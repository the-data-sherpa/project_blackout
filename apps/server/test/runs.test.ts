import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  recordingSchema,
  serverMessageSchema,
  type RunMessage,
  type ServerMessage,
} from "@blackout/contracts";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function createApp() {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  await app.ready();
  return { app, tick: () => tick() };
}

it("starts, commits and inspects a complete ordered run through HTTP and WebSocket", async () => {
  const { app, tick } = await createApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { seed: "demo", durationSeconds: 2 },
  });
  expect(response.statusCode).toBe(201);
  const started = recordingSchema.parse(response.json());
  expect(started.run.status).toBe("running");
  expect(started.run.manifest).toMatchObject({
    seed: "demo",
    schemaVersion: 1,
    policyVersion: null,
    evaluatorVersion: null,
    requestedModel: null,
    resolvedModel: null,
  });
  expect(started.commands).toEqual([
    {
      runId: started.run.id,
      type: "start",
      sequence: 1,
      simulationTimeMs: 0,
      recordedAt: started.run.createdAt,
    },
  ]);
  expect(started.events).toEqual([]);
  const messages: ServerMessage[] = [];
  const socket = await app.injectWS(
    `/ws?runId=${started.run.id}`,
    {},
    {
      onInit: (client) => {
        client.on("message", (payload) =>
          messages.push(serverMessageSchema.parse(JSON.parse(String(payload)))),
        );
      },
    },
  );
  cleanup.push(() => socket.terminate());
  await expect.poll(() => messages.length).toBe(2);
  expect(messages[1]).toEqual({ type: "run.snapshot", recording: started });

  tick();
  tick();
  tick();
  const inspected = await app.inject(`/api/runs/${started.run.id}`);
  const saved = recordingSchema.parse(inspected.json());
  expect(saved.run).toMatchObject({
    status: "completed",
    simulationTimeMs: 2000,
    lastSequence: 4,
  });
  expect(saved.run.endedAt).not.toBeNull();
  expect(
    saved.events.map(({ sequence, simulationTimeMs }) => [
      sequence,
      simulationTimeMs,
    ]),
  ).toEqual([
    [1, 1000],
    [2, 1000],
    [3, 2000],
    [4, 2000],
  ]);
  await expect.poll(() => messages.length).toBe(4);
  expect(messages[3]).toEqual({
    type: "run.updated",
    run: saved.run,
    events: saved.events.slice(2),
  });
  expect((await app.inject("/api/runs/active")).json()).toEqual({
    runId: null,
  });

  const next = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { seed: "demo", durationSeconds: 1 },
  });
  const second = recordingSchema.parse(next.json());
  expect(second.run.id).not.toBe(started.run.id);
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  expect(messages).toHaveLength(4); // A subscriber never receives another run's records.
  expect(
    recordingSchema.parse(
      (await app.inject(`/api/runs/${started.run.id}`)).json(),
    ),
  ).toEqual(saved);
  expect(second.commands[0]?.runId).toBe(second.run.id);
});

it("rejects concurrent starts, malformed requests, unknown fields and invalid run IDs", async () => {
  const { app } = await createApp();
  for (const payload of [
    { seed: " " },
    { seed: "a", durationSeconds: 1.5 },
    { seed: "a", durationSeconds: 121 },
    { seed: "a", durationSeconds: "2" },
    { seed: "a", apiKey: "must-not-be-recorded" },
  ]) {
    expect(
      (await app.inject({ method: "POST", url: "/api/runs", payload }))
        .statusCode,
    ).toBe(400);
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        headers: { "content-type": "application/json" },
        payload: "{",
      })
    ).statusCode,
  ).toBe(400);
  expect((await app.inject("/api/runs/not-a-uuid")).statusCode).toBe(400);
  expect((await app.inject(`/api/runs/${randomUUID()}`)).statusCode).toBe(404);
  await expect(app.injectWS(`/ws?runId=${randomUUID()}`)).rejects.toThrow();
  const starts = await Promise.all(
    ["first", "second"].map((seed) =>
      app.inject({ method: "POST", url: "/api/runs", payload: { seed } }),
    ),
  );
  expect(starts.map((response) => response.statusCode).sort()).toEqual([
    201, 409,
  ]);
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "blackout-recordings-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "runs.sqlite");
  const database = openDatabase(path);
  cleanup.push(() => {
    if (database.open) database.close();
  });
  return { path, database, recordings: new Recordings(database) };
}

it("reproduces tied events from the saved manifest despite irregular wall-clock scheduling", async () => {
  const { recordings } = createStore();
  const runs = new Runs(recordings);
  const first = runs.start({ seed: "deterministic", durationSeconds: 8 });
  for (let i = 0; i < 8; i++) runs.tick();
  const expected = recordings.get(first.run.id)!;
  const second = runs.start({
    seed: expected.run.manifest.seed,
    durationSeconds: expected.run.manifest.durationSeconds,
  });
  for (const delay of [8, 0, 3, 12, 0, 1, 7, 2]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    runs.tick();
  }
  const actual = recordings.get(second.run.id)!;
  expect(actual.run.manifest).toEqual(expected.run.manifest);
  expect(actual.events.map((event) => ({ ...event, runId: "" }))).toEqual(
    expected.events.map((event) => ({ ...event, runId: "" })),
  );
  expect(
    actual.commands.map(({ sequence, simulationTimeMs, type }) => ({
      sequence,
      simulationTimeMs,
      type,
    })),
  ).toEqual([{ sequence: 1, simulationTimeMs: 0, type: "start" }]);
  const different = runs.start({ seed: "another-seed", durationSeconds: 8 });
  for (let i = 0; i < 8; i++) runs.tick();
  expect(
    recordings
      .get(different.run.id)!
      .events.map((event) => ({ ...event, runId: "" })),
  ).not.toEqual(actual.events.map((event) => ({ ...event, runId: "" })));
});

it("publishes only committed records, and preserves them across reopen", () => {
  const { path, database, recordings } = createStore();
  const runs = new Runs(recordings);
  const observerDatabase = openDatabase(path);
  cleanup.push(() => observerDatabase.close());
  const observer = new Recordings(observerDatabase);
  runs.subscribe((message) => {
    if (message.type !== "run.updated") return;
    const committed = observer.get(message.run.id)!;
    expect(committed.run).toEqual(message.run);
    expect(committed.events.slice(-message.events.length)).toEqual(
      message.events,
    );
  });
  const started = runs.start({ seed: "durable", durationSeconds: 2 });
  expect(observer.get(started.run.id)).toEqual(started);
  runs.tick();
  runs.tick();
  const expected = recordings.get(started.run.id);
  database.close();
  const reopened = openDatabase(path);
  try {
    expect(new Recordings(reopened).get(started.run.id)).toEqual(expected);
    expect(reopened.pragma("user_version", { simple: true })).toBe(1);
    expect(reopened.pragma("synchronous", { simple: true })).toBe(2);
  } finally {
    reopened.close();
  }
});

it("rolls back a failed start and a partial step without publishing unsaved events", () => {
  const { database, recordings } = createStore();
  const runs = new Runs(recordings);
  const messages: RunMessage[] = [];
  runs.subscribe((message) => messages.push(message));
  database.exec(
    "CREATE TRIGGER fail_start BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'write failure'); END;",
  );
  expect(() => runs.start({ seed: "failure" })).toThrow();
  expect(database.prepare("SELECT count(*) AS count FROM runs").get()).toEqual({
    count: 0,
  });
  database.exec("DROP TRIGGER fail_start;");
  const started = runs.start({ seed: "failure", durationSeconds: 3 });
  runs.tick();
  database.exec(
    "CREATE TRIGGER fail_step BEFORE INSERT ON events WHEN NEW.sequence = 4 BEGIN SELECT RAISE(ABORT, 'write failure'); END;",
  );
  runs.tick();
  runs.tick();
  const saved = recordings.get(started.run.id)!;
  expect(saved.run).toMatchObject({
    status: "failed",
    simulationTimeMs: 1000,
    lastSequence: 2,
  });
  expect(saved.events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(messages.at(-1)?.type).toBe("recording.error");
  expect(
    messages
      .filter((message) => message.type === "run.updated")
      .flatMap((message) => message.events),
  ).toEqual(saved.events);
  expect(() => runs.start({ seed: "next" })).toThrow("Recording failed");
});

it("marks unfinished runs interrupted before accepting a new run", () => {
  const { path, database, recordings } = createStore();
  const runs = new Runs(recordings);
  const started = runs.start({ seed: "interrupted", durationSeconds: 3 });
  runs.tick();
  database.close();
  const reopened = openDatabase(path);
  try {
    const after = new Runs(new Recordings(reopened));
    expect(after.recordings.get(started.run.id)?.run).toMatchObject({
      status: "interrupted",
      simulationTimeMs: 1000,
      lastSequence: 2,
    });
    expect(after.start({ seed: "next" }).run.id).not.toBe(started.run.id);
  } finally {
    reopened.close();
  }
});

it("does not rewind a committed step when a transport subscriber throws", () => {
  const { recordings } = createStore();
  const runs = new Runs(recordings);
  const started = runs.start({ seed: "transport", durationSeconds: 2 });
  const unsubscribe = runs.subscribe(() => {
    throw new Error("Socket closed");
  });
  expect(() => runs.tick()).toThrow("Socket closed");
  expect(recordings.get(started.run.id)?.run).toMatchObject({
    status: "running",
    simulationTimeMs: 1000,
    lastSequence: 2,
  });
  expect(runs.recordingFailure).toBeNull();
  unsubscribe();
  runs.tick();
  expect(recordings.get(started.run.id)?.run).toMatchObject({
    status: "completed",
    simulationTimeMs: 2000,
    lastSequence: 4,
  });
});
