import { z } from "zod";
import {
  evaluationConfigSchema,
  inferenceAttemptSchema,
  policyConfigSchema,
} from "./decisions.js";
import {
  fixtureSchema,
  organizationSchema,
  telemetryEventSchema,
  observableSnapshotSchema,
} from "./telemetry.js";

export const startRunSchema = z.strictObject({
  seed: z.string().trim().min(1).max(128),
  durationSeconds: z.number().int().min(1).max(120).default(30),
  fixture: fixtureSchema.default("baseline"),
  evaluate: z.boolean().default(false),
});

export const runIdSchema = z.uuid();
const simulationTimeSchema = z.number().int().nonnegative();

export const legacyManifestSchema = z.strictObject({
  seed: startRunSchema.shape.seed,
  simulationOrigin: z.iso.datetime(),
  durationSeconds: startRunSchema.shape.durationSeconds,
  tickMs: z.literal(1000),
  initialState: z.strictObject({
    users: z.array(z.string().min(1)).min(1),
    hosts: z.array(z.string().min(1)).min(1),
    resources: z.array(z.string().min(1)).min(1),
  }),
  generatorVersion: z.literal("authentication/1"),
  scenarioVersion: z.literal("baseline/1"),
  schemaVersion: z.literal(1),
  policyVersion: z.string().nullable(),
  evaluatorVersion: z.string().nullable(),
  requestedModel: z.string().nullable(),
  resolvedModel: z.string().nullable(),
});

export const telemetryManifestSchema = legacyManifestSchema.extend({
  schemaVersion: z.literal(2),
  generatorVersion: z.literal("telemetry/1"),
  scenarioVersion: z.literal("fixtures/1"),
  aggregatorVersion: z.literal("rolling-state/1"),
  warmupMs: z.literal(900_000),
  fixture: fixtureSchema,
  organization: organizationSchema,
  evaluation: evaluationConfigSchema.optional(),
  policy: policyConfigSchema.optional(),
});
export const manifestSchema = z.discriminatedUnion("schemaVersion", [
  legacyManifestSchema,
  telemetryManifestSchema,
]);

export const runSchema = z.strictObject({
  id: runIdSchema,
  manifest: manifestSchema,
  status: z.enum(["running", "completed", "interrupted", "failed"]),
  simulationTimeMs: simulationTimeSchema,
  lastSequence: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

export const runListQuerySchema = z.strictObject({
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const runSummarySchema = runSchema.omit({ manifest: true }).extend({
  seed: startRunSchema.shape.seed,
  durationSeconds: startRunSchema.shape.durationSeconds,
});
export const runListSchema = z.strictObject({
  runs: z.array(runSummarySchema),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  activeRunId: runIdSchema.nullable(),
});

// Observable events carry no scenario names, commands, or hidden truth labels.
export const authenticationEventSchema = z.strictObject({
  runId: runIdSchema,
  sequence: z.number().int().positive(),
  simulationTimeMs: simulationTimeSchema,
  occurredAt: z.iso.datetime(),
  type: z.literal("authentication"),
  userId: z.string(),
  hostId: z.string(),
  resource: z.string(),
  sourceIp: z.ipv4(),
  outcome: z.enum(["success", "failure"]),
});

export const commandSchema = z.strictObject({
  runId: runIdSchema,
  sequence: z.number().int().positive(),
  simulationTimeMs: simulationTimeSchema,
  recordedAt: z.iso.datetime(),
  type: z.literal("start"),
  parameters: z.strictObject({ fixture: fixtureSchema }).optional(),
});

export const observableEventSchema = z.union([
  telemetryEventSchema,
  authenticationEventSchema,
]);

export const recordingSchema = z.strictObject({
  run: runSchema,
  events: z.array(observableEventSchema),
  commands: z.array(commandSchema),
  snapshots: z.array(observableSnapshotSchema).default([]),
  attempts: z.array(inferenceAttemptSchema).default([]),
});

export const activeRunSchema = z.strictObject({
  runId: runIdSchema.nullable(),
});
export const apiErrorSchema = z.strictObject({
  code: z.enum([
    "invalid_input",
    "run_active",
    "not_found",
    "recording_unavailable",
  ]),
  message: z.string(),
});

export const runMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("inference.updated"),
    runId: runIdSchema,
    attempt: inferenceAttemptSchema,
  }),
  z.strictObject({
    type: z.literal("run.snapshot"),
    recording: recordingSchema,
  }),
  z.strictObject({
    type: z.literal("run.updated"),
    run: runSchema,
    events: z.array(observableEventSchema),
    snapshot: observableSnapshotSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("recording.error"),
    runId: runIdSchema,
    message: z.string(),
  }),
]);

export type StartRun = z.infer<typeof startRunSchema>;
export type RunManifest = z.infer<typeof manifestSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunList = z.infer<typeof runListSchema>;
export type AuthenticationEvent = z.infer<typeof authenticationEventSchema>;
export type RunCommand = z.infer<typeof commandSchema>;
export type Recording = z.infer<typeof recordingSchema>;
export type RunMessage = z.infer<typeof runMessageSchema>;

export type LegacyManifest = z.infer<typeof legacyManifestSchema>;
export type TelemetryManifest = z.infer<typeof telemetryManifestSchema>;
export type ObservableEvent = z.infer<typeof observableEventSchema>;
