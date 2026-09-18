import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  investigationStatus,
  recordingSchema,
  type JevResponse,
  type Recording,
  type RunMessage,
  type TelemetryEvent,
} from "@blackout/contracts";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";
import { defaultEvaluation, type EvaluatorOptions } from "../src/evaluator.js";
import { evaluatePolicy } from "../src/policy.js";
import { buildApp } from "../src/app.js";
import { aggregateInput } from "../src/aggregation.js";
import { baselineObservations, observe } from "../src/telemetry.js";
import {
  decisionMetrics,
  visibleAttempts,
} from "../../web/src/app/decision-view.js";
import { receiveRunMessage } from "../../web/src/app/run-stream.js";
import { judgmentView } from "../../web/src/app/judgment-view.js";
import {
  emptyEventFilters,
  hostSamples,
  indexEvents,
  searchEvents,
} from "../../web/src/app/event-search.js";
import {
  inspectAssessment,
  inspectionBoundary,
  inspectBoundary,
  newerAssessmentCount,
} from "../../web/src/app/playback.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function response(
  probability = 0.9,
  confidence: number | null = 0.9,
): JevResponse {
  return {
    model: "jev-m6-test",
    answers: {
      compromise: { type: "noul", noul: probability },
      classification: {
        type: "choice",
        choice: "compromise",
        probabilities: {
          normal: 0,
          benign_anomaly: 0,
          suspicious: 0,
          compromise: 1,
        },
        ...(confidence === null ? {} : { confidence }),
      },
      severity: {
        type: "score",
        score: 2,
        probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
        legend: { "0": "none", "1": "low", "2": "high", "3": "critical" },
      },
      response: {
        type: "choice",
        choice: "escalate",
        probabilities: { observe: 0, investigate: 0, escalate: 1 },
      },
    },
  };
}
function store(options: EvaluatorOptions = {}, filename = ":memory:") {
  const db = openDatabase(filename);
  const recordings = new Recordings(db);
  const runs = new Runs(recordings, {
    apiKey: "test-only",
    fetch: async () => Response.json(response()),
    ...options,
  });
  cleanup.push(async () => {
    await runs.close();
    db.close();
  });
  return { db, recordings, runs };
}
const action = (type: "acknowledge" | "close", expectedSequence: number) => ({
  commandId: randomUUID(),
  type,
  expectedSequence,
});
async function advance(runs: Runs, count: number) {
  for (let i = 0; i < count; i++) {
    runs.tick();
    await runs.settled();
  }
}

it("preserves legacy applied assessments and excludes results applied after the inspected cursor", async () => {
  const { runs, recordings } = store();
  const id = runs.start({
    seed: "legacy-judgments",
    durationSeconds: 5,
    evaluate: true,
  }).run.id;
  await runs.settled();
  await advance(runs, 5);
  const saved = recordings.get(id)!;
  const legacy = recordingSchema.parse({
    ...saved,
    attempts: saved.attempts.map((attempt) => {
      const value = { ...attempt };
      delete value.appliedAt;
      delete value.appliedSimulationTimeMs;
      return value;
    }),
  });
  expect(judgmentView(legacy).current?.id).toBe(saved.attempts[1]!.id);
  expect(judgmentView(legacy).previous?.id).toBe(saved.attempts[0]!.id);
  const future = { ...saved, run: { ...saved.run, simulationTimeMs: 0 } };
  expect(judgmentView(future).current?.id).toBe(saved.attempts[0]!.id);
  expect(judgmentView(future).state).toContain(
    "after this inspected checkpoint",
  );
  const held = {
    ...saved.attempts[1]!,
    appliedAt: null,
    appliedSimulationTimeMs: null,
  };
  expect(
    judgmentView({ ...saved, attempts: [saved.attempts[0]!, held] }),
  ).toMatchObject({
    current: { id: saved.attempts[0]!.id },
    state: "Received response · held, not applied",
    ageMs: 5000,
  });
});

it("keeps full event search within inclusive cursor boundaries and keeps missing and old host samples explicit", async () => {
  const { runs, recordings } = store();
  const id = runs.start({ seed: "search-boundaries", durationSeconds: 120 }).run
    .id;
  await advance(runs, 120);
  const saved = recordings.get(id)!;
  const index = indexEvents(saved);
  expect(index.length).toBeGreaterThan(5000);
  const last = saved.events.at(-1)!;
  if (!("eventId" in last)) throw new Error("Expected a versioned event");
  expect(
    searchEvents(
      index,
      120_000,
      { ...emptyEventFilters, query: last.eventId.toUpperCase() },
      null,
    ).events,
  ).toEqual([last]);
  expect(
    searchEvents(
      index,
      119_999,
      { ...emptyEventFilters, query: last.eventId },
      null,
    ).events,
  ).toEqual([]);
  expect(
    searchEvents(
      index,
      120_000,
      { ...emptyEventFilters, from: "120", through: "120" },
      null,
    ).events,
  ).toEqual(saved.events.filter((event) => event.simulationTimeMs === 120_000));
  expect(
    searchEvents(
      index,
      120_000,
      { ...emptyEventFilters, from: "121", through: "120" },
      null,
    ),
  ).toMatchObject({
    events: [],
    error: "From time must be at or before through time.",
  });
  expect(
    searchEvents(
      index,
      120_000,
      { ...emptyEventFilters, from: "Infinity" },
      null,
    ).events,
  ).toEqual([]);
  const dns = saved.events.find((event) => event.type === "dns")!;
  if (dns.type !== "dns" || saved.run.manifest.schemaVersion !== 2)
    throw new Error("Expected organization and DNS");
  const service = saved.run.manifest.organization.resources.find(
    (resource) => resource.domain === dns.query,
  )!;
  expect(
    searchEvents(
      index,
      0,
      {
        ...emptyEventFilters,
        kind: "dns",
        query: dns.query.toUpperCase(),
        period: "warmup",
      },
      service.id,
    ).events,
  ).toContain(dns);
  const metric = saved.events
    .filter((event) => event.type === "host-metric")
    .at(-1)!;
  const at = metric.simulationTimeMs;
  const noFutureSamples = {
    ...saved,
    events: saved.events.filter((event) => event.simulationTimeMs <= at),
  };
  expect(hostSamples(noFutureSamples, metric.hostId).ageMs).toBe(
    saved.run.simulationTimeMs - at,
  );
  expect(
    hostSamples(
      {
        ...noFutureSamples,
        run: { ...saved.run, simulationTimeMs: at + 30_000 },
      },
      metric.hostId,
    ).stale,
  ).toBe(false);
  expect(
    hostSamples(
      {
        ...noFutureSamples,
        run: { ...saved.run, simulationTimeMs: at + 30_001 },
      },
      metric.hostId,
    ).stale,
  ).toBe(true);
  expect(
    hostSamples(
      {
        ...saved,
        events: saved.events.filter((event) => event.type !== "host-metric"),
      },
      metric.hostId,
    ),
  ).toEqual({ samples: [], ageMs: null, stale: false });
  const before = { ...saved, run: { ...saved.run, simulationTimeMs: at - 1 } };
  expect(hostSamples(before, metric.hostId).samples).not.toContain(metric);
});

it("opens only when every configured threshold matches, preserving fluctuations and missing confidence", async () => {
  const values = [
    response(0.79),
    response(0.8, 0.74),
    response(0.99, null),
    response(0.8, 0.75),
    response(0.1),
  ];
  const { runs, recordings } = store({
    fetch: async () => Response.json(values.shift()!),
  });
  const id = runs.start({
    seed: "thresholds",
    evaluate: true,
    durationSeconds: 20,
  }).run.id;
  await runs.settled();
  await advance(runs, 10);
  expect(recordings.investigationHistory(id)).toEqual([]);
  await advance(runs, 5);
  expect(investigationStatus(recordings.investigationHistory(id))).toBe("open");
  await advance(runs, 5);
  const saved = recordings.get(id)!;
  expect(saved.investigationHistory).toHaveLength(1);
  expect(saved.investigationHistory[0]).toMatchObject({
    type: "opened",
    simulationTimeMs: 15000,
    attemptId: saved.attempts[3]!.id,
    snapshotId: saved.attempts[3]!.snapshotId,
    actor: "advisory-policy",
  });
  expect(
    saved.attempts.map((attempt) => attempt.response!.answers.compromise.noul),
  ).toEqual([0.79, 0.8, 0.99, 0.8, 0.1]);
  expect(saved.attempts[2]!.policy!.outcome).toBe("unevaluable");
  expect(
    saved.attempts[2]!.response!.answers.classification.confidence,
  ).toBeUndefined();
  const severe = response();
  severe.answers.severity = {
    ...severe.answers.severity,
    score: 1.99,
    probabilities: { "0": 0, "1": 0.01, "2": 0.99, "3": 0 },
  };
  expect(evaluatePolicy(severe).outcome).toBe("review");
});

it("records idempotent local actions, rejects stale actions, reopens only on a new applied incident, and preserves evidence", async () => {
  const { runs, recordings } = store();
  const id = runs.start({
    seed: "investigation",
    evaluate: true,
    interactive: true,
    durationSeconds: 10,
  }).run.id;
  await runs.settled();
  const before = recordings.get(id)!;
  const ack = action("acknowledge", 1);
  const acknowledged = runs.investigate(id, ack);
  expect(runs.investigate(id, ack)).toEqual(acknowledged);
  expect(() => runs.investigate(id, action("acknowledge", 2))).toThrow(
    "unavailable",
  );
  expect(() => runs.investigate(id, { ...ack, type: "close" })).toThrow(
    "different request",
  );
  expect(() => runs.investigate(id, action("close", 1))).toThrow("changed");
  runs.control(id, {
    commandId: randomUUID(),
    type: "begin-injection",
    fixture: "credential-compromise",
  });
  await advance(runs, 1);
  runs.control(id, { commandId: randomUUID(), type: "stop-injection" });
  expect(investigationStatus(recordings.investigationHistory(id))).toBe(
    "acknowledged",
  );
  const close = action("close", 2);
  const closed = runs.investigate(id, close);
  expect(closed.events.slice(0, before.events.length)).toEqual(before.events);
  expect(closed.attempts).toEqual(before.attempts);
  expect(closed.snapshots[0]).toEqual(before.snapshots[0]);
  recordings.saveAttempt(before.attempts[0]!);
  expect(investigationStatus(recordings.investigationHistory(id))).toBe(
    "closed",
  );
  await advance(runs, 4);
  const reopened = recordings.get(id)!;
  expect(reopened.investigationHistory.map((event) => event.type)).toEqual([
    "opened",
    "acknowledged",
    "closed",
    "reopened",
  ]);
  expect(reopened.investigationHistory.map((event) => event.sequence)).toEqual([
    1, 2, 3, 4,
  ]);
  expect(
    reopened.investigationHistory.every(
      (event, i, history) =>
        i === 0 || event.runRevision > history[i - 1]!.runRevision,
    ),
  ).toBe(true);
  expect(runs.investigate(id, close).investigationHistory).toEqual(
    reopened.investigationHistory,
  );
  expect(() => runs.investigate(id, action("close", 3))).toThrow("changed");
  const replacement = runs.control(id, {
    commandId: randomUUID(),
    type: "reset",
  });
  expect(replacement.investigationHistory).toEqual([]);
  expect(recordings.investigationHistory(id)).toEqual(
    reopened.investigationHistory,
  );
  await runs.settled();
  expect(() => runs.investigate(replacement.run.id, ack)).toThrow(
    "different request",
  );
});

it("holds investigation opening and timeline results during pause, applies once on resume, and synchronizes history over deltas", async () => {
  let resolve!: (response: Response) => void;
  const { runs, recordings } = store({
    fetch: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const id = runs.start({ seed: "pause-investigation", evaluate: true }).run.id;
  let client: Recording | null = recordings.get(id)!;
  const messages: RunMessage[] = [];
  runs.subscribe((message) => {
    messages.push(message);
    client = receiveRunMessage(client, message, id);
  });
  runs.control(id, { commandId: randomUUID(), type: "pause" });
  const frozen = recordings.get(id)!;
  resolve(Response.json(response()));
  await runs.settled();
  const held = recordings.get(id)!;
  expect(held.attempts[0]!.status).toBe("succeeded");
  expect(held.investigationHistory).toEqual([]);
  expect(visibleAttempts(held)[0]!.response).toBeNull();
  expect(decisionMetrics(held)).toEqual(decisionMetrics(frozen));
  runs.control(id, { commandId: randomUUID(), type: "resume" });
  expect(client).toEqual(recordings.get(id));
  expect(client!.investigationHistory).toHaveLength(1);
  expect(client!.investigationHistory[0]!.runRevision).toBe(
    client!.run.revision,
  );
  expect(messages.length).toBeGreaterThan(2);
});

it("rolls back an incident and its response together on storage failure", async () => {
  const { db, runs, recordings } = store();
  db.exec(
    "CREATE TRIGGER fail_investigation BEFORE INSERT ON investigation_events BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
  );
  const id = runs.start({ seed: "atomic-investigation", evaluate: true }).run
    .id;
  await runs.settled();
  const saved = recordings.get(id)!;
  expect(saved.run.status).toBe("failed");
  expect(saved.attempts[0]!.status).toBe("pending");
  expect(saved.investigationHistory).toEqual([]);
});

it("persists local actions across restart and permits closure of an inactive recording via API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-m6-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "recordings.sqlite");
  const options = {
    databasePath,
    webOrigin: "http://localhost:3000",
    schedule: () => () => {},
    evaluator: {
      apiKey: "test-only",
      fetch: async () => Response.json(response()),
    },
  };
  const app = await buildApp(options);
  const start = recordingSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { seed: "restart-investigation", evaluate: true },
      })
    ).json(),
  );
  const url = `/api/runs/${start.run.id}`;
  await expect
    .poll(
      async () =>
        recordingSchema.parse((await app.inject(url)).json())
          .investigationHistory.length,
    )
    .toBe(1);
  const ack = action("acknowledge", 1);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `${url}/investigation-actions`,
        payload: ack,
      })
    ).statusCode,
  ).toBe(200);
  await app.close();
  const reopened = await buildApp(options);
  cleanup.push(() => reopened.close());
  const saved = recordingSchema.parse((await reopened.inject(url)).json());
  expect(saved.run.status).toBe("interrupted");
  expect(investigationStatus(saved.investigationHistory)).toBe("acknowledged");
  const closed = await reopened.inject({
    method: "POST",
    url: `${url}/investigation-actions`,
    payload: action("close", 2),
  });
  expect(closed.statusCode).toBe(200);
  expect(
    investigationStatus(
      recordingSchema.parse(closed.json()).investigationHistory,
    ),
  ).toBe("closed");
  expect(
    (
      await reopened.inject({
        method: "POST",
        url: `${url}/investigation-actions`,
        payload: { ...ack, actor: "someone-else" },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await reopened.inject({
        method: "POST",
        url: `/api/runs/${randomUUID()}/investigation-actions`,
        payload: ack,
      })
    ).statusCode,
  ).toBe(404);
});

it("defines metrics independently of filters, counts retries and failures, and excludes pending/interrupt latency", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockResolvedValueOnce(Response.json(response()))
    .mockResolvedValue(Response.json(response(0.7, null)));
  const { runs, recordings } = store({
    fetch: transport,
    config: { ...defaultEvaluation, retryDelayMs: 0 },
  });
  const id = runs.start({ seed: "metrics", evaluate: true, durationSeconds: 5 })
    .run.id;
  await runs.settled();
  await advance(runs, 5);
  const saved = recordings.get(id)!;
  saved.attempts.forEach((attempt, index) => {
    attempt.latencyMs = [100, 200, 900][index]!;
  });
  expect(decisionMetrics(saved)).toEqual({
    events: 25,
    warmupEvents: 4500,
    attempts: 3,
    decisions: 2,
    failures: 1,
    pending: 0,
    decisionsPerMinute: 24,
    latencySamples: 3,
    medianLatencyMs: 200,
    p95LatencyMs: 900,
  });
  for (const attempt of saved.attempts) {
    const snapshot = saved.snapshots.find(
      (snapshot) => snapshot.id === attempt.snapshotId,
    )!;
    expect(snapshot.simulationTimeMs).toBe(attempt.simulationTimeMs);
    const sequences = snapshot.input.windows.flatMap((window) =>
      window.metrics.flatMap((metric) => metric.evidenceSequences),
    );
    expect(
      sequences.every((sequence) =>
        saved.events.some(
          (event) =>
            event.sequence === sequence &&
            event.simulationTimeMs <= snapshot.simulationTimeMs,
        ),
      ),
    ).toBe(true);
  }
  saved.attempts[0]!.error!.code = "interrupted";
  expect(decisionMetrics(saved)).toMatchObject({
    latencySamples: 2,
    medianLatencyMs: 550,
  });
  saved.run.simulationTimeMs = 0;
  expect(decisionMetrics(saved).decisionsPerMinute).toBeNull();
});

it("expires all injected evidence after a full 15 simulation minutes while baseline continues and investigation remains open", async () => {
  const { runs, recordings } = store();
  const id = runs.start({
    seed: "full-window",
    fixture: "credential-compromise",
    evaluate: true,
    durationSeconds: 35,
  }).run.id;
  await runs.settled();
  await advance(runs, 35);
  const saved = recordings.get(id)!;
  const manifest = saved.run.manifest;
  if (manifest.schemaVersion !== 2) throw new Error("Expected telemetry");
  const injected = new Set(
    recordings.truth(id).flatMap((record) => record.eventSequences),
  );
  const events: TelemetryEvent[] = saved.events.filter(
    (event): event is TelemetryEvent => "eventId" in event,
  );
  const lastInjection = Math.max(
    ...events
      .filter((event) => injected.has(event.sequence))
      .map((event) => event.simulationTimeMs),
  );
  const expiry = lastInjection + 900_000;
  let sequence = saved.run.lastSequence;
  for (let time = 36000; time <= expiry; time += 1000)
    for (const observation of baselineObservations(manifest, time))
      events.push(observe(observation, manifest, id, time, ++sequence));
  const references = (time: number) =>
    aggregateInput(manifest.organization, events, time)
      .windows.at(-1)!
      .metrics.flatMap((metric) => metric.evidenceSequences);
  expect(
    references(expiry - 1).some((sequence) => injected.has(sequence)),
  ).toBe(true);
  expect(references(expiry).some((sequence) => injected.has(sequence))).toBe(
    false,
  );
  expect(references(expiry).length).toBeGreaterThan(0);
  expect(investigationStatus(recordings.investigationHistory(id))).toBe("open");
  expect(recordings.get(id)).toEqual(saved);
});

it("pins persisted evidence, decisions and investigation while streamed success and failure continue", async () => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-inspection-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "recording.sqlite");
  let calls = 0;
  const { runs, recordings } = store(
    {
      config: { ...defaultEvaluation, maxAttempts: 1 },
      fetch: async () => {
        calls++;
        return calls === 3
          ? Response.json({ invalid: true })
          : Response.json(response(calls === 1 ? 0.1 : 0.9));
      },
    },
    filename,
  );
  const id = runs.start({
    seed: "shared-inspection",
    durationSeconds: 15,
    evaluate: true,
  }).run.id;
  await runs.settled();
  let client = recordings.get(id)!;
  runs.subscribe((message) => {
    client = receiveRunMessage(client, message, id)!;
  });
  const first = inspectAssessment(client, client.attempts[0]!.id)!;
  const frozen = JSON.stringify(first);
  await advance(runs, 5);
  expect(client).toEqual(recordings.get(id));
  expect(newerAssessmentCount(client, first)).toBe(1);
  expect(
    first.recording.events.every((event) => event.simulationTimeMs <= 0),
  ).toBe(true);
  expect(first.recording.snapshots).toHaveLength(1);
  expect(first.recording.investigationHistory).toHaveLength(0);
  expect(decisionMetrics(first.recording).decisions).toBe(1);
  const secondId = client.attempts[1]!.id;
  runs.investigate(id, action("acknowledge", 1));
  runs.investigate(id, action("close", 2));
  const second = inspectAssessment(client, secondId)!;
  expect(investigationStatus(second.recording.investigationHistory)).toBe(
    "open",
  );
  await advance(runs, 5);
  expect(client.attempts.at(-1)!.status).toBe("failed");
  expect(newerAssessmentCount(client, first)).toBe(1);
  await advance(runs, 5);
  expect(newerAssessmentCount(client, first)).toBe(2);
  expect(JSON.stringify(first)).toBe(frozen);
  expect(investigationStatus(client.investigationHistory)).toBe("open");
  const reopened = openDatabase(filename);
  try {
    const persisted = new Recordings(reopened).get(id)!;
    const restored = inspectAssessment(persisted, secondId)!;
    expect(restored.assessment).toEqual(second.assessment);
    expect(restored.recording.events).toEqual(second.recording.events);
    expect(restored.recording.snapshots).toEqual(second.recording.snapshots);
    expect(restored.recording.attempts).toEqual(second.recording.attempts);
    expect(restored.recording.investigationHistory).toEqual(
      second.recording.investigationHistory,
    );
    expect(inspectAssessment(persisted, randomUUID())).toBeNull();
  } finally {
    reopened.close();
  }
  expect(calls).toBe(4);
});

it("keeps a held response inspectable without future application leaking into the pinned view", async () => {
  let resolve!: (response: Response) => void;
  const { runs, recordings } = store({
    fetch: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const id = runs.start({
    seed: "held-inspection",
    durationSeconds: 1,
    evaluate: true,
  }).run.id;
  runs.control(id, { commandId: randomUUID(), type: "pause" });
  resolve(Response.json(response()));
  await runs.settled();
  const held = recordings.get(id)!;
  const inspection = inspectAssessment(held, held.attempts[0]!.id)!;
  expect(inspection.assessment!.response).not.toBeNull();
  expect(inspection.assessment!.appliedAt).toBeNull();
  expect(inspection.recording.investigationHistory).toHaveLength(0);
  expect(decisionMetrics(inspection.recording).decisions).toBe(0);
  runs.control(id, { commandId: randomUUID(), type: "resume" });
  const applied = recordings.get(id)!;
  expect(newerAssessmentCount(applied, inspection)).toBe(1);
  expect(inspection.assessment!.appliedAt).toBeNull();
  expect(inspection.recording.investigationHistory).toHaveLength(0);
  expect(
    investigationStatus(
      inspectAssessment(applied, applied.attempts[0]!.id)!.recording
        .investigationHistory,
    ),
  ).toBe("open");
  const legacy = recordingSchema.parse({
    ...applied,
    attempts: applied.attempts.map((attempt) => ({
      ...attempt,
      appliedAt: undefined,
      appliedSimulationTimeMs: undefined,
    })),
  });
  expect(
    decisionMetrics(
      inspectAssessment(legacy, legacy.attempts[0]!.id)!.recording,
    ).decisions,
  ).toBe(1);
  const delayed = recordingSchema.parse({
    ...applied,
    attempts: applied.attempts.map((attempt) => ({
      ...attempt,
      appliedSimulationTimeMs: 1000,
    })),
  });
  const atCheckpoint = inspectAssessment(delayed, delayed.attempts[0]!.id)!;
  expect(atCheckpoint.assessment!.response).not.toBeNull();
  expect(atCheckpoint.recording.attempts).toHaveLength(0);
  expect(atCheckpoint.recording.investigationHistory).toHaveLength(0);
});

it("restores pending and held inspection boundaries independently of later operator actions", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let calls = 0;
    let receive!: (response: Response) => void;
    const { runs, recordings } = store({
      fetch: async () =>
        ++calls === 1
          ? Response.json(response())
          : new Promise<Response>((resolve) => {
              receive = resolve;
            }),
    });
    const id = runs.start({
      seed: "link-phase-boundary",
      durationSeconds: 20,
      evaluate: true,
    }).run.id;
    await runs.settled();
    vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
    for (let i = 0; i < 5; i++) runs.tick();
    const pending = recordings.get(id)!;
    const pendingBoundary = inspectionBoundary(pending);
    runs.control(id, { commandId: randomUUID(), type: "pause" });
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    receive(Response.json(response()));
    await runs.settled();
    const held = recordings.get(id)!;
    const heldBoundary = inspectionBoundary(held);
    vi.setSystemTime(new Date("2026-01-01T00:00:15Z"));
    runs.investigate(id, action("close", 1));
    const closedHeld = recordings.get(id)!;
    const closedBoundary = inspectionBoundary(closedHeld);
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z"));
    runs.control(id, { commandId: randomUUID(), type: "resume" });
    const applied = recordings.get(id)!;
    expect(applied.investigationHistory.map((event) => event.type)).toEqual([
      "opened",
      "closed",
      "reopened",
    ]);
    const pendingView = inspectBoundary(applied, 5000, pendingBoundary)!;
    expect(pendingView.attempts.at(-1)).toMatchObject({
      status: "pending",
      response: null,
      appliedAt: null,
    });
    expect(pendingView.investigationHistory.map((event) => event.type)).toEqual(
      ["opened"],
    );
    const heldView = inspectBoundary(applied, 5000, heldBoundary)!;
    expect(heldView.attempts.at(-1)).toMatchObject({
      status: "succeeded",
      appliedAt: null,
    });
    expect(heldView.investigationHistory.map((event) => event.type)).toEqual([
      "opened",
    ]);
    expect(
      inspectBoundary(applied, 5000, closedBoundary)!.investigationHistory.map(
        (event) => event.type,
      ),
    ).toEqual(["opened", "closed"]);
    for (const phase of ["pending", "received"] as const) {
      expect(
        inspectAssessment(
          applied,
          held.attempts.at(-1)!.id,
          phase,
        )!.recording.investigationHistory.map((event) => event.type),
      ).toEqual(["opened"]);
    }
  } finally {
    vi.useRealTimers();
  }
});
