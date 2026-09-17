import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { defaultEvaluation } from "./evaluator.js";
import { defaultPolicy } from "./policy.js";

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_PATH: z.string().min(1).default("./data/blackout.sqlite"),
  JEV_API_KEY: z.string().optional(),
  JEV_MODEL: z.string().min(1).default("jev-1.13.0"),
  JEV_CHECKPOINT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(30_000)
    .multipleOf(1000)
    .default(defaultEvaluation.checkpointMs),
  JEV_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(defaultEvaluation.timeoutMs),
  JEV_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(2)
    .default(defaultEvaluation.maxAttempts),
  POLICY_INCIDENT_PROBABILITY: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(defaultPolicy.incidentProbability),
  POLICY_CLASSIFICATION_CONFIDENCE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(defaultPolicy.classificationConfidence),
  POLICY_INCIDENT_SEVERITY: z.coerce
    .number()
    .min(0)
    .max(3)
    .default(defaultPolicy.incidentSeverity),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return {
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    webOrigin: new URL(parsed.WEB_ORIGIN).origin,
    databasePath:
      parsed.DATABASE_PATH === ":memory:"
        ? ":memory:"
        : resolve(repositoryRoot, parsed.DATABASE_PATH),
    logLevel: parsed.LOG_LEVEL,
    evaluator: {
      apiKey: parsed.JEV_API_KEY?.trim() || undefined,
      model: parsed.JEV_MODEL,
      config: {
        ...defaultEvaluation,
        checkpointMs: parsed.JEV_CHECKPOINT_MS,
        timeoutMs: parsed.JEV_TIMEOUT_MS,
        maxAttempts: parsed.JEV_MAX_ATTEMPTS,
      },
      policy: {
        ...defaultPolicy,
        incidentProbability: parsed.POLICY_INCIDENT_PROBABILITY,
        classificationConfidence: parsed.POLICY_CLASSIFICATION_CONFIDENCE,
        incidentSeverity: parsed.POLICY_INCIDENT_SEVERITY,
      },
    },
  };
}
