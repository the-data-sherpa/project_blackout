import type {
  ObservableEvent,
  Organization,
  TelemetryAuthentication,
} from "@blackout/contracts";

export const entityEvidenceRule = {
  id: "entity-evidence/1",
  windowMs: 30_000,
  suspiciousScore: 4,
  expression:
    "Last 30 seconds: 3 points per unfamiliar device, location, or resource plus 1 point per authentication failure; suspicious at 4 or more points.",
} as const;

export const maxRenderedRelationships = 64;
export const maxAnimatedRelationships = 12;
export const maxSupportingReferences = 12;

export type TopologyEntityKind = "user" | "workstation" | "server" | "service";
export type EvidenceStatus = "normal" | "suspicious" | "unavailable";

export type TopologyNode = {
  key: string;
  id: string;
  kind: TopologyEntityKind;
  status: EvidenceStatus;
  score: number;
  evidenceSequences: number[];
  explanation: string;
};

export type TopologyRelationship = {
  id: string;
  sourceKey: string;
  targetKey: string;
  type: "authentication" | "dns" | "network";
  count: number;
  lastSimulationTimeMs: number;
  evidenceSequences: number[];
};

export type TopologyState = {
  cursorMs: number;
  rule: typeof entityEvidenceRule;
  nodes: TopologyNode[];
  relationships: TopologyRelationship[];
};

type MutableRelationship = TopologyRelationship;

function entityKey(kind: TopologyEntityKind, id: string) {
  return `${kind}:${id}`;
}

function retainReference(sequences: number[], sequence: number) {
  sequences.push(sequence);
  if (sequences.length > maxSupportingReferences) sequences.shift();
}

function addRelationship(
  relationships: Map<string, MutableRelationship>,
  sourceKey: string,
  targetKey: string,
  type: TopologyRelationship["type"],
  event: ObservableEvent,
) {
  const id = `${type}:${sourceKey}->${targetKey}`;
  const relationship = relationships.get(id) ?? {
    id,
    sourceKey,
    targetKey,
    type,
    count: 0,
    lastSimulationTimeMs: event.simulationTimeMs,
    evidenceSequences: [],
  };
  relationship.count++;
  relationship.lastSimulationTimeMs = Math.max(
    relationship.lastSimulationTimeMs,
    event.simulationTimeMs,
  );
  retainReference(relationship.evidenceSequences, event.sequence);
  relationships.set(id, relationship);
}

function eventTouchesHost(event: ObservableEvent, hostId: string) {
  return (
    event.hostId === hostId ||
    (event.type === "network" && event.destinationHostId === hostId)
  );
}

function eventTouchesService(
  event: ObservableEvent,
  resource: Organization["resources"][number],
) {
  return (
    (event.type === "authentication" && event.resource === resource.id) ||
    (event.type === "dns" && event.query === resource.domain)
  );
}

function latestReferences(events: readonly ObservableEvent[]) {
  return events.slice(-maxSupportingReferences).map((event) => event.sequence);
}

export function buildTopology(
  organization: Organization,
  events: readonly ObservableEvent[],
  cursorMs: number,
): TopologyState {
  const visibleEvents = events.filter(
    (event) => event.simulationTimeMs <= cursorMs,
  );
  const recentEvents = visibleEvents.filter(
    (event) =>
      event.simulationTimeMs > cursorMs - entityEvidenceRule.windowMs &&
      event.simulationTimeMs <= cursorMs,
  );
  const hosts = new Map(organization.hosts.map((host) => [host.id, host]));
  const resourcesById = new Map(
    organization.resources.map((resource) => [resource.id, resource]),
  );
  const resourcesByDomain = new Map(
    organization.resources.map((resource) => [resource.domain, resource]),
  );
  const relationships = new Map<string, MutableRelationship>();

  for (const event of visibleEvents) {
    if (!("userId" in event)) continue;
    const userKey = entityKey("user", event.userId);
    const sourceHost = hosts.get(event.hostId);
    if (!sourceHost) continue;
    const sourceHostKey = entityKey(sourceHost.kind, sourceHost.id);
    addRelationship(relationships, userKey, sourceHostKey, event.type, event);
    if (event.type === "authentication") {
      const resource = resourcesById.get(event.resource);
      if (resource)
        addRelationship(
          relationships,
          sourceHostKey,
          entityKey("service", resource.id),
          "authentication",
          event,
        );
    } else if (event.type === "dns") {
      const resource = resourcesByDomain.get(event.query);
      if (resource)
        addRelationship(
          relationships,
          sourceHostKey,
          entityKey("service", resource.id),
          "dns",
          event,
        );
    } else if (event.type === "network") {
      const destination = hosts.get(event.destinationHostId);
      if (destination)
        addRelationship(
          relationships,
          sourceHostKey,
          entityKey(destination.kind, destination.id),
          "network",
          event,
        );
    }
  }

  const suspiciousEvidenceByUser = new Map<string, Set<number>>();
  const nodes: TopologyNode[] = organization.users.map((profile) => {
    const activity = recentEvents.filter(
      (event) => "userId" in event && event.userId === profile.userId,
    );
    const authentications = activity.filter(
      (event): event is TelemetryAuthentication =>
        event.type === "authentication" && "location" in event,
    );
    let score = 0;
    const supporting = authentications.filter((event) => {
      const deviations =
        Number(!profile.hostIds.includes(event.hostId)) +
        Number(!profile.locations.includes(event.location)) +
        Number(!profile.resources.includes(event.resource));
      const contribution = deviations * 3 + Number(event.outcome === "failure");
      score += contribution;
      return contribution > 0;
    });
    const suspicious = score >= entityEvidenceRule.suspiciousScore;
    if (suspicious)
      suspiciousEvidenceByUser.set(
        profile.userId,
        new Set(supporting.map((event) => event.sequence)),
      );
    return {
      key: entityKey("user", profile.userId),
      id: profile.userId,
      kind: "user" as const,
      status: activity.length
        ? suspicious
          ? ("suspicious" as const)
          : ("normal" as const)
        : ("unavailable" as const),
      score,
      evidenceSequences: suspicious
        ? latestReferences(supporting)
        : latestReferences(activity),
      explanation: activity.length
        ? suspicious
          ? `Rule-derived evidence: score ${score} meets the ${entityEvidenceRule.suspiciousScore}-point threshold.`
          : `Recent observations produce score ${score}, below the ${entityEvidenceRule.suspiciousScore}-point threshold.`
        : "No observations in the current 30-second evidence window.",
    };
  });

  for (const host of organization.hosts) {
    const activity = recentEvents.filter((event) =>
      eventTouchesHost(event, host.id),
    );
    const supporting = activity.filter(
      (event) =>
        "userId" in event &&
        suspiciousEvidenceByUser.get(event.userId)?.has(event.sequence),
    );
    nodes.push({
      key: entityKey(host.kind, host.id),
      id: host.id,
      kind: host.kind,
      status: activity.length
        ? supporting.length
          ? "suspicious"
          : "normal"
        : "unavailable",
      score: supporting.length,
      evidenceSequences: latestReferences(
        supporting.length ? supporting : activity,
      ),
      explanation: activity.length
        ? supporting.length
          ? `${supporting.length} recent observation${supporting.length === 1 ? "" : "s"} link this host to an identity that meets ${entityEvidenceRule.id}.`
          : "Recent host observations are not supporting references for a suspicious identity result."
        : "No observations in the current 30-second evidence window.",
    });
  }

  for (const resource of organization.resources) {
    const activity = recentEvents.filter((event) =>
      eventTouchesService(event, resource),
    );
    const supporting = activity.filter(
      (event) =>
        "userId" in event &&
        suspiciousEvidenceByUser.get(event.userId)?.has(event.sequence),
    );
    nodes.push({
      key: entityKey("service", resource.id),
      id: resource.id,
      kind: "service",
      status: activity.length
        ? supporting.length
          ? "suspicious"
          : "normal"
        : "unavailable",
      score: supporting.length,
      evidenceSequences: latestReferences(
        supporting.length ? supporting : activity,
      ),
      explanation: activity.length
        ? supporting.length
          ? `${supporting.length} recent observation${supporting.length === 1 ? "" : "s"} link this service to an identity that meets ${entityEvidenceRule.id}.`
          : "Recent service observations are not supporting references for a suspicious identity result."
        : "No observations in the current 30-second evidence window.",
    });
  }

  return {
    cursorMs,
    rule: entityEvidenceRule,
    nodes,
    relationships: [...relationships.values()].sort(
      (a, b) =>
        b.lastSimulationTimeMs - a.lastSimulationTimeMs ||
        a.id.localeCompare(b.id),
    ),
  };
}
