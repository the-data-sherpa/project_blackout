import type {
  InferenceAttempt,
  Recording,
  RunCommand,
} from "@blackout/contracts";

function upperBound<T>(
  values: readonly T[],
  cursor: number,
  time: (value: T) => number,
) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (time(values[middle]!) <= cursor) low = middle + 1;
    else high = middle;
  }
  return low;
}

function attemptVisibility(attempt: InferenceAttempt, endMs: number) {
  if (attempt.status === "pending") return attempt.simulationTimeMs;
  if (attempt.appliedSimulationTimeMs !== undefined)
    return attempt.appliedSimulationTimeMs ?? endMs;
  return attempt.simulationTimeMs;
}

function controlsAt(commands: RunCommand[], cursor: number, source: Recording) {
  if (!source.run.controls) return undefined;
  let paused = false;
  let requestedSpeed: NonNullable<
    Recording["run"]["controls"]
  >["requestedSpeed"] = 1;
  let injection: NonNullable<Recording["run"]["controls"]>["injection"] = null;
  for (const command of commands) {
    if (command.simulationTimeMs > cursor) break;
    switch (command.type) {
      case "pause":
        paused = true;
        break;
      case "resume":
        paused = false;
        break;
      case "set-speed":
        requestedSpeed = command.parameters?.speed ?? requestedSpeed;
        break;
      case "begin-injection":
        if (command.parameters?.fixture)
          injection = {
            fixture: command.parameters.fixture as
              "credential-compromise" | "benign-maintenance",
            startedAtMs: command.simulationTimeMs,
            stoppedAtMs: null,
          };
        break;
      case "stop-injection": {
        const active = injection as NonNullable<typeof injection> | null;
        if (active)
          injection = {
            fixture: active.fixture,
            startedAtMs: active.startedAtMs,
            stoppedAtMs: command.simulationTimeMs,
          };
        break;
      }
      case "start":
      case "reset":
        break;
    }
  }
  return {
    paused,
    pausedAttemptId: null,
    requestedSpeed,
    waitingForInference: false,
    pendingApplication: false,
    elapsedWallMs: 0,
    injection,
  };
}

export class PlaybackIndex {
  readonly endMs: number;
  private readonly attempts: Array<{
    attempt: InferenceAttempt;
    visibleAtMs: number;
  }>;

  constructor(private readonly source: Recording) {
    this.endMs = source.run.simulationTimeMs;
    this.attempts = source.attempts
      .map((attempt) => ({
        attempt,
        visibleAtMs: attemptVisibility(attempt, this.endMs),
      }))
      .sort(
        (a, b) =>
          a.visibleAtMs - b.visibleAtMs ||
          a.attempt.simulationTimeMs - b.attempt.simulationTimeMs ||
          a.attempt.attemptNumber - b.attempt.attemptNumber,
      );
  }

  at(requestedCursorMs: number): Recording {
    const cursor = Math.max(0, Math.min(this.endMs, requestedCursorMs));
    const events = this.source.events.slice(
      0,
      upperBound(this.source.events, cursor, (event) => event.simulationTimeMs),
    );
    const commands = this.source.commands.slice(
      0,
      upperBound(
        this.source.commands,
        cursor,
        (command) => command.simulationTimeMs,
      ),
    );
    const snapshots = this.source.snapshots.slice(
      0,
      upperBound(
        this.source.snapshots,
        cursor,
        (snapshot) => snapshot.simulationTimeMs,
      ),
    );
    const attemptCount = upperBound(
      this.attempts,
      cursor,
      (value) => value.visibleAtMs,
    );
    const attempts = this.attempts
      .slice(0, attemptCount)
      .map(({ attempt }) => attempt)
      .sort(
        (a, b) =>
          a.simulationTimeMs - b.simulationTimeMs ||
          a.attemptNumber - b.attemptNumber,
      );
    const attemptIds = new Set(attempts.map((attempt) => attempt.id));
    const investigationHistory = this.source.investigationHistory.filter(
      (event) =>
        event.simulationTimeMs <= cursor &&
        (event.attemptId === null || attemptIds.has(event.attemptId)),
    );
    const resolvedModel = [...attempts]
      .reverse()
      .find(
        (attempt) =>
          attempt.status === "succeeded" && attempt.appliedAt !== null,
      )?.response?.model;
    return {
      ...this.source,
      run: {
        ...this.source.run,
        simulationTimeMs: cursor,
        lastSequence: events.at(-1)?.sequence ?? 0,
        manifest: {
          ...this.source.run.manifest,
          resolvedModel: resolvedModel ?? null,
        },
        controls: controlsAt(commands, cursor, this.source),
      },
      events,
      commands,
      snapshots,
      attempts,
      investigationHistory,
    };
  }
}
