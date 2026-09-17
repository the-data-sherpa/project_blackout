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
  scenarioPlanSchema,
} from "./telemetry.js";

export const speedSchema = z.union([
  z.literal(0.25),
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
  z.literal(5),
]);
export const interactiveFixtureSchema = z.enum([
  "credential-compromise",
  "benign-maintenance",
]);
export const controlRunSchema = z.discriminatedUnion("type", [
  z.strictObject({ commandId: z.uuid(), type: z.literal("pause") }),
  z.strictObject({ commandId: z.uuid(), type: z.literal("resume") }),
  z.strictObject({ commandId: z.uuid(), type: z.literal("reset") }),
  z.strictObject({ commandId: z.uuid(), type: z.literal("stop-injection") }),
  z.strictObject({
    commandId: z.uuid(),
    type: z.literal("begin-injection"),
    fixture: interactiveFixtureSchema,
  }),
  z.strictObject({
    commandId: z.uuid(),
    type: z.literal("set-speed"),
    speed: speedSchema,
  }),
]);

export const startRunSchema = z
  .strictObject({
    seed: z.string().trim().min(1).max(128),
    durationSeconds: z.number().int().min(1).max(120).default(30),
    fixture: fixtureSchema.default("baseline"),
    evaluate: z.boolean().default(false),
    interactive: z.boolean().default(false),
    commandId: z.uuid().optional(),
    stopInjectionAtSeconds: z.number().int().min(1).max(35).optional(),
  })
  .superRefine((input, context) => {
    if (
      input.interactive &&
      (input.fixture !== "baseline" ||
        input.stopInjectionAtSeconds !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Interactive runs start in normal mode; use Begin Attack or Begin Control to inject a scenario",
      });
    if (
      input.stopInjectionAtSeconds !== undefined &&
      ((input.fixture !== "credential-compromise" &&
        input.fixture !== "benign-maintenance") ||
        input.stopInjectionAtSeconds > input.durationSeconds)
    )
      context.addIssue({
        code: "custom",
        message:
          "A scheduled stop requires a full scenario and must occur within the run",
      });
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

export const telemetryManifestSchema = legacyManifestSchema
  .extend({
    schemaVersion: z.literal(2),
    generatorVersion: z.literal("telemetry/1"),
    scenarioVersion: z.enum(["fixtures/1", "scenarios/1"]),
    aggregatorVersion: z.enum(["rolling-state/1", "rolling-state/2"]),
    warmupMs: z.literal(900_000),
    fixture: fixtureSchema,
    organization: organizationSchema,
    scenario: scenarioPlanSchema.optional(),
    evaluation: evaluationConfigSchema.optional(),
    policy: policyConfigSchema.optional(),
    interactive: z.boolean().optional(),
    interactiveScenarioVersion: z.literal("scenarios/1").optional(),
  })
  .superRefine((manifest, context) => {
    const fullScenario =
      manifest.fixture === "credential-compromise" ||
      manifest.fixture === "benign-maintenance";
    if (
      fullScenario !== (manifest.scenarioVersion === "scenarios/1") ||
      fullScenario !== Boolean(manifest.scenario)
    )
      context.addIssue({
        code: "custom",
        message:
          "Full scenarios require a versioned plan; first-slice fixtures must not carry one",
      });
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
  revision: z.number().int().nonnegative().default(0),
  controls: z
    .strictObject({
      paused: z.boolean(),
      pausedAttemptId: z.uuid().nullable().optional(),
      requestedSpeed: speedSchema,
      waitingForInference: z.boolean(),
      pendingApplication: z.boolean(),
      elapsedWallMs: z.number().nonnegative(),
      injection: z
        .strictObject({
          fixture: interactiveFixtureSchema,
          startedAtMs: simulationTimeSchema,
          stoppedAtMs: simulationTimeSchema.nullable(),
        })
        .nullable(),
    })
    .optional(),
  endedReason: z.enum(["reset", "shutdown", "storage-failure"]).optional(),
  replacementRunId: runIdSchema.optional(),
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
  type: z.enum([
    "start",
    "begin-injection",
    "stop-injection",
    "pause",
    "resume",
    "reset",
    "set-speed",
  ]),
  parameters: z
    .strictObject({
      fixture: fixtureSchema.optional(),
      speed: speedSchema.optional(),
    })
    .optional(),
  request: z.union([controlRunSchema, startRunSchema]).optional(),
  resultRunId: runIdSchema.optional(),
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
    "invalid_transition",
    "command_conflict",
  ]),
  message: z.string(),
});

export const runMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("inference.updated"),
    runId: runIdSchema,
    run: runSchema,
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
    commands: z.array(commandSchema).optional(),
    attempts: z.array(inferenceAttemptSchema).optional(),
  }),
  z.strictObject({
    type: z.literal("recording.error"),
    runId: runIdSchema,
    message: z.string(),
  }),
]);

export type StartRun = z.infer<typeof startRunSchema>;
export type ControlRun = z.infer<typeof controlRunSchema>;
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
