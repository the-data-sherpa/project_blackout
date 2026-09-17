import { describe, expect, it } from "vitest";
import {
  authenticationEventSchema,
  healthSchema,
  serverMessageSchema,
} from "../src/index.js";

describe("transport contracts", () => {
  it("rejects an unavailable database presented as healthy", () => {
    expect(
      healthSchema.safeParse({
        status: "ok",
        service: "blackout-server",
        database: "unavailable",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown protocol versions and unexpected fields", () => {
    expect(
      serverMessageSchema.safeParse({
        type: "connection.ready",
        protocolVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: "connection.ready",
        protocolVersion: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

it("keeps scenario truth and command metadata outside observable events", () => {
  const event = {
    runId: "b612389b-b7ee-4a2a-8e34-96bff19329d1",
    sequence: 1,
    simulationTimeMs: 1000,
    occurredAt: "2026-01-01T09:00:01.000Z",
    type: "authentication",
    userId: "user-001",
    hostId: "workstation-001",
    resource: "mail",
    sourceIp: "192.0.2.1",
    outcome: "success",
  };
  expect(authenticationEventSchema.safeParse(event).success).toBe(true);
  for (const field of ["scenario", "stage", "isAttack", "command", "apiKey"]) {
    expect(
      authenticationEventSchema.safeParse({ ...event, [field]: "hidden" })
        .success,
    ).toBe(false);
  }
});
