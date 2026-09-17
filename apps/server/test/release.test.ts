import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { investigationStatus, type JevResponse } from "@blackout/contracts";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";
import { Runs } from "../src/runs.js";
import { PlaybackIndex } from "../../web/src/app/playback.js";

it("rehearses baseline, escalation, paused inspection, outage, cessation, playback, rerun and cleanup", async () => {
  const database = openDatabase(":memory:");
  const recordings = new Recordings(database);
  let probability = 0.05;
  let outage = false;
  let calls = 0;
  const runs = new Runs(recordings, {
    apiKey: "release-test-only",
    fetch: async () => {
      calls++;
      if (outage)
        return Response.json({ error: "unavailable" }, { status: 401 });
      const response: JevResponse = {
        model: "release-software-fixture",
        answers: {
          compromise: { type: "noul", noul: probability },
          classification: {
            type: "choice",
            choice: "compromise",
            confidence: 1,
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
      };
      return Response.json(response);
    },
  });
  const advance = async (count: number) => {
    for (let n = 0; n < count; n++) {
      runs.tick();
      await runs.settled();
    }
  };
  try {
    const id = runs.start({
      seed: "m9-software-rehearsal",
      interactive: true,
      evaluate: true,
      durationSeconds: 45,
    }).run.id;
    await runs.settled();
    await advance(5);
    expect(investigationStatus(recordings.investigationHistory(id))).toBe(
      "none",
    );
    runs.control(id, {
      commandId: randomUUID(),
      type: "begin-injection",
      fixture: "credential-compromise",
    });
    probability = 0.95;
    await advance(20);
    runs.control(id, { commandId: randomUUID(), type: "pause" });
    const frozen = recordings.get(id)!;
    expect(investigationStatus(frozen.investigationHistory)).toBe("open");
    expect(frozen.snapshots.at(-1)!.input.focus).not.toBeNull();
    await advance(3);
    expect(recordings.get(id)).toEqual(frozen);
    runs.control(id, { commandId: randomUUID(), type: "resume" });
    outage = true;
    await advance(5);
    expect(recordings.attempts(id).at(-1)?.status).toBe("failed");
    runs.control(id, { commandId: randomUUID(), type: "stop-injection" });
    const before = recordings.get(id)!;
    outage = false;
    probability = 0.05;
    await advance(15);
    const saved = recordings.get(id)!;
    expect(saved.run.status).toBe("completed");
    expect(saved.events.length - before.events.length).toBe(75);
    expect(investigationStatus(saved.investigationHistory)).toBe("open");
    const previousCalls = calls;
    const playback = new PlaybackIndex(saved);
    expect(investigationStatus(playback.at(0).investigationHistory)).toBe(
      "none",
    );
    expect(investigationStatus(playback.at(45000).investigationHistory)).toBe(
      "open",
    );
    expect(calls).toBe(previousCalls);
    const rerun = runs.rerun(id);
    if (rerun.status !== "created") throw new Error("Expected rerun");
    expect(rerun.recording.run.derivation).toMatchObject({ eventsMatch: true });
    const fresh = await runs.reevaluate(id);
    if (fresh.status !== "created") throw new Error("Expected reevaluation");
    expect(recordings.get(id)).toEqual(saved);
    recordings.storage.delete(fresh.recording.run.id);
    recordings.storage.delete(rerun.recording.run.id);
    recordings.storage.delete(id);
    expect(recordings.list(0, 20).total).toBe(0);
  } finally {
    await runs.close();
    database.close();
  }
}, 20000);
