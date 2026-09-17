import { z } from "zod";

export const windowSizes = [10_000, 30_000, 60_000, 300_000, 900_000] as const;
export const fixtureSchema = z.enum([
  "baseline",
  "credential-attack",
  "harmless-anomaly",
]);
const entityId = z.string().min(1);
export const profileSchema = z.strictObject({
  userId: entityId,
  department: z.enum(["engineering", "finance", "operations"]),
  hostIds: z.array(entityId).min(1),
  locations: z.array(z.string().min(1)).min(1),
  resources: z.array(z.string().min(1)).min(1),
});
export const organizationSchema = z.strictObject({
  users: z.array(profileSchema).min(20).max(60),
  hosts: z
    .array(
      z.strictObject({
        id: entityId,
        kind: z.enum(["workstation", "server"]),
        location: z.string().min(1),
        ip: z.ipv4(),
      }),
    )
    .min(10)
    .max(25),
  resources: z
    .array(
      z.strictObject({
        id: entityId,
        hostId: entityId,
        domain: z.string().endsWith(".test"),
      }),
    )
    .min(1),
});

const envelope = {
  runId: z.uuid(),
  eventId: z.string().regex(/^event-\d{6,}$/),
  sequence: z.number().int().positive(),
  simulationTimeMs: z.number().int(),
  occurredAt: z.iso.datetime(),
  severity: z.enum(["info", "warning"]),
  hostId: entityId,
};
export const telemetryAuthenticationSchema = z.strictObject({
  ...envelope,
  type: z.literal("authentication"),
  source: z.literal("identity-provider"),
  userId: entityId,
  resource: entityId,
  sourceIp: z.ipv4(),
  location: z.string().min(1),
  outcome: z.enum(["success", "failure"]),
});
export const metricEventSchema = z.strictObject({
  ...envelope,
  type: z.literal("host-metric"),
  source: z.literal("host-monitor"),
  cpuPercent: z.number().min(0).max(100),
  memoryPercent: z.number().min(0).max(100),
});
export const dnsEventSchema = z.strictObject({
  ...envelope,
  type: z.literal("dns"),
  source: z.literal("dns-resolver"),
  userId: entityId,
  query: z.string().endsWith(".test"),
  outcome: z.enum(["resolved", "nxdomain"]),
  answerIp: z.ipv4().nullable(),
});
export const networkEventSchema = z.strictObject({
  ...envelope,
  type: z.literal("network"),
  source: z.literal("network-sensor"),
  userId: entityId,
  destinationHostId: entityId,
  destinationPort: z.number().int().min(1).max(65535),
  bytesSent: z.number().int().nonnegative(),
  outcome: z.enum(["allowed", "denied"]),
});
export const telemetryEventSchema = z.discriminatedUnion("type", [
  telemetryAuthenticationSchema,
  metricEventSchema,
  dnsEventSchema,
  networkEventSchema,
]);
export const metricNames = [
  "authenticationAttempts",
  "authenticationFailures",
  "unfamiliarDevices",
  "unfamiliarLocations",
  "unfamiliarResources",
  "dnsQueries",
  "dnsFailures",
  "networkConnections",
  "networkBytes",
  "meanCpuPercent",
  "meanMemoryPercent",
] as const;
export const aggregateMetricSchema = z.strictObject({
  name: z.enum(metricNames),
  value: z.number().nonnegative().nullable(),
  evidenceSequences: z.array(z.number().int().positive()),
});
export const windowSchema = z.strictObject({
  durationMs: z.union(windowSizes.map((size) => z.literal(size))),
  startExclusiveMs: z.number().int(),
  endInclusiveMs: z.number().int(),
  metrics: z.array(aggregateMetricSchema),
});
export const focusSchema = z.strictObject({
  userId: entityId,
  profile: profileSchema,
  windowMs: z.literal(30_000),
  score: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  deviations: z.number().int().nonnegative(),
  evidenceSequences: z.array(z.number().int().positive()),
  rule: z.literal(
    "3 per unfamiliar device/location/resource + 1 per failure; highest score, then attempts, then ascending user ID",
  ),
});
// This is the ONLY contract the evaluator may receive. Construct it explicitly;
// never spread a run, manifest, command, snapshot wrapper or truth into it.
export const evaluatorInputSchema = z.strictObject({
  schemaVersion: z.literal("observable-state/1"),
  simulationTimeMs: z.number().int().nonnegative(),
  windows: z.array(windowSchema).length(5),
  focus: focusSchema.nullable(),
});
export const observableSnapshotSchema = z.strictObject({
  id: z.string().regex(/^snapshot-\d{6,}$/),
  runId: z.uuid(),
  simulationTimeMs: z.number().int().nonnegative(),
  input: evaluatorInputSchema,
});
export const scenarioTruthSchema = z.strictObject({
  runId: z.uuid(),
  simulationTimeMs: z.number().int().nonnegative(),
  fixture: fixtureSchema,
  targetUserId: entityId,
  interpretation: z.enum(["credential-misuse", "authorized-burst"]),
  eventSequences: z.array(z.number().int().positive()),
});
export type Fixture = z.infer<typeof fixtureSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type UserProfile = z.infer<typeof profileSchema>;
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryAuthentication = z.infer<
  typeof telemetryAuthenticationSchema
>;
export type ObservableSnapshot = z.infer<typeof observableSnapshotSchema>;
export type EvaluatorInput = z.infer<typeof evaluatorInputSchema>;
export type ScenarioTruth = z.infer<typeof scenarioTruthSchema>;
export type AggregateMetric = z.infer<typeof aggregateMetricSchema>;
