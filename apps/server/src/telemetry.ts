import {
  telemetryEventSchema,
  telemetryManifestSchema,
  type Organization,
  type StartRun,
  type TelemetryEvent,
  type TelemetryManifest,
} from "@blackout/contracts";
import { createScenarioPlan } from "./scenarios.js";
import { randomBytes } from "./random.js";
export { randomBytes } from "./random.js";

type WithoutEnvelope<T> = T extends TelemetryEvent
  ? Omit<
      T,
      | "runId"
      | "eventId"
      | "sequence"
      | "simulationTimeMs"
      | "occurredAt"
      | "source"
      | "severity"
    >
  : never;
export type Observation = WithoutEnvelope<TelemetryEvent>;

const id = (prefix: string, index: number) =>
  `${prefix}-${String(index + 1).padStart(3, "0")}`;

function createOrganization(seed: string): Organization {
  const locations = ["Boston", "Denver", "Dublin"];
  const hosts: Organization["hosts"] = Array.from(
    { length: 16 },
    (_, index) => ({
      id: id("host", index),
      kind: index < 12 ? "workstation" : "server",
      location: locations[index % locations.length]!,
      ip: `192.0.2.${index + 1}`,
    }),
  );
  const resources = [
    "mail",
    "documents",
    "intranet",
    "source",
    "payroll",
    "inventory",
  ].map((name, index) => ({
    id: name,
    hostId: hosts[12 + (index % 4)]!.id,
    domain: `${name}.blackout.test`,
  }));
  const departments = ["engineering", "finance", "operations"] as const;
  const users = Array.from({ length: 32 }, (_, index) => {
    const bytes = randomBytes("organization/1", seed, index);
    const hostIndex = bytes[0]! % 12;
    const primary = hosts[hostIndex]!;
    const secondary = hosts[(hostIndex + 1 + (bytes[1]! % 10)) % 12]!;
    const department = bytes[2]! % 3;
    return {
      userId: id("user", index),
      department: departments[department]!,
      hostIds: [primary.id, secondary.id],
      locations: [...new Set([primary.location, secondary.location])],
      resources: ["mail", "documents", resources[3 + department]!.id],
    };
  });
  return { users, hosts, resources };
}

export function createTelemetryManifest(input: StartRun): TelemetryManifest {
  const organization = createOrganization(input.seed);
  const scenario = createScenarioPlan(input, organization);
  return telemetryManifestSchema.parse({
    seed: input.seed,
    durationSeconds: input.durationSeconds,
    fixture: input.fixture,
    ...(input.interactive
      ? { interactive: true, interactiveScenarioVersion: "scenarios/1" }
      : {}),
    simulationOrigin: "2026-01-01T09:00:00.000Z",
    tickMs: 1000,
    initialState: {
      users: organization.users.map((user) => user.userId),
      hosts: organization.hosts.map((host) => host.id),
      resources: organization.resources.map((resource) => resource.id),
    },
    organization,
    ...(scenario ? { scenario } : {}),
    warmupMs: 900_000,
    generatorVersion: "telemetry/1",
    scenarioVersion: scenario ? "scenarios/1" : "fixtures/1",
    aggregatorVersion: "rolling-state/2",
    schemaVersion: 2,
    policyVersion: null,
    evaluatorVersion: null,
    requestedModel: null,
    resolvedModel: null,
  });
}

// Keyed by simulation time, not the final event sequence: injected observations
// cannot consume baseline randomness or change the next baseline event.
export function baselineObservations(
  manifest: TelemetryManifest,
  time: number,
): Observation[] {
  const { users, hosts, resources } = manifest.organization;
  const bytes = randomBytes(manifest.generatorVersion, manifest.seed, time);
  const authentications: Observation[] = [0, 1].map((position) => {
    const offset = position * 8;
    const user = users[bytes[offset]! % users.length]!;
    const hostId = user.hostIds[bytes[offset + 1]! % 10 === 0 ? 1 : 0]!;
    const host = hosts.find((item) => item.id === hostId)!;
    const failureEvery =
      12 + (randomBytes("failure-rate", manifest.seed, user.userId)[0]! % 20);
    return {
      type: "authentication",
      userId: user.userId,
      hostId,
      resource: user.resources[bytes[offset + 2]! % user.resources.length]!,
      sourceIp: host.ip,
      location: user.locations[bytes[offset + 3]! % user.locations.length]!,
      outcome: bytes[offset + 4]! % failureEvery === 0 ? "failure" : "success",
    };
  });
  const user = users[bytes[16]! % users.length]!;
  const resourceId = user.resources[bytes[17]! % user.resources.length]!;
  const resource = resources.find((item) => item.id === resourceId)!;
  const destination = hosts.find((host) => host.id === resource.hostId)!;
  const missing = bytes[18]! % 40 === 0;
  return [
    ...authentications,
    {
      type: "host-metric",
      hostId: hosts[bytes[19]! % hosts.length]!.id,
      cpuPercent: 10 + (bytes[20]! % 55),
      memoryPercent: 25 + (bytes[21]! % 45),
    },
    {
      type: "dns",
      userId: user.userId,
      hostId: user.hostIds[0]!,
      query: missing ? "old-service.blackout.test" : resource.domain,
      outcome: missing ? "nxdomain" : "resolved",
      answerIp: missing ? null : destination.ip,
    },
    {
      type: "network",
      userId: user.userId,
      hostId: user.hostIds[0]!,
      destinationHostId: destination.id,
      destinationPort: 443,
      bytesSent: 500 + bytes.readUInt16BE(22),
      outcome: "allowed",
    },
  ];
}

export function observe(
  observation: Observation,
  manifest: TelemetryManifest,
  runId: string,
  time: number,
  sequence: number,
): TelemetryEvent {
  const source = {
    authentication: "identity-provider",
    "host-metric": "host-monitor",
    dns: "dns-resolver",
    network: "network-sensor",
  }[observation.type];
  const warning =
    observation.type === "host-metric"
      ? observation.cpuPercent >= 85 || observation.memoryPercent >= 90
      : ["failure", "nxdomain", "denied"].includes(observation.outcome);
  return telemetryEventSchema.parse({
    ...observation,
    runId,
    sequence,
    eventId: `event-${String(sequence).padStart(6, "0")}`,
    simulationTimeMs: time,
    occurredAt: new Date(
      Date.parse(manifest.simulationOrigin) + time,
    ).toISOString(),
    source,
    severity: warning ? "warning" : "info",
  });
}

export function orderObservations(
  manifest: TelemetryManifest,
  time: number,
  observations: Observation[],
) {
  // Order by observation content, never by baseline/fixture provenance.
  return observations
    .map((observation) => ({
      observation,
      key: randomBytes("ordering/1", manifest.seed, time, observation).toString(
        "hex",
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ observation }) => observation);
}

export function generateWarmup(
  manifest: TelemetryManifest,
  runId: string,
): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  for (let time = -manifest.warmupMs; time < 0; time += manifest.tickMs) {
    for (const observation of orderObservations(
      manifest,
      time,
      baselineObservations(manifest, time),
    )) {
      events.push(
        observe(observation, manifest, runId, time, events.length + 1),
      );
    }
  }
  return events;
}
