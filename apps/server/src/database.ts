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
  if (version === 4) return;
  if (version !== 0 && version !== 1 && version !== 2 && version !== 3)
    throw new Error(`Unsupported database version: ${String(version)}`);
  if (version === 0)
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
  if (version === 0 || version === 1)
    database.transaction(() => {
      database.exec(`
      CREATE TABLE snapshots (
        run_id TEXT NOT NULL REFERENCES runs(id),
        id TEXT NOT NULL,
        simulation_time_ms INTEGER NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (run_id, id),
        UNIQUE (run_id, simulation_time_ms)
      );
      CREATE TABLE scenario_truth (
        run_id TEXT NOT NULL REFERENCES runs(id),
        simulation_time_ms INTEGER NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (run_id, simulation_time_ms)
      );
      PRAGMA user_version = 2;
    `);
    })();
  if (version !== 3)
    database.transaction(() => {
      database.exec(`
      CREATE TABLE inference_attempts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        simulation_time_ms INTEGER NOT NULL,
        attempt_number INTEGER NOT NULL,
        record TEXT NOT NULL,
        FOREIGN KEY (run_id, snapshot_id) REFERENCES snapshots(run_id, id),
        UNIQUE (run_id, snapshot_id, attempt_number)
      );
      CREATE TABLE evaluation_reports (
        id TEXT PRIMARY KEY,
        record TEXT NOT NULL
      );
      PRAGMA user_version = 3;
    `);
    })();
  database.transaction(() => {
    database.exec(`
      CREATE TABLE investigation_events (
        run_id TEXT NOT NULL REFERENCES runs(id),
        sequence INTEGER NOT NULL,
        attempt_id TEXT REFERENCES inference_attempts(id),
        record TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE UNIQUE INDEX investigation_request ON investigation_events(json_extract(record, '$.request.commandId'));
      CREATE UNIQUE INDEX investigation_attempt ON investigation_events(attempt_id) WHERE attempt_id IS NOT NULL;
      PRAGMA user_version = 4;
    `);
  })();
}
