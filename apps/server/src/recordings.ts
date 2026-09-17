import type Database from "better-sqlite3";
import { z } from "zod";
import {
  recordingSchema,
  investigationEventSchema,
  investigationStatus,
  type InvestigationEvent,
  runListSchema,
  runSchema,
  commandSchema,
  scenarioTruthSchema,
  inferenceAttemptSchema,
  observableSnapshotSchema,
  summarizeInput,
  type InferenceAttempt,
  evaluationReportSchema,
  type EvaluationReport,
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

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  run(id: string): Run | null {
    const row = this.database
      .prepare("SELECT record FROM runs WHERE id = ?")
      .get(id);
    return row ? runSchema.parse(readJson(row)) : null;
  }

  command(commandId: string): RunCommand | null {
    const row = this.database
      .prepare(
        "SELECT record FROM commands WHERE json_extract(record, '$.request.commandId') = ?",
      )
      .get(commandId);
    return row ? commandSchema.parse(readJson(row)) : null;
  }

  nextCommandSequence(runId: string): number {
    const row = z
      .object({ sequence: z.number() })
      .parse(
        this.database
          .prepare(
            "SELECT coalesce(max(sequence), 0) + 1 AS sequence FROM commands WHERE run_id = ?",
          )
          .get(runId),
      );
    return row.sequence;
  }

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
    const run = runSchema.parse(readJson(row));
    const evidenceRunId =
      run.derivation?.type === "reevaluation" ? run.derivation.sourceRunId : id;
    return recordingSchema.parse({
      run,
      attempts: this.attempts(id),
      investigationHistory: this.investigationHistory(id),
      events: this.database
        .prepare("SELECT record FROM events WHERE run_id = ? ORDER BY sequence")
        .all(evidenceRunId)
        .map(readJson),
      snapshots: this.database
        .prepare(
          "SELECT record FROM snapshots WHERE run_id = ? ORDER BY simulation_time_ms",
        )
        .all(evidenceRunId)
        .map(readJson),
      commands: this.database
        .prepare(
          "SELECT record FROM commands WHERE run_id = ? ORDER BY sequence",
        )
        .all(evidenceRunId)
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

  investigationHistory(runId: string): InvestigationEvent[] {
    return this.database
      .prepare(
        "SELECT record FROM investigation_events WHERE run_id = ? ORDER BY sequence",
      )
      .all(runId)
      .map((row) => investigationEventSchema.parse(readJson(row)));
  }

  investigationRequest(commandId: string): InvestigationEvent | null {
    const row = this.database
      .prepare(
        "SELECT record FROM investigation_events WHERE json_extract(record, '$.request.commandId') = ?",
      )
      .get(commandId);
    return row ? investigationEventSchema.parse(readJson(row)) : null;
  }

  saveInvestigation(value: InvestigationEvent) {
    const event = investigationEventSchema.parse(value);
    this.database
      .prepare(
        "INSERT INTO investigation_events (run_id, sequence, attempt_id, record) VALUES (?, ?, ?, ?)",
      )
      .run(event.runId, event.sequence, event.attemptId, JSON.stringify(event));
  }

  attempts(id: string): InferenceAttempt[] {
    return this.database
      .prepare(
        "SELECT record FROM inference_attempts WHERE run_id = ? ORDER BY simulation_time_ms, attempt_number",
      )
      .all(id)
      .map((row) => inferenceAttemptSchema.parse(readJson(row)));
  }

  reports() {
    return this.database
      .prepare(
        "SELECT record FROM evaluation_reports ORDER BY json_extract(record, '$.createdAt') DESC",
      )
      .all()
      .map((row) => evaluationReportSchema.parse(readJson(row)));
  }

  saveReport(report: EvaluationReport) {
    this.database
      .prepare("INSERT INTO evaluation_reports (id, record) VALUES (?, ?)")
      .run(report.id, JSON.stringify(evaluationReportSchema.parse(report)));
  }

  saveAttempt(value: InferenceAttempt, run?: Run) {
    const attempt = inferenceAttemptSchema.parse(value);
    const snapshot = this.database
      .prepare("SELECT record FROM snapshots WHERE run_id = ? AND id = ?")
      .get(attempt.runId, attempt.snapshotId);
    const input = snapshot
      ? observableSnapshotSchema.parse(readJson(snapshot)).input
      : null;
    const expected =
      input &&
      (attempt.request.state.schemaVersion.startsWith("observable-summary/")
        ? summarizeInput(input)
        : input);
    if (
      !expected ||
      JSON.stringify(expected) !== JSON.stringify(attempt.request.state)
    )
      throw new Error("Inference request does not match its recorded snapshot");
    this.database.transaction(() => {
      const previous = this.database
        .prepare("SELECT record FROM inference_attempts WHERE id = ?")
        .get(attempt.id);
      const wasApplied =
        previous && inferenceAttemptSchema.parse(readJson(previous)).appliedAt;
      this.database
        .prepare(
          `INSERT INTO inference_attempts (id, run_id, snapshot_id, simulation_time_ms, attempt_number, record)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record`,
        )
        .run(
          attempt.id,
          attempt.runId,
          attempt.snapshotId,
          attempt.simulationTimeMs,
          attempt.attemptNumber,
          JSON.stringify(attempt),
        );
      const owner = run ?? this.run(attempt.runId);
      if (
        !wasApplied &&
        attempt.appliedAt &&
        attempt.status === "succeeded" &&
        attempt.policy?.outcome === "incident_advisory" &&
        owner?.manifest.schemaVersion === 2 &&
        owner.manifest.investigation
      ) {
        const history = this.investigationHistory(attempt.runId);
        const status = investigationStatus(history);
        if (status === "none" || status === "closed")
          this.saveInvestigation({
            runId: attempt.runId,
            sequence: (history.at(-1)?.sequence ?? 0) + 1,
            runRevision: owner.revision,
            simulationTimeMs: attempt.appliedSimulationTimeMs!,
            recordedAt: attempt.appliedAt,
            version: owner.manifest.investigation.version,
            type: status === "none" ? "opened" : "reopened",
            actor: "advisory-policy",
            attemptId: attempt.id,
            snapshotId: attempt.snapshotId,
            request: null,
          });
      }
      if (run) this.commit(run);
    })();
  }

  createDerived(
    value: Recording,
    storedSnapshots: ObservableSnapshot[] = value.snapshots,
  ) {
    const recording = recordingSchema.parse(value);
    if (recording.run.status === "running")
      throw new Error("Derived recordings must be complete");
    this.database.transaction(() => {
      this.database
        .prepare("INSERT INTO runs (id, status, record) VALUES (?, ?, ?)")
        .run(
          recording.run.id,
          recording.run.status,
          JSON.stringify(recording.run),
        );
      const insertEvent = this.database.prepare(
        "INSERT INTO events (run_id, sequence, record) VALUES (?, ?, ?)",
      );
      for (const event of recording.events)
        insertEvent.run(
          recording.run.id,
          event.sequence,
          JSON.stringify(event),
        );
      const insertCommand = this.database.prepare(
        "INSERT INTO commands (run_id, sequence, record) VALUES (?, ?, ?)",
      );
      for (const command of recording.commands)
        insertCommand.run(
          recording.run.id,
          command.sequence,
          JSON.stringify(command),
        );
      const insertSnapshot = this.database.prepare(
        "INSERT INTO snapshots (run_id, id, simulation_time_ms, record) VALUES (?, ?, ?, ?)",
      );
      for (const value of storedSnapshots) {
        const snapshot = observableSnapshotSchema.parse(value);
        insertSnapshot.run(
          recording.run.id,
          snapshot.id,
          snapshot.simulationTimeMs,
          JSON.stringify(snapshot),
        );
      }
      for (const attempt of recording.attempts)
        this.saveAttempt(attempt, recording.run);
      for (const event of recording.investigationHistory)
        this.saveInvestigation(event);
    })();
  }

  create(
    value: z.input<typeof runSchema>,
    command: RunCommand,
    events: ObservableEvent[] = [],
    snapshot?: ObservableSnapshot,
  ) {
    const run = runSchema.parse(value);
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
    commands: RunCommand[] = [],
  ) {
    this.database.transaction(() => {
      this.insertEvidence(run.id, events, snapshot, truth);
      for (const value of commands) {
        const command = commandSchema.parse(value);
        if (
          command.runId !== run.id ||
          command.simulationTimeMs !== run.simulationTimeMs
        )
          throw new Error("Command must belong to the committed step");
        this.database
          .prepare(
            "INSERT INTO commands (run_id, sequence, record) VALUES (?, ?, ?)",
          )
          .run(run.id, command.sequence, JSON.stringify(command));
      }
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
