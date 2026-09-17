import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { recordingSchema, runListSchema } from "@blackout/contracts";
import { openDatabase } from "../src/database.js";
import { Recordings } from "../src/recordings.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const credential = "test-only-jev-credential-never-record-this";
const authorization = "test-only-authorization-never-record-this";

async function startBackend(databasePath: string) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/index.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(address.port),
        WEB_ORIGIN: "http://localhost:3000",
        DATABASE_PATH: databasePath,
        LOG_LEVEL: "silent",
        JEV_API_KEY: credential,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout.resume();
  const base = `http://127.0.0.1:${address.port}`;
  async function stop(signal: NodeJS.Signals = "SIGTERM") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.kill(signal);
    try {
      await exited;
    } finally {
      clearTimeout(deadline);
    }
  }
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(`Backend exited: ${stderr}`);
          try {
            return (
              await fetch(`${base}/api/health`, {
                signal: AbortSignal.timeout(500),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        { timeout: 10_000, interval: 50 },
      )
      .toBe(true);
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    stop,
    async start(seed: string, durationSeconds: number) {
      const response = await fetch(`${base}/api/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authorization}`,
        },
        body: JSON.stringify({ seed, durationSeconds }),
      });
      expect(response.status).toBe(201);
      return recordingSchema.parse(await response.json());
    },
    async get(id: string) {
      return recordingSchema.parse(
        await (await fetch(`${base}/api/runs/${id}`)).json(),
      );
    },
    async list() {
      return runListSchema.parse(
        await (await fetch(`${base}/api/runs`)).json(),
      );
    },
  };
}

it("recovers exact committed records after SIGKILL and clean shutdown without resuming generation or recording credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-restart-"));
  const path = join(directory, "recordings.sqlite");
  const processes: Awaited<ReturnType<typeof startBackend>>[] = [];
  try {
    const first = await startBackend(path);
    processes.push(first);
    const completed = await first.start("completed-before-crash", 1);
    await expect
      .poll(async () => (await first.get(completed.run.id)).run.status, {
        timeout: 5000,
      })
      .toBe("completed");
    const savedCompleted = await first.get(completed.run.id);
    const active = await first.start("interrupted-by-crash", 120);
    await expect
      .poll(async () => (await first.get(active.run.id)).run.simulationTimeMs, {
        timeout: 5000,
      })
      .toBeGreaterThan(0);
    await first.stop("SIGKILL");

    // Read the last committed transaction after the process is gone. A final tick
    // can commit between an HTTP read and SIGKILL, so that HTTP read is only a prefix.
    const database = openDatabase(path);
    const committed = new Recordings(database).get(active.run.id)!;
    database.close();
    expect(committed.run.status).toBe("running");
    expect(committed.events.length).toBeGreaterThan(0);

    const second = await startBackend(path);
    processes.push(second);
    const recovered = await second.get(active.run.id);
    expect(recovered.run).toMatchObject({
      ...committed.run,
      status: "interrupted",
      revision: committed.run.revision + 1,
      controls: {
        ...committed.run.controls,
        elapsedWallMs: expect.any(Number),
      },
      endedAt: expect.any(String),
    });
    expect(recovered.events).toEqual(committed.events);
    expect(recovered.commands).toEqual(committed.commands);
    expect(recovered.snapshots).toEqual(committed.snapshots);
    expect(await second.get(completed.run.id)).toEqual(savedCompleted);
    expect((await second.list()).runs.map((run) => run.id)).toEqual([
      active.run.id,
      completed.run.id,
    ]);
    expect((await second.list()).activeRunId).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await second.get(active.run.id)).toEqual(recovered);

    const next = await second.start("after-restart", 120);
    expect([active.run.id, completed.run.id]).not.toContain(next.run.id);
    await second.stop();
    const third = await startBackend(path);
    processes.push(third);
    expect((await third.get(next.run.id)).run.status).toBe("interrupted");
    expect(await third.get(active.run.id)).toEqual(recovered);
    const all = await third.list();
    expect(all.total).toBe(3);
    for (const run of all.runs) {
      const json = JSON.stringify(await third.get(run.id));
      expect(json).not.toContain(credential);
      expect(json).not.toContain(authorization);
      expect(json).not.toContain("JEV_API_KEY");
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      if (!existsSync(path + suffix)) continue;
      const bytes = readFileSync(path + suffix);
      expect(bytes.includes(Buffer.from(credential))).toBe(false);
      expect(bytes.includes(Buffer.from(authorization))).toBe(false);
    }
  } finally {
    for (const backend of processes.reverse()) await backend.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
