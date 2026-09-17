import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  type ControlRun,
  type Recording,
  type RunMessage,
} from "@blackout/contracts";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";
import { defaultEvaluation, type EvaluatorOptions } from "../src/evaluator.js";
import { buildApp } from "../src/app.js";
import { receiveRunMessage } from "../../web/src/app/run-stream.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
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
function command(
  type: "pause" | "resume" | "stop-injection" | "reset",
): ControlRun {
  return { commandId: randomUUID(), type };
}
function response() {
  return Response.json({
    model: "jev-controls-test",
    answers: {
      compromise: { type: "noul", noul: 0.9 },
      classification: {
        type: "choice",
        choice: "compromise",
        probabilities: {
          normal: 0,
          benign_anomaly: 0,
          suspicious: 0,
          compromise: 1,
        },
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
  });
}
function deferred() {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  return { fetch, resolve: () => resolve(response()) };
}

it("freezes the clock, windows and live decision application while recording a late response; resume applies exactly once", async () => {
  const transport = deferred();
  const { runs, recordings } = store({
    apiKey: "controls-credential",
    fetch: transport.fetch,
  });
  const started = runs.start({
    seed: "paused-response",
    evaluate: true,
    durationSeconds: 5,
  });
  const id = started.run.id;
  const pause = command("pause");
  const frozen = runs.control(id, pause);
  expect(runs.control(id, pause)).toEqual(frozen);
  expect(() => runs.control(id, command("pause"))).toThrow("already paused");
  for (let n = 0; n < 5; n++) runs.tick();
  transport.resolve();
  await runs.settled();
  const received = recordings.get(id)!;
  expect(received.events).toEqual(frozen.events);
  expect(received.snapshots).toEqual(frozen.snapshots);
  expect(received.run.simulationTimeMs).toBe(0);
  expect(received.run.manifest.resolvedModel).toBeNull();
  expect(received.run.controls).toMatchObject({
    paused: true,
    waitingForInference: false,
    pendingApplication: true,
  });
  expect(received.attempts[0]).toMatchObject({
    status: "succeeded",
    completedAt: expect.any(String),
    appliedAt: null,
    appliedSimulationTimeMs: null,
    snapshotId: started.snapshots[0]!.id,
  });
  const resume = command("resume");
  const resumed = runs.control(id, resume);
  expect(resumed.run.manifest.resolvedModel).toBe("jev-controls-test");
  expect(resumed.attempts[0]).toMatchObject({
    appliedAt: expect.any(String),
    appliedSimulationTimeMs: 0,
  });
  expect(runs.control(id, resume)).toEqual(resumed);
  expect(
    resumed.commands.map((c) => [c.sequence, c.type, c.simulationTimeMs]),
  ).toEqual([
    [1, "start", 0],
    [2, "pause", 0],
    [3, "resume", 0],
  ]);
  runs.tick();
  expect(recordings.get(id)!.run.simulationTimeMs).toBe(1000);
  expect(transport.fetch).toHaveBeenCalledTimes(1);
});

it("holds a terminal checkpoint on pause and completes only after its saved result is applied on resume", async () => {
  const transport = deferred();
  const { runs, recordings } = store({
    apiKey: "controls-credential",
    fetch: transport.fetch,
  });
  const id = runs.start({
    seed: "last-checkpoint",
    durationSeconds: 1,
    evaluate: true,
  }).run.id;
  transport.resolve();
  await runs.settled();
  runs.tick();
  runs.control(id, command("pause"));
  transport.resolve();
  await runs.settled();
  expect(recordings.get(id)!.run).toMatchObject({
    status: "running",
    simulationTimeMs: 1000,
  });
  runs.tick();
  const finished = runs.control(id, command("resume"));
  expect(finished.run.status).toBe("completed");
  expect(finished.attempts.map((a) => a.simulationTimeMs)).toEqual([0, 1000]);
  expect(finished.attempts.every((a) => a.appliedAt)).toBe(true);
});

it("uses bounded wall time for a paused timeout and ignores an eventual transport response", async () => {
  vi.useFakeTimers();
  const transport = deferred();
  const { runs, recordings } = store({
    apiKey: "controls-credential",
    fetch: transport.fetch,
    config: { ...defaultEvaluation, timeoutMs: 100, maxAttempts: 1 },
  });
  const id = runs.start({ seed: "paused-timeout", evaluate: true }).run.id;
  runs.control(id, command("pause"));
  await vi.advanceTimersByTimeAsync(101);
  await runs.settled();
  const timedOut = recordings.get(id)!;
  expect(timedOut.run.simulationTimeMs).toBe(0);
  expect(timedOut.attempts[0]).toMatchObject({
    status: "failed",
    error: { code: "timeout" },
    appliedAt: null,
  });
  transport.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(recordings.get(id)).toEqual(timedOut);
  expect(
    runs.control(id, command("resume")).attempts[0]!.appliedAt,
  ).not.toBeNull();
});

it("stops injection while paused without dropping evidence, then continues baseline", () => {
  const { runs, recordings } = store();
  const id = runs.start({
    seed: "interactive",
    interactive: true,
    durationSeconds: 20,
  }).run.id;
  runs.tick();
  const begin: ControlRun = {
    commandId: randomUUID(),
    type: "begin-injection",
    fixture: "credential-compromise",
  };
  runs.control(id, begin);
  runs.control(id, begin);
  for (let n = 0; n < 6; n++) runs.tick();
  const before = runs.control(id, command("pause"));
  expect(
    recordings.truth(id).some((t) => t.stage === "increasing-failures"),
  ).toBe(true);
  const stopped = runs.control(id, command("stop-injection"));
  expect(stopped.events).toEqual(before.events);
  expect(stopped.snapshots).toEqual(before.snapshots);
  runs.tick();
  expect(recordings.get(id)!.run.simulationTimeMs).toBe(7000);
  runs.control(id, command("resume"));
  runs.tick();
  const after = recordings.get(id)!;
  expect(after.run.lastSequence - before.run.lastSequence).toBe(5);
  expect(after.events.slice(0, before.events.length)).toEqual(before.events);
  expect(
    after.snapshots
      .at(-1)!
      .input.windows[0]!.metrics.some((m) =>
        m.evidenceSequences.some(
          (seq) => seq > 4505 && seq <= before.run.lastSequence,
        ),
      ),
  ).toBe(true);
  expect(recordings.truth(id).at(-1)!.simulationTimeMs).toBe(7000);
  expect(after.commands.map((c) => c.type)).toEqual([
    "start",
    "begin-injection",
    "pause",
    "stop-injection",
    "resume",
  ]);
});

it("ends a complete interactive scenario automatically and can begin the benign control afterwards", () => {
  const { runs, recordings } = store();
  const id = runs.start({
    seed: "auto-stop",
    interactive: true,
    durationSeconds: 40,
  }).run.id;
  runs.control(id, {
    commandId: randomUUID(),
    type: "begin-injection",
    fixture: "credential-compromise",
  });
  for (let n = 0; n < 31; n++) runs.tick();
  expect(recordings.get(id)!.run.controls!.injection!.stoppedAtMs).toBe(31000);
  expect(recordings.truth(id).at(-1)!.stage).toBe("stopped");
  runs.control(id, {
    commandId: randomUUID(),
    type: "begin-injection",
    fixture: "benign-maintenance",
  });
  runs.tick();
  expect(recordings.truth(id).at(-1)).toMatchObject({
    fixture: "benign-maintenance",
    stage: "sign-in",
  });
  expect(recordings.get(id)!.commands.map((c) => c.sequence)).toEqual([
    1, 2, 3, 4,
  ]);
});

it("resets atomically with pending inference and keeps old callbacks out of the replacement run", async () => {
  const requests: (() => void)[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(
    () =>
      new Promise<Response>((resolve) =>
        requests.push(() => resolve(response())),
      ),
  );
  const { runs, recordings } = store({ apiKey: "controls-credential", fetch });
  const original = runs.start({
    seed: "reset-pending",
    interactive: true,
    durationSeconds: 10,
    evaluate: true,
  });
  runs.control(original.run.id, command("pause"));
  const reset = command("reset");
  const fresh = runs.control(original.run.id, reset);
  expect(fresh.run.id).not.toBe(original.run.id);
  expect(fresh.run.manifest).toEqual(original.run.manifest);
  expect(fresh.events.map((e) => ({ ...e, runId: "" }))).toEqual(
    original.events.map((e) => ({ ...e, runId: "" })),
  );
  expect(runs.control(original.run.id, reset).run.id).toBe(fresh.run.id);
  expect(() => runs.control(original.run.id, command("resume"))).toThrow(
    "no longer active",
  );
  requests[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  runs.tick();
  expect(recordings.get(fresh.run.id)!.run.simulationTimeMs).toBe(0); // new request is still pending
  expect(recordings.get(fresh.run.id)!.attempts[0]!.status).toBe("pending");
  const old = recordings.get(original.run.id)!;
  expect(old.run).toMatchObject({
    status: "interrupted",
    endedReason: "reset",
    replacementRunId: fresh.run.id,
  });
  expect(old.attempts[0]).toMatchObject({
    status: "failed",
    error: { code: "interrupted" },
    appliedAt: null,
  });
  requests[1]!();
  await runs.settled();
  runs.tick();
  expect(recordings.get(fresh.run.id)!.run.simulationTimeMs).toBe(1000);
  expect(recordings.list(0, 10).total).toBe(2);
});

it("rolls back reset if the replacement cannot be saved, retaining the active run and its command log", () => {
  const { db, runs, recordings } = store();
  const original = runs.start({ seed: "reset-rollback", interactive: true });
  db.exec(
    "CREATE TRIGGER fail_reset BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  const reset = command("reset");
  expect(() => runs.control(original.run.id, reset)).toThrow();
  expect(recordings.get(original.run.id)).toEqual(original);
  expect(recordings.command(reset.commandId)).toBeNull();
  db.exec("DROP TRIGGER fail_reset");
  expect(runs.control(original.run.id, reset).run.id).not.toBe(original.run.id);
});

it("preserves held decisions when a resume transaction fails", async () => {
  const transport = deferred();
  const { db, runs, recordings } = store({
    apiKey: "controls-credential",
    fetch: transport.fetch,
  });
  const id = runs.start({ seed: "resume-rollback", evaluate: true }).run.id;
  runs.control(id, command("pause"));
  transport.resolve();
  await runs.settled();
  const frozen = recordings.get(id)!;
  expect(frozen.attempts[0]!.appliedAt).toBeNull();
  db.exec(
    "CREATE TRIGGER fail_resume BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
  );
  const resume = command("resume");
  expect(() => runs.control(id, resume)).toThrow();
  expect(recordings.get(id)).toEqual(frozen);
  db.exec("DROP TRIGGER fail_resume");
  expect(runs.control(id, resume).attempts[0]!.appliedAt).not.toBeNull();
});

it("validates controls through HTTP, rejects ID reuse and permits a duplicate start without creating a run", async () => {
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    schedule: () => () => {},
  });
  cleanup.push(() => app.close());
  const input = {
    seed: "http-controls",
    interactive: true,
    commandId: randomUUID(),
  };
  const first = (
    await app.inject({ method: "POST", url: "/api/runs", payload: input })
  ).json<Recording>();
  expect(
    (
      await app.inject({ method: "POST", url: "/api/runs", payload: input })
    ).json<Recording>().run.id,
  ).toBe(first.run.id);
  const send = (id: string, payload: object) =>
    app.inject({ method: "POST", url: `/api/runs/${id}/commands`, payload });
  const pause = command("pause");
  expect((await send(first.run.id, pause)).statusCode).toBe(200);
  expect((await send(first.run.id, pause)).statusCode).toBe(200);
  expect(
    (await send(first.run.id, { ...pause, type: "resume" })).json().code,
  ).toBe("command_conflict");
  expect((await send(randomUUID(), pause)).statusCode).toBe(409);
  expect((await send("invalid", pause)).statusCode).toBe(400);
  expect(
    (
      await send(first.run.id, {
        commandId: randomUUID(),
        type: "set-speed",
        speed: 3,
      })
    ).statusCode,
  ).toBe(400);
  expect((await send(first.run.id, command("stop-injection"))).statusCode).toBe(
    409,
  );
});

it("keeps paused controls and command deduplication durable across backend restart", async () => {
  const { runs, recordings } = store();
  const original = runs.start({ seed: "paused-restart", interactive: true });
  const speed: ControlRun = {
    commandId: randomUUID(),
    type: "set-speed",
    speed: 0.25,
  };
  runs.control(original.run.id, speed);
  runs.control(original.run.id, command("pause"));
  runs.interrupt();
  const restarted = new Runs(recordings);
  expect(recordings.get(original.run.id)!.run).toMatchObject({
    status: "interrupted",
    controls: { paused: true, requestedSpeed: 0.25 },
  });
  expect(restarted.control(original.run.id, speed).run.status).toBe(
    "interrupted",
  );
  const next = restarted.start({ seed: "next", durationSeconds: 1 });
  restarted.tick();
  expect(recordings.get(next.run.id)!.run.status).toBe("completed");
  await restarted.close();
});

it("preserves ordered events, snapshots and every checkpoint across all speeds and timed controls", async () => {
  vi.useFakeTimers();
  let expected: unknown;
  for (const speed of [0.25, 0.5, 1, 2, 5] as const) {
    const { runs, recordings } = store();
    const id = runs.start({
      seed: "cross-speed",
      interactive: true,
      evaluate: true,
      durationSeconds: 20,
    }).run.id;
    await runs.settled();
    runs.control(id, { commandId: randomUUID(), type: "set-speed", speed });
    for (let second = 0; second < 20; second++) {
      if (second === 2) {
        runs.control(id, command("pause"));
        await vi.advanceTimersByTimeAsync(10_000);
        runs.pulse();
        expect(recordings.run(id)!.simulationTimeMs).toBe(2000);
        runs.control(id, command("resume"));
      }
      if (second === 4)
        runs.control(id, {
          commandId: randomUUID(),
          type: "begin-injection",
          fixture: "credential-compromise",
        });
      if (second === 13) runs.control(id, command("stop-injection"));
      await vi.advanceTimersByTimeAsync(1000 / speed - 1);
      runs.pulse();
      expect(recordings.run(id)!.simulationTimeMs).toBe(second * 1000);
      await vi.advanceTimersByTimeAsync(1);
      runs.pulse();
      await runs.settled();
      expect(recordings.run(id)!.simulationTimeMs).toBe((second + 1) * 1000);
    }
    const saved = recordings.get(id)!;
    expect(saved.run.status).toBe("completed");
    const actual = {
      events: saved.events.map((event) => ({ ...event, runId: "" })),
      snapshots: saved.snapshots.map((snapshot) => ({
        ...snapshot,
        runId: "",
        recordedAt: "",
      })),
      checkpoints: saved.attempts.map((attempt) => attempt.simulationTimeMs),
    };
    expect(actual.checkpoints).toEqual([0, 5000, 10000, 15000, 20000]);
    if (expected) expect(actual).toEqual(expected);
    else expected = actual;
  }
});

it("does not advance or burst through checkpoints after slow inference at 5x", async () => {
  vi.useFakeTimers();
  const transport = deferred();
  const { runs, recordings } = store({
    apiKey: "controls-credential",
    fetch: transport.fetch,
  });
  const id = runs.start({
    seed: "slow-fast",
    evaluate: true,
    durationSeconds: 6,
  }).run.id;
  runs.control(id, { commandId: randomUUID(), type: "set-speed", speed: 5 });
  await vi.advanceTimersByTimeAsync(5000);
  runs.pulse();
  expect(recordings.run(id)!.simulationTimeMs).toBe(0);
  transport.resolve();
  await runs.settled();
  runs.pulse();
  expect(recordings.run(id)!.simulationTimeMs).toBe(0);
  for (let n = 0; n < 5; n++) {
    await vi.advanceTimersByTimeAsync(200);
    runs.pulse();
  }
  expect(recordings.run(id)!.simulationTimeMs).toBe(5000);
  await vi.advanceTimersByTimeAsync(5000);
  runs.pulse();
  expect(recordings.run(id)!.simulationTimeMs).toBe(5000);
  transport.resolve();
  await runs.settled();
  await vi.advanceTimersByTimeAsync(200);
  runs.pulse();
  transport.resolve();
  await runs.settled();
  expect(recordings.get(id)!.attempts.map((a) => a.simulationTimeMs)).toEqual([
    0, 5000, 6000,
  ]);
});

it("resynchronizes missing, duplicate and out-of-order deltas against an authoritative snapshot", () => {
  const { runs, recordings } = store();
  const started = runs.start({ seed: "stream", interactive: true });
  const messages: RunMessage[] = [];
  runs.subscribe((message) => messages.push(message));
  runs.tick();
  runs.control(started.run.id, command("pause"));
  const first = receiveRunMessage(started, messages[0]!, started.run.id)!;
  expect(receiveRunMessage(first, messages[0]!, started.run.id)).toBe(first);
  expect(() =>
    receiveRunMessage(started, messages[1]!, started.run.id),
  ).toThrow("Missing live update");
  const paused = receiveRunMessage(first, messages[1]!, started.run.id)!;
  expect(receiveRunMessage(paused, messages[0]!, started.run.id)).toBe(paused);
  const authoritative = recordings.get(started.run.id)!;
  expect(
    receiveRunMessage(
      started,
      { type: "run.snapshot", recording: authoritative },
      started.run.id,
    ),
  ).toEqual(authoritative);
  expect(() =>
    receiveRunMessage(
      paused,
      { type: "run.snapshot", recording: started },
      started.run.id,
    ),
  ).toThrow("Stale");
  expect(() => receiveRunMessage(paused, messages[0]!, randomUUID())).toThrow(
    "Unexpected run",
  );
  const update = messages[0]!;
  if (update.type !== "run.updated") throw new Error("Expected events");
  expect(() =>
    receiveRunMessage(
      started,
      { ...update, events: update.events.slice(1) },
      started.run.id,
    ),
  ).toThrow("Missing event");
});

it("sends a fresh snapshot after disconnect, including pause, speed and reset ownership", async () => {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  const started = (
    await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { seed: "reconnect", interactive: true },
    })
  ).json<Recording>();
  const id = started.run.id;
  const connect = async (runId: string) => {
    const messages: RunMessage[] = [];
    const socket = await app.injectWS(
      `/ws?runId=${runId}`,
      {},
      {
        onInit: (client) =>
          client.on("message", (payload) => {
            const parsed = JSON.parse(String(payload));
            if (parsed.type !== "connection.ready") messages.push(parsed);
          }),
      },
    );
    cleanup.push(() => socket.terminate());
    await expect.poll(() => messages.length).toBeGreaterThan(0);
    return { socket, messages };
  };
  const first = await connect(id);
  first.socket.terminate();
  tick();
  tick();
  const send = (payload: ControlRun) =>
    app.inject({ method: "POST", url: `/api/runs/${id}/commands`, payload });
  await send({ commandId: randomUUID(), type: "set-speed", speed: 5 });
  await send(command("pause"));
  const next = await connect(id);
  const fresh = next.messages[0]!;
  expect(fresh.type).toBe("run.snapshot");
  if (fresh.type !== "run.snapshot") throw new Error("Expected snapshot");
  expect(fresh.recording.run).toMatchObject({
    simulationTimeMs: 2000,
    controls: { paused: true, requestedSpeed: 5 },
  });
  expect(fresh.recording.events).toHaveLength(4510);
  next.socket.terminate();
  const reset = (await send(command("reset"))).json<Recording>();
  const previous = await connect(id);
  expect(previous.messages[0]).toMatchObject({
    type: "run.snapshot",
    recording: {
      run: { status: "interrupted", replacementRunId: reset.run.id },
    },
  });
  expect((await app.inject("/api/runs/active")).json().runId).toBe(
    reset.run.id,
  );
});

it("disconnects a backed-up socket while generation keeps saving", async () => {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  const started = (
    await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { seed: "slow-client", durationSeconds: 2 },
    })
  ).json<Recording>();
  let received = 0;
  const socket = await app.injectWS(
    `/ws?runId=${started.run.id}`,
    {},
    {
      onInit: (client) =>
        client.on("message", () => {
          received++;
        }),
    },
  );
  cleanup.push(() => socket.terminate());
  await expect.poll(() => received).toBe(2);
  const peer = [...app.websocketServer.clients][0]!;
  Object.defineProperty(peer, "bufferedAmount", {
    get: () => 100 * 1024 * 1024,
  });
  const closed = new Promise<number>((resolve) =>
    socket.on("close", (code) => resolve(code)),
  );
  tick();
  tick();
  expect(await closed).toBe(1013);
  expect(
    (await app.inject(`/api/runs/${started.run.id}`)).json<Recording>().run,
  ).toMatchObject({ status: "completed", lastSequence: 4510 });
});

it("resets a finished recording without changing its completed status or end time", () => {
  const { runs, recordings } = store();
  const id = runs.start({ seed: "completed-reset", durationSeconds: 1 }).run.id;
  runs.tick();
  const finished = recordings.get(id)!;
  const reset = command("reset");
  const next = runs.control(id, reset);
  const retained = recordings.get(id)!;
  expect(retained.run).toMatchObject({
    status: "completed",
    endedAt: finished.run.endedAt,
    replacementRunId: next.run.id,
  });
  expect(retained.run.controls!.elapsedWallMs).toBe(
    finished.run.controls!.elapsedWallMs,
  );
  expect(retained.events).toEqual(finished.events);
  expect(next.run).toMatchObject({ status: "running", simulationTimeMs: 0 });
  expect(() => runs.control(id, command("reset"))).toThrow("no longer active");
});

it("excludes interactive and manually stopped runs from fixed-schedule evaluation cohorts", async () => {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3000",
    evaluator: { config: { ...defaultEvaluation, maxAttempts: 1 } },
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  cleanup.push(() => app.close());
  for (const interactive of [true, false]) {
    const started = (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          seed: "cohort",
          evaluate: true,
          interactive,
          fixture: interactive ? "baseline" : "credential-compromise",
          durationSeconds: 6,
        },
      })
    ).json<Recording>();
    const settled = async () => {
      await expect
        .poll(
          async () =>
            (await app.inject(`/api/runs/${started.run.id}`)).json<Recording>()
              .run.controls!.waitingForInference,
        )
        .toBe(false);
    };
    for (let n = 0; n < 6; n++) {
      await settled();
      tick();
      const saved = (
        await app.inject(`/api/runs/${started.run.id}`)
      ).json<Recording>();
      expect(saved.run.simulationTimeMs).toBe((n + 1) * 1000);
      if (!interactive && n === 4)
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/api/runs/${started.run.id}/commands`,
              payload: command("stop-injection"),
            })
          ).statusCode,
        ).toBe(200);
    }
    await settled();
    const report = await app.inject({
      method: "POST",
      url: "/api/evaluation-reports",
      payload: { runIds: [started.run.id] },
    });
    expect(report.statusCode).toBe(400);
    expect(report.json().code).toBe("invalid_input");
  }
});
