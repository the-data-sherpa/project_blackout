import { statSync } from "node:fs";
import type Database from "better-sqlite3";
import { z } from "zod";
import { storageUsageSchema } from "@blackout/contracts";

// Child-first ordering also respects the attempt -> snapshot foreign key.
const tables = [
  "investigation_events",
  "inference_attempts",
  "events",
  "commands",
  "snapshots",
  "scenario_truth",
  "runs",
] as const;
const bytesSchema = z.object({ bytes: z.number() });

export class RecordingInUse extends Error {}

export class RecordingStorage {
  private readonly readers = new Map<string, number>();
  constructor(private readonly database: Database.Database) {}

  retain(id: string) {
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
    return () => {
      const remaining = (this.readers.get(id) ?? 1) - 1;
      if (remaining) this.readers.set(id, remaining);
      else this.readers.delete(id);
    };
  }

  private bytes(
    table: (typeof tables)[number] | "evaluation_reports",
    id?: string,
  ) {
    const key = table === "runs" ? "id" : "run_id";
    const statement = this.database.prepare(
      `SELECT coalesce(sum(length(CAST(record AS BLOB))), 0) AS bytes FROM ${table}${id ? ` WHERE ${key} = ?` : ""}`,
    );
    return bytesSchema.parse(id ? statement.get(id) : statement.get()).bytes;
  }

  describe(id: string) {
    const row = this.database
      .prepare(
        "SELECT status, json_extract(record, '$.derivation.type') AS derivation, json_extract(record, '$.derivation.sourceRunId') AS source FROM runs WHERE id = ?",
      )
      .get(id);
    if (!row) return null;
    const run = z
      .object({
        status: z.string(),
        derivation: z.string().nullable(),
        source: z.string().nullable(),
      })
      .parse(row);
    const linked = z
      .array(z.object({ id: z.string() }))
      .parse(
        this.database
          .prepare(
            "SELECT id FROM runs WHERE json_extract(record, '$.derivation.sourceRunId') = ? ORDER BY id",
          )
          .all(id),
      );
    const deletionBlockers: string[] = [];
    if (run.status === "running")
      deletionBlockers.push(
        "The run is active. Wait for completion or reset it first.",
      );
    if (this.readers.has(id))
      deletionBlockers.push(
        "A fresh reevaluation is using this recording. Wait for it to finish.",
      );
    for (const child of linked)
      deletionBlockers.push(`Delete linked recording ${child.id} first.`);
    return {
      ownedBytes: tables.reduce((sum, table) => sum + this.bytes(table, id), 0),
      sharedSourceRunId: run.derivation === "reevaluation" ? run.source : null,
      deletionBlockers,
    };
  }

  usage() {
    const pageSize = Number(
      this.database.pragma("page_size", { simple: true }),
    );
    let walBytes = 0;
    if (this.database.name !== ":memory:") {
      try {
        walBytes = statSync(`${this.database.name}-wal`).size;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    return storageUsageSchema.parse({
      databaseBytes:
        Number(this.database.pragma("page_count", { simple: true })) * pageSize,
      reusableBytes:
        Number(this.database.pragma("freelist_count", { simple: true })) *
        pageSize,
      walBytes,
      recordingBytes: tables.reduce((sum, table) => sum + this.bytes(table), 0),
      reportBytes: this.bytes("evaluation_reports"),
    });
  }

  delete(id: string): boolean {
    return this.database.transaction(() => {
      const storage = this.describe(id);
      if (!storage) return false;
      if (storage.deletionBlockers.length)
        throw new RecordingInUse(storage.deletionBlockers.join(" "));
      for (const table of tables)
        this.database
          .prepare(
            `DELETE FROM ${table} WHERE ${table === "runs" ? "id" : "run_id"} = ?`,
          )
          .run(id);
      return true;
    })();
  }
}
