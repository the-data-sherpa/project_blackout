import { describe, expect, it } from "vitest";
import { healthSchema, serverMessageSchema } from "../src/index.js";

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
