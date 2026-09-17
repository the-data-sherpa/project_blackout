import type Database from "better-sqlite3";
import { z } from "zod";
import {
  recordingSchema,
  runListSchema,
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

  list(offset: number, limit: number) {
    const rows = this.database
      .prepare(
        "SELECT record FROM runs ORDER BY json_extract(record, '$.createdAt') DESC, id DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset);
    const { total } = z
      .object({ total: z.number() })
      .parse(this.database.prepare("SELECT count(*) AS total FROM runs").get());
    return runListSchema.parse({
      runs: rows.map((row) => {
        const { manifest, ...run } = runSchema.parse(readJson(row));
        return {
          ...run,
          seed: manifest.seed,
          durationSeconds: manifest.durationSeconds,
        };
      }),
      total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
      activeRunId: this.active()?.id ?? null,
    });
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
