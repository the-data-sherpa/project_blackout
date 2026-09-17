import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  recordingSchema,
  runListSchema,
  storageUsageSchema,
} from "@blackout/contracts";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function store() {
  const directory = mkdtempSync(join(tmpdir(), "blackout-storage-"));
  const path = join(directory, "recordings.sqlite");
  const database = openDatabase(path);
  const recordings = new Recordings(database);
  const runs = new Runs(recordings);
  cleanup.push(async () => {
    await runs.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { path, database, recordings, runs };
}

it("counts owned UTF-8 records, protects active and linked runs, and preserves other evidence across restart", async () => {
  const { path, database, recordings, runs } = store();
  const first = runs.start({ seed: "storage-🗄", durationSeconds: 1 }).run.id;
  expect(() => runs.rerun(first)).toThrow("source run to finish");
  await expect(runs.reevaluate(first)).rejects.toThrow("source run to finish");
  expect(() => recordings.storage.delete(first)).toThrow("active");
  runs.tick();
  const original = recordings.get(first)!;
  const rerun = runs.rerun(first);
  if (rerun.status !== "created") throw new Error("Expected rerun");
  const fresh = await runs.reevaluate(first);
  if (fresh.status !== "created") throw new Error("Expected reevaluation");
  const next = await runs.reevaluate(fresh.recording.run.id);
  if (next.status !== "created")
    throw new Error("Expected chained reevaluation");
  expect(next.recording.events).toEqual(original.events);
  expect(next.recording.snapshots).toEqual(original.snapshots);
  expect(next.recording.commands).toEqual(original.commands);
  expect(() => recordings.storage.delete(first)).toThrow("linked recording");
  expect(() => recordings.storage.delete(fresh.recording.run.id)).toThrow(
    "linked recording",
  );
  expect(
    recordings.storage.describe(fresh.recording.run.id)?.sharedSourceRunId,
  ).toBe(first);
  expect(recordings.storage.describe(first)?.ownedBytes).toBeGreaterThan(
    Buffer.byteLength(JSON.stringify(original.events)),
  );
  const before = recordings.storage.usage();
  expect(before.databaseBytes).toBeGreaterThan(0);
  recordings.storage.delete(next.recording.run.id);
  recordings.storage.delete(fresh.recording.run.id);
  recordings.storage.delete(rerun.recording.run.id);
  expect(recordings.get(first)).toEqual(original);
  const observer = openDatabase(path);
  try {
    expect(new Recordings(observer).get(first)).toEqual(original);
  } finally {
    observer.close();
  }
  expect(recordings.storage.usage().recordingBytes).toBeLessThan(
    before.recordingBytes,
  );
  expect(database.pragma("foreign_key_check")).toEqual([]);
  expect(recordings.storage.delete(first)).toBe(true);
  expect(recordings.storage.delete(first)).toBe(false);
  expect(recordings.storage.usage().recordingBytes).toBe(0);
});

it("rolls back an interrupted deletion and permits a retry without changing another run", () => {
  const { database, recordings, runs } = store();
  const first = runs.start({ seed: "delete-failure", durationSeconds: 1 }).run
    .id;
  runs.tick();
  const second = runs.start({ seed: "keep", durationSeconds: 1 }).run.id;
  runs.tick();
  const before = [recordings.get(first), recordings.get(second)];
  database.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'disk failure'); END;",
  );
  expect(() => recordings.storage.delete(first)).toThrow("disk failure");
  expect([recordings.get(first), recordings.get(second)]).toEqual(before);
  database.exec("DROP TRIGGER fail_delete");
  recordings.storage.delete(first);
  expect(recordings.get(second)).toEqual(before[1]);
  expect(database.pragma("foreign_key_check")).toEqual([]);
});

it("locks the source while fresh evaluation is in flight and releases it on completion", async () => {
  const { recordings, runs } = store();
  const id = runs.start({ seed: "lease", durationSeconds: 1 }).run.id;
  runs.tick();
  let resolve!: (response: Response) => void;
  const reevaluator = new Runs(recordings, {
    apiKey: "test-only",
    fetch: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const operation = reevaluator.reevaluate(id);
  expect(() => recordings.storage.delete(id)).toThrow("reevaluation is using");
  resolve(Response.json({ invalid: true }));
  await new Promise((done) => setImmediate(done));
  resolve(Response.json({ invalid: true }));
  const result = await operation;
  if (result.status !== "created") throw new Error("Expected reevaluation");
  recordings.storage.delete(result.recording.run.id);
  expect(recordings.storage.delete(id)).toBe(true);
  await reevaluator.close();
});

it("serves storage, makes deletion retries idempotent, and retains report results with unavailable links", async () => {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    schedule: (step) => {
      tick = step;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  const started = recordingSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { seed: "http-storage", durationSeconds: 1, evaluate: true },
      })
    ).json(),
  );
  const url = `/api/runs/${started.run.id}`;
  expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(409);
  await expect
    .poll(
      async () =>
        (await app.inject(url)).json().run.controls.waitingForInference,
    )
    .toBe(false);
  tick();
  await expect
    .poll(async () => (await app.inject(url)).json().run.status)
    .toBe("completed");
  expect(
    runListSchema.parse((await app.inject("/api/runs")).json()).runs[0]?.storage
      ?.ownedBytes,
  ).toBeGreaterThan(0);
  expect(
    storageUsageSchema.parse((await app.inject("/api/storage")).json())
      .recordingBytes,
  ).toBeGreaterThan(0);
  const report = (
    await app.inject({
      method: "POST",
      url: "/api/evaluation-reports",
      payload: { runIds: [started.run.id] },
    })
  ).json();
  expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(204);
  expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(204);
  expect((await app.inject(url)).statusCode).toBe(404);
  const retained = (await app.inject("/api/evaluation-reports")).json()
    .reports[0];
  expect(retained.runs[0].recordingAvailable).toBe(false);
  expect(retained.runs[0].decisions).toEqual(report.runs[0].decisions);
  expect(
    (await app.inject({ method: "DELETE", url: "/api/runs/invalid" }))
      .statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ method: "DELETE", url: `/api/runs/${randomUUID()}` }))
      .statusCode,
  ).toBe(204);
});

it("does not publish a partial reevaluation as completed during shutdown", async () => {
  const { recordings, runs } = store();
  const id = runs.start({ seed: "shutdown-reevaluation", durationSeconds: 1 })
    .run.id;
  runs.tick();
  const original = recordings.get(id);
  const reevaluator = new Runs(recordings, {
    apiKey: "test-only",
    fetch: () => new Promise(() => {}),
  });
  const operation = reevaluator.reevaluate(id);
  const rejected = expect(operation).rejects.toThrow(
    "interrupted by backend shutdown",
  );
  await reevaluator.close();
  await rejected;
  expect(recordings.list(0, 20).total).toBe(1);
  expect(recordings.get(id)).toEqual(original);
  expect(recordings.storage.delete(id)).toBe(true);
});

it("rejects retrying a reset whose replacement was deliberately deleted", () => {
  const { recordings, runs } = store();
  const first = runs.start({ seed: "deleted-reset", durationSeconds: 1 }).run
    .id;
  runs.tick();
  const request = { commandId: randomUUID(), type: "reset" };
  const replacement = runs.control(first, request).run.id;
  runs.tick();
  recordings.storage.delete(replacement);
  expect(() => runs.control(first, request)).toThrow("recording was deleted");
  expect(recordings.list(0, 20).total).toBe(1);
});
