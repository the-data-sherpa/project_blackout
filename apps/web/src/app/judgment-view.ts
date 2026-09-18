import type { InferenceAttempt, Recording } from "@blackout/contracts";

export function judgmentView(
  recording: Recording,
  inspectedAttempt: InferenceAttempt | null = null,
) {
  // Held responses have null application timing. Inspect their lifecycle below,
  // but derive all four card values only from results applied by this cursor.
  const applied = recording.attempts.filter(
    (attempt) =>
      attempt.status === "succeeded" &&
      attempt.appliedAt !== null &&
      (attempt.appliedSimulationTimeMs ?? attempt.simulationTimeMs) <=
        recording.run.simulationTimeMs,
  );
  const current = applied.at(-1) ?? null;
  const previous = applied.at(-2) ?? null;
  const latest = inspectedAttempt ?? recording.attempts.at(-1);
  const evaluation =
    recording.run.manifest.schemaVersion === 2
      ? recording.run.manifest.evaluation
      : null;
  const held = latest?.appliedAt === null && latest.status !== "pending";
  const laterApplication =
    latest?.appliedSimulationTimeMs != null &&
    latest.appliedSimulationTimeMs > recording.run.simulationTimeMs;
  const retryScheduled =
    latest?.status === "failed" &&
    recording.run.controls?.waitingForInference &&
    latest.attemptNumber < (evaluation?.maxAttempts ?? 1) &&
    (latest.error?.code === "timeout" ||
      (latest.error?.code === "http_error" &&
        (latest.error.httpStatus === 429 ||
          (latest.error.httpStatus ?? 0) >= 500)));
  const state = !latest
    ? evaluation
      ? "Not evaluated yet"
      : "Never evaluated · telemetry only"
    : held
      ? `Received ${latest.status === "failed" ? "failure" : "response"} · held, not applied`
      : laterApplication
        ? "Response applied after this inspected checkpoint"
        : latest.status === "pending"
          ? `${latest.attemptNumber > 1 ? "Retrying" : "Pending"} · attempt ${latest.attemptNumber}`
          : latest.status === "failed"
            ? `${retryScheduled ? "Retry scheduled" : "Unavailable"} · ${latest.error?.code ?? "failed"}${current ? " · last applied result is stale" : " · risk unknown"}`
            : "Successful · applied assessment";
  return {
    current,
    previous,
    latest,
    state,
    ageMs: current
      ? recording.run.simulationTimeMs - current.simulationTimeMs
      : null,
  };
}

export function numericChange(value: number, previous: number, unit: string) {
  const delta = value - previous;
  if (Math.abs(delta) < 0.00001) return `Unchanged · ${unit}`;
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} ${unit}`;
}
