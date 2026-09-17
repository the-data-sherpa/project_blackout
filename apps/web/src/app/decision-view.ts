import type { InferenceAttempt, Recording } from "@blackout/contracts";

// Inspection may read a held response. The live panel, timeline and counters may not.
export function visibleAttempts({
  attempts,
  run,
}: Recording): InferenceAttempt[] {
  const liveAttempts =
    run.status === "running" &&
    run.controls?.paused &&
    run.controls.pausedAttemptId !== undefined
      ? attempts.slice(
          0,
          attempts.findIndex(
            (attempt) => attempt.id === run.controls!.pausedAttemptId,
          ) + 1,
        )
      : attempts;
  return liveAttempts.map((attempt) =>
    run.status === "running" &&
    attempt.appliedAt === null &&
    attempt.status !== "pending"
      ? {
          ...attempt,
          status: "pending",
          response: null,
          error: null,
          policy: null,
          completedAt: null,
          latencyMs: null,
          responseBody: null,
        }
      : attempt,
  );
}

export function decisionMetrics(recording: Recording) {
  const attempts = visibleAttempts(recording);
  const decisions = attempts.filter(
    (attempt) => attempt.status === "succeeded" && attempt.appliedAt !== null,
  );
  const latencies = attempts
    .filter(
      (attempt) =>
        attempt.latencyMs !== null && attempt.error?.code !== "interrupted",
    )
    .map((attempt) => attempt.latencyMs!)
    .sort((a, b) => a - b);
  const n = latencies.length;
  return {
    events: recording.events.filter((event) => event.simulationTimeMs >= 0)
      .length,
    warmupEvents: recording.events.filter((event) => event.simulationTimeMs < 0)
      .length,
    attempts: attempts.length,
    decisions: decisions.length,
    failures: attempts.filter((attempt) => attempt.status === "failed").length,
    pending: attempts.filter((attempt) => attempt.status === "pending").length,
    decisionsPerMinute:
      recording.run.simulationTimeMs > 0
        ? (decisions.length * 60_000) / recording.run.simulationTimeMs
        : null,
    latencySamples: n,
    medianLatencyMs: n
      ? (latencies[Math.floor((n - 1) / 2)]! + latencies[Math.floor(n / 2)]!) /
        2
      : null,
    p95LatencyMs: n ? latencies[Math.ceil(n * 0.95) - 1]! : null,
  };
}
