import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  evaluationReportSchema,
  evaluatorInputSchema,
  startRunSchema,
  summarizeInput,
  telemetryEventSchema,
  telemetryManifestSchema,
  type JevResponse,
  type TelemetryEvent,
} from "@blackout/contracts";
import { aggregateInput } from "../src/aggregation.js";
import { fixtureObservations } from "../src/fixtures.js";
import {
  baselineObservations,
  createTelemetryManifest,
  generateWarmup,
  observe,
  orderObservations,
} from "../src/telemetry.js";
import { scheduledCommands } from "../src/scenarios.js";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";
import { createEvaluationReport } from "../src/evaluation-report.js";
import { evaluatePolicy } from "../src/policy.js";

it.each(["m4-001", "m4-002", "m4-003"])(
  "reproduces every stage, consistent entities and benign profile context for %s",
  (seed) => {
    const baseline = createTelemetryManifest(startRunSchema.parse({ seed }));
    for (const fixture of [
      "credential-compromise",
      "benign-maintenance",
    ] as const) {
      const manifest = createTelemetryManifest(
        startRunSchema.parse({
          seed,
          fixture,
          durationSeconds: 95,
          stopInjectionAtSeconds: 35,
        }),
      );
      const plan = manifest.scenario!;
      const user = manifest.organization.users.find(
        (user) => user.userId === plan.targetUserId,
      )!;
      expect(manifest.organization).toEqual(baseline.organization);
      const stages = new Set();
      const runId = randomUUID();
      const events: TelemetryEvent[] = [];
      for (let time = 1000; time <= 95_000; time += 1000) {
        const injected = fixtureObservations(manifest, time);
        expect(fixtureObservations(structuredClone(manifest), time)).toEqual(
          injected,
        );
        expect(baselineObservations(manifest, time)).toEqual(
          baselineObservations(baseline, time),
        );
        const mixed = orderObservations(manifest, time, [
          ...baselineObservations(manifest, time),
          ...injected.observations,
        ]);
        expect(mixed.length).toBe(5 + injected.observations.length);
        for (const observation of mixed)
          events.push(
            observe(observation, manifest, runId, time, events.length + 1),
          );
        for (const observation of injected.observations) {
          if ("userId" in observation)
            expect(observation.userId).toBe(plan.targetUserId);
          expect(
            telemetryEventSchema.safeParse(
              observe(observation, manifest, runId, time, 1),
            ).success,
          ).toBe(true);
          if (observation.type === "network")
            expect(
              manifest.organization.hosts.some(
                (host) => host.id === observation.destinationHostId,
              ),
            ).toBe(true);
          if (
            fixture === "benign-maintenance" &&
            observation.type === "authentication"
          ) {
            expect(user.hostIds).toContain(observation.hostId);
            expect(user.locations).toContain(observation.location);
            expect(user.resources).toContain(observation.resource);
          }
        }
        if (time < 5000 || time >= 35_000)
          expect(injected.observations).toEqual([]);
        if (injected.truth) stages.add(injected.truth.stage);
        if (
          [
            5000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 65_000,
          ].includes(time)
        ) {
          const input = aggregateInput(manifest.organization, events, time);
          const payload = JSON.stringify(summarizeInput(input));
          for (const secret of [
            fixture,
            "stage",
            "targetUserId",
            "stopAtMs",
            seed,
            runId,
            "interpretation",
            "evidenceSequences",
          ])
            expect(payload).not.toContain(secret);
          expect(
            evaluatorInputSchema.safeParse({ ...input, scenario: plan })
              .success,
          ).toBe(false);
          if (time === 30_000 && fixture === "credential-compromise") {
            expect(input.focus?.userId).toBe(user.userId);
            if (input.schemaVersion !== "observable-state/2")
              throw new Error("Wrong version");
            expect(
              input.focusActivity.groups.some(
                (group) =>
                  group.observation.type === "network" &&
                  group.observation.hostId === plan.secondHostId,
              ),
            ).toBe(true);
            expect(
              input.focusActivity.groups.some(
                (group) =>
                  group.observation.type === "network" &&
                  group.observation.destinationPort === 445,
              ),
            ).toBe(true);
          }
        }
      }
      expect([...stages]).toEqual([
        ...plan.stages.map((stage) => stage.name),
        "stopped",
      ]);
      expect(fixtureObservations(manifest, 9000).truth?.stage).toBe(
        plan.stages[0]!.name,
      );
      expect(scheduledCommands(manifest, runId, 5000)[0]?.type).toBe(
        "begin-injection",
      );
      expect(scheduledCommands(manifest, runId, 35_000)[0]?.type).toBe(
        "stop-injection",
      );
      expect(
        events.filter((event) => event.simulationTimeMs >= 35_000),
      ).toHaveLength(61 * 5);
    }
  },
);

it("bounds activity groups, links their exact evidence, excludes future events and expires them by simulation time", () => {
  const manifest = createTelemetryManifest(
    startRunSchema.parse({ seed: "bounded", fixture: "credential-compromise" }),
  );
  const id = randomUUID();
  const events = generateWarmup(manifest, id);
  for (let time = 1000; time <= 34_000; time += 1000) {
    for (const observation of fixtureObservations(manifest, time).observations)
      events.push(observe(observation, manifest, id, time, events.length + 1));
  }
  const input = aggregateInput(manifest.organization, events, 34_000);
  if (input.schemaVersion !== "observable-state/2")
    throw new Error("Wrong version");
  expect(input.focusActivity.groups.length).toBeLessThanOrEqual(16);
  expect(input.focusActivity.omittedGroups).toBeGreaterThan(0);
  for (const group of input.focusActivity.groups) {
    expect(group.count).toBe(group.evidenceSequences.length);
    const evidence = events.filter((event) =>
      group.evidenceSequences.includes(event.sequence),
    );
    expect(Math.min(...evidence.map((event) => event.simulationTimeMs))).toBe(
      group.firstSimulationMs,
    );
    expect(Math.max(...evidence.map((event) => event.simulationTimeMs))).toBe(
      group.lastSimulationMs,
    );
    expect(
      evidence.every(
        (event) =>
          event.simulationTimeMs > 4000 && event.simulationTimeMs <= 34_000,
      ),
    ).toBe(true);
  }
  const past = aggregateInput(manifest.organization, events, 20_000);
  if (past.schemaVersion !== "observable-state/2")
    throw new Error("Wrong version");
  expect(
    past.focusActivity.groups.every(
      (group) => group.lastSimulationMs <= 20_000,
    ),
  ).toBe(true);
  const expired = aggregateInput(manifest.organization, events, 64_000);
  if (expired.schemaVersion !== "observable-state/2")
    throw new Error("Wrong version");
  expect(expired.focusActivity.totalEvents).toBe(0);
  expect(
    expired.windows[4]!.metrics.find(
      (metric) => metric.name === "unfamiliarDevices",
    )!.value,
  ).toBeGreaterThan(0);
});

it("records commands and truth atomically; stop truncates injection while baseline persists", () => {
  const db = openDatabase(":memory:");
  try {
    const recordings = new Recordings(db);
    const runs = new Runs(recordings);
    const first = runs.start({
      seed: "scheduled",
      fixture: "credential-compromise",
      durationSeconds: 15,
      stopInjectionAtSeconds: 12,
    });
    for (let second = 1; second <= 15; second++) runs.tick();
    const saved = recordings.get(first.run.id)!;
    expect(
      saved.commands.map((command) => [
        command.sequence,
        command.type,
        command.simulationTimeMs,
      ]),
    ).toEqual([
      [1, "start", 0],
      [2, "begin-injection", 5000],
      [3, "stop-injection", 12_000],
    ]);
    expect(
      saved.events.filter((event) => event.simulationTimeMs >= 12_000),
    ).toHaveLength(20);
    expect(recordings.truth(first.run.id).at(-1)).toMatchObject({
      stage: "stopped",
      eventSequences: [],
      simulationTimeMs: 12_000,
    });
    const second = runs.start({
      seed: "scheduled",
      fixture: "credential-compromise",
      durationSeconds: 15,
      stopInjectionAtSeconds: 12,
    });
    for (let step = 1; step <= 15; step++) runs.tick();
    const rerun = recordings.get(second.run.id)!;
    expect(rerun.events.map((event) => ({ ...event, runId: "" }))).toEqual(
      saved.events.map((event) => ({ ...event, runId: "" })),
    );
    expect(
      rerun.commands.map((command) => ({
        ...command,
        runId: "",
        recordedAt: "",
      })),
    ).toEqual(
      saved.commands.map((command) => ({
        ...command,
        runId: "",
        recordedAt: "",
      })),
    );
    const originalTruth = recordings.truth(second.run.id)[0]!;
    db.prepare(
      "UPDATE scenario_truth SET record = ? WHERE run_id = ? AND simulation_time_ms = ?",
    ).run(
      JSON.stringify({
        ...originalTruth,
        stage: "department-sync",
        interpretation: "authorized-burst",
      }),
      second.run.id,
      originalTruth.simulationTimeMs,
    );
    expect(recordings.get(second.run.id)).toEqual(rerun);
    const stoppedEarly = runs.start({
      seed: "early-stop",
      fixture: "credential-compromise",
      durationSeconds: 6,
      stopInjectionAtSeconds: 3,
    });
    for (let step = 1; step <= 6; step++) runs.tick();
    expect(
      recordings
        .get(stoppedEarly.run.id)!
        .commands.map((command) => [command.sequence, command.type]),
    ).toEqual([
      [1, "start"],
      [2, "stop-injection"],
    ]);
    expect(
      recordings
        .get(stoppedEarly.run.id)!
        .events.filter((event) => event.simulationTimeMs > 0),
    ).toHaveLength(30);
    expect(
      recordings
        .truth(stoppedEarly.run.id)
        .every((row) => row.eventSequences.length === 0),
    ).toBe(true);
    const third = runs.start({
      seed: "rollback",
      fixture: "benign-maintenance",
      durationSeconds: 6,
    });
    for (let step = 1; step < 5; step++) runs.tick();
    const before = recordings.get(third.run.id)!;
    db.exec(
      "CREATE TRIGGER fail_command BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'command failure'); END;",
    );
    runs.tick();
    const after = recordings.get(third.run.id)!;
    expect(after.run.status).toBe("failed");
    expect(after.run.simulationTimeMs).toBe(4000);
    expect(after.events).toEqual(before.events);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(recordings.truth(third.run.id)).toEqual([]);
  } finally {
    db.close();
  }
});

function modelResponse(probability: number): JevResponse {
  const high = probability >= 0.8;
  return {
    model: "test-only",
    answers: {
      compromise: { type: "noul", noul: probability },
      classification: {
        type: "choice",
        choice: high ? "compromise" : "normal",
        confidence: 0.9,
        probabilities: {
          normal: high ? 0 : 1,
          benign_anomaly: 0,
          suspicious: 0,
          compromise: high ? 1 : 0,
        },
      },
      severity: {
        type: "score",
        score: high ? 2 : 0,
        probabilities: { "0": high ? 0 : 1, "1": 0, "2": high ? 1 : 0, "3": 0 },
        legend: {
          "0": "none",
          "1": "limited",
          "2": "serious",
          "3": "critical",
        },
      },
      response: {
        type: "choice",
        choice: "observe",
        probabilities: { observe: 1, investigate: 0, escalate: 0 },
      },
    },
  };
}

it("measures suspicion, detection, control denominators and decline with unknown failed endpoints", async () => {
  const db = openDatabase(":memory:");
  const recordings = new Recordings(db);
  const runs = new Runs(recordings, {
    apiKey: "test",
    fetch: async (_url, init) => {
      const time = JSON.parse(String(init?.body)).state.simulationTimeMs;
      return Response.json(
        modelResponse(
          time === 0
            ? 0.9
            : time < 10_000
              ? 0.1
              : time < 15_000
                ? 0.5
                : time < 40_000
                  ? 0.9
                  : 0.1,
        ),
      );
    },
  });
  try {
    const started = runs.start({
      seed: "metrics-m4",
      fixture: "credential-compromise",
      durationSeconds: 40,
      evaluate: true,
      stopInjectionAtSeconds: 35,
    });
    await runs.settled();
    for (let step = 1; step <= 40; step++) {
      runs.tick();
      await runs.settled();
    }
    const recording = recordings.get(started.run.id)!;
    const truth = recordings.truth(started.run.id);
    const report = createEvaluationReport([{ recording, truth }]);
    expect(report.runs[0]).toMatchObject({
      attackOutcome: "detected",
      suspicionOutcome: "detected",
      suspicionDelaySimulationMs: 5000,
      detectionDelaySimulationMs: 10_000,
      controlCheckpoints: 1,
      falseIncidentDecisions: 1,
      activityDecline: {
        stopSimulationMs: 35_000,
        postStopCheckpoints: 2,
        successfulCheckpoints: 2,
        referenceProbability: 0.9,
        finalProbability: 0.1,
        firstLowDelaySimulationMs: 5000,
      },
    });
    expect(report.runs[0]!.activityDecline!.probabilityChange).toBeCloseTo(
      -0.8,
    );
    const stop = recording.commands.at(-1)!;
    const benign = structuredClone(recording);
    if (benign.run.manifest.schemaVersion !== 2)
      throw new Error("Expected telemetry manifest");
    benign.run.manifest.fixture = "benign-maintenance";
    expect(
      createEvaluationReport([{ recording: benign, truth: [] }]).runs[0],
    ).toMatchObject({
      attackOutcome: "not_applicable",
      controlCheckpoints: 9,
      falseIncidentDecisions: 6,
      classificationSwitches: 3,
      comparablePairs: 8,
    });
    expect(report.runs[0]!.activityDecline!.firstLowDelayWallMs).toBe(
      Math.max(
        0,
        Date.parse(recording.attempts.at(-1)!.completedAt!) -
          Date.parse(stop.recordedAt),
      ),
    );
    const last = recording.attempts.at(-1)!;
    last.status = "failed";
    last.response = null;
    last.error = { code: "timeout", message: "Timeout", httpStatus: null };
    last.policy = evaluatePolicy(null);
    expect(
      createEvaluationReport([{ recording, truth }]).runs[0]!.activityDecline,
    ).toMatchObject({
      probabilityChange: null,
      finalProbability: null,
      failedCheckpoints: 1,
      firstLowDelaySimulationMs: null,
    });
    for (const attempt of recording.attempts)
      if (attempt.response) {
        attempt.response = modelResponse(0.1);
        attempt.policy = evaluatePolicy(attempt.response);
      }
    expect(
      createEvaluationReport([{ recording, truth }]).runs[0],
    ).toMatchObject({
      attackOutcome: "incomplete",
      suspicionOutcome: "incomplete",
    });
    expect(
      createEvaluationReport([
        { recording, truth: truth.filter((row) => !row.eventSequences.length) },
      ]).runs[0]!.attackOutcome,
    ).toBe("not_exposed");
    recordings.saveReport(report);
    expect(recordings.reports()[0]).toEqual(report);
  } finally {
    await runs.close();
    db.close();
  }
});

it("retains previous reports and rejects invalid schedules", () => {
  const manifest = createTelemetryManifest(
    startRunSchema.parse({
      seed: "contracts",
      fixture: "credential-compromise",
    }),
  );
  expect(
    telemetryManifestSchema.safeParse({ ...manifest, scenario: undefined })
      .success,
  ).toBe(false);
  expect(
    telemetryManifestSchema.safeParse({ ...manifest, fixture: "baseline" })
      .success,
  ).toBe(false);
  expect(
    telemetryManifestSchema.safeParse({
      ...manifest,
      scenario: {
        ...manifest.scenario,
        stages: [{ name: "weak-signal", startMs: 5000, endExclusiveMs: 5000 }],
      },
    }).success,
  ).toBe(false);
  const legacy = JSON.parse(
    readFileSync("docs/evaluations/m3-follow-up-suite.json", "utf8"),
  );
  expect(evaluationReportSchema.parse(legacy).metricVersion).toBe(
    "slice-metrics/2",
  );
  expect(
    startRunSchema.safeParse({
      seed: "x",
      fixture: "baseline",
      stopInjectionAtSeconds: 5,
    }).success,
  ).toBe(false);
  expect(
    startRunSchema.safeParse({
      seed: "x",
      fixture: "credential-compromise",
      durationSeconds: 10,
      stopInjectionAtSeconds: 11,
    }).success,
  ).toBe(false);
});
