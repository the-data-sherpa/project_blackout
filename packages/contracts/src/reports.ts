import { z } from "zod";
import { fixtureSchema } from "./telemetry.js";
import { evaluationConfigSchema, policyConfigSchema } from "./decisions.js";

const count = z.number().int().nonnegative();
export const evaluationReportSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  metricVersion: z.enum([
    "slice-metrics/1",
    "slice-metrics/2",
    "scenario-metrics/1",
  ]),
  definitions: z.record(z.string(), z.string()),
  runs: z.array(
    z.strictObject({
      runId: z.uuid(),
      recordingAvailable: z.boolean().optional(),
      seed: z.string(),
      fixture: fixtureSchema,
      questionVersion: z.string(),
      scenarioVersion: z.string().optional(),
      aggregatorVersion: z.string().optional(),
      requestedModel: z.string(),
      returnedModels: z.array(z.string()),
      evaluation: evaluationConfigSchema,
      policy: policyConfigSchema,
      durationSimulationMs: count,
      durationWallMs: z.number().nonnegative(),
      actualSimulationSpeed: z.number().nonnegative(),
      checkpoints: count,
      successfulCheckpoints: count,
      failedCheckpoints: count,
      unevaluableCheckpoints: count.default(0),
      attempts: count,
      failedAttempts: count,
      incidentDecisions: count,
      firstMaliciousSimulationMs: count.nullable(),
      detectionDelaySimulationMs: count.nullable(),
      detectionDelayWallMs: z.number().nonnegative().nullable(),
      attackOutcome: z.enum([
        "detected",
        "miss",
        "incomplete",
        "not_applicable",
        "not_exposed",
      ]),
      suspicionThreshold: z.number().min(0).max(1).optional(),
      suspicionDelaySimulationMs: count.nullable().optional(),
      suspicionDelayWallMs: z.number().nonnegative().nullable().optional(),
      suspicionOutcome: z
        .enum([
          "detected",
          "miss",
          "incomplete",
          "not_applicable",
          "not_exposed",
        ])
        .optional(),
      controlCheckpoints: count.optional(),
      falseIncidentDecisions: count.optional(),
      activityDecline: z
        .strictObject({
          stopSimulationMs: count,
          stopRecordedAt: z.iso.datetime(),
          lowProbabilityThreshold: z.number().min(0).max(1),
          referenceAttemptId: z.uuid().nullable(),
          referenceProbability: z.number().min(0).max(1).nullable(),
          finalAttemptId: z.uuid().nullable(),
          finalProbability: z.number().min(0).max(1).nullable(),
          probabilityChange: z.number().min(-1).max(1).nullable(),
          postStopCheckpoints: count,
          successfulCheckpoints: count,
          failedCheckpoints: count,
          firstLowDelaySimulationMs: count.nullable(),
          firstLowDelayWallMs: z.number().nonnegative().nullable(),
        })
        .nullable()
        .optional(),
      classificationSwitches: count,
      comparablePairs: count,
      latencyMs: z.strictObject({
        samples: count,
        p50: z.number().nullable(),
        p95: z.number().nullable(),
      }),
      inputTokens: count,
      outputTokens: count,
      attemptsWithUsage: count,
      decisions: z.array(
        z.strictObject({
          attemptId: z.uuid(),
          snapshotId: z.string(),
          simulationTimeMs: count,
          status: z.enum(["succeeded", "failed"]),
          outcome: z.string(),
          classification: z.string().nullable(),
          error: z.string().nullable(),
          compromiseProbability: z.number().min(0).max(1).nullable().optional(),
          completedAt: z.iso.datetime().nullable().optional(),
        }),
      ),
    }),
  ),
});
export const evaluationReportsSchema = z.strictObject({
  reports: z.array(evaluationReportSchema),
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
