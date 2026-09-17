import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  inferenceAttemptSchema,
  jevResponseSchema,
  recordingSchema,
  summarizeInput,
  type InferenceAttempt,
  type JevResponse,
  type RunMessage,
} from "@blackout/contracts";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";
import {
  defaultEvaluation,
  Evaluator,
  questions,
  type EvaluatorOptions,
} from "../src/evaluator.js";
import { defaultPolicy, evaluatePolicy } from "../src/policy.js";
import { createEvaluationReport } from "../src/evaluation-report.js";
import { buildApp } from "../src/app.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});
function response(): JevResponse {
  return jevResponseSchema.parse({
    model: "jev-test",
    answers: {
      compromise: { type: "noul", noul: 0.8 },
      classification: {
        type: "choice",
        choice: "compromise",
        confidence: 0.75,
        probabilities: {
          normal: 0.05,
          benign_anomaly: 0.05,
          suspicious: 0.1,
          compromise: 0.8,
        },
      },
      severity: {
        type: "score",
        score: 2,
        probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
        legend: Object.fromEntries(
          questions.severity.criteria.map((text, index) => [
            String(index),
            text,
          ]),
        ),
        confidence: 1,
      },
      response: {
        type: "choice",
        choice: "escalate",
        probabilities: { observe: 0, investigate: 0, escalate: 1 },
        confidence: 1,
      },
    },
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}
function store(options: EvaluatorOptions = {}) {
  const db = openDatabase(":memory:");
  const recordings = new Recordings(db);
  const runs = new Runs(recordings, options);
  cleanup.push(async () => {
    await runs.close();
    db.close();
  });
  return { db, recordings, runs };
}
const testConfig = { ...defaultEvaluation, timeoutMs: 100, retryDelayMs: 0 };

it("sends all four questions against the exact snapshot, keeps truth and credentials out of the recording, and saves policy before publishing", async () => {
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-secret",
    );
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body)).toEqual(["model", "state", "questions"]);
    expect(Object.keys(body.questions)).toHaveLength(4);
    expect(JSON.stringify(body)).not.toMatch(
      /credential-attack|credential-misuse|test-secret|runId/,
    );
    return Response.json(response());
  });
  const { runs, recordings } = store({
    apiKey: "test-secret",
    fetch: transport,
    config: testConfig,
  });
  runs.subscribe((message) => {
    if (message.type === "inference.updated")
      expect(
        recordings
          .attempts(message.runId)
          .find((attempt) => attempt.id === message.attempt.id),
      ).toEqual(message.attempt);
  });
  const started = runs.start({
    seed: "pipeline",
    fixture: "credential-attack",
    durationSeconds: 1,
    evaluate: true,
  });
  expect(started.attempts[0]?.status).toBe("pending");
  await runs.settled();
  runs.tick();
  await runs.settled();
  const saved = recordings.get(started.run.id)!;
  expect(saved.run.status).toBe("completed");
  expect(saved.run.manifest.resolvedModel).toBe("jev-test");
  expect(saved.attempts.map((attempt) => attempt.simulationTimeMs)).toEqual([
    0, 1000,
  ]);
  expect(transport).toHaveBeenCalledTimes(2);
  for (const attempt of saved.attempts) {
    expect(attempt.request.state).toEqual(
      summarizeInput(
        saved.snapshots.find((snapshot) => snapshot.id === attempt.snapshotId)!
          .input,
      ),
    );
    expect(attempt.policy?.outcome).toBe("incident_advisory");
    expect(attempt.latencyMs).toBeGreaterThanOrEqual(0);
    expect(attempt.response).toEqual(response());
    expect(attempt.responseBody).toBe(JSON.stringify(response()));
  }
  expect(JSON.stringify(saved)).not.toContain("test-secret");
  expect(() =>
    recordings.saveAttempt({
      ...saved.attempts[0]!,
      snapshotId: saved.snapshots[1]!.id,
    }),
  ).toThrow("does not match");
  expect(
    inferenceAttemptSchema.safeParse({
      ...saved.attempts[0],
      simulationTimeMs: 999,
    }).success,
  ).toBe(false);
});

it("holds the clock with one request in flight, preserves every checkpoint, and recovers after an outage", async () => {
  let release: (result: Response) => void = () => {};
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json(response()));
  const { runs, recordings } = store({
    apiKey: "test",
    fetch: transport,
    config: { ...defaultEvaluation, maxAttempts: 1 },
  });
  const started = runs.start({
    seed: "pace",
    durationSeconds: 6,
    evaluate: true,
  });
  for (let index = 0; index < 10; index++) runs.tick();
  expect(recordings.get(started.run.id)?.run.simulationTimeMs).toBe(0);
  expect(transport).toHaveBeenCalledTimes(1);
  release(Response.json(response()));
  await runs.settled();
  for (let index = 0; index < 5; index++) runs.tick();
  await runs.settled();
  expect(recordings.get(started.run.id)?.run.simulationTimeMs).toBe(5000);
  expect(recordings.attempts(started.run.id).at(-1)?.error?.httpStatus).toBe(
    503,
  );
  runs.tick();
  await runs.settled();
  expect(
    recordings
      .attempts(started.run.id)
      .map((attempt) => [attempt.simulationTimeMs, attempt.status]),
  ).toEqual([
    [0, "succeeded"],
    [5000, "failed"],
    [6000, "succeeded"],
  ]);
  expect(recordings.get(started.run.id)?.run.status).toBe("completed");
});

it("bounds timeouts and retries against the same snapshot, ignores late replies, and permits a later checkpoint", async () => {
  const late: ((result: Response) => void)[] = [];
  const transport = vi.fn<typeof fetch>(
    () => new Promise((resolve) => late.push(resolve)),
  );
  const { runs, recordings } = store({
    apiKey: "test",
    fetch: transport,
    config: testConfig,
  });
  const started = runs.start({
    seed: "timeout",
    durationSeconds: 1,
    evaluate: true,
  });
  await runs.settled();
  const attempts = recordings.attempts(started.run.id);
  expect(attempts.map((attempt) => attempt.error?.code)).toEqual([
    "timeout",
    "timeout",
  ]);
  expect(attempts[0]?.snapshotId).toBe(attempts[1]?.snapshotId);
  late.forEach((resolve) => resolve(Response.json(response())));
  await new Promise((resolve) => setImmediate(resolve));
  expect(recordings.attempts(started.run.id)).toEqual(attempts);
  runs.tick();
  await runs.settled();
  expect(recordings.get(started.run.id)?.run.status).toBe("completed");
  expect(transport).toHaveBeenCalledTimes(4);
});

it.each([
  "missing answer",
  "bad probability",
  "wrong choice",
  "bad score",
  "invalid JSON",
])(
  "records malformed response: %s, without creating a decision",
  async (kind) => {
    const body = response();
    let raw = JSON.stringify(body);
    if (kind === "missing answer")
      raw = JSON.stringify({ model: "jev-test", answers: {} });
    if (kind === "bad probability") {
      body.answers.compromise.noul = 2;
      raw = JSON.stringify(body);
    }
    if (kind === "wrong choice") {
      body.answers.classification.choice = "normal";
      raw = JSON.stringify(body);
    }
    if (kind === "bad score") {
      body.answers.severity.score = 0;
      raw = JSON.stringify(body);
    }
    if (kind === "invalid JSON") raw = "not json";
    const transport = vi.fn<typeof fetch>(async () => new Response(raw));
    const { runs, recordings } = store({
      apiKey: "test",
      fetch: transport,
      config: testConfig,
    });
    const started = runs.start({
      seed: "malformed",
      durationSeconds: 1,
      evaluate: true,
    });
    await runs.settled();
    const attempt = recordings.attempts(started.run.id)[0]!;
    expect(attempt.status).toBe("failed");
    expect(attempt.error?.code).toBe("malformed_response");
    expect(attempt.policy?.outcome).toBe("unevaluable");
    expect(attempt.response).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  },
);

it("records unavailable without a key, never substitutes a low-risk result, and sends no requests", async () => {
  const transport = vi.fn<typeof fetch>();
  const { runs, recordings } = store({ fetch: transport });
  const started = runs.start({
    seed: "no-key",
    durationSeconds: 1,
    evaluate: true,
  });
  await runs.settled();
  runs.tick();
  await runs.settled();
  expect(transport).not.toHaveBeenCalled();
  expect(
    recordings
      .attempts(started.run.id)
      .every(
        (attempt) =>
          attempt.error?.code === "unavailable" && attempt.response === null,
      ),
  ).toBe(true);
  expect(recordings.get(started.run.id)?.run.status).toBe("completed");
});

it("preserves observed values in the compact request without evidence IDs or hidden metadata", () => {
  const { runs } = store();
  const saved = runs.start({ seed: "projection", durationSeconds: 1 });
  const input = saved.snapshots[0]!.input;
  const summary = summarizeInput(input);
  expect(
    summary.windows.map((window) =>
      window.metrics.map((metric) => [metric.name, metric.value]),
    ),
  ).toEqual(
    input.windows.map((window) =>
      window.metrics.map((metric) => [metric.name, metric.value]),
    ),
  );
  expect(summary.focus?.profile).toEqual(input.focus?.profile);
  expect(JSON.stringify(summary)).not.toContain("evidenceSequences");
  expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(5000);
  expect(() =>
    summarizeInput({ ...input, ...{ truth: "credential-misuse" } }),
  ).toThrow();
});

it("preserves checkpoints and terminal completion when a subscriber throws", async () => {
  const { runs, recordings } = store({
    apiKey: "test",
    fetch: async () => Response.json(response()),
  });
  runs.subscribe(() => {
    throw new Error("Closed transport");
  });
  const started = runs.start({
    seed: "transport-checkpoints",
    durationSeconds: 1,
    evaluate: true,
  });
  await runs.settled();
  runs.tick();
  await runs.settled();
  runs.tick();
  expect(recordings.get(started.run.id)?.run).toMatchObject({
    status: "completed",
    simulationTimeMs: 1000,
  });
  expect(
    recordings
      .attempts(started.run.id)
      .map((attempt) => attempt.simulationTimeMs),
  ).toEqual([0, 1000]);
});

it("redacts reflected credentials and omits error bodies and transport error messages", async () => {
  const key = "private-test-key";
  for (const result of [
    new Response(`{"api_key":"${key}","authorization":"Bearer more-private"}`),
    new Response(key, { status: 401 }),
    new Error(key),
  ]) {
    const transport = vi.fn<typeof fetch>(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const { runs, recordings } = store({
      apiKey: key,
      fetch: transport,
      config: { ...testConfig, maxAttempts: 1 },
    });
    const started = runs.start({
      seed: "redaction",
      durationSeconds: 1,
      evaluate: true,
    });
    await runs.settled();
    const serialized = JSON.stringify(recordings.attempts(started.run.id));
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain("more-private");
  }
});

it("evaluates inclusive policy boundaries and keeps missing confidence explicitly unevaluable", () => {
  const body = response();
  expect(evaluatePolicy(body).outcome).toBe("incident_advisory");
  body.answers.compromise.noul = 0.79999;
  expect(evaluatePolicy(body).rules[0]?.matched).toBe(false);
  expect(evaluatePolicy(body).outcome).toBe("review");
  body.answers.compromise.noul = 0.8;
  body.answers.classification.confidence = 0.74999;
  expect(evaluatePolicy(body).rules[2]?.matched).toBe(false);
  body.answers.classification.confidence = 0.75;
  expect(
    evaluatePolicy(body, { ...defaultPolicy, incidentSeverity: 2.00001 })
      .rules[3]?.matched,
  ).toBe(false);
  delete body.answers.classification.confidence;
  const parsed = jevResponseSchema.parse(body);
  expect(evaluatePolicy(parsed).outcome).toBe("unevaluable");
  expect(evaluatePolicy(parsed).rules[2]?.matched).toBeNull();
  expect(
    evaluatePolicy(null).rules.every((rule) => rule.matched === null),
  ).toBe(true);
  expect(Object.hasOwn(body.answers.compromise, "confidence")).toBe(false);
});

it("accepts the documented inclusive rounding tolerance despite floating-point representation", () => {
  const body = response();
  body.answers.severity.score = 2.11;
  body.answers.severity.probabilities = {
    "0": 0.01,
    "1": 0.06,
    "2": 0.76,
    "3": 0.17,
  };
  expect(jevResponseSchema.safeParse(body).success).toBe(true);
  body.answers.severity.score = 2.111;
  expect(jevResponseSchema.safeParse(body).success).toBe(false);
});

it("interrupts pending attempts on restart and preserves inspectable attempts and policy across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-inference-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "run.sqlite");
  const db = openDatabase(filename);
  const recordings = new Recordings(db);
  const runs = new Runs(recordings);
  const started = runs.start({ seed: "restart", durationSeconds: 2 });
  const evaluator = new Evaluator({
    apiKey: "test",
    fetch: async () => Response.json(response()),
  });
  const attempts: InferenceAttempt[] = [];
  await evaluator.checkpoint(
    started.snapshots[0]!,
    (attempt) => attempts.push(attempt),
    new AbortController().signal,
  );
  recordings.saveAttempt(attempts[0]!); // Simulate a process killed between pending and response writes.
  db.close();
  const reopened = openDatabase(filename);
  try {
    const after = new Runs(new Recordings(reopened));
    const saved = after.recordings.get(started.run.id)!;
    expect(saved.run.status).toBe("interrupted");
    expect(saved.attempts[0]?.error?.code).toBe("interrupted");
    expect(saved.attempts[0]?.policy?.outcome).toBe("unevaluable");
    expect(saved.attempts[0]?.request).toEqual(attempts[0]?.request);
  } finally {
    reopened.close();
  }
});

it("records the matching review fallback separately when no incident rule matches", () => {
  const body = response();
  body.answers.compromise.noul = 0.1;
  body.answers.classification = {
    type: "choice",
    choice: "normal",
    confidence: 0.1,
    probabilities: {
      normal: 0.4,
      benign_anomaly: 0.2,
      suspicious: 0.2,
      compromise: 0.2,
    },
  };
  body.answers.severity.score = 1;
  body.answers.response.choice = "investigate";
  const policy = evaluatePolicy(body);
  expect(policy.outcome).toBe("review");
  expect(
    policy.rules
      .filter((rule) => rule.group === "incident")
      .every((rule) => rule.matched === false),
  ).toBe(true);
  expect(policy.rules.find((rule) => rule.group === "review")).toMatchObject({
    id: "review-fallback",
    matched: true,
  });
});

it("stops generation on inference storage failure and does not send an unrecorded request", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json(response()));
  const { runs, recordings, db } = store({ apiKey: "test", fetch: transport });
  db.exec(
    "CREATE TRIGGER fail_attempt BEFORE INSERT ON inference_attempts BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  const started = runs.start({ seed: "disk-full", evaluate: true });
  await runs.settled();
  runs.tick();
  expect(transport).not.toHaveBeenCalled();
  expect(recordings.get(started.run.id)?.run).toMatchObject({
    status: "failed",
    simulationTimeMs: 0,
  });
  expect(runs.recordingFailure).not.toBeNull();
});

it("computes report denominators, misses, incomplete evaluations and true detections from saved outcomes", async () => {
  const outputs = [response(), response(), response()];
  outputs[0]!.answers.classification.choice = "normal";
  outputs[0]!.answers.classification.probabilities = {
    normal: 1,
    benign_anomaly: 0,
    suspicious: 0,
    compromise: 0,
  };
  outputs[0]!.answers.compromise.noul = 0.1;
  outputs[0]!.answers.response.choice = "observe";
  outputs[0]!.answers.response.probabilities = {
    observe: 1,
    investigate: 0,
    escalate: 0,
  };
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json(outputs.shift() ?? response()),
  );
  const { runs, recordings } = store({
    apiKey: "test",
    fetch: transport,
    config: { ...testConfig, checkpointMs: 1000, maxAttempts: 1 },
  });
  const start = runs.start({
    seed: "metrics",
    fixture: "credential-attack",
    durationSeconds: 2,
    evaluate: true,
  });
  await runs.settled();
  runs.tick();
  await runs.settled();
  runs.tick();
  await runs.settled();
  const recording = recordings.get(start.run.id)!;
  const truth = recordings.truth(start.run.id);
  const report = createEvaluationReport([{ recording, truth }]);
  expect(report.runs[0]).toMatchObject({
    checkpoints: 3,
    successfulCheckpoints: 3,
    failedCheckpoints: 0,
    incidentDecisions: 2,
    attackOutcome: "detected",
    detectionDelaySimulationMs: 0,
    classificationSwitches: 1,
    comparablePairs: 2,
    inputTokens: 300,
    attemptsWithUsage: 3,
  });
  expect(report.runs[0]?.detectionDelayWallMs).toBeTypeOf("number");
  const missed = structuredClone(recording);
  missed.attempts.forEach((attempt) => {
    attempt.policy!.outcome = "review";
  });
  expect(
    createEvaluationReport([{ recording: missed, truth }]).runs[0]
      ?.attackOutcome,
  ).toBe("miss");
  const missingConfidence = structuredClone(missed);
  delete missingConfidence.attempts[0]!.response!.answers.classification
    .confidence;
  missingConfidence.attempts[0]!.policy = evaluatePolicy(
    missingConfidence.attempts[0]!.response,
  );
  expect(
    createEvaluationReport([{ recording: missingConfidence, truth }]).runs[0],
  ).toMatchObject({
    successfulCheckpoints: 3,
    unevaluableCheckpoints: 1,
    attackOutcome: "incomplete",
  });
  missed.attempts[1] = {
    ...missed.attempts[1]!,
    status: "failed",
    response: null,
    error: { code: "timeout", message: "Timeout", httpStatus: null },
    policy: evaluatePolicy(null),
  };
  expect(
    createEvaluationReport([{ recording: missed, truth }]).runs[0],
  ).toMatchObject({
    attackOutcome: "incomplete",
    failedCheckpoints: 1,
    successfulCheckpoints: 2,
    comparablePairs: 0,
  });
  recordings.saveReport(report);
  expect(recordings.reports()).toEqual([report]);
});

it("exposes saved attempts through HTTP and WebSocket and makes reads without new inference", async () => {
  let tick = () => {};
  const transport = vi.fn<typeof fetch>(async () => Response.json(response()));
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    evaluator: { apiKey: "private", fetch: transport },
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  await app.ready();
  const started = recordingSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { seed: "http", durationSeconds: 1, evaluate: true },
      })
    ).json(),
  );
  const messages: RunMessage[] = [];
  const socket = await app.injectWS(
    `/ws?runId=${started.run.id}`,
    {},
    {
      onInit: (client) =>
        client.on("message", (payload) => {
          const message = JSON.parse(String(payload));
          if (message.type !== "connection.ready") messages.push(message);
        }),
    },
  );
  cleanup.push(() => socket.terminate());
  await expect
    .poll(() => messages.some((message) => message.type === "run.snapshot"))
    .toBe(true);
  await expect.poll(() => transport.mock.calls.length).toBe(1);
  tick();
  await expect
    .poll(
      async () =>
        recordingSchema.parse(
          (await app.inject(`/api/runs/${started.run.id}`)).json(),
        ).run.status,
    )
    .toBe("completed");
  const saved = recordingSchema.parse(
    (await app.inject(`/api/runs/${started.run.id}`)).json(),
  );
  expect(saved.attempts).toHaveLength(2);
  await expect
    .poll(() =>
      messages.map((message) =>
        message.type === "inference.updated"
          ? `${message.type}:${message.attempt.status}`
          : message.type,
      ),
    )
    .toContain("inference.updated:succeeded");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/evaluation-reports",
        payload: { runIds: [started.run.id] },
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (await app.inject("/api/evaluation-reports")).json().reports,
  ).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(
    JSON.stringify((await app.inject("/api/evaluator")).json()),
  ).not.toContain("private");
});
