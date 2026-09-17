import { z } from "zod";

export const startRunSchema = z.strictObject({
  seed: z.string().trim().min(1).max(128),
  durationSeconds: z.number().int().min(1).max(120).default(30),
});

export const runIdSchema = z.uuid();
const simulationTimeSchema = z.number().int().nonnegative();

export const manifestSchema = z.strictObject({
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

export const runSchema = z.strictObject({
  id: runIdSchema,
  manifest: manifestSchema,
  status: z.enum(["running", "completed", "interrupted", "failed"]),
  simulationTimeMs: simulationTimeSchema,
  lastSequence: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
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
});

export const recordingSchema = z.strictObject({
  run: runSchema,
  events: z.array(authenticationEventSchema),
  commands: z.array(commandSchema),
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
    type: z.literal("run.snapshot"),
    recording: recordingSchema,
  }),
  z.strictObject({
    type: z.literal("run.updated"),
    run: runSchema,
    events: z.array(authenticationEventSchema),
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
export type AuthenticationEvent = z.infer<typeof authenticationEventSchema>;
export type RunCommand = z.infer<typeof commandSchema>;
export type Recording = z.infer<typeof recordingSchema>;
export type RunMessage = z.infer<typeof runMessageSchema>;
