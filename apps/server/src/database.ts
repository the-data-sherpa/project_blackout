import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

// Only the long-running backend owns this database.
export function openDatabase(filename: string) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const database = new Database(filename);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("synchronous = FULL");
    migrate(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function migrate(database: Database.Database) {
  const version = database.pragma("user_version", { simple: true });
  if (version === 1) return;
  if (version !== 0)
    throw new Error(`Unsupported database version: ${String(version)}`);
  database.transaction(() => {
    database.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
        record TEXT NOT NULL
      );
      CREATE UNIQUE INDEX one_active_run ON runs(status) WHERE status = 'running';
      CREATE TABLE events (
        run_id TEXT NOT NULL REFERENCES runs(id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        record TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE TABLE commands (
        run_id TEXT NOT NULL REFERENCES runs(id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        record TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      PRAGMA user_version = 1;
    `);
  })();
}
