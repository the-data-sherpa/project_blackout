import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../src/database.js";

it("persists writes across reopen and enforces foreign keys", () => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-db-"));
  const filename = join(directory, "nested", "test.sqlite");
  const database = openDatabase(filename);
  try {
    database.exec(
      "CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));",
    );
    database.prepare("INSERT INTO parent (id) VALUES (?)").run(7);
    expect(() =>
      database.prepare("INSERT INTO child (parent_id) VALUES (?)").run(9),
    ).toThrow();
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
  } finally {
    database.close();
  }
  const reopened = openDatabase(filename);
  try {
    expect(reopened.prepare("SELECT id FROM parent").get()).toEqual({ id: 7 });
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each([1, 3])(
  "migrates a version-%i database without changing its legacy recording",
  async (version) => {
    const { randomUUID } = await import("node:crypto");
    const { startRunSchema } = await import("@blackout/contracts");
    const { createManifest, authenticationStep } =
      await import("../src/authentication.js");
    const { Recordings } = await import("../src/recordings.js");
    const directory = mkdtempSync(join(tmpdir(), "blackout-migration-"));
    const filename = join(directory, "legacy.sqlite");
    const database = openDatabase(filename);
    const id = randomUUID();
    const timestamp = "2026-01-01T09:00:00.000Z";
    const manifest = createManifest(
      startRunSchema.parse({ seed: "legacy", durationSeconds: 1 }),
    );
    try {
      const recordings = new Recordings(database);
      recordings.create(
        {
          id,
          manifest,
          status: "completed",
          simulationTimeMs: 1000,
          lastSequence: 2,
          createdAt: timestamp,
          endedAt: timestamp,
        },
        {
          runId: id,
          type: "start",
          sequence: 1,
          simulationTimeMs: 0,
          recordedAt: timestamp,
        },
        authenticationStep(manifest, id, 1000),
      );
      database.exec(
        version === 1
          ? "DROP TABLE investigation_events; DROP TABLE inference_attempts; DROP TABLE evaluation_reports; DROP TABLE snapshots; DROP TABLE scenario_truth; PRAGMA user_version = 1;"
          : "DROP TABLE investigation_events; PRAGMA user_version = 3;",
      );
    } finally {
      database.close();
    }
    const migrated = openDatabase(filename);
    try {
      expect(migrated.pragma("user_version", { simple: true })).toBe(4);
      const saved = new Recordings(migrated).get(id)!;
      expect(saved.run.manifest).toEqual(manifest);
      expect(saved.events).toEqual(authenticationStep(manifest, id, 1000));
      expect(saved.snapshots).toEqual([]);
      expect(saved.investigationHistory).toEqual([]);
      expect(new Recordings(migrated).truth(id)).toEqual([]);
      expect(new Recordings(migrated).list(0, 20).total).toBe(1);
    } finally {
      migrated.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
