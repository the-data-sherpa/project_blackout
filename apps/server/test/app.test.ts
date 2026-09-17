import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { healthSchema, serverMessageSchema } from "@blackout/contracts";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp() {
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
  });
  apps.push(app);
  await app.ready();
  return app;
}

describe("backend transport", () => {
  it("reports SQLite readiness using the shared contract", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:3000" },
    });
    expect(response.statusCode).toBe(200);
    expect(healthSchema.parse(response.json()).database).toBe("ready");
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });

  it("sends a validated WebSocket greeting", async () => {
    const app = await createApp();
    let message: Promise<unknown[]> | undefined;
    const socket = await app.injectWS(
      "/ws",
      { headers: { origin: "http://localhost:3000" } },
      {
        onInit: (client) => {
          message = once(client, "message");
        },
      },
    );
    try {
      const [payload] = await message!;
      expect(serverMessageSchema.parse(JSON.parse(String(payload)))).toEqual({
        type: "connection.ready",
        protocolVersion: 1,
      });
    } finally {
      socket.terminate();
    }
  });

  it("rejects browser WebSocket connections from another origin", async () => {
    const app = await createApp();
    await expect(
      app.injectWS("/ws", { headers: { origin: "https://unrelated.example" } }),
    ).rejects.toThrow();
  });
});

it("fails fast on invalid configuration", () => {
  expect(() => readConfig({ API_PORT: "not-a-port" })).toThrow();
  expect(() => readConfig({ DATABASE_PATH: "" })).toThrow();
});
