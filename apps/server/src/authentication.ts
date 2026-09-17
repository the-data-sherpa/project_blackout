import { createHash } from "node:crypto";
import {
  manifestSchema,
  type AuthenticationEvent,
  type RunManifest,
  type StartRun,
} from "@blackout/contracts";

export function createManifest(input: StartRun): RunManifest {
  return manifestSchema.parse({
    ...input,
    simulationOrigin: "2026-01-01T09:00:00.000Z",
    tickMs: 1000,
    initialState: {
      users: ["user-001", "user-002", "user-003"],
      hosts: ["workstation-001", "workstation-002"],
      resources: ["mail", "documents", "intranet"],
    },
    generatorVersion: "authentication/1",
    scenarioVersion: "baseline/1",
    schemaVersion: 1,
    policyVersion: null,
    evaluatorVersion: null,
    requestedModel: null,
    resolvedModel: null,
  });
}

// Each position owns its randomness. Scheduling and other runs cannot consume it.
export function authenticationStep(
  manifest: RunManifest,
  runId: string,
  simulationTimeMs: number,
): AuthenticationEvent[] {
  const tick = simulationTimeMs / manifest.tickMs;
  if (!Number.isInteger(tick) || tick < 1 || tick > manifest.durationSeconds)
    throw new Error("Simulation step outside the manifest");

  const { users, hosts, resources } = manifest.initialState;
  return [0, 1].map((position) => {
    const sequence = (tick - 1) * 2 + position + 1;
    const random = createHash("sha256")
      .update(
        JSON.stringify([manifest.generatorVersion, manifest.seed, sequence]),
      )
      .digest();
    return {
      runId,
      sequence,
      simulationTimeMs,
      occurredAt: new Date(
        Date.parse(manifest.simulationOrigin) + simulationTimeMs,
      ).toISOString(),
      type: "authentication",
      userId: users[random[0]! % users.length]!,
      hostId: hosts[random[1]! % hosts.length]!,
      resource: resources[random[2]! % resources.length]!,
      sourceIp: `192.0.2.${1 + (random[3]! % 20)}`,
      outcome: random[4]! % 12 === 0 ? "failure" : "success",
    };
  });
}
