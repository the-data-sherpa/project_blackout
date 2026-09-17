import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  recordingSchema,
  runIdSchema,
  scenarioTruthSchema,
} from "@blackout/contracts";
import { openDatabase } from "../apps/server/dist/database.js";
import { Recordings } from "../apps/server/dist/recordings.js";
import { createEvaluationReport } from "../apps/server/dist/evaluation-report.js";

const ids = process.argv.slice(2).map((id) => runIdSchema.parse(id));
if (!ids.length || new Set(ids).size !== ids.length)
  throw new Error(
    "Pass distinct completed source run IDs to package as the offline demonstration.",
  );
const base = process.env.BLACKOUT_API_URL ?? "http://localhost:3001";
async function get(path) {
  const response = await fetch(new URL(path, base), {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Cannot read ${path}: HTTP ${response.status}`);
  return response.json();
}
const records = [];
for (const id of ids) {
  const recording = recordingSchema.parse(await get(`/api/runs/${id}`));
  if (
    recording.run.status !== "completed" ||
    recording.run.derivation ||
    recording.run.manifest.schemaVersion !== 2 ||
    recording.run.manifest.interactive ||
    !recording.run.manifest.evaluation
  )
    throw new Error(
      "Package completed, scheduled, evaluated source recordings only.",
    );
  const truth = (await get(`/api/runs/${id}/truth`)).records.map((row) =>
    scenarioTruthSchema.parse(row),
  );
  const payload = JSON.stringify({ recording, truth });
  if (process.env.JEV_API_KEY && payload.includes(process.env.JEV_API_KEY))
    throw new Error("Credential detected in recording. Packaging refused.");
  records.push({ recording, truth });
}
const directory = mkdtempSync(join(tmpdir(), "blackout-demo-"));
const database = openDatabase(join(directory, "demo.sqlite"));
try {
  database.transaction(() => {
    for (const { recording, truth } of records) {
      const { run } = recording;
      database
        .prepare("INSERT INTO runs (id, status, record) VALUES (?, ?, ?)")
        .run(run.id, run.status, JSON.stringify(run));
      for (const table of ["events", "commands"]) {
        const values = recording[table];
        for (const row of values)
          database
            .prepare(
              `INSERT INTO ${table} (run_id, sequence, record) VALUES (?, ?, ?)`,
            )
            .run(run.id, row.sequence, JSON.stringify(row));
      }
      for (const row of recording.snapshots)
        database
          .prepare(
            "INSERT INTO snapshots (run_id, id, simulation_time_ms, record) VALUES (?, ?, ?, ?)",
          )
          .run(run.id, row.id, row.simulationTimeMs, JSON.stringify(row));
      for (const row of truth)
        database
          .prepare(
            "INSERT INTO scenario_truth (run_id, simulation_time_ms, record) VALUES (?, ?, ?)",
          )
          .run(run.id, row.simulationTimeMs, JSON.stringify(row));
      for (const row of recording.attempts)
        database
          .prepare(
            "INSERT INTO inference_attempts (id, run_id, snapshot_id, simulation_time_ms, attempt_number, record) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            row.id,
            run.id,
            row.snapshotId,
            row.simulationTimeMs,
            row.attemptNumber,
            JSON.stringify(row),
          );
      for (const row of recording.investigationHistory)
        database
          .prepare(
            "INSERT INTO investigation_events (run_id, sequence, attempt_id, record) VALUES (?, ?, ?, ?)",
          )
          .run(run.id, row.sequence, row.attemptId, JSON.stringify(row));
    }
    new Recordings(database).saveReport(createEvaluationReport(records));
  })();
  for (const { recording } of records) {
    if (
      JSON.stringify(new Recordings(database).get(recording.run.id)) !==
      JSON.stringify(recording)
    )
      throw new Error("Packaged recording differs from source.");
  }
  if (database.pragma("foreign_key_check").length)
    throw new Error("Invalid packaged references");
  database.pragma("wal_checkpoint(TRUNCATE)");
  const usage = new Recordings(database).storage.usage();
  database.close();
  const compressed = gzipSync(readFileSync(join(directory, "demo.sqlite")), {
    level: 9,
  });
  const output = resolve("demo");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "blackout-demo.sqlite.gz"), compressed);
  const flagship =
    records.find(
      ({ recording }) =>
        recording.run.manifest.fixture === "credential-compromise",
    ) ?? records[0];
  writeFileSync(
    join(output, "manifest.json"),
    JSON.stringify(
      {
        format: "blackout-demo/1",
        createdAt: new Date().toISOString(),
        runId: flagship.recording.run.id,
        runIds: ids,
        sha256: createHash("sha256").update(compressed).digest("hex"),
        compressedBytes: compressed.length,
        storage: usage,
        runs: records.map(({ recording }) => ({
          id: recording.run.id,
          seed: recording.run.manifest.seed,
          fixture: recording.run.manifest.fixture,
          model: recording.run.manifest.resolvedModel,
          durationMs: recording.run.simulationTimeMs,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Packaged ${ids.length} exact recordings (${compressed.length} compressed bytes). No inference calls made.`,
  );
} finally {
  if (database.open) database.close();
  rmSync(directory, { recursive: true, force: true });
}
