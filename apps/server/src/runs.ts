import { randomUUID } from "node:crypto";
import {
  runMessageSchema,
  startRunSchema,
  type Run,
  type RunMessage,
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
import { createSnapshot } from "./aggregation.js";
import { Recordings } from "./recordings.js";
import {
  Evaluator,
  questionVersion,
  type EvaluatorOptions,
} from "./evaluator.js";
import { evaluatePolicy } from "./policy.js";

export class RunError extends Error {
  constructor(
    readonly code: "run_active" | "recording_unavailable",
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
  private controller = new AbortController();
  private failure: Extract<RunMessage, { type: "recording.error" }> | null =
    null;

  constructor(
    readonly recordings: Recordings,
    options: EvaluatorOptions = {},
  ) {
    this.evaluator = new Evaluator(options);
    // This process never silently resumes a prior process's simulation.
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

  start(input: unknown) {
    const parsed = startRunSchema.parse(input);
    if (this.failure)
      throw new RunError("recording_unavailable", this.failure.message);
    if (this.recordings.active())
      throw new RunError(
        "run_active",
        "A run is already active. Wait for it to finish.",
      );
    const manifest = createTelemetryManifest(parsed);
    if (parsed.evaluate) {
      manifest.evaluation = this.evaluator.config;
      manifest.policy = this.evaluator.policy;
      manifest.policyVersion = this.evaluator.policy.version;
      manifest.evaluatorVersion = questionVersion;
      manifest.requestedModel = this.evaluator.model;
    }
    const run: Run = {
      id: randomUUID(),
      manifest,
      status: "running",
      simulationTimeMs: 0,
      lastSequence: 0,
      createdAt: new Date().toISOString(),
      endedAt: null,
    };
    const events = generateWarmup(manifest, run.id);
    run.lastSequence = events.at(-1)!.sequence;
    const snapshot = createSnapshot(run.id, manifest.organization, events, 0);
    this.recordings.create(
      run,
      {
        runId: run.id,
        type: "start",
        sequence: 1,
        simulationTimeMs: 0,
        recordedAt: run.createdAt,
        parameters: { fixture: manifest.fixture },
      },
      events,
      snapshot,
    );
    this.evidence = events;
    this.current = run;
    this.controller = new AbortController();
    if (parsed.evaluate) this.evaluate(snapshot);
    return this.recordings.get(run.id)!;
  }

  tick() {
    if (this.failure || this.pending) return;
    const run = this.current;
    if (!run) return;
    let message: RunMessage;
    let checkpoint: ObservableSnapshot | undefined;
    let finishAfterEvaluation = false;
    try {
      const simulationTimeMs = run.simulationTimeMs + run.manifest.tickMs;
      const manifest = run.manifest;
      if (manifest.schemaVersion !== 2)
        throw new Error("Legacy runs cannot resume generation");
      const fixture = fixtureObservations(manifest, simulationTimeMs);
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
      const complete = simulationTimeMs === run.manifest.durationSeconds * 1000;
      if (
        manifest.evaluation &&
        (simulationTimeMs % manifest.evaluation.checkpointMs === 0 || complete)
      ) {
        checkpoint = snapshot;
        finishAfterEvaluation = complete;
      }
      const finished = complete && !checkpoint;
      const updated: Run = {
        ...run,
        simulationTimeMs,
        lastSequence: events.at(-1)!.sequence,
        status: finished ? "completed" : "running",
        endedAt: finished ? new Date().toISOString() : null,
      };
      message = runMessageSchema.parse({
        type: "run.updated",
        run: updated,
        events,
        snapshot,
      });
      this.recordings.commit(updated, events, snapshot, truth);
      this.evidence = finished ? [] : evidence;
      this.current = finished ? null : updated;
    } catch {
      this.current = null;
      this.failure = {
        type: "recording.error",
        runId: run.id,
        message:
          "Recording failed. Generation stopped at the last saved step. Restart the backend after checking storage.",
      };
      try {
        const failed: Run = {
          ...run,
          status: "failed",
          endedAt: new Date().toISOString(),
        };
        this.recordings.commit(failed);
        this.publish({ type: "run.updated", run: failed, events: [] });
      } catch {
        /* The error message does not claim that failure status was saved. */
      }
      this.publish(this.failure);
      return;
    }
    // Transport errors must never roll back the clock of an already committed step.
    this.publish(message);
    if (checkpoint) this.evaluate(checkpoint, finishAfterEvaluation);
  }

  private evaluate(snapshot: ObservableSnapshot, complete = false) {
    const signal = this.controller.signal;
    this.pending = this.evaluator
      .checkpoint(
        snapshot,
        (attempt) => {
          const resolved =
            attempt.response && this.current?.id === snapshot.runId
              ? {
                  ...this.current,
                  manifest: {
                    ...this.current.manifest,
                    resolvedModel: attempt.response.model,
                  },
                }
              : undefined;
          this.recordings.saveAttempt(attempt, resolved);
          if (resolved) {
            this.current = resolved;
            this.publish({ type: "run.updated", run: resolved, events: [] });
          }
          this.publish({
            type: "inference.updated",
            runId: snapshot.runId,
            attempt,
          });
        },
        signal,
      )
      .then(() => {
        if (!complete || signal.aborted || this.current?.id !== snapshot.runId)
          return;
        const finished: Run = {
          ...this.current,
          status: "completed",
          endedAt: new Date().toISOString(),
        };
        this.recordings.commit(finished);
        this.current = null;
        this.evidence = [];
        this.publish({ type: "run.updated", run: finished, events: [] });
      })
      .catch(() => {
        // An evaluator failure is recorded normally. Reaching here means persistence failed.
        const run = this.current;
        this.current = null;
        this.failure = {
          type: "recording.error",
          runId: snapshot.runId,
          message:
            "Inference recording failed. Generation stopped at the last saved checkpoint. Check storage and restart the backend.",
        };
        if (run) {
          try {
            const failed: Run = {
              ...run,
              status: "failed",
              endedAt: new Date().toISOString(),
            };
            this.recordings.commit(failed);
            this.publish({ type: "run.updated", run: failed, events: [] });
          } catch {
            /* Preserve the last durable state. */
          }
        }
        this.publish(this.failure);
      })
      .finally(() => {
        this.pending = null;
      });
  }

  async settled() {
    await this.pending;
  }

  async close() {
    this.controller.abort();
    await this.pending;
    this.interrupt();
  }

  interrupt() {
    const run = this.recordings.active();
    if (run) {
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
      this.recordings.commit({
        ...run,
        status: "interrupted",
        endedAt: new Date().toISOString(),
      });
    }
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
