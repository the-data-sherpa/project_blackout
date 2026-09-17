import type Database from "better-sqlite3";
import { z } from "zod";
import {
  recordingSchema,
  runListSchema,
  runSchema,
  scenarioTruthSchema,
  type ObservableEvent,
  type ObservableSnapshot,
  type ScenarioTruth,
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
      snapshots: this.database
        .prepare(
          "SELECT record FROM snapshots WHERE run_id = ? ORDER BY simulation_time_ms",
        )
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

  truth(id: string): ScenarioTruth[] {
    return this.database
      .prepare(
        "SELECT record FROM scenario_truth WHERE run_id = ? ORDER BY simulation_time_ms",
      )
      .all(id)
      .map((row) => scenarioTruthSchema.parse(readJson(row)));
  }

  create(
    run: Run,
    command: RunCommand,
    events: ObservableEvent[] = [],
    snapshot?: ObservableSnapshot,
  ) {
    this.database.transaction(() => {
      this.database
        .prepare("INSERT INTO runs (id, status, record) VALUES (?, ?, ?)")
        .run(run.id, run.status, JSON.stringify(run));
      this.database
        .prepare(
          "INSERT INTO commands (run_id, sequence, record) VALUES (?, ?, ?)",
        )
        .run(run.id, command.sequence, JSON.stringify(command));
      this.insertEvidence(run.id, events, snapshot);
    })();
  }

  commit(
    run: Run,
    events: ObservableEvent[] = [],
    snapshot?: ObservableSnapshot,
    truth?: ScenarioTruth,
  ) {
    this.database.transaction(() => {
      this.insertEvidence(run.id, events, snapshot, truth);
      this.database
        .prepare("UPDATE runs SET status = ?, record = ? WHERE id = ?")
        .run(run.status, JSON.stringify(run), run.id);
    })();
  }
  private insertEvidence(
    runId: string,
    events: ObservableEvent[],
    snapshot?: ObservableSnapshot,
    truth?: ScenarioTruth,
  ) {
    const insert = this.database.prepare(
      "INSERT INTO events (run_id, sequence, record) VALUES (?, ?, ?)",
    );
    for (const event of events)
      insert.run(runId, event.sequence, JSON.stringify(event));
    if (snapshot)
      this.database
        .prepare(
          "INSERT INTO snapshots (run_id, id, simulation_time_ms, record) VALUES (?, ?, ?, ?)",
        )
        .run(
          runId,
          snapshot.id,
          snapshot.simulationTimeMs,
          JSON.stringify(snapshot),
        );
    if (truth)
      this.database
        .prepare(
          "INSERT INTO scenario_truth (run_id, simulation_time_ms, record) VALUES (?, ?, ?)",
        )
        .run(runId, truth.simulationTimeMs, JSON.stringify(truth));
  }
}
