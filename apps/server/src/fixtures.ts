import type { ScenarioTruth, TelemetryManifest } from "@blackout/contracts";
import type { Observation } from "./telemetry.js";
import { randomBytes } from "./random.js";
import { scenarioObservations } from "./scenarios.js";

// Fixture metadata never enters the aggregator or the observable envelope.
export function fixtureObservations(
  manifest: TelemetryManifest,
  time: number,
): {
  observations: Observation[];
  truth: Omit<ScenarioTruth, "runId" | "eventSequences"> | null;
} {
  if (manifest.scenarioVersion === "scenarios/1")
    return scenarioObservations(manifest, time);
  if (manifest.fixture === "baseline" || time < 1000 || time > 8000)
    return { observations: [], truth: null };
  const { users, hosts, resources } = manifest.organization;
  const target =
    users[randomBytes("fixtures/1", manifest.seed)[0]! % users.length]!;
  const attack = manifest.fixture === "credential-attack";
  const host = attack
    ? hosts.find(
        (item) =>
          item.kind === "workstation" && !target.hostIds.includes(item.id),
      )!
    : hosts.find((item) => item.id === target.hostIds[1])!;
  const resource = attack
    ? resources.find((item) => !target.resources.includes(item.id))!.id
    : target.resources[2]!;
  const observations: Observation[] = Array.from({ length: 3 }, () => ({
    type: "authentication",
    userId: target.userId,
    hostId: host.id,
    resource,
    sourceIp: host.ip,
    location: attack ? "Singapore" : target.locations.at(-1)!,
    outcome:
      (attack && time <= 4000) || (!attack && time === 1000)
        ? "failure"
        : "success",
  }));
  if (!attack)
    observations.push({
      type: "network",
      userId: target.userId,
      hostId: host.id,
      destinationHostId: resources.find((item) => item.id === resource)!.hostId,
      destinationPort: 443,
      bytesSent: 8_000_000,
      outcome: "allowed",
    });
  return {
    observations,
    truth: {
      simulationTimeMs: time,
      fixture: manifest.fixture,
      targetUserId: target.userId,
      interpretation: attack ? "credential-misuse" : "authorized-burst",
    },
  };
}
