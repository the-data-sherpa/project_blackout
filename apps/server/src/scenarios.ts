import type {
  Organization,
  ScenarioPlan,
  ScenarioTruth,
  StartRun,
  TelemetryManifest,
  RunCommand,
} from "@blackout/contracts";
import type { Observation } from "./telemetry.js";
import { randomBytes } from "./random.js";

export function createScenarioPlan(
  input: StartRun,
  organization: Organization,
): ScenarioPlan | undefined {
  if (
    input.fixture !== "credential-compromise" &&
    input.fixture !== "benign-maintenance"
  )
    return;
  const bytes = randomBytes("scenarios/1", input.seed);
  const user = organization.users[bytes[0]! % organization.users.length]!;
  const attack = input.fixture === "credential-compromise";
  const entry = attack
    ? organization.hosts.filter(
        (host) =>
          host.kind === "workstation" && !user.hostIds.includes(host.id),
      )[bytes[1]! % 10]!
    : organization.hosts.find((host) => host.id === user.hostIds[1])!;
  const resource = organization.resources.find(
    (item) => item.id === (attack ? "intranet" : user.resources[2]),
  )!;
  const names: ScenarioPlan["stages"][number]["name"][] = attack
    ? [
        "weak-signal",
        "increasing-failures",
        "unusual-success",
        "resource-access",
        "discovery",
        "lateral-movement",
      ]
    : ["sign-in", "document-transfer", "department-sync"];
  const span = attack ? 5000 : 10_000;
  return {
    version: "scenarios/1",
    targetUserId: user.userId,
    entryHostId: entry.id,
    secondHostId: resource.hostId,
    resourceId: resource.id,
    location: attack ? "Singapore" : entry.location,
    stopAtMs: (input.stopInjectionAtSeconds ?? 35) * 1000,
    stages: names.map((name, index) => ({
      name,
      startMs: 5000 + index * span,
      endExclusiveMs: 5000 + (index + 1) * span,
    })),
  };
}

// Pure schedule: wall time and model answers cannot change emitted observations.
export function scenarioObservations(
  manifest: TelemetryManifest,
  time: number,
): {
  observations: Observation[];
  truth: Omit<ScenarioTruth, "runId" | "eventSequences"> | null;
} {
  const plan = manifest.scenario;
  if (!plan) throw new Error("Scenario manifest requires its recorded plan");
  const attack = manifest.fixture === "credential-compromise";
  const truth = (
    stage: ScenarioTruth["stage"],
  ): Omit<ScenarioTruth, "runId" | "eventSequences"> => ({
    simulationTimeMs: time,
    fixture: manifest.fixture,
    targetUserId: plan.targetUserId,
    interpretation: attack ? "credential-misuse" : "authorized-burst",
    stage,
  });
  if (time === plan.stopAtMs)
    return { observations: [], truth: truth("stopped") };
  if (time > plan.stopAtMs) return { observations: [], truth: null };
  const stage = plan.stages.find(
    (stage) => time >= stage.startMs && time < stage.endExclusiveMs,
  );
  if (!stage) return { observations: [], truth: null };
  const { users, hosts, resources } = manifest.organization;
  const user = users.find((user) => user.userId === plan.targetUserId)!;
  const entry = hosts.find((host) => host.id === plan.entryHostId)!;
  const second = hosts.find((host) => host.id === plan.secondHostId)!;
  const chosen = resources.find((resource) => resource.id === plan.resourceId)!;
  const auth = (
    outcome: "success" | "failure",
    resource = user.resources[0]!,
    host = entry,
  ): Observation => ({
    type: "authentication",
    userId: user.userId,
    hostId: host.id,
    sourceIp: host.ip,
    location: plan.location,
    resource,
    outcome,
  });
  const dns = (resource: typeof chosen, host = entry): Observation => ({
    type: "dns",
    userId: user.userId,
    hostId: host.id,
    query: resource.domain,
    outcome: "resolved",
    answerIp: hosts.find((item) => item.id === resource.hostId)!.ip,
  });
  const network = (
    destinationHostId: string,
    destinationPort: number,
    bytesSent: number,
    host = entry,
    outcome: "allowed" | "denied" = "allowed",
  ): Observation => ({
    type: "network",
    userId: user.userId,
    hostId: host.id,
    destinationHostId,
    destinationPort,
    bytesSent,
    outcome,
  });
  let observations: Observation[];
  switch (stage.name) {
    case "weak-signal":
      observations = [auth("failure")];
      break;
    case "increasing-failures":
      observations = Array.from({ length: 4 }, () => auth("failure"));
      break;
    case "unusual-success":
      observations = [
        auth("success"),
        dns(resources[0]!),
        network(resources[0]!.hostId, 443, 6000),
      ];
      break;
    case "resource-access":
      observations = [
        auth("success", chosen.id),
        dns(chosen),
        network(chosen.hostId, 443, 4_000_000),
      ];
      break;
    case "discovery":
      observations = resources.flatMap((resource) => [
        dns(resource),
        network(
          resource.hostId,
          445,
          128,
          entry,
          resource.id === chosen.id ? "allowed" : "denied",
        ),
      ]);
      break;
    case "lateral-movement":
      observations = [
        auth("success", chosen.id),
        network(second.id, 445, 65_000),
        auth("success", "documents", second),
        dns(resources[1]!, second),
        network(resources[1]!.hostId, 443, 2_000_000, second),
      ];
      break;
    case "sign-in":
      observations = [
        auth(time === stage.startMs ? "failure" : "success"),
        dns(resources[0]!),
        network(resources[0]!.hostId, 443, 6000),
      ];
      break;
    case "document-transfer":
      observations = [
        auth("success", "documents"),
        dns(resources[1]!),
        network(resources[1]!.hostId, 443, 8_000_000),
      ];
      break;
    case "department-sync":
      observations = [
        auth("success", chosen.id),
        dns(chosen),
        network(chosen.hostId, 443, 6_000_000),
      ];
      break;
  }
  return { observations, truth: truth(stage.name) };
}

export function scheduledCommands(
  manifest: TelemetryManifest,
  runId: string,
  time: number,
): RunCommand[] {
  const plan = manifest.scenario;
  if (!plan) return [];
  const begin = plan.stages[0]!.startMs;
  const type =
    time === plan.stopAtMs
      ? "stop-injection"
      : time === begin && time < plan.stopAtMs
        ? "begin-injection"
        : null;
  return type
    ? [
        {
          runId,
          sequence:
            type === "begin-injection" || plan.stopAtMs <= begin ? 2 : 3,
          simulationTimeMs: time,
          recordedAt: new Date().toISOString(),
          type,
          parameters: { fixture: manifest.fixture },
        },
      ]
    : [];
}
