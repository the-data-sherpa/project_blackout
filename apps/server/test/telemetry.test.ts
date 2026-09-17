import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  evaluatorInputSchema,
  startRunSchema,
  telemetryEventSchema,
  type TelemetryEvent,
} from "@blackout/contracts";
import { aggregateInput, createSnapshot } from "../src/aggregation.js";
import { fixtureObservations } from "../src/fixtures.js";
import {
  baselineObservations,
  createTelemetryManifest,
  generateWarmup,
  observe,
  orderObservations,
  type Observation,
} from "../src/telemetry.js";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";

const manifest = createTelemetryManifest(
  startRunSchema.parse({ seed: "m2-tests" }),
);
const runId = randomUUID();
const warmup = generateWarmup(manifest, runId);
const organization = manifest.organization;
const first = organization.users[0]!;
const second = organization.users[1]!;
function auth(user = first): Extract<Observation, { type: "authentication" }> {
  return {
    type: "authentication",
    userId: user.userId,
    hostId: user.hostIds[0]!,
    resource: user.resources[0]!,
    sourceIp: "192.0.2.1",
    location: user.locations[0]!,
    outcome: "success",
  };
}
function eventsAt(times: number[]): TelemetryEvent[] {
  return times.map((time, index) =>
    observe(auth(), manifest, runId, time, index + 1),
  );
}

it("creates deterministic identity-specific organization profiles and a full ordered warm-up", () => {
  expect(organization.users).toHaveLength(32);
  expect(organization.hosts).toHaveLength(16);
  expect(
    createTelemetryManifest(startRunSchema.parse({ seed: manifest.seed })),
  ).toEqual(manifest);
  expect(
    createTelemetryManifest(startRunSchema.parse({ seed: "different" }))
      .organization,
  ).not.toEqual(organization);
  expect(warmup).toHaveLength(4500);
  expect(warmup[0]?.simulationTimeMs).toBe(-900_000);
  expect(warmup.at(-1)?.simulationTimeMs).toBe(-1000);
  expect(warmup.map((event) => event.sequence)).toEqual(
    Array.from({ length: 4500 }, (_, index) => index + 1),
  );
  expect(warmup.map((event) => event.simulationTimeMs)).toEqual(
    warmup.map((event) => event.simulationTimeMs).sort((a, b) => a - b),
  );
  const authentication = warmup.filter(
    (event) => event.type === "authentication",
  );
  expect(new Set(authentication.map((event) => event.userId)).size).toBe(32);
  for (const profile of organization.users) {
    const history = authentication.filter(
      (event) => event.userId === profile.userId,
    );
    expect(new Set(history.map((event) => event.hostId)).size).toBe(2);
    expect(new Set(history.map((event) => event.resource)).size).toBe(3);
    expect(
      history.every(
        (event) =>
          profile.hostIds.includes(event.hostId) &&
          profile.locations.includes(event.location) &&
          profile.resources.includes(event.resource),
      ),
    ).toBe(true);
  }
  expect(authentication.some((event) => event.outcome === "failure")).toBe(
    true,
  );
  expect(
    new Set(
      organization.users.map((profile) => JSON.stringify(profile.hostIds)),
    ).size,
  ).toBeGreaterThan(10);
});

it("uses validated mixed observable envelopes and existing entities without network side effects", () => {
  const hostIds = new Set(organization.hosts.map((host) => host.id));
  const userIds = new Set(organization.users.map((user) => user.userId));
  expect(new Set(warmup.map((event) => event.type))).toEqual(
    new Set(["authentication", "host-metric", "dns", "network"]),
  );
  for (const event of warmup) {
    expect(telemetryEventSchema.safeParse(event).success).toBe(true);
    expect(hostIds.has(event.hostId)).toBe(true);
    if ("userId" in event) expect(userIds.has(event.userId)).toBe(true);
    if (event.type === "network")
      expect(hostIds.has(event.destinationHostId)).toBe(true);
    if (event.type === "dns") expect(event.query.endsWith(".test")).toBe(true);
    if (event.type === "authentication")
      expect(
        organization.resources.some(
          (resource) => resource.id === event.resource,
        ),
      ).toBe(true);
    expect(event.eventId).toMatch(/^event-\d{6}$/);
  }
  for (const type of ["authentication", "dns", "network", "host-metric"]) {
    const event = warmup.find((item) => item.type === type)!;
    for (const field of [
      "scenario",
      "stage",
      "target",
      "isAttack",
      "command",
      "apiKey",
    ])
      expect(
        telemetryEventSchema.safeParse({ ...event, [field]: "hidden" }).success,
      ).toBe(false);
    expect(
      telemetryEventSchema.safeParse({ ...event, source: "attack-generator" })
        .success,
    ).toBe(false);
  }
});

it("uses open-left, closed-right simulation windows, excluding future observations", () => {
  const events = eventsAt([
    -900_000, -300_000, -60_000, -30_000, -10_000, -1, 0, 1,
  ]);
  const input = aggregateInput(organization, events, 0);
  expect(input.windows.map((window) => window.metrics[0]?.value)).toEqual([
    2, 3, 4, 5, 6,
  ]);
  expect(input.windows[0]?.metrics[0]?.evidenceSequences).toEqual([6, 7]);
  expect(input.windows.at(-1)?.metrics[0]?.evidenceSequences).toEqual([
    2, 3, 4, 5, 6, 7,
  ]);
  expect(
    aggregateInput(organization, events, 900_001).windows.every(
      (window) => window.metrics[0]?.value === 0,
    ),
  ).toBe(true);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2099-01-01"));
    expect(aggregateInput(organization, events, 0)).toEqual(input);
  } finally {
    vi.useRealTimers();
  }
});

it("computes sums, means, failures and profile comparisons from exactly the referenced events", () => {
  const unusual: Observation = {
    ...auth(),
    type: "authentication",
    userId: first.userId,
    hostId: organization.hosts.find((host) => !first.hostIds.includes(host.id))!
      .id,
    resource: "intranet",
    sourceIp: "192.0.2.2",
    location: "Singapore",
    outcome: "failure",
  };
  const observations: Observation[] = [
    auth(),
    unusual,
    {
      type: "host-metric",
      hostId: "host-001",
      cpuPercent: 20,
      memoryPercent: 40,
    },
    {
      type: "host-metric",
      hostId: "host-002",
      cpuPercent: 40,
      memoryPercent: 60,
    },
    {
      type: "network",
      hostId: "host-001",
      userId: first.userId,
      destinationHostId: "host-013",
      destinationPort: 443,
      bytesSent: 25,
      outcome: "allowed",
    },
    {
      type: "network",
      hostId: "host-001",
      userId: first.userId,
      destinationHostId: "host-013",
      destinationPort: 443,
      bytesSent: 75,
      outcome: "allowed",
    },
    {
      type: "dns",
      hostId: "host-001",
      userId: first.userId,
      query: "old.blackout.test",
      outcome: "nxdomain",
      answerIp: null,
    },
  ];
  const events = observations.map((observation, index) =>
    observe(observation, manifest, runId, 0, index + 1),
  );
  const input = aggregateInput(organization, events, 0);
  expect(
    Object.fromEntries(
      input.windows[0]!.metrics.map((metric) => [metric.name, metric.value]),
    ),
  ).toEqual({
    authenticationAttempts: 2,
    authenticationFailures: 1,
    unfamiliarDevices: 1,
    unfamiliarLocations: 1,
    unfamiliarResources: 1,
    dnsQueries: 1,
    dnsFailures: 1,
    networkConnections: 2,
    networkBytes: 100,
    meanCpuPercent: 30,
    meanMemoryPercent: 50,
  });
  expect(
    input.windows[0]!.metrics.find((metric) => metric.name === "networkBytes")
      ?.evidenceSequences,
  ).toEqual([5, 6]);
  expect(input.focus).toMatchObject({
    userId: first.userId,
    score: 10,
    failures: 1,
    deviations: 3,
    attempts: 2,
    evidenceSequences: [1, 2],
  });
  const expired = aggregateInput(organization, events, 900_000);
  expect(expired.focus).toBeNull();
  expect(
    expired.windows[4]!.metrics.find(
      (metric) => metric.name === "meanCpuPercent",
    )?.value,
  ).toBeNull();
});

it("selects focus by deviations, failures, activity and stable identity ties, never by a fixture target", () => {
  const events = [
    observe(auth(second), manifest, runId, 0, 1),
    observe(auth(first), manifest, runId, 0, 2),
  ];
  expect(aggregateInput(organization, events, 0).focus?.userId).toBe(
    first.userId,
  );
  events.push(observe(auth(second), manifest, runId, 0, 3));
  expect(aggregateInput(organization, events, 0).focus?.userId).toBe(
    second.userId,
  );
  const failure: Observation = { ...auth(first), outcome: "failure" };
  events.push(observe(failure, manifest, runId, 0, 4));
  expect(aggregateInput(organization, events, 0).focus?.userId).toBe(
    first.userId,
  );
});

it("creates immutable, detached snapshots with a strict evaluator allowlist", () => {
  const events = eventsAt([-1, 0]);
  const snapshot = createSnapshot(runId, organization, events, 0);
  expect(() => {
    snapshot.input.windows[0]!.metrics[0]!.value = 9;
  }).toThrow();
  events[0]!.simulationTimeMs = -999_999;
  expect(snapshot.input.windows[0]!.metrics[0]!.value).toBe(2);
  for (const field of [
    "runId",
    "seed",
    "fixture",
    "scenario",
    "stage",
    "target",
    "truth",
    "commands",
    "requestedModel",
  ]) {
    expect(
      evaluatorInputSchema.safeParse({ ...snapshot.input, [field]: "secret" })
        .success,
    ).toBe(false);
    expect(JSON.stringify(snapshot.input)).not.toContain(`"${field}"`);
  }
  expect(
    evaluatorInputSchema.safeParse({
      ...snapshot.input,
      focus: { ...snapshot.input.focus, target: first.userId },
    }).success,
  ).toBe(false);
});

it.each(["credential-attack", "harmless-anomaly"] as const)(
  "reproduces %s without changing baseline, identifiers or source semantics",
  (fixture) => {
    const configured = createTelemetryManifest(
      startRunSchema.parse({ seed: manifest.seed, fixture }),
    );
    expect(configured.organization).toEqual(organization);
    expect(generateWarmup(configured, runId)).toEqual(warmup);
    for (let time = 1000; time <= 10_000; time += 1000) {
      expect(baselineObservations(configured, time)).toEqual(
        baselineObservations(manifest, time),
      );
      const generated = fixtureObservations(configured, time);
      expect(fixtureObservations(configured, time)).toEqual(generated);
      const mixed = orderObservations(configured, time, [
        ...baselineObservations(configured, time),
        ...generated.observations,
      ]);
      const events = mixed.map((observation, index) =>
        observe(observation, configured, runId, time, index + 1),
      );
      expect(
        events.every((event) => telemetryEventSchema.safeParse(event).success),
      ).toBe(true);
      if (time > 8000) expect(generated.truth).toBeNull();
      for (const observation of generated.observations) {
        expect(observe(observation, configured, runId, time, 1)).toEqual(
          observe(observation, manifest, runId, time, 1),
        );
      }
    }
  },
);

it("persists snapshots and truth atomically, and truth-only changes cannot alter the observable payload", () => {
  const database = openDatabase(":memory:");
  try {
    const recordings = new Recordings(database);
    const runs = new Runs(recordings);
    const start = runs.start({
      seed: "truth-isolation",
      fixture: "credential-attack",
      durationSeconds: 3,
    });
    runs.tick();
    const before = recordings.get(start.run.id)!;
    expect(recordings.truth(start.run.id)).toHaveLength(1);
    const record = recordings.truth(start.run.id)[0]!;
    database
      .prepare("UPDATE scenario_truth SET record = ? WHERE run_id = ?")
      .run(
        JSON.stringify({
          ...record,
          fixture: "harmless-anomaly",
          interpretation: "authorized-burst",
          targetUserId: "user-032",
        }),
        start.run.id,
      );
    expect(recordings.get(start.run.id)).toEqual(before);
    if (before.run.manifest.schemaVersion !== 2)
      throw new Error("Expected telemetry manifest");
    expect(before.snapshots.at(-1)?.input).toEqual(
      aggregateInput(
        before.run.manifest.organization,
        before.events.filter(
          (event): event is TelemetryEvent => "eventId" in event,
        ),
        1000,
      ),
    );
    database.exec(
      "CREATE TRIGGER fail_truth BEFORE INSERT ON scenario_truth BEGIN SELECT RAISE(ABORT, 'truth write failure'); END;",
    );
    runs.tick();
    const after = recordings.get(start.run.id)!;
    expect(after.run.status).toBe("failed");
    expect(after.events).toEqual(before.events);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.run.simulationTimeMs).toBe(1000);
  } finally {
    database.close();
  }
});

it.each(["credential-attack", "harmless-anomaly"] as const)(
  "records identical %s events and snapshots from the same versioned inputs and command",
  (fixture) => {
    const database = openDatabase(":memory:");
    try {
      const recordings = new Recordings(database);
      const runs = new Runs(recordings);
      const input = {
        seed: "reproducible-fixture",
        fixture,
        durationSeconds: 10,
      };
      const first = runs.start(input);
      for (let step = 0; step < 10; step++) runs.tick();
      const saved = recordings.get(first.run.id)!;
      const second = runs.start(input);
      for (let step = 0; step < 10; step++) runs.tick();
      const rerun = recordings.get(second.run.id)!;
      const withoutRun = <T extends { runId: string }>(values: T[]) =>
        values.map((value) => ({ ...value, runId: "" }));
      expect(rerun.run.manifest).toEqual(saved.run.manifest);
      expect(withoutRun(rerun.events)).toEqual(withoutRun(saved.events));
      expect(withoutRun(rerun.snapshots)).toEqual(withoutRun(saved.snapshots));
      expect(withoutRun(recordings.truth(second.run.id))).toEqual(
        withoutRun(recordings.truth(first.run.id)),
      );
      expect(rerun.commands[0]?.parameters).toEqual({ fixture });
      expect(
        saved.events.filter((event) => event.simulationTimeMs > 8000),
      ).toHaveLength(10);
      const state = saved.snapshots.find(
        (snapshot) => snapshot.simulationTimeMs === 8000,
      )!;
      expect(state.input.focus?.deviations).toBe(
        fixture === "credential-attack" ? 72 : 0,
      );
      expect(state.input.focus?.userId).toBe(
        recordings.truth(first.run.id)[0]?.targetUserId,
      );
    } finally {
      database.close();
    }
  },
);
