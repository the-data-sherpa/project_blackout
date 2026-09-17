import type {
  InferenceAttempt,
  Recording,
  RunMessage,
} from "@blackout/contracts";

function mergeAttempts(
  previous: InferenceAttempt[],
  updates: InferenceAttempt[],
) {
  const attempts = new Map(previous.map((attempt) => [attempt.id, attempt]));
  for (const attempt of updates) attempts.set(attempt.id, attempt);
  return [...attempts.values()].sort(
    (a, b) =>
      a.simulationTimeMs - b.simulationTimeMs ||
      a.attemptNumber - b.attemptNumber,
  );
}

// A gap requires a fresh authoritative snapshot. Never build a plausible partial recording.
export function receiveRunMessage(
  previous: Recording | null,
  message: RunMessage,
  runId: string,
): Recording | null {
  if (message.type === "recording.error") return previous;
  const run =
    message.type === "run.snapshot" ? message.recording.run : message.run;
  if (run.id !== runId) throw new Error("Unexpected run in live stream");
  if (message.type === "run.snapshot") {
    if (previous && run.revision < previous.run.revision)
      throw new Error("Stale resynchronization snapshot");
    return message.recording;
  }
  if (!previous || previous.run.id !== runId)
    throw new Error("Snapshot required before updates");
  if (run.revision <= previous.run.revision) return previous;
  if (run.revision !== previous.run.revision + 1)
    throw new Error("Missing live update");
  if (message.type === "inference.updated") {
    if (message.runId !== runId || message.attempt.runId !== runId)
      throw new Error("Unexpected attempt");
    return {
      ...previous,
      run,
      attempts: mergeAttempts(previous.attempts, [message.attempt]),
      investigationHistory:
        message.investigationHistory ?? previous.investigationHistory,
    };
  }
  let sequence = previous.run.lastSequence;
  for (const event of message.events) {
    if (event.runId !== runId || event.sequence !== ++sequence)
      throw new Error("Missing event");
  }
  if (run.lastSequence !== sequence) throw new Error("Incomplete event batch");
  const commands = message.commands ?? [];
  let commandSequence = previous.commands.at(-1)?.sequence ?? 0;
  for (const command of commands) {
    if (command.runId !== runId || command.sequence !== ++commandSequence)
      throw new Error("Missing command");
  }
  if (message.snapshot && message.snapshot.runId !== runId)
    throw new Error("Unexpected snapshot");
  return {
    ...previous,
    run,
    events: [...previous.events, ...message.events],
    commands: [...previous.commands, ...commands],
    snapshots: message.snapshot
      ? [...previous.snapshots, message.snapshot]
      : previous.snapshots,
    attempts: mergeAttempts(previous.attempts, message.attempts ?? []),
    investigationHistory:
      message.investigationHistory ?? previous.investigationHistory,
  };
}
