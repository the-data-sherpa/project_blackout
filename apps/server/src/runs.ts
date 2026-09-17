import { randomUUID } from "node:crypto";
import {
  controlRunSchema,
  investigationActionSchema,
  investigationStatus,
  runMessageSchema,
  recordingSchema,
  runOperationResultSchema,
  startRunSchema,
  type InferenceAttempt,
  type Run,
  type RunCommand,
  type RunMessage,
  type StartRun,
  type TelemetryEvent,
  type ObservableSnapshot,
} from "@blackout/contracts";
import {
  baselineObservations,
  createTelemetryManifest,
  generateWarmup,
  observe,
  orderObservations,
} from "./telemetry.js";
import { fixtureObservations } from "./fixtures.js";
import { createScenarioPlan, scheduledCommands } from "./scenarios.js";
import { createSnapshot } from "./aggregation.js";
import { Recordings } from "./recordings.js";
import {
  Evaluator,
  questionVersion,
  type EvaluatorOptions,
} from "./evaluator.js";
import { evaluatePolicy } from "./policy.js";
import { recreateTelemetry } from "./replay.js";

export class RunError extends Error {
  constructor(
    readonly code:
      | "run_active"
      | "recording_unavailable"
      | "invalid_transition"
      | "command_conflict",
    message: string,
  ) {
    super(message);
  }
}

export class Runs {
  private current: Run | null = null;
  private evidence: TelemetryEvent[] = [];
  private readonly listeners = new Set<(message: RunMessage) => void>();
  private readonly evaluator: Evaluator;
  private pending: Promise<void> | null = null;
  private readonly outstanding = new Set<Promise<void>>();
  private readonly reevaluations = new Set<Promise<unknown>>();
  private readonly reevaluationController = new AbortController();
  private controller = new AbortController();
  private nextTickAt = 0;
  private failure: Extract<RunMessage, { type: "recording.error" }> | null =
    null;

  constructor(
    readonly recordings: Recordings,
    options: EvaluatorOptions = {},
  ) {
    this.evaluator = new Evaluator(options);
    this.interrupt();
  }

  subscribe(listener: (message: RunMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  get recordingFailure() {
    return this.failure;
  }

  private available() {
    if (this.failure)
      throw new RunError("recording_unavailable", this.failure.message);
  }

  private duplicate(input: { commandId?: string | undefined }, runId?: string) {
    if (!input.commandId) return null;
    const command = this.recordings.command(input.commandId);
    if (!command) return null;
    if (
      (runId && command.runId !== runId) ||
      JSON.stringify(command.request) !== JSON.stringify(input)
    )
      throw new RunError(
        "command_conflict",
        "This command ID was already used for a different request.",
      );
    const recording = this.recordings.get(command.resultRunId ?? command.runId);
    if (!recording)
      throw new RunError(
        "invalid_transition",
        "This command's recording was deleted. Use a new command ID to start another run.",
      );
    return recording;
  }

  private prepare(input: StartRun) {
    const manifest = createTelemetryManifest(input);
    if (input.evaluate) {
      manifest.evaluation = this.evaluator.config;
      manifest.policy = this.evaluator.policy;
      manifest.policyVersion = this.evaluator.policy.version;
      manifest.evaluatorVersion = questionVersion;
      manifest.requestedModel = this.evaluator.model;
      manifest.investigation = {
        version: "investigation-policy/1",
        trigger: "incident_advisory",
        consecutiveDecisions: 1,
        resolution: "operator-only",
        afterClosure: "reopen-on-next-matching-decision",
      };
    }
    const run: Run = {
      id: randomUUID(),
      manifest,
      status: "running",
      simulationTimeMs: 0,
      lastSequence: 0,
      createdAt: new Date().toISOString(),
      endedAt: null,
      revision: 0,
      controls: {
        paused: false,
        requestedSpeed: 1,
        waitingForInference: false,
        pendingApplication: false,
        elapsedWallMs: 0,
        injection: null,
      },
    };
    const events = generateWarmup(manifest, run.id);
    run.lastSequence = events.at(-1)!.sequence;
    const snapshot = createSnapshot(run.id, manifest.organization, events, 0);
    const command: RunCommand = {
      runId: run.id,
      type: "start",
      sequence: 1,
      simulationTimeMs: 0,
      recordedAt: run.createdAt,
      parameters: { fixture: manifest.fixture },
      ...(input.commandId ? { request: input } : {}),
    };
    return { run, events, snapshot, command };
  }

  private activate(prepared: ReturnType<Runs["prepare"]>) {
    this.current = prepared.run;
    this.evidence = prepared.events;
    this.pending = null;
    this.controller = new AbortController();
    this.repace();
    if (
      prepared.run.manifest.schemaVersion === 2 &&
      prepared.run.manifest.evaluation
    )
      this.evaluate(prepared.snapshot);
  }

  start(input: unknown) {
    const parsed = startRunSchema.parse(input);
    this.available();
    const duplicate = this.duplicate(parsed);
    if (duplicate) return duplicate;
    if (this.recordings.active())
      throw new RunError(
        "run_active",
        "A run is already active. Reset it or wait for it to finish.",
      );
    const prepared = this.prepare(parsed);
    this.recordings.create(
      prepared.run,
      prepared.command,
      prepared.events,
      prepared.snapshot,
    );
    this.activate(prepared);
    return this.recordings.get(prepared.run.id)!;
  }

  rerun(runId: string) {
    const source = this.recordings.get(runId);
    if (!source)
      throw new RunError("invalid_transition", "This recording was not found.");
    if (source.run.status === "running")
      throw new RunError(
        "invalid_transition",
        "Wait for the source run to finish before creating a linked recording.",
      );
    const result = recreateTelemetry(source);
    if (result.status === "incompatible")
      return runOperationResultSchema.parse(result);
    this.recordings.createDerived(result.recording);
    return runOperationResultSchema.parse({
      status: "created",
      recording: this.recordings.get(result.recording.run.id)!,
    });
  }

  async reevaluate(runId: string) {
    const release = this.recordings.storage.retain(runId);
    const operation = this.reevaluateSource(runId);
    this.reevaluations.add(operation);
    try {
      return await operation;
    } finally {
      release();
      this.reevaluations.delete(operation);
    }
  }

  private async reevaluateSource(runId: string) {
    const source = this.recordings.get(runId);
    if (!source)
      throw new RunError("invalid_transition", "This recording was not found.");
    if (source.run.status === "running")
      throw new RunError(
        "invalid_transition",
        "Wait for the source run to finish before creating a linked recording.",
      );
    if (source.run.manifest.schemaVersion !== 2)
      return runOperationResultSchema.parse({
        status: "incompatible",
        sourceRunId: runId,
        message:
          "This recording has no compatible observable snapshots for fresh evaluation.",
      });
    const sourceSnapshotIds = new Set(
      source.attempts.map((attempt) => attempt.snapshotId),
    );
    const checkpoints = source.snapshots.filter(
      (snapshot) =>
        snapshot.simulationTimeMs >= 0 &&
        (sourceSnapshotIds.size
          ? sourceSnapshotIds.has(snapshot.id)
          : snapshot.simulationTimeMs % this.evaluator.config.checkpointMs ===
              0 || snapshot.simulationTimeMs === source.run.simulationTimeMs),
    );
    if (!checkpoints.length)
      return runOperationResultSchema.parse({
        status: "incompatible",
        sourceRunId: runId,
        message:
          "This recording has no compatible observable snapshots for fresh evaluation.",
      });

    const id = randomUUID();
    const attempts = new Map<string, InferenceAttempt>();
    const storedSnapshots = checkpoints.map((snapshot) => ({
      ...snapshot,
      runId: id,
    }));
    for (const snapshot of storedSnapshots)
      await this.evaluator.checkpoint(
        snapshot,
        (attempt) => {
          attempts.set(
            attempt.id,
            attempt.status === "pending"
              ? attempt
              : {
                  ...attempt,
                  appliedAt: attempt.completedAt,
                  appliedSimulationTimeMs: attempt.simulationTimeMs,
                },
          );
        },
        this.reevaluationController.signal,
      );
    if (this.reevaluationController.signal.aborted)
      throw new RunError(
        "invalid_transition",
        "Fresh evaluation was interrupted by backend shutdown. The source recording is retained; retry after restart.",
      );
    const orderedAttempts = [...attempts.values()].sort(
      (a, b) =>
        a.simulationTimeMs - b.simulationTimeMs ||
        a.attemptNumber - b.attemptNumber,
    );
    const resolvedModel = [...orderedAttempts]
      .reverse()
      .find((attempt) => attempt.response)?.response?.model;
    const now = new Date().toISOString();
    const manifest = {
      ...source.run.manifest,
      evaluation: this.evaluator.config,
      policy: this.evaluator.policy,
      investigation: undefined,
      policyVersion: this.evaluator.policy.version,
      evaluatorVersion: questionVersion,
      requestedModel: this.evaluator.model,
      resolvedModel: resolvedModel ?? null,
    };
    const recording = recordingSchema.parse({
      run: {
        id,
        manifest,
        status: "completed",
        simulationTimeMs: source.run.simulationTimeMs,
        lastSequence: source.run.lastSequence,
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
          type: "reevaluation",
          sourceRunId: runId,
          checkpointMs:
            source.run.manifest.evaluation?.checkpointMs ??
            this.evaluator.config.checkpointMs,
          questionVersion,
          requestedModel: this.evaluator.model,
          policyVersion: this.evaluator.policy.version,
        },
      },
      events: [],
      commands: [],
      snapshots: storedSnapshots,
      attempts: orderedAttempts,
      investigationHistory: [],
    });
    this.recordings.createDerived(recording, storedSnapshots);
    return runOperationResultSchema.parse({
      status: "created",
      recording: this.recordings.get(id)!,
    });
  }

  control(runId: string, input: unknown) {
    const request = controlRunSchema.parse(input);
    this.available();
    const duplicate = this.duplicate(request, runId);
    if (duplicate) return duplicate;
    const run =
      this.current ??
      (request.type === "reset" ? this.recordings.run(runId) : null);
    if (
      !run ||
      run.id !== runId ||
      (run.status !== "running" && request.type !== "reset")
    )
      throw new RunError(
        "invalid_transition",
        "This run is no longer active. Load the active run before sending controls.",
      );
    const controls = { ...run.controls! };
    const invalid = (message: string): never => {
      throw new RunError("invalid_transition", message);
    };
    const command: RunCommand = {
      runId,
      type: request.type,
      sequence: this.recordings.nextCommandSequence(runId),
      simulationTimeMs: run.simulationTimeMs,
      recordedAt: new Date().toISOString(),
      request,
    };
    switch (request.type) {
      case "pause":
        if (controls.paused) invalid("This run is already paused.");
        controls.paused = true;
        controls.pausedAttemptId =
          this.recordings.attempts(runId).at(-1)?.id ?? null;
        break;
      case "resume":
        if (!controls.paused) invalid("This run is already running.");
        controls.paused = false;
        controls.pausedAttemptId = null;
        break;
      case "set-speed":
        controls.requestedSpeed = request.speed;
        command.parameters = { speed: request.speed };
        break;
      case "begin-injection":
        if (run.manifest.schemaVersion !== 2 || !run.manifest.interactive)
          invalid(
            "Begin is available on interactive runs. Start an interactive run first.",
          );
        if (controls.injection && controls.injection.stoppedAtMs === null)
          invalid(
            "Injection is already active. Stop it before beginning another scenario.",
          );
        if (run.simulationTimeMs >= run.manifest.durationSeconds * 1000)
          invalid(
            "The final checkpoint is already reached. Reset to begin a new scenario.",
          );
        controls.injection = {
          fixture: request.fixture,
          startedAtMs: run.simulationTimeMs,
          stoppedAtMs: null,
        };
        command.parameters = { fixture: request.fixture };
        break;
      case "stop-injection":
        if (!controls.injection || controls.injection.stoppedAtMs !== null)
          invalid("No injection is active.");
        controls.injection = {
          ...controls.injection!,
          stoppedAtMs: run.simulationTimeMs,
        };
        break;
      case "reset": {
        const manifest = run.manifest;
        if (manifest.schemaVersion !== 2)
          return invalid("Legacy recordings cannot be reset.");
        const prepared = this.prepare(
          startRunSchema.parse({
            seed: manifest.seed,
            durationSeconds: manifest.durationSeconds,
            fixture: manifest.fixture,
            interactive: manifest.interactive ?? false,
            evaluate: Boolean(manifest.evaluation),
            ...(manifest.scenario &&
            manifest.scenario.stopAtMs <= manifest.durationSeconds * 1000
              ? { stopInjectionAtSeconds: manifest.scenario.stopAtMs / 1000 }
              : {}),
          }),
        );
        command.resultRunId = prepared.run.id;
        const ended = this.revise({
          ...run,
          ...(run.status === "running"
            ? {
                status: "interrupted" as const,
                endedAt: command.recordedAt,
                endedReason: "reset" as const,
                controls: { ...controls, waitingForInference: false },
              }
            : {}),
          replacementRunId: prepared.run.id,
        });
        this.recordings.transaction(() => {
          this.recordings.commit(ended, [], undefined, undefined, [command]);
          this.recordings.create(
            prepared.run,
            prepared.command,
            prepared.events,
            prepared.snapshot,
          );
        });
        this.controller.abort();
        this.activate(prepared);
        this.publish({
          type: "run.updated",
          run: ended,
          events: [],
          commands: [command],
        });
        return this.recordings.get(prepared.run.id)!;
      }
    }
    let updated = this.revise({ ...run, controls });
    const applied =
      request.type === "resume"
        ? this.recordings
            .attempts(runId)
            .filter(
              (attempt) =>
                attempt.status !== "pending" && attempt.appliedAt === null,
            )
            .map((attempt) => this.applyAttempt(attempt, updated))
        : [];
    if (request.type === "resume") {
      updated.controls!.pendingApplication = false;
      const response = [...applied]
        .reverse()
        .find((attempt) => attempt.response)?.response;
      if (response)
        updated.manifest = {
          ...updated.manifest,
          resolvedModel: response.model,
        };
      if (
        !this.pending &&
        run.simulationTimeMs === run.manifest.durationSeconds * 1000
      )
        updated = {
          ...updated,
          status: "completed",
          endedAt: command.recordedAt,
        };
    }
    this.recordings.transaction(() => {
      for (const attempt of applied)
        this.recordings.saveAttempt(attempt, updated);
      this.recordings.commit(updated, [], undefined, undefined, [command]);
    });
    this.current = updated.status === "running" ? updated : null;
    this.repace();
    this.publish({
      type: "run.updated",
      run: updated,
      events: [],
      commands: [command],
      attempts: applied,
      investigationHistory: this.recordings.investigationHistory(runId),
    });
    return this.recordings.get(runId)!;
  }

  investigate(runId: string, input: unknown) {
    const request = investigationActionSchema.parse(input);
    this.available();
    const previous = this.recordings.investigationRequest(request.commandId);
    if (previous) {
      if (
        previous.runId !== runId ||
        JSON.stringify(previous.request) !== JSON.stringify(request)
      )
        throw new RunError(
          "command_conflict",
          "This action ID was already used for a different request.",
        );
      return this.recordings.get(runId)!;
    }
    const run = this.recordings.run(runId);
    const history = this.recordings.investigationHistory(runId);
    const status = investigationStatus(history);
    if (
      !run ||
      history.at(-1)?.sequence !== request.expectedSequence ||
      (request.type === "acknowledge"
        ? status !== "open"
        : status !== "open" && status !== "acknowledged")
    )
      throw new RunError(
        "invalid_transition",
        "The investigation changed or this action is unavailable. Refresh the recording before trying again.",
      );
    const updated = this.revise(run);
    this.recordings.transaction(() => {
      this.recordings.saveInvestigation({
        runId,
        sequence: request.expectedSequence + 1,
        runRevision: updated.revision,
        simulationTimeMs: run.simulationTimeMs,
        recordedAt: new Date().toISOString(),
        version: "investigation-policy/1",
        type: request.type === "acknowledge" ? "acknowledged" : "closed",
        actor: "local-operator",
        attemptId: null,
        snapshotId: null,
        request,
      });
      this.recordings.commit(updated);
    });
    if (this.current?.id === runId) this.current = updated;
    this.publish({
      type: "run.updated",
      run: updated,
      events: [],
      investigationHistory: this.recordings.investigationHistory(runId),
    });
    return this.recordings.get(runId)!;
  }

  private revise(run: Run): Run {
    return {
      ...run,
      revision: run.revision + 1,
      ...(run.controls
        ? {
            controls: {
              ...run.controls,
              elapsedWallMs: Math.max(
                0,
                (run.endedAt ? Date.parse(run.endedAt) : Date.now()) -
                  Date.parse(run.createdAt),
              ),
            },
          }
        : {}),
    };
  }
  private repace(now = performance.now()) {
    this.nextTickAt =
      now + 1000 / (this.current?.controls?.requestedSpeed ?? 1);
  }
  // Production uses a short wall-clock pulse. Tests can advance one exact simulation step with tick().
  pulse(now = performance.now()) {
    if (!this.current || this.current.controls?.paused || this.pending) {
      this.repace(now);
      return;
    }
    if (now < this.nextTickAt) return;
    this.tick();
    // Never catch up by dropping checkpoints or bursting after a pause/inference wait.
    this.repace(now);
  }

  tick() {
    if (this.failure || this.pending || this.current?.controls?.paused) return;
    const run = this.current;
    if (!run) return;
    let message: RunMessage;
    let checkpoint: ObservableSnapshot | undefined;
    try {
      const simulationTimeMs = run.simulationTimeMs + run.manifest.tickMs;
      const manifest = run.manifest;
      if (manifest.schemaVersion !== 2)
        throw new Error("Legacy runs cannot resume generation");
      let injectionManifest = manifest;
      let commands = scheduledCommands(manifest, run.id, simulationTimeMs);
      let controls = { ...run.controls! };
      if (manifest.interactive) {
        commands = [];
        const injection = controls.injection;
        if (injection && injection.stoppedAtMs === null) {
          const plan = createScenarioPlan(
            startRunSchema.parse({
              seed: manifest.seed,
              fixture: injection.fixture,
            }),
            manifest.organization,
          )!;
          const offset = injection.startedAtMs - 4000;
          const scenario = {
            ...plan,
            stopAtMs: plan.stopAtMs + offset,
            stages: plan.stages.map((stage) => ({
              ...stage,
              startMs: stage.startMs + offset,
              endExclusiveMs: stage.endExclusiveMs + offset,
            })),
          };
          injectionManifest = {
            ...manifest,
            fixture: injection.fixture,
            scenarioVersion: "scenarios/1",
            scenario,
          };
          if (simulationTimeMs === scenario.stopAtMs) {
            controls = {
              ...controls,
              injection: { ...injection, stoppedAtMs: simulationTimeMs },
            };
            commands = [
              {
                runId: run.id,
                type: "stop-injection",
                sequence: 0,
                simulationTimeMs,
                recordedAt: new Date().toISOString(),
                parameters: { fixture: injection.fixture },
              },
            ];
          }
        }
      } else {
        for (const command of commands) {
          if (command.type === "begin-injection" && manifest.scenario)
            controls.injection = {
              fixture: manifest.fixture as
                "credential-compromise" | "benign-maintenance",
              startedAtMs: simulationTimeMs,
              stoppedAtMs: null,
            };
          if (command.type === "stop-injection" && controls.injection)
            controls.injection = {
              ...controls.injection,
              stoppedAtMs: simulationTimeMs,
            };
        }
        // An operator stop overrides the remaining prerecorded scenario schedule.
        if (
          run.controls?.injection?.stoppedAtMs !== null &&
          run.controls?.injection
        ) {
          injectionManifest = {
            ...manifest,
            fixture: "baseline",
            scenarioVersion: "fixtures/1",
            scenario: undefined,
          };
          commands = [];
        }
      }
      if (commands.length) {
        const sequence = this.recordings.nextCommandSequence(run.id);
        commands = commands.map((command, index) => ({
          ...command,
          sequence: sequence + index,
        }));
      }
      const fixture = fixtureObservations(injectionManifest, simulationTimeMs);
      const observations = orderObservations(manifest, simulationTimeMs, [
        ...baselineObservations(manifest, simulationTimeMs),
        ...fixture.observations,
      ]);
      const events = observations.map((observation, index) =>
        observe(
          observation,
          manifest,
          run.id,
          simulationTimeMs,
          run.lastSequence + index + 1,
        ),
      );
      const evidence = [...this.evidence, ...events].filter(
        (event) =>
          event.simulationTimeMs > simulationTimeMs - manifest.warmupMs,
      );
      const snapshot = createSnapshot(
        run.id,
        manifest.organization,
        evidence,
        simulationTimeMs,
      );
      const injected = new Set(fixture.observations);
      const truth = fixture.truth
        ? {
            ...fixture.truth,
            runId: run.id,
            eventSequences: events
              .filter((_event, index) => injected.has(observations[index]!))
              .map((event) => event.sequence),
          }
        : undefined;
      const complete = simulationTimeMs === manifest.durationSeconds * 1000;
      if (
        manifest.evaluation &&
        (simulationTimeMs % manifest.evaluation.checkpointMs === 0 || complete)
      )
        checkpoint = snapshot;
      const finished = complete && !checkpoint;
      const updated = this.revise({
        ...run,
        controls,
        simulationTimeMs,
        lastSequence: events.at(-1)!.sequence,
        status: finished ? "completed" : "running",
        endedAt: finished ? new Date().toISOString() : null,
      });
      message = runMessageSchema.parse({
        type: "run.updated",
        run: updated,
        events,
        snapshot,
        ...(commands.length ? { commands } : {}),
      });
      this.recordings.commit(updated, events, snapshot, truth, commands);
      this.evidence = finished ? [] : evidence;
      this.current = finished ? null : updated;
    } catch {
      this.fail(
        run,
        "Recording failed. Generation stopped at the last saved step. Restart the backend after checking storage.",
      );
      return;
    }
    this.publish(message);
    if (checkpoint) this.evaluate(checkpoint);
  }

  private applyAttempt(attempt: InferenceAttempt, run: Run): InferenceAttempt {
    return {
      ...attempt,
      appliedAt: new Date().toISOString(),
      appliedSimulationTimeMs: run.simulationTimeMs,
    };
  }

  private evaluate(snapshot: ObservableSnapshot) {
    const signal = this.controller.signal;
    const task = this.evaluator
      .checkpoint(
        snapshot,
        (value) => {
          // Read the owning run even after reset: an old response may only mutate its recording.
          const owner = this.recordings.run(snapshot.runId)!;
          const live =
            this.current?.id === owner.id &&
            owner.status === "running" &&
            !signal.aborted;
          let attempt: InferenceAttempt = {
            ...value,
            appliedAt: null,
            appliedSimulationTimeMs: null,
          };
          if (live && !owner.controls!.paused && attempt.status !== "pending")
            attempt = this.applyAttempt(attempt, owner);
          const updated = this.revise({
            ...owner,
            controls: {
              ...owner.controls!,
              waitingForInference: live,
              pendingApplication:
                owner.controls!.pendingApplication ||
                (live &&
                  owner.controls!.paused &&
                  attempt.status !== "pending"),
            },
            manifest:
              attempt.response && attempt.appliedAt
                ? { ...owner.manifest, resolvedModel: attempt.response.model }
                : owner.manifest,
          });
          this.recordings.saveAttempt(attempt, updated);
          if (live) this.current = updated;
          this.publish({
            type: "inference.updated",
            runId: owner.id,
            run: updated,
            attempt,
            investigationHistory: this.recordings.investigationHistory(
              owner.id,
            ),
          });
        },
        signal,
      )
      .then(() => {
        if (signal.aborted || this.current?.id !== snapshot.runId) return;
        const run = this.current;
        const complete =
          !run.controls!.paused &&
          run.simulationTimeMs === run.manifest.durationSeconds * 1000;
        const updated = this.revise({
          ...run,
          controls: { ...run.controls!, waitingForInference: false },
          status: complete ? "completed" : "running",
          endedAt: complete ? new Date().toISOString() : null,
        });
        this.recordings.commit(updated);
        this.current = complete ? null : updated;
        if (complete) this.evidence = [];
        this.publish({ type: "run.updated", run: updated, events: [] });
      })
      .catch(() => {
        // Persistence errors in an old request must not mark a replacement run failed.
        const owner = this.recordings.run(snapshot.runId);
        if (owner)
          this.fail(
            owner,
            "Inference recording failed. Check storage and restart the backend.",
          );
      })
      .finally(() => {
        this.outstanding.delete(task);
        if (this.pending === task) {
          this.pending = null;
          this.repace();
        }
      });
    this.pending = task;
    this.outstanding.add(task);
  }

  private fail(run: Run, message: string) {
    if (this.current?.id === run.id) this.current = null;
    this.failure = { type: "recording.error", runId: run.id, message };
    try {
      if (run.status === "running") {
        const failed = this.revise({
          ...run,
          status: "failed",
          endedReason: "storage-failure",
          endedAt: new Date().toISOString(),
        });
        this.recordings.commit(failed);
        this.publish({ type: "run.updated", run: failed, events: [] });
      }
    } catch {
      /* Preserve the last durable state. */
    }
    this.publish(this.failure);
  }

  async settled() {
    await this.pending;
  }
  async close() {
    this.controller.abort();
    this.reevaluationController.abort();
    await Promise.allSettled(this.reevaluations);
    await Promise.all(this.outstanding);
    this.interrupt();
  }
  interrupt() {
    const run = this.recordings.active();
    if (!run) return;
    for (const attempt of this.recordings.attempts(run.id)) {
      if (attempt.status !== "pending") continue;
      this.recordings.saveAttempt({
        ...attempt,
        status: "failed",
        completedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - Date.parse(attempt.startedAt)),
        error: {
          code: "interrupted",
          message:
            "Backend stopped before this attempt completed. Elapsed time includes downtime.",
          httpStatus: null,
        },
        policy: evaluatePolicy(
          null,
          run.manifest.schemaVersion === 2 ? run.manifest.policy : undefined,
        ),
      });
    }
    this.recordings.commit(
      this.revise({
        ...run,
        status: "interrupted",
        endedReason: "shutdown",
        endedAt: new Date().toISOString(),
        ...(run.controls
          ? { controls: { ...run.controls, waitingForInference: false } }
          : {}),
      }),
    );
  }
  private publish(message: RunMessage) {
    const parsed = runMessageSchema.parse(message);
    for (const listener of this.listeners) {
      try {
        listener(parsed);
      } catch {
        /* A transport failure cannot fail the recorder. */
      }
    }
  }
}
