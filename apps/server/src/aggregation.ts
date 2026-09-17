import {
  evaluatorInputSchema,
  activityObservationSchema,
  type FocusActivity,
  observableSnapshotSchema,
  windowSizes,
  type AggregateMetric,
  type EvaluatorInput,
  type ObservableSnapshot,
  type Organization,
  type TelemetryAuthentication,
  type TelemetryEvent,
  type UserProfile,
} from "@blackout/contracts";

function deviations(event: TelemetryAuthentication, profile: UserProfile) {
  return (
    Number(!profile.hostIds.includes(event.hostId)) +
    Number(!profile.locations.includes(event.location)) +
    Number(!profile.resources.includes(event.resource))
  );
}

// Deliberately cannot accept a run, manifest, fixture or truth record.
export function aggregateInput(
  organization: Organization,
  events: readonly TelemetryEvent[],
  simulationTimeMs: number,
): EvaluatorInput {
  const profiles = new Map(
    organization.users.map((profile) => [profile.userId, profile]),
  );
  const windows = windowSizes.map((durationMs) => {
    const startExclusiveMs = simulationTimeMs - durationMs;
    const included = events.filter(
      (event) =>
        event.simulationTimeMs > startExclusiveMs &&
        event.simulationTimeMs <= simulationTimeMs,
    );
    const auth = included.filter((event) => event.type === "authentication");
    const dns = included.filter((event) => event.type === "dns");
    const network = included.filter((event) => event.type === "network");
    const host = included.filter((event) => event.type === "host-metric");
    const metric = (
      name: AggregateMetric["name"],
      evidence: readonly TelemetryEvent[],
      value: number | null = evidence.length,
    ): AggregateMetric => ({
      name,
      value,
      evidenceSequences: evidence.map((event) => event.sequence),
    });
    const metrics = [
      metric("authenticationAttempts", auth),
      metric(
        "authenticationFailures",
        auth.filter((event) => event.outcome === "failure"),
      ),
      metric(
        "unfamiliarDevices",
        auth.filter(
          (event) =>
            !profiles.get(event.userId)!.hostIds.includes(event.hostId),
        ),
      ),
      metric(
        "unfamiliarLocations",
        auth.filter(
          (event) =>
            !profiles.get(event.userId)!.locations.includes(event.location),
        ),
      ),
      metric(
        "unfamiliarResources",
        auth.filter(
          (event) =>
            !profiles.get(event.userId)!.resources.includes(event.resource),
        ),
      ),
      metric("dnsQueries", dns),
      metric(
        "dnsFailures",
        dns.filter((event) => event.outcome === "nxdomain"),
      ),
      metric("networkConnections", network),
      metric(
        "networkBytes",
        network,
        network.reduce((sum, event) => sum + event.bytesSent, 0),
      ),
      metric(
        "meanCpuPercent",
        host,
        host.length
          ? host.reduce((sum, event) => sum + event.cpuPercent, 0) / host.length
          : null,
      ),
      metric(
        "meanMemoryPercent",
        host,
        host.length
          ? host.reduce((sum, event) => sum + event.memoryPercent, 0) /
              host.length
          : null,
      ),
    ];
    return {
      durationMs,
      startExclusiveMs,
      endInclusiveMs: simulationTimeMs,
      metrics,
    };
  });
  const recent = events.filter(
    (event): event is TelemetryAuthentication =>
      event.type === "authentication" &&
      event.simulationTimeMs > simulationTimeMs - 30_000 &&
      event.simulationTimeMs <= simulationTimeMs,
  );
  const candidates = organization.users
    .map((profile) => {
      const evidence = recent.filter(
        (event) => event.userId === profile.userId,
      );
      const failures = evidence.filter(
        (event) => event.outcome === "failure",
      ).length;
      const deviationCount = evidence.reduce(
        (sum, event) => sum + deviations(event, profile),
        0,
      );
      return {
        userId: profile.userId,
        profile,
        windowMs: 30_000 as const,
        score: 3 * deviationCount + failures,
        attempts: evidence.length,
        failures,
        deviations: deviationCount,
        evidenceSequences: evidence.map((event) => event.sequence),
        rule: "3 per unfamiliar device/location/resource + 1 per failure; highest score, then attempts, then ascending user ID" as const,
      };
    })
    .filter((candidate) => candidate.attempts > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.attempts - a.attempts ||
        a.userId.localeCompare(b.userId),
    );
  const focus = candidates[0] ?? null;
  const groups = new Map<string, FocusActivity["groups"][number]>();
  let totalEvents = 0;
  for (const event of events) {
    if (
      !focus ||
      !("userId" in event) ||
      event.userId !== focus.userId ||
      event.simulationTimeMs <= simulationTimeMs - 30_000 ||
      event.simulationTimeMs > simulationTimeMs
    )
      continue;
    const observation = activityObservationSchema.parse(
      Object.fromEntries(
        Object.entries(event).filter(
          ([key]) =>
            ![
              "runId",
              "eventId",
              "sequence",
              "simulationTimeMs",
              "occurredAt",
              "source",
              "severity",
            ].includes(key),
        ),
      ),
    );
    const key = JSON.stringify(observation);
    const group = groups.get(key) ?? {
      observation,
      count: 0,
      firstSimulationMs: event.simulationTimeMs,
      lastSimulationMs: event.simulationTimeMs,
      evidenceSequences: [],
    };
    group.count++;
    group.firstSimulationMs = Math.min(
      group.firstSimulationMs,
      event.simulationTimeMs,
    );
    group.lastSimulationMs = Math.max(
      group.lastSimulationMs,
      event.simulationTimeMs,
    );
    group.evidenceSequences.push(event.sequence);
    groups.set(key, group);
    totalEvents++;
  }
  const orderedGroups = [...groups.entries()].sort(
    (a, b) =>
      b[1].lastSimulationMs - a[1].lastSimulationMs || a[0].localeCompare(b[0]),
  );
  return evaluatorInputSchema.parse({
    schemaVersion: "observable-state/2",
    simulationTimeMs,
    windows,
    focus,
    focusActivity: {
      windowMs: 30_000,
      totalEvents,
      omittedGroups: Math.max(0, groups.size - 16),
      groups: orderedGroups.slice(0, 16).map(([, group]) => group),
    },
  });
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function createSnapshot(
  runId: string,
  organization: Organization,
  events: readonly TelemetryEvent[],
  simulationTimeMs: number,
): ObservableSnapshot {
  return freezeDeep(
    observableSnapshotSchema.parse({
      id: `snapshot-${String(simulationTimeMs / 1000 + 1).padStart(6, "0")}`,
      runId,
      simulationTimeMs,
      input: aggregateInput(organization, events, simulationTimeMs),
      recordedAt: new Date().toISOString(),
    }),
  );
}
