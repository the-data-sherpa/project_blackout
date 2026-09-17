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
