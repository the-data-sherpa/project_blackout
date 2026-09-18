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

export type Inspection = {
  recording: Recording;
  assessment: InferenceAttempt | null;
};

export function inspectAssessment(
  source: Recording,
  id: string,
  phase?: "pending" | "received" | "applied" | null,
): Inspection | null {
  const saved = source.attempts.find((attempt) => attempt.id === id);
  if (!saved) return null;
  const assessment: InferenceAttempt =
    phase === "pending"
      ? {
          ...saved,
          status: "pending",
          completedAt: null,
          latencyMs: null,
          response: null,
          responseBody: null,
          error: null,
          policy: null,
          appliedAt: null,
          appliedSimulationTimeMs: null,
        }
      : phase === "received"
        ? { ...saved, appliedAt: null, appliedSimulationTimeMs: null }
        : saved;
  const at = assessment.simulationTimeMs;
  const wall =
    assessment.appliedAt ?? assessment.completedAt ?? assessment.startedAt;
  const projection = new PlaybackIndex(source).at(at);
  const attempts = projection.attempts
    .map((attempt) => (attempt.id === id ? assessment : attempt))
    .filter((attempt) => {
      // Legacy results became visible at their checkpoint. Modern results must
      // have actually entered the display by the selected assessment's boundary.
      if (attempt.appliedAt === undefined) return true;
      if (attempt.status === "pending") return attempt.startedAt <= wall;
      return attempt.appliedAt !== null && attempt.appliedAt <= wall;
    });
  const appliedIds = new Set(
    attempts
      .filter((attempt) => attempt.appliedAt !== null)
      .map((attempt) => attempt.id),
  );
  const transition =
    assessment.appliedAt !== null &&
    (assessment.appliedSimulationTimeMs ?? assessment.simulationTimeMs) <= at
      ? source.investigationHistory.find((event) => event.attemptId === id)
      : undefined;
  const investigationHistory = projection.investigationHistory.filter(
    (event) => {
      if (event.attemptId !== null && !appliedIds.has(event.attemptId))
        return false;
      if (transition) return event.runRevision <= transition.runRevision;
      // Operator actions sharing a wall timestamp cannot be ordered relative to
      // an attempt without a recorded revision. Do not claim they preceded it.
      return (
        event.recordedAt < wall ||
        (event.recordedAt === wall && event.attemptId !== null)
      );
    },
  );
  return {
    assessment,
    recording: {
      ...projection,
      attempts,
      investigationHistory,
      commands: projection.commands.filter(
        (command) => command.recordedAt <= wall,
      ),
      run: {
        ...projection.run,
        manifest: {
          ...projection.run.manifest,
          resolvedModel:
            [...attempts]
              .reverse()
              .find(
                (attempt) =>
                  attempt.status === "succeeded" && attempt.appliedAt !== null,
              )?.response?.model ?? null,
        },
      },
    },
  };
}

export function newerAssessmentCount(
  source: Recording,
  inspection: Inspection,
) {
  const visible = new Set(
    inspection.recording.attempts
      .filter(
        (attempt) =>
          attempt.status === "succeeded" && attempt.appliedAt !== null,
      )
      .map((attempt) => attempt.id),
  );
  return source.attempts.filter(
    (attempt) =>
      attempt.status === "succeeded" &&
      attempt.appliedAt !== null &&
      !visible.has(attempt.id),
  ).length;
}

export type AssessmentPhase = "pending" | "received" | "applied";
export type InspectionBoundary = {
  attemptId: string | null;
  phase: AssessmentPhase | null;
  historySequence: number;
  commandSequence: number;
};

export function assessmentPhase(attempt: InferenceAttempt): AssessmentPhase {
  return attempt.status === "pending"
    ? "pending"
    : attempt.appliedAt === null
      ? "received"
      : "applied";
}

export function inspectionBoundary(
  recording: Recording,
  assessment: InferenceAttempt | null = null,
): InspectionBoundary {
  const latest = assessment ?? recording.attempts.at(-1);
  return {
    attemptId: latest?.id ?? null,
    phase: latest ? assessmentPhase(latest) : null,
    historySequence: recording.investigationHistory.at(-1)?.sequence ?? 0,
    commandSequence: recording.commands.at(-1)?.sequence ?? 0,
  };
}

// Simulation time alone cannot order a paused response and operator actions.
// Stable sequence cutoffs and the latest attempt's phase describe that boundary.
export function inspectBoundary(
  source: Recording,
  cursor: number,
  boundary: InspectionBoundary,
): Recording | null {
  const index =
    boundary.attemptId === null
      ? -1
      : source.attempts.findIndex(
          (attempt) => attempt.id === boundary.attemptId,
        );
  const saved = source.attempts[index];
  if (
    boundary.attemptId !== null &&
    (!saved || saved.simulationTimeMs > cursor || !boundary.phase)
  )
    return null;
  if (
    saved &&
    ((boundary.phase === "received" && saved.status === "pending") ||
      (boundary.phase === "applied" &&
        (saved.status === "pending" || saved.appliedAt === null)))
  )
    return null;
  if (
    boundary.historySequence >
      (source.investigationHistory.at(-1)?.sequence ?? 0) ||
    boundary.commandSequence > (source.commands.at(-1)?.sequence ?? 0)
  )
    return null;
  const projected = new PlaybackIndex(source).at(cursor);
  const attempts = source.attempts
    .slice(0, index + 1)
    .filter((attempt) => attempt.simulationTimeMs <= cursor)
    .map((attempt) => {
      if (attempt.id !== boundary.attemptId) return attempt;
      if (boundary.phase === "pending")
        return {
          ...attempt,
          status: "pending" as const,
          completedAt: null,
          latencyMs: null,
          response: null,
          responseBody: null,
          error: null,
          policy: null,
          appliedAt: null,
          appliedSimulationTimeMs: null,
        };
      if (boundary.phase === "received")
        return { ...attempt, appliedAt: null, appliedSimulationTimeMs: null };
      return attempt;
    })
    .filter(
      (attempt) =>
        attempt.appliedAt === null ||
        (attempt.appliedSimulationTimeMs ?? attempt.simulationTimeMs) <= cursor,
    );
  const appliedIds = new Set(
    attempts
      .filter(
        (attempt) => attempt.status !== "pending" && attempt.appliedAt !== null,
      )
      .map((attempt) => attempt.id),
  );
  const commands = projected.commands.filter(
    (command) => command.sequence <= boundary.commandSequence,
  );
  return {
    ...projected,
    attempts,
    commands,
    investigationHistory: projected.investigationHistory.filter(
      (event) =>
        event.sequence <= boundary.historySequence &&
        (event.attemptId === null || appliedIds.has(event.attemptId)),
    ),
    run: {
      ...projected.run,
      controls: controlsAt(commands, cursor, source),
      manifest: {
        ...projected.run.manifest,
        resolvedModel:
          [...attempts]
            .reverse()
            .find(
              (attempt) =>
                attempt.status === "succeeded" && attempt.appliedAt !== null,
            )?.response?.model ?? null,
      },
    },
  };
}
