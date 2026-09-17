import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  recordingSchema,
  type ControlRun,
  type JevResponse,
  type Recording,
} from "@blackout/contracts";
import { PlaybackIndex } from "../../web/src/app/playback.js";
import { openDatabase } from "../src/database.js";
import { recreateTelemetry } from "../src/replay.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function jevResponse(classification: "normal" | "compromise"): JevResponse {
  const compromise = classification === "compromise";
  return {
    model: `jev-m7-${classification}`,
    answers: {
      compromise: { type: "noul", noul: compromise ? 0.95 : 0.05 },
      classification: {
        type: "choice",
        choice: classification,
        confidence: 0.95,
        probabilities: {
          normal: compromise ? 0.02 : 0.95,
          benign_anomaly: 0.01,
          suspicious: 0.02,
          compromise: compromise ? 0.95 : 0.02,
        },
      },
      severity: {
        type: "score",
        score: compromise ? 3 : 0,
        confidence: 0.95,
        probabilities: compromise
          ? { "0": 0, "1": 0, "2": 0, "3": 1 }
          : { "0": 1, "1": 0, "2": 0, "3": 0 },
        legend: {
          "0": "none",
          "1": "low",
          "2": "high",
          "3": "critical",
        },
      },
      response: {
        type: "choice",
        choice: compromise ? "escalate" : "observe",
        confidence: 0.95,
        probabilities: compromise
          ? { observe: 0.02, investigate: 0.03, escalate: 0.95 }
          : { observe: 0.95, investigate: 0.03, escalate: 0.02 },
      },
    },
  };
}

function store(fetch?: typeof globalThis.fetch) {
  const database = openDatabase(":memory:");
  const recordings = new Recordings(database);
  const runs = new Runs(
    recordings,
    fetch ? { apiKey: "m7-test-key", fetch } : {},
  );
  cleanup.push(async () => {
    await runs.close();
    database.close();
  });
  return { recordings, runs };
}

function command(type: "pause" | "resume" | "stop-injection"): ControlRun {
  return { commandId: randomUUID(), type };
}

function comparableEvents(recording: Recording) {
  return recording.events.map((event) => ({ ...event, runId: "recording" }));
}

it("recreates full interactive telemetry and command timing in a separate linked recording", () => {
  const { recordings, runs } = store();
  const id = runs.start({
    seed: "m7-rerun",
    durationSeconds: 10,
    interactive: true,
  }).run.id;
  runs.tick();
  runs.control(id, {
    commandId: randomUUID(),
    type: "begin-injection",
    fixture: "credential-compromise",
  });
  for (let index = 0; index < 6; index++) runs.tick();
  runs.control(id, command("pause"));
  runs.control(id, command("stop-injection"));
  runs.control(id, command("resume"));
  runs.control(id, {
    commandId: randomUUID(),
    type: "set-speed",
    speed: 5,
  });
  for (let index = 0; index < 3; index++) runs.tick();
  const original = recordings.get(id)!;
  expect(original.run.status).toBe("completed");

  const result = runs.rerun(id);
  expect(result.status).toBe("created");
  if (result.status !== "created") throw new Error("Expected a rerun");
  const reproduced = result.recording;
  expect(reproduced.run.id).not.toBe(id);
  expect(reproduced.run.derivation).toMatchObject({
    type: "telemetry-rerun",
    sourceRunId: id,
    eventsMatch: true,
    firstMismatchSequence: null,
  });
  expect(comparableEvents(reproduced)).toEqual(comparableEvents(original));
  expect(reproduced.snapshots.map((snapshot) => snapshot.input)).toEqual(
    original.snapshots.map((snapshot) => snapshot.input),
  );
  expect(
    reproduced.commands.map(({ type, sequence, simulationTimeMs }) => ({
      type,
      sequence,
      simulationTimeMs,
    })),
  ).toEqual(
    original.commands.map(({ type, sequence, simulationTimeMs }) => ({
      type,
      sequence,
      simulationTimeMs,
    })),
  );
  expect(recordings.get(id)).toEqual(original);
  expect(reproduced.attempts).toEqual([]);
});

it("returns an explicit compatibility result for a legacy generator", () => {
  const id = randomUUID();
  const source = recordingSchema.parse({
    run: {
      id,
      manifest: {
        seed: "legacy",
        simulationOrigin: "2026-01-01T09:00:00.000Z",
        durationSeconds: 1,
        tickMs: 1000,
        initialState: { users: ["user"], hosts: ["host"], resources: ["mail"] },
        generatorVersion: "authentication/1",
        scenarioVersion: "baseline/1",
        schemaVersion: 1,
        policyVersion: null,
        evaluatorVersion: null,
        requestedModel: null,
        resolvedModel: null,
      },
      status: "completed",
      simulationTimeMs: 1000,
      lastSequence: 0,
      createdAt: "2026-01-01T09:00:00.000Z",
      endedAt: "2026-01-01T09:00:01.000Z",
      revision: 0,
    },
    events: [],
    commands: [],
    snapshots: [],
    attempts: [],
    investigationHistory: [],
  });
  expect(recreateTelemetry(source)).toEqual({
    status: "incompatible",
    sourceRunId: id,
    message:
      "This recording cannot be reproduced by the installed telemetry/1 generator and supported schema versions.",
  });
});

it("reevaluates original checkpoints with fresh decisions without mutating source evidence", async () => {
  const originalFetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(jevResponse("normal")),
  );
  const { recordings, runs } = store(originalFetch);
  const id = runs.start({
    seed: "m7-reevaluation",
    durationSeconds: 1,
    evaluate: true,
  }).run.id;
  await runs.settled();
  runs.tick();
  await runs.settled();
  const original = recordings.get(id)!;
  const originalBytes = JSON.stringify(original);

  const freshFetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(jevResponse("compromise")),
  );
  const reevaluator = new Runs(recordings, {
    apiKey: "fresh-m7-key",
    fetch: freshFetch,
  });
  cleanup.push(() => reevaluator.close());
  const result = await reevaluator.reevaluate(id);
  expect(result.status).toBe("created");
  if (result.status !== "created") throw new Error("Expected reevaluation");
  const fresh = result.recording;
  expect(fresh.run.derivation).toMatchObject({
    type: "reevaluation",
    sourceRunId: id,
    questionVersion: "security-questions/3",
    requestedModel: "jev-1.13.0",
  });
  expect(fresh.events).toEqual(original.events);
  expect(fresh.snapshots).toEqual(original.snapshots);
  expect(fresh.attempts.map((attempt) => attempt.simulationTimeMs)).toEqual(
    original.attempts.map((attempt) => attempt.simulationTimeMs),
  );
  expect(
    fresh.attempts.every(
      (attempt) =>
        attempt.response?.answers.classification.choice === "compromise",
    ),
  ).toBe(true);
  expect(
    original.attempts.every(
      (attempt) => attempt.response?.answers.classification.choice === "normal",
    ),
  ).toBe(true);
  expect(JSON.stringify(recordings.get(id))).toBe(originalBytes);
  expect(freshFetch).toHaveBeenCalledTimes(original.attempts.length);
});

it("records bounded unavailable reevaluation attempts instead of changing the original", async () => {
  const { recordings, runs } = store();
  const id = runs.start({ seed: "m7-unavailable", durationSeconds: 1 }).run.id;
  runs.tick();
  const original = recordings.get(id)!;
  const result = await runs.reevaluate(id);
  expect(result.status).toBe("created");
  if (result.status !== "created") throw new Error("Expected reevaluation");
  expect(result.recording.attempts).toHaveLength(2);
  expect(
    result.recording.attempts.every(
      (attempt) =>
        attempt.status === "failed" && attempt.error?.code === "unavailable",
    ),
  ).toBe(true);
  expect(recordings.get(id)).toEqual(original);
});

it("seeks repeatedly without exposing decisions or actions before their application point", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(jevResponse("compromise")),
  );
  const { recordings, runs } = store(fetch);
  const id = runs.start({
    seed: "m7-seek",
    durationSeconds: 1,
    evaluate: true,
  }).run.id;
  await runs.settled();
  runs.tick();
  await runs.settled();
  const source = recordings.get(id)!;
  const first = source.attempts[0]!;
  const delayed = recordingSchema.parse({
    ...source,
    attempts: source.attempts.map((attempt) =>
      attempt.id === first.id
        ? { ...attempt, appliedSimulationTimeMs: 1000 }
        : attempt,
    ),
    investigationHistory: source.investigationHistory.map((event) =>
      event.attemptId === first.id
        ? { ...event, simulationTimeMs: 1000 }
        : event,
    ),
  });
  const index = new PlaybackIndex(delayed);
  const start = index.at(0);
  const end = index.at(1000);
  expect(start.attempts.map((attempt) => attempt.id)).not.toContain(first.id);
  expect(start.investigationHistory).toHaveLength(0);
  expect(end.attempts.map((attempt) => attempt.id)).toContain(first.id);
  expect(end.investigationHistory.map((event) => event.attemptId)).toContain(
    first.id,
  );
  expect(index.at(0)).toEqual(start);
  expect(index.at(1000)).toEqual(end);
  expect(index.at(0)).toEqual(start);
});
