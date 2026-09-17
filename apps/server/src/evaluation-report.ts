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
    "Synthetic scenarios and fixed thresholds. This report does not establish calibrated confidence or real-world security effectiveness. Stopping injection and declining activity do not establish remediation.",
  suspicion:
    "First successful checkpoint at/after the first malicious observation with compromise probability >= 0.5. Delays use the same simulation and wall origins as detection. Not exposed means no malicious observations were emitted. A miss requires every checkpoint to succeed; suspicion does not require policy fields.",
  activityDecline:
    "From the recorded stop-injection command: probabilityChange = terminal checkpoint probability minus last checkpoint strictly before stop. Either failed endpoint yields null; no earlier result is substituted. Post-stop denominators include the stop checkpoint. First low delay uses probability < 0.2 and simulation time since stop / response completion minus the stop command recordedAt. Low risk is not remediation; longer windows retain history.",
  control:
    "falseIncidentDecisions / controlCheckpoints counts policy-evaluable successes over all baseline/benign checkpoints and checkpoints strictly before the first malicious observation in attack runs. Failed or unevaluable policies are excluded. Detection still starts at the first malicious observation.",
};

export function createEvaluationReport(
  records: { recording: Recording; truth: ScenarioTruth[] }[],
) {
  return evaluationReportSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    metricVersion: "scenario-metrics/1",
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
        truth.find(
          (row) =>
            row.interpretation === "credential-misuse" &&
            row.eventSequences.length > 0,
        )?.simulationTimeMs ?? null;
      const detection =
        firstMalicious === null
          ? undefined
          : incidents.find(
              (attempt) => attempt.simulationTimeMs >= firstMalicious,
            );
      const onsetTimestamp = recording.snapshots.find(
        (snapshot) => snapshot.simulationTimeMs === firstMalicious,
      )?.recordedAt;
      const attack =
        manifest.fixture === "credential-attack" ||
        manifest.fixture === "credential-compromise";
      const suspicion =
        firstMalicious === null
          ? undefined
          : successful.find(
              (attempt) =>
                attempt.simulationTimeMs >= firstMalicious &&
                attempt.response!.answers.compromise.noul >= 0.5,
            );
      const wallDelay = (attempt: typeof detection, origin = onsetTimestamp) =>
        attempt && origin
          ? Math.max(0, Date.parse(attempt.completedAt!) - Date.parse(origin))
          : null;
      const outcome = (found: typeof detection, needsPolicy: boolean) =>
        !attack
          ? "not_applicable"
          : firstMalicious === null
            ? "not_exposed"
            : found
              ? "detected"
              : successful.length !== checkpoints.length ||
                  (needsPolicy && unevaluable > 0)
                ? "incomplete"
                : "miss";
      const controls = successful.filter(
        (attempt) =>
          attempt.policy?.outcome !== "unevaluable" &&
          (!attack ||
            firstMalicious === null ||
            attempt.simulationTimeMs < firstMalicious),
      );
      const stop = recording.commands.find(
        (command) => command.type === "stop-injection",
      );
      const postStop = stop
        ? checkpoints.filter(
            (attempt) => attempt.simulationTimeMs >= stop.simulationTimeMs,
          )
        : [];
      const reference = stop
        ? checkpoints
            .filter(
              (attempt) => attempt.simulationTimeMs < stop.simulationTimeMs,
            )
            .at(-1)
        : undefined;
      const terminal = checkpoints.at(-1);
      const referenceProbability =
        reference?.response?.answers.compromise.noul ?? null;
      const finalProbability =
        terminal?.response?.answers.compromise.noul ?? null;
      const firstLow = postStop.find(
        (attempt) =>
          attempt.response && attempt.response.answers.compromise.noul < 0.2,
      );
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
        scenarioVersion: manifest.scenarioVersion,
        aggregatorVersion: manifest.aggregatorVersion,
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
        attackOutcome: outcome(detection, true),
        suspicionThreshold: 0.5,
        suspicionDelaySimulationMs: suspicion
          ? suspicion.simulationTimeMs - firstMalicious!
          : null,
        suspicionDelayWallMs: wallDelay(suspicion),
        suspicionOutcome: outcome(suspicion, false),
        controlCheckpoints: controls.length,
        falseIncidentDecisions: controls.filter(
          (attempt) => attempt.policy?.outcome === "incident_advisory",
        ).length,
        activityDecline: stop
          ? {
              stopSimulationMs: stop.simulationTimeMs,
              stopRecordedAt: stop.recordedAt,
              lowProbabilityThreshold: 0.2,
              referenceAttemptId: reference?.id ?? null,
              referenceProbability,
              finalAttemptId: terminal?.id ?? null,
              finalProbability,
              probabilityChange:
                referenceProbability === null || finalProbability === null
                  ? null
                  : finalProbability - referenceProbability,
              postStopCheckpoints: postStop.length,
              successfulCheckpoints: postStop.filter(
                (attempt) => attempt.status === "succeeded",
              ).length,
              failedCheckpoints: postStop.filter(
                (attempt) => attempt.status === "failed",
              ).length,
              firstLowDelaySimulationMs: firstLow
                ? firstLow.simulationTimeMs - stop.simulationTimeMs
                : null,
              firstLowDelayWallMs: wallDelay(firstLow, stop.recordedAt),
            }
          : null,
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
          compromiseProbability:
            attempt.response?.answers.compromise.noul ?? null,
          completedAt: attempt.completedAt,
        })),
      };
    }),
  });
}
