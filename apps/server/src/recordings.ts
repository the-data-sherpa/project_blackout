import type Database from "better-sqlite3";
import { z } from "zod";
import {
  recordingSchema,
  runSchema,
  type AuthenticationEvent,
  type Recording,
  type Run,
  type RunCommand,
} from "@blackout/contracts";

const rowSchema = z.object({ record: z.string() });
function readJson(row: unknown): unknown {
  return JSON.parse(rowSchema.parse(row).record);
}

export class Recordings {
  constructor(private readonly database: Database.Database) {}

  active(): Run | null {
    const row = this.database
      .prepare("SELECT record FROM runs WHERE status = 'running'")
      .get();
    return row ? runSchema.parse(readJson(row)) : null;
  }

  get(id: string): Recording | null {
    const row = this.database
      .prepare("SELECT record FROM runs WHERE id = ?")
      .get(id);
    if (!row) return null;
    return recordingSchema.parse({
      run: readJson(row),
      events: this.database
        .prepare("SELECT record FROM events WHERE run_id = ? ORDER BY sequence")
        .all(id)
        .map(readJson),
      commands: this.database
        .prepare(
          "SELECT record FROM commands WHERE run_id = ? ORDER BY sequence",
        )
        .all(id)
        .map(readJson),
    });
  }

  create(run: Run, command: RunCommand) {
    this.database.transaction(() => {
      this.database
        .prepare("INSERT INTO runs (id, status, record) VALUES (?, ?, ?)")
        .run(run.id, run.status, JSON.stringify(run));
      this.database
        .prepare(
          "INSERT INTO commands (run_id, sequence, record) VALUES (?, ?, ?)",
        )
        .run(run.id, command.sequence, JSON.stringify(command));
    })();
  }

  commit(run: Run, events: AuthenticationEvent[] = []) {
    this.database.transaction(() => {
      const insert = this.database.prepare(
        "INSERT INTO events (run_id, sequence, record) VALUES (?, ?, ?)",
      );
      for (const event of events)
        insert.run(run.id, event.sequence, JSON.stringify(event));
      this.database
        .prepare("UPDATE runs SET status = ?, record = ? WHERE id = ?")
        .run(run.status, JSON.stringify(run), run.id);
    })();
  }
}
