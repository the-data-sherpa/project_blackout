import { randomUUID } from "node:crypto";
import {
  runMessageSchema,
  startRunSchema,
  type Run,
  type RunMessage,
} from "@blackout/contracts";
import { authenticationStep, createManifest } from "./authentication.js";
import { Recordings } from "./recordings.js";

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
  private readonly listeners = new Set<(message: RunMessage) => void>();
  private failure: Extract<RunMessage, { type: "recording.error" }> | null =
    null;

  constructor(readonly recordings: Recordings) {
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
    const run: Run = {
      id: randomUUID(),
      manifest: createManifest(parsed),
      status: "running",
      simulationTimeMs: 0,
      lastSequence: 0,
      createdAt: new Date().toISOString(),
      endedAt: null,
    };
    this.recordings.create(run, {
      runId: run.id,
      type: "start",
      sequence: 1,
      simulationTimeMs: 0,
      recordedAt: run.createdAt,
    });
    this.current = run;
    return this.recordings.get(run.id)!;
  }

  tick() {
    if (this.failure) return;
    const run = this.current;
    if (!run) return;
    let message: RunMessage;
    try {
      const simulationTimeMs = run.simulationTimeMs + run.manifest.tickMs;
      const events = authenticationStep(run.manifest, run.id, simulationTimeMs);
      const complete = simulationTimeMs === run.manifest.durationSeconds * 1000;
      const updated: Run = {
        ...run,
        simulationTimeMs,
        lastSequence: events.at(-1)!.sequence,
        status: complete ? "completed" : "running",
        endedAt: complete ? new Date().toISOString() : null,
      };
      message = runMessageSchema.parse({
        type: "run.updated",
        run: updated,
        events,
      });
      this.recordings.commit(updated, events);
      this.current = complete ? null : updated;
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
  }

  interrupt() {
    const run = this.recordings.active();
    if (run)
      this.recordings.commit({
        ...run,
        status: "interrupted",
        endedAt: new Date().toISOString(),
      });
  }

  private publish(message: RunMessage) {
    const parsed = runMessageSchema.parse(message);
    for (const listener of this.listeners) listener(parsed);
  }
}
