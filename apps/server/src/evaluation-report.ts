import { randomUUID } from "node:crypto";
import {
  evaluationReportSchema,
  type Recording,
  type ScenarioTruth,
} from "@blackout/contracts";

export const metricDefinitions = {
  incident:
    "A successful checkpoint whose recorded application policy outcome is incident_advisory. No model values are rewritten.",
  detection:
    "First incident advisory at or after the first credential-misuse event. Simulation delay is checkpoint time minus first malicious event time, in ms. Wall delay is decision completion minus that event snapshot's recordedAt, in ms. Missing legacy timestamps yield null, never estimated timing.",
  miss: "No incident advisory in an attack run with every checkpoint successfully evaluated and all required policy fields available. Otherwise no detection is incomplete, not a confirmed miss.",
  falseIncident:
    "For baseline and harmless controls: incidentDecisions / (successfulCheckpoints - unevaluableCheckpoints). Failed checkpoints and successful responses missing required policy fields are excluded and reported separately; baseline before injection in attack runs is not included.",
  latency:
    "Per-attempt wall duration in ms, including recorded failures but excluding restart-interrupted attempts and retry backoff. Nearest-rank p50/p95; samples states the denominator.",
  cadence:
    "durationSimulationMs / durationWallMs is achieved simulation speed. Checkpoint count includes time zero and the terminal snapshot, even for durations not divisible by the interval.",
  stability:
    "Classification switches / comparablePairs of consecutive successful checkpoints. A failed checkpoint breaks adjacency.",
  tokens:
    "Sum of returned usage fields over attemptsWithUsage. Missing usage and interrupted attempts are not estimated.",
  scope:
    "Synthetic first-slice fixtures and fixed thresholds. This report does not establish calibrated confidence or real-world security effectiveness.",
};

export function createEvaluationReport(
  records: { recording: Recording; truth: ScenarioTruth[] }[],
) {
  return evaluationReportSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    metricVersion: "slice-metrics/2",
    definitions: metricDefinitions,
    runs: records.map(({ recording, truth }) => {
      const { run, attempts } = recording;
      const manifest = run.manifest;
      if (
        run.status !== "completed" ||
        manifest.schemaVersion !== 2 ||
        !manifest.evaluation ||
        !manifest.policy ||
        !manifest.evaluatorVersion ||
        !manifest.requestedModel
      )
        throw new Error("Reports require completed evaluated recordings");
      const checkpoints = [
        ...new Map(
          attempts.map((attempt) => [attempt.snapshotId, attempt]),
        ).values(),
      ];
      const expected =
        Math.ceil(
          (manifest.durationSeconds * 1000) / manifest.evaluation.checkpointMs,
        ) + 1;
      if (
        checkpoints.length !== expected ||
        checkpoints.some((attempt) => attempt.status === "pending")
      )
        throw new Error("Recording is missing completed checkpoints");
      const successful = checkpoints.filter(
        (attempt) => attempt.status === "succeeded",
      );
      const unevaluable = successful.filter(
        (attempt) => attempt.policy?.outcome === "unevaluable",
      ).length;
      const incidents = successful.filter(
        (attempt) => attempt.policy?.outcome === "incident_advisory",
      );
      const firstMalicious =
        truth.find((row) => row.interpretation === "credential-misuse")
          ?.simulationTimeMs ?? null;
      const detection =
        firstMalicious === null
          ? undefined
          : incidents.find(
              (attempt) => attempt.simulationTimeMs >= firstMalicious,
            );
      const onsetTimestamp = recording.snapshots.find(
        (snapshot) => snapshot.simulationTimeMs === firstMalicious,
      )?.recordedAt;
      const latency = attempts
        .filter(
          (attempt) =>
            attempt.latencyMs !== null && attempt.error?.code !== "interrupted",
        )
        .map((attempt) => attempt.latencyMs!)
        .sort((a, b) => a - b);
      let switches = 0;
      let pairs = 0;
      for (let index = 1; index < checkpoints.length; index++) {
        const a =
          checkpoints[index - 1]!.response?.answers.classification.choice;
        const b = checkpoints[index]!.response?.answers.classification.choice;
        if (a && b) {
          pairs++;
          if (a !== b) switches++;
        }
      }
      const durationWallMs = Math.max(
        0,
        Date.parse(run.endedAt!) - Date.parse(run.createdAt),
      );
      return {
        runId: run.id,
        seed: manifest.seed,
        fixture: manifest.fixture,
        questionVersion: manifest.evaluatorVersion,
        requestedModel: manifest.requestedModel,
        returnedModels: [
          ...new Set(successful.map((attempt) => attempt.response!.model)),
        ],
        evaluation: manifest.evaluation,
        policy: manifest.policy,
        durationSimulationMs: run.simulationTimeMs,
        durationWallMs,
        actualSimulationSpeed: durationWallMs
          ? run.simulationTimeMs / durationWallMs
          : 0,
        checkpoints: checkpoints.length,
        successfulCheckpoints: successful.length,
        failedCheckpoints: checkpoints.length - successful.length,
        unevaluableCheckpoints: unevaluable,
        attempts: attempts.length,
        failedAttempts: attempts.filter(
          (attempt) => attempt.status === "failed",
        ).length,
        incidentDecisions: incidents.length,
        firstMaliciousSimulationMs: firstMalicious,
        detectionDelaySimulationMs: detection
          ? detection.simulationTimeMs - firstMalicious!
          : null,
        detectionDelayWallMs:
          detection && onsetTimestamp
            ? Math.max(
                0,
                Date.parse(detection.completedAt!) - Date.parse(onsetTimestamp),
              )
            : null,
        attackOutcome:
          manifest.fixture !== "credential-attack"
            ? "not_applicable"
            : detection
              ? "detected"
              : successful.length !== checkpoints.length || unevaluable > 0
                ? "incomplete"
                : "miss",
        classificationSwitches: switches,
        comparablePairs: pairs,
        latencyMs: {
          samples: latency.length,
          p50: latency[Math.ceil(latency.length * 0.5) - 1] ?? null,
          p95: latency[Math.ceil(latency.length * 0.95) - 1] ?? null,
        },
        inputTokens: attempts.reduce(
          (sum, attempt) => sum + (attempt.response?.usage?.input_tokens ?? 0),
          0,
        ),
        outputTokens: attempts.reduce(
          (sum, attempt) => sum + (attempt.response?.usage?.output_tokens ?? 0),
          0,
        ),
        attemptsWithUsage: attempts.filter((attempt) => attempt.response?.usage)
          .length,
        decisions: checkpoints.map((attempt) => ({
          attemptId: attempt.id,
          snapshotId: attempt.snapshotId,
          simulationTimeMs: attempt.simulationTimeMs,
          status: attempt.status,
          outcome: attempt.policy?.outcome ?? "unevaluable",
          classification:
            attempt.response?.answers.classification.choice ?? null,
          error: attempt.error?.code ?? null,
        })),
      };
    }),
  });
}
