import {
  investigationStatus,
  type InferenceAttempt,
  type Recording,
} from "@blackout/contracts";

export type ProcessingNode = {
  id: string;
  label: string;
  value: string;
  detail: unknown;
  target: string;
};

// Every comparison comes from the recorded policy; this view never re-evaluates it.
export function processingGraph(
  recording: Recording,
  selected: InferenceAttempt | null,
) {
  const attempt = selected ?? recording.attempts.at(-1);
  const snapshot = attempt
    ? recording.snapshots.find((item) => item.id === attempt.snapshotId)
    : recording.snapshots.at(-1);
  const evidenceTime =
    snapshot?.simulationTimeMs ?? recording.run.simulationTimeMs;
  const evidenceCount = recording.events.filter(
    (event) => event.simulationTimeMs <= evidenceTime,
  ).length;
  const applied =
    !!attempt &&
    attempt.status !== "pending" &&
    attempt.appliedAt !== null &&
    (attempt.appliedSimulationTimeMs ?? attempt.simulationTimeMs) <=
      recording.run.simulationTimeMs;
  const state = !attempt
    ? "Not evaluated"
    : attempt.status === "pending"
      ? attempt.attemptNumber > 1
        ? "Retrying"
        : "Pending"
      : !applied
        ? "Received / held — not applied"
        : attempt.status === "failed"
          ? "Failed / unavailable"
          : "Applied";
  const timing = attempt
    ? {
        attemptId: attempt.id,
        snapshotId: attempt.snapshotId,
        checkpointMs: attempt.simulationTimeMs,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        appliedAt:
          attempt.appliedAt ??
          (attempt.appliedAt === undefined
            ? "Legacy: application time unavailable"
            : null),
        appliedSimulationTimeMs: attempt.appliedSimulationTimeMs,
        latencyMs: attempt.latencyMs,
      }
    : null;
  const answers = attempt?.response?.answers;
  const judgments: ProcessingNode[] = (
    ["compromise", "classification", "severity", "response"] as const
  ).map((key) => ({
    id: key,
    label: {
      compromise: "Compromise probability",
      classification: "Classification",
      severity: "Weighted severity",
      response: "Advisory response",
    }[key],
    value: !answers
      ? state
      : key === "compromise"
        ? `${(answers.compromise.noul * 100).toFixed(1)}%`
        : key === "severity"
          ? `${answers.severity.score.toFixed(2)} / 3`
          : answers[key].choice,
    detail: {
      question: attempt?.request.questions[key] ?? null,
      answer: answers?.[key] ?? null,
      state,
      timing,
      error: attempt?.error ?? null,
      advisoryOnly: key === "response",
    },
    target: "decision-title",
  }));
  const rules: ProcessingNode[] = attempt?.policy?.rules.map((rule) => ({
    id: `rule-${rule.id}`,
    label: rule.expression,
    value:
      rule.matched === null
        ? "Unevaluable"
        : rule.matched
          ? "Matched"
          : "Not matched",
    detail: {
      ...rule,
      inputs: attempt.policy!.inputs,
      policy: attempt.policy!.config,
      state,
      timing,
    },
    target: "decision-title",
  })) ?? [
    {
      id: "policy-missing",
      label: "Policy conditions",
      value: "Not recorded / unavailable",
      detail: { state, timing },
      target: "decision-title",
    },
  ];
  const transition =
    attempt &&
    recording.investigationHistory.find(
      (event) => event.attemptId === attempt.id,
    );
  const status = investigationStatus(recording.investigationHistory);
  const stages: { label: string; nodes: ProcessingNode[] }[] = [
    {
      label: "01 / Evidence",
      nodes: [
        {
          id: "events",
          label: "Recorded events",
          value: `${evidenceCount.toLocaleString("en-US")} observations`,
          detail: {
            throughSimulationMs: evidenceTime,
            count: evidenceCount,
            includesWarmup: true,
            scope:
              "Recorded observations through this snapshot; inspect contributing members in observable state.",
          },
          target: "events-title",
        },
      ],
    },
    {
      label: "02 / Input",
      nodes: [
        {
          id: "snapshot",
          label: "Observable snapshot",
          value: snapshot ? snapshot.id : "Unavailable",
          detail: snapshot ?? null,
          target: "state-title",
        },
      ],
    },
    { label: "03 / Judgments", nodes: judgments },
    { label: "04 / Policy", nodes: rules },
    {
      label: "05 / Investigation",
      nodes: [
        {
          id: "investigation",
          label: status === "none" ? "Not opened" : status,
          value: transition
            ? `${transition.type} at ${transition.simulationTimeMs / 1000} s`
            : "No transition from this attempt",
          detail: {
            attemptId: attempt?.id ?? null,
            applied,
            transition: transition ?? null,
            policyOutcome: attempt?.policy?.outcome ?? null,
            historyCount: recording.investigationHistory.length,
            recentHistory: recording.investigationHistory.slice(-5),
          },
          target: "investigation-title",
        },
      ],
    },
  ];
  return { attempt, snapshot, evidenceTime, state, stages, applied, timing };
}
