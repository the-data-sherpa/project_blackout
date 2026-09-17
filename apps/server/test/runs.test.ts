import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  recordingSchema,
  runListSchema,
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
    schemaVersion: 2,
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
      parameters: { fixture: "baseline" },
    },
  ]);
  expect(started.events).toHaveLength(4500);
  expect(started.events.every((event) => event.simulationTimeMs < 0)).toBe(
    true,
  );
  expect(started.snapshots).toHaveLength(1);
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
    lastSequence: 4510,
  });
  expect(saved.run.endedAt).not.toBeNull();
  expect(
    saved.events
      .filter((event) => event.simulationTimeMs > 0)
      .map(({ sequence, simulationTimeMs }) => [sequence, simulationTimeMs]),
  ).toEqual([
    [4501, 1000],
    [4502, 1000],
    [4503, 1000],
    [4504, 1000],
    [4505, 1000],
    [4506, 2000],
    [4507, 2000],
    [4508, 2000],
    [4509, 2000],
    [4510, 2000],
  ]);
  await expect.poll(() => messages.length).toBe(4);
  expect(messages[3]).toEqual({
    type: "run.updated",
    run: saved.run,
    events: saved.events.slice(-5),
    snapshot: saved.snapshots.at(-1),
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
    expect(reopened.pragma("user_version", { simple: true })).toBe(3);
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
    "CREATE TRIGGER fail_step BEFORE INSERT ON events WHEN NEW.sequence = 4510 BEGIN SELECT RAISE(ABORT, 'write failure'); END;",
  );
  runs.tick();
  runs.tick();
  const saved = recordings.get(started.run.id)!;
  expect(saved.run).toMatchObject({
    status: "failed",
    simulationTimeMs: 1000,
    lastSequence: 4505,
  });
  expect(saved.events).toHaveLength(4505);
  expect(saved.snapshots).toHaveLength(2);
  expect(messages.at(-1)?.type).toBe("recording.error");
  expect(
    messages
      .filter((message) => message.type === "run.updated")
      .flatMap((message) => message.events),
  ).toEqual(saved.events.filter((event) => event.simulationTimeMs > 0));
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
      lastSequence: 4505,
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
  expect(() => runs.tick()).not.toThrow();
  expect(recordings.get(started.run.id)?.run).toMatchObject({
    status: "running",
    simulationTimeMs: 1000,
    lastSequence: 4505,
  });
  expect(runs.recordingFailure).toBeNull();
  unsubscribe();
  runs.tick();
  expect(recordings.get(started.run.id)?.run).toMatchObject({
    status: "completed",
    simulationTimeMs: 2000,
    lastSequence: 4510,
  });
});

it("lists every stored run in stable pages and identifies the active run", async () => {
  const { app, tick } = await createApp();
  expect(runListSchema.parse((await app.inject("/api/runs")).json())).toEqual({
    runs: [],
    total: 0,
    nextOffset: null,
    activeRunId: null,
  });
  const created = [];
  for (const seed of ["page-one", "page-two", "page-three"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { seed, durationSeconds: 1 },
    });
    created.push(recordingSchema.parse(response.json()).run);
    if (seed !== "page-three") tick();
  }
  const first = runListSchema.parse(
    (await app.inject("/api/runs?limit=2")).json(),
  );
  const second = runListSchema.parse(
    (await app.inject("/api/runs?limit=2&offset=2")).json(),
  );
  expect(first.total).toBe(3);
  expect(first.nextOffset).toBe(2);
  expect(second.nextOffset).toBeNull();
  expect(first.activeRunId).toBe(created[2]?.id);
  const summaries = [...first.runs, ...second.runs];
  expect(summaries.map((run) => run.id)).toEqual(
    [...created]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .map((run) => run.id),
  );
  expect(summaries.filter((run) => run.status === "completed")).toHaveLength(2);
  expect(
    summaries.every(
      (run) => !Object.hasOwn(run, "events") && !Object.hasOwn(run, "manifest"),
    ),
  ).toBe(true);
  for (const query of [
    "limit=0",
    "limit=101",
    "offset=-1",
    "offset=1.5",
    "offset=abc",
    "extra=true",
  ]) {
    expect((await app.inject(`/api/runs?${query}`)).statusCode).toBe(400);
  }
});

it("reports failed start writes over HTTP without creating a phantom recording", async () => {
  const { path, database } = createStore();
  const app = await buildApp({
    databasePath: path,
    webOrigin: "http://localhost:3000",
    schedule: () => () => {},
  });
  cleanup.push(() => app.close());
  await app.ready();
  database.exec(
    "CREATE TRIGGER fail_start BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'private-disk-details'); END;",
  );
  const failed = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { seed: "failed-start" },
  });
  expect(failed.statusCode).toBe(503);
  expect(failed.json().code).toBe("recording_unavailable");
  expect(failed.body).not.toContain("private-disk-details");
  expect(
    runListSchema.parse((await app.inject("/api/runs")).json()).total,
  ).toBe(0);
  database.exec("DROP TRIGGER fail_start;");
  const retried = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { seed: "retry" },
  });
  expect(retried.statusCode).toBe(201);
  expect(
    runListSchema.parse((await app.inject("/api/runs")).json()).total,
  ).toBe(1);
});

it("reports a storage failure even when it cannot persist failed status", async () => {
  const { path, database } = createStore();
  let tick = () => {};
  const app = await buildApp({
    databasePath: path,
    webOrigin: "http://localhost:3000",
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  await app.ready();
  const started = recordingSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { seed: "disk-full", durationSeconds: 3 },
      })
    ).json(),
  );
  tick();
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
  database.exec(
    "CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk full'); END; CREATE TRIGGER fail_status BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  try {
    tick();
    tick();
    await expect
      .poll(() =>
        messages.some((message) => message.type === "recording.error"),
      )
      .toBe(true);
    const saved = recordingSchema.parse(
      (await app.inject(`/api/runs/${started.run.id}`)).json(),
    );
    expect(saved.run).toMatchObject({
      status: "running",
      simulationTimeMs: 1000,
      lastSequence: 4505,
    });
    expect(saved.events).toHaveLength(4505);
    expect(
      messages.filter((message) => message.type === "run.updated"),
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { seed: "not-accepted" },
        })
      ).statusCode,
    ).toBe(503);
  } finally {
    database.exec("DROP TRIGGER fail_events; DROP TRIGGER fail_status;");
  }
});

it("classifies invalid saved data as a recording failure rather than bad request input", async () => {
  const { path, database } = createStore();
  let tick = () => {};
  const app = await buildApp({
    databasePath: path,
    webOrigin: "http://localhost:3000",
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  await app.ready();
  const started = recordingSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { seed: "bad-record", durationSeconds: 1 },
      })
    ).json(),
  );
  tick();
  database
    .prepare("UPDATE events SET record = ? WHERE run_id = ?")
    .run(JSON.stringify({ invalid: "stored event" }), started.run.id);
  const response = await app.inject(`/api/runs/${started.run.id}`);
  expect(response.statusCode).toBe(503);
  expect(response.json().code).toBe("recording_unavailable");
});

it("serves truth only from its explicit endpoint and retains evidence for every saved aggregate", async () => {
  const { app, tick } = await createApp();
  const started = recordingSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          seed: "separate-truth",
          durationSeconds: 2,
          fixture: "credential-attack",
        },
      })
    ).json(),
  );
  tick();
  tick();
  const saved = recordingSchema.parse(
    (await app.inject(`/api/runs/${started.run.id}`)).json(),
  );
  const truth = (await app.inject(`/api/runs/${started.run.id}/truth`)).json();
  expect(truth.records).toHaveLength(2);
  expect(JSON.stringify(saved)).not.toContain("credential-misuse");
  expect(saved.snapshots).toHaveLength(3);
  const events = new Map(saved.events.map((event) => [event.sequence, event]));
  for (const snapshot of saved.snapshots) {
    for (const window of snapshot.input.windows) {
      for (const metric of window.metrics) {
        for (const sequence of metric.evidenceSequences) {
          const event = events.get(sequence)!;
          expect(event).toBeDefined();
          expect(event.simulationTimeMs).toBeGreaterThan(
            window.startExclusiveMs,
          );
          expect(event.simulationTimeMs).toBeLessThanOrEqual(
            window.endInclusiveMs,
          );
        }
      }
    }
  }
  expect((await app.inject(`/api/runs/${randomUUID()}/truth`)).statusCode).toBe(
    404,
  );
});
