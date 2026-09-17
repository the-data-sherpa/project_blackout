import { z } from "zod";
import {
  evaluatorInputSchema,
  aggregateMetricSchema,
  windowSchema,
  focusSchema,
  type EvaluatorInput,
} from "./telemetry.js";

export const modelStateSchema = z.strictObject({
  schemaVersion: z.literal("observable-summary/1"),
  simulationTimeMs: z.number().int().nonnegative(),
  windows: z
    .array(
      windowSchema.extend({
        metrics: z.array(
          aggregateMetricSchema.omit({ evidenceSequences: true }),
        ),
      }),
    )
    .length(5),
  focus: focusSchema
    .omit({ evidenceSequences: true, rule: true, score: true })
    .nullable(),
});

// Evidence IDs and selection rules stay in the snapshot for local inspection.
export function summarizeInput(
  value: EvaluatorInput,
): z.infer<typeof modelStateSchema> {
  const input = evaluatorInputSchema.parse(value);
  const focus = input.focus;
  return modelStateSchema.parse({
    schemaVersion: "observable-summary/1",
    simulationTimeMs: input.simulationTimeMs,
    windows: input.windows.map((window) => ({
      durationMs: window.durationMs,
      startExclusiveMs: window.startExclusiveMs,
      endInclusiveMs: window.endInclusiveMs,
      metrics: window.metrics.map((metric) => ({
        name: metric.name,
        value: metric.value,
      })),
    })),
    focus: focus
      ? {
          userId: focus.userId,
          profile: focus.profile,
          windowMs: focus.windowMs,
          attempts: focus.attempts,
          failures: focus.failures,
          deviations: focus.deviations,
        }
      : null,
  });
}

const probability = z.number().min(0).max(1);
export const conditionSchema = z.enum([
  "normal",
  "benign_anomaly",
  "suspicious",
  "compromise",
]);
export const advisorySchema = z.enum(["observe", "investigate", "escalate"]);
const distribution = <T extends string>(keys: readonly T[]) =>
  z
    .record(z.enum(keys), probability)
    .refine(
      (values) =>
        Math.abs(
          Object.values<number>(values).reduce((sum, value) => sum + value, 0) -
            1,
        ) <=
        0.01 + 1e-9,
      "Probabilities must sum to one",
    );
const choice = <T extends string>(keys: readonly T[]) =>
  z
    .strictObject({
      type: z.literal("choice"),
      choice: z.enum(keys),
      probabilities: distribution(keys),
      confidence: probability.optional(),
    })
    .refine(
      (answer) =>
        answer.probabilities[answer.choice] >=
        Math.max(...Object.values<number>(answer.probabilities)) - 0.001,
      "Selected choice must have the highest probability",
    );

export const jevResponseSchema = z.strictObject({
  model: z.string().min(1).max(200),
  answers: z.strictObject({
    compromise: z.strictObject({ type: z.literal("noul"), noul: probability }),
    classification: choice(conditionSchema.options),
    severity: z
      .strictObject({
        type: z.literal("score"),
        score: z.number().min(0).max(3),
        probabilities: distribution(["0", "1", "2", "3"]),
        legend: z.record(z.enum(["0", "1", "2", "3"]), z.string()),
        confidence: probability.optional(),
      })
      .refine(
        (answer) =>
          Math.abs(
            answer.score -
              Object.entries(answer.probabilities).reduce(
                (sum, [level, p]) => sum + Number(level) * p,
                0,
              ),
          ) <=
          0.02 + 1e-9,
        "Score must match the weighted distribution",
      ),
    response: choice(advisorySchema.options),
  }),
  usage: z
    .strictObject({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

const text = z.string().min(1);
const choiceQuestion = z.strictObject({
  type: z.literal("choice"),
  instructions: text,
  criteria: z.record(text, text),
});
export const jevRequestSchema = z.strictObject({
  model: text,
  state: z.union([evaluatorInputSchema, modelStateSchema]),
  questions: z.strictObject({
    compromise: z.strictObject({
      type: z.literal("noul"),
      instructions: text,
      criteria: z.strictObject({ true: text, false: text }),
    }),
    classification: choiceQuestion,
    severity: z.strictObject({
      type: z.literal("score"),
      instructions: text,
      criteria: z.array(text).length(4),
    }),
    response: choiceQuestion,
  }),
});

export const evaluationConfigSchema = z.strictObject({
  checkpointMs: z.number().int().min(1000).max(30_000).multipleOf(1000),
  timeoutMs: z.number().int().min(100).max(60_000),
  maxAttempts: z.number().int().min(1).max(2),
  retryDelayMs: z.number().int().min(0).max(5000),
});
export const policyConfigSchema = z.strictObject({
  version: z.enum(["advisory-policy/1", "advisory-policy/2"]),
  incidentProbability: probability,
  classificationConfidence: probability,
  incidentSeverity: z.number().min(0).max(3),
});
export const policyResultSchema = z.strictObject({
  config: policyConfigSchema,
  inputs: z.strictObject({
    compromiseProbability: probability.nullable(),
    classification: conditionSchema.nullable(),
    classificationConfidence: probability.nullable(),
    severity: z.number().min(0).max(3).nullable(),
    modelAdvisory: advisorySchema.nullable(),
  }),
  rules: z.array(
    z.strictObject({
      id: text,
      group: z.enum(["incident", "review"]).default("incident"),
      expression: text,
      matched: z.boolean().nullable(),
    }),
  ),
  outcome: z.enum(["unevaluable", "observe", "review", "incident_advisory"]),
  advisoryOnly: z.literal(true),
});

export const inferenceAttemptSchema = z
  .strictObject({
    id: z.uuid(),
    runId: z.uuid(),
    snapshotId: text,
    simulationTimeMs: z.number().int().nonnegative(),
    questionVersion: z.enum(["security-questions/1", "security-questions/2"]),
    attemptNumber: z.number().int().min(1).max(2),
    request: jevRequestSchema,
    status: z.enum(["pending", "succeeded", "failed"]),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
    response: jevResponseSchema.nullable(),
    responseBody: z.string().nullable(),
    error: z
      .strictObject({
        code: z.enum([
          "unavailable",
          "timeout",
          "http_error",
          "malformed_response",
          "interrupted",
        ]),
        message: text,
        httpStatus: z.number().int().nullable(),
      })
      .nullable(),
    policy: policyResultSchema.nullable(),
  })
  .superRefine((attempt, context) => {
    if (attempt.request.state.simulationTimeMs !== attempt.simulationTimeMs)
      context.addIssue({
        code: "custom",
        message: "Request must match checkpoint time",
      });
    if (
      attempt.status === "pending"
        ? attempt.completedAt !== null ||
          attempt.latencyMs !== null ||
          attempt.response !== null ||
          attempt.error !== null ||
          attempt.policy !== null
        : attempt.completedAt === null ||
          attempt.latencyMs === null ||
          attempt.policy === null ||
          (attempt.status === "succeeded"
            ? attempt.response === null || attempt.error !== null
            : attempt.response !== null || attempt.error === null)
    )
      context.addIssue({
        code: "custom",
        message: "Attempt lifecycle fields are inconsistent",
      });
  });

export type JevRequest = z.infer<typeof jevRequestSchema>;
export type JevResponse = z.infer<typeof jevResponseSchema>;
export type InferenceAttempt = z.infer<typeof inferenceAttemptSchema>;
export type EvaluationConfig = z.infer<typeof evaluationConfigSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type PolicyResult = z.infer<typeof policyResultSchema>;
