import { randomUUID } from "node:crypto";
import {
  recordingSchema,
  type Recording,
  type RunCommand,
  type TelemetryManifest,
} from "@blackout/contracts";
import { createSnapshot } from "./aggregation.js";
import { fixtureObservations } from "./fixtures.js";
import { createScenarioPlan } from "./scenarios.js";
import {
  baselineObservations,
  generateWarmup,
  observe,
  orderObservations,
} from "./telemetry.js";

export type ReplayResult =
  | { status: "created"; recording: Recording }
  | { status: "incompatible"; sourceRunId: string; message: string };

function compatibleManifest(
  recording: Recording,
): recording is Recording & { run: { manifest: TelemetryManifest } } {
  const manifest = recording.run.manifest;
  return (
    manifest.schemaVersion === 2 &&
    manifest.generatorVersion === "telemetry/1" &&
    (manifest.scenarioVersion === "fixtures/1" ||
      manifest.scenarioVersion === "scenarios/1") &&
    (manifest.aggregatorVersion === "rolling-state/1" ||
      manifest.aggregatorVersion === "rolling-state/2")
  );
}

function interactiveManifest(
  manifest: TelemetryManifest,
  injection: {
    fixture: "credential-compromise" | "benign-maintenance";
    startedAtMs: number;
    stoppedAtMs: number | null;
  } | null,
): TelemetryManifest {
  if (!injection || injection.stoppedAtMs !== null)
    return {
      ...manifest,
      fixture: "baseline",
      scenarioVersion: "fixtures/1",
      scenario: undefined,
    };
  const plan = createScenarioPlan(
    {
      seed: manifest.seed,
      durationSeconds: manifest.durationSeconds,
      fixture: injection.fixture,
      evaluate: false,
      interactive: false,
    },
    manifest.organization,
  )!;
  const offset = injection.startedAtMs - 4000;
  return {
    ...manifest,
    fixture: injection.fixture,
    scenarioVersion: "scenarios/1",
    scenario: {
      ...plan,
      stopAtMs: plan.stopAtMs + offset,
      stages: plan.stages.map((stage) => ({
        ...stage,
        startMs: stage.startMs + offset,
        endExclusiveMs: stage.endExclusiveMs + offset,
      })),
    },
  };
}

function comparable(event: Recording["events"][number]) {
  return JSON.stringify({ ...event, runId: "source" });
}

export function recreateTelemetry(source: Recording): ReplayResult {
  if (!compatibleManifest(source))
    return {
      status: "incompatible",
      sourceRunId: source.run.id,
      message:
        "This recording cannot be reproduced by the installed telemetry/1 generator and supported schema versions.",
    };

  const manifest = source.run.manifest;
  const runId = randomUUID();
  const events = generateWarmup(manifest, runId);
  const snapshots = [createSnapshot(runId, manifest.organization, events, 0)];
  let evidence = [...events];
  let injection: NonNullable<Recording["run"]["controls"]>["injection"] = null;
  let manuallyStopped = false;
  const commandsAt = new Map<number, RunCommand[]>();
  for (const command of source.commands) {
    const values = commandsAt.get(command.simulationTimeMs) ?? [];
    values.push(command);
    commandsAt.set(command.simulationTimeMs, values);
  }
  const applyCommands = (simulationTimeMs: number) => {
    for (const command of commandsAt.get(simulationTimeMs) ?? []) {
      if (command.type === "begin-injection" && command.parameters?.fixture)
        injection = {
          fixture: command.parameters.fixture as
            "credential-compromise" | "benign-maintenance",
          startedAtMs: command.simulationTimeMs,
          stoppedAtMs: null,
        };
      if (command.type === "stop-injection") {
        if (injection)
          injection = {
            ...injection,
            stoppedAtMs: command.simulationTimeMs,
          };
        if (command.request) manuallyStopped = true;
      }
    }
  };
  applyCommands(0);

  let lastSequence = events.at(-1)!.sequence;
  for (
    let simulationTimeMs = manifest.tickMs;
    simulationTimeMs <= source.run.simulationTimeMs;
    simulationTimeMs += manifest.tickMs
  ) {
    let generationManifest = manifest;
    if (manifest.interactive)
      generationManifest = interactiveManifest(manifest, injection);
    else if (manuallyStopped)
      generationManifest = {
        ...manifest,
        fixture: "baseline",
        scenarioVersion: "fixtures/1",
        scenario: undefined,
      };
    const fixture = fixtureObservations(generationManifest, simulationTimeMs);
    const observations = orderObservations(manifest, simulationTimeMs, [
      ...baselineObservations(manifest, simulationTimeMs),
      ...fixture.observations,
    ]);
    const generated = observations.map((observation, index) =>
      observe(
        observation,
        manifest,
        runId,
        simulationTimeMs,
        lastSequence + index + 1,
      ),
    );
    events.push(...generated);
    lastSequence = generated.at(-1)!.sequence;
    evidence = [...evidence, ...generated].filter(
      (event) => event.simulationTimeMs > simulationTimeMs - manifest.warmupMs,
    );
    snapshots.push(
      createSnapshot(runId, manifest.organization, evidence, simulationTimeMs),
    );
    applyCommands(simulationTimeMs);
  }

  const sourceComparable = source.events.map(comparable);
  const reproducedComparable = events.map(comparable);
  const mismatchIndex = sourceComparable.findIndex(
    (event, index) => event !== reproducedComparable[index],
  );
  const firstMismatch =
    mismatchIndex >= 0
      ? (source.events[mismatchIndex]?.sequence ?? mismatchIndex + 1)
      : sourceComparable.length === reproducedComparable.length
        ? null
        : Math.min(sourceComparable.length, reproducedComparable.length) + 1;
  const now = new Date().toISOString();
  const recording = recordingSchema.parse({
    run: {
      id: runId,
      manifest,
      status: "completed",
      simulationTimeMs: source.run.simulationTimeMs,
      lastSequence,
      createdAt: now,
      endedAt: now,
      revision: 0,
      controls: source.run.controls
        ? {
            ...source.run.controls,
            paused: false,
            pausedAttemptId: null,
            waitingForInference: false,
            pendingApplication: false,
          }
        : undefined,
      derivation: {
        type: "telemetry-rerun",
        sourceRunId: source.run.id,
        compatibility: "compatible",
        eventsMatch: firstMismatch === null,
        sourceEventCount: source.events.length,
        reproducedEventCount: events.length,
        firstMismatchSequence: firstMismatch,
      },
    },
    events,
    snapshots,
    attempts: [],
    investigationHistory: [],
    commands: source.commands.map((command) => {
      const copy: RunCommand = { ...command, runId };
      delete copy.resultRunId;
      return copy;
    }),
  });
  return { status: "created", recording };
}
