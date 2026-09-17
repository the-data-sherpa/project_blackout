import { describe, expect, it } from "vitest";
import type {
  ObservableEvent,
  Organization,
  TelemetryAuthentication,
} from "@blackout/contracts";
import {
  buildTopology,
  entityEvidenceRule,
  type TopologyState,
} from "../../web/src/app/topology.js";
const organization: Organization = {
  users: [
    {
      userId: "user-001",
      department: "engineering",
      hostIds: ["host-001"],
      locations: ["London"],
      resources: ["documents"],
    },
  ],
  hosts: [
    {
      id: "host-001",
      kind: "workstation",
      location: "London",
      ip: "10.0.0.1",
    },
    {
      id: "host-002",
      kind: "server",
      location: "Singapore",
      ip: "10.0.0.2",
    },
  ],
  resources: [
    {
      id: "documents",
      hostId: "host-002",
      domain: "documents.blackout.test",
    },
    {
      id: "intranet",
      hostId: "host-002",
      domain: "intranet.blackout.test",
    },
  ],
};

function authentication(
  sequence: number,
  simulationTimeMs: number,
  overrides: Partial<TelemetryAuthentication> = {},
): TelemetryAuthentication {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    eventId: `event-${String(sequence).padStart(6, "0")}`,
    sequence,
    simulationTimeMs,
    occurredAt: new Date(simulationTimeMs).toISOString(),
    severity: "info",
    source: "identity-provider",
    type: "authentication",
    userId: "user-001",
    hostId: "host-001",
    resource: "documents",
    sourceIp: "10.0.0.1",
    location: "London",
    outcome: "success",
    ...overrides,
  };
}

function node(state: TopologyState, id: string) {
  const result = state.nodes.find((item) => item.id === id);
  if (!result) throw new Error(`Missing node ${id}`);
  return result;
}

describe("entity evidence topology", () => {
  it("applies the explicit threshold and expires evidence at the open window boundary", () => {
    const familiarFailure = authentication(1, 0, {
      outcome: "failure",
      severity: "warning",
    });
    const unfamiliarSuccess = authentication(2, 1000, {
      hostId: "host-002",
      sourceIp: "10.0.0.2",
      location: "Singapore",
      resource: "intranet",
    });
    const events: ObservableEvent[] = [familiarFailure, unfamiliarSuccess];

    const belowThreshold = buildTopology(organization, events, 0);
    expect(node(belowThreshold, "user-001")).toMatchObject({
      status: "normal",
      score: 1,
      evidenceSequences: [1],
    });

    const suspicious = buildTopology(organization, events, 1000);
    expect(node(suspicious, "user-001")).toMatchObject({
      status: "suspicious",
      score: 10,
      evidenceSequences: [1, 2],
    });
    expect(node(suspicious, "host-002")).toMatchObject({
      status: "suspicious",
      evidenceSequences: [2],
    });
    expect(node(suspicious, "intranet")).toMatchObject({
      status: "suspicious",
      evidenceSequences: [2],
    });

    const expired = buildTopology(
      organization,
      [unfamiliarSuccess],
      1000 + entityEvidenceRule.windowMs,
    );
    expect(node(expired, "user-001")).toMatchObject({
      status: "unavailable",
      score: 0,
      evidenceSequences: [],
    });
    expect(node(expired, "host-002").status).toBe("unavailable");
  });

  it("shows no future relationship and ignores truth-shaped metadata", () => {
    const event = authentication(1, 5000, {
      hostId: "host-002",
      sourceIp: "10.0.0.2",
      location: "Singapore",
      resource: "intranet",
    });
    const clean = buildTopology(organization, [event], 5000);
    const truthContaminated = buildTopology(
      organization,
      [
        {
          ...event,
          fixture: "credential-compromise",
          interpretation: "credential-misuse",
          attack: true,
        } as ObservableEvent,
      ],
      5000,
    );

    expect(buildTopology(organization, [event], 4999).relationships).toEqual(
      [],
    );
    expect(truthContaminated).toEqual(clean);
    expect(clean.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "user:user-001",
          targetKey: "server:host-002",
          type: "authentication",
          evidenceSequences: [1],
        }),
        expect.objectContaining({
          sourceKey: "server:host-002",
          targetKey: "service:intranet",
          type: "authentication",
          evidenceSequences: [1],
        }),
      ]),
    );
  });
});
