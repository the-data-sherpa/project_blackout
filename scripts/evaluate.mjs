import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluationReportSchema, recordingSchema } from "@blackout/contracts";

const flags = process.argv.slice(2);
if (flags.some((flag) => !["--smoke", "--m4", "--speed=5"].includes(flag)))
  throw new Error("Usage: npm run evaluate [-- --m4] [--smoke] [--speed=5]");
const base = process.env.BLACKOUT_API_URL ?? "http://localhost:3001";
async function api(path, body) {
  const response = await fetch(new URL(path, base), {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `BLACKOUT returned HTTP ${response.status} for ${path}. Check the backend and stored runs.`,
    );
  return response.json();
}
const evaluator = await api("/api/evaluator");
if (!evaluator.configured)
  throw new Error(
    "Set JEV_API_KEY on the backend and restart it before running the real-API suite.",
  );
if ((await api("/api/runs/active")).runId)
  throw new Error(
    "Wait for the active run to complete before starting the suite.",
  );
const smoke = flags.includes("--smoke");
const m4 = flags.includes("--m4");
const seeds = m4
  ? smoke
    ? ["m4-smoke-001"]
    : ["m4-001", "m4-002", "m4-003"]
  : smoke
    ? ["m3-smoke-001"]
    : ["m3-001", "m3-002", "m3-003"];
const fixtures = m4
  ? smoke
    ? ["credential-compromise"]
    : ["baseline", "credential-compromise", "benign-maintenance"]
  : smoke
    ? ["credential-attack"]
    : ["baseline", "credential-attack", "harmless-anomaly"];
const durationSeconds = m4 ? 95 : smoke ? 6 : 20;
const checkpoints =
  Math.ceil((durationSeconds * 1000) / evaluator.config.checkpointMs) + 1;
console.log(
  `Real Jev evaluation: ${seeds.length * fixtures.length} runs, at most ${checkpoints * seeds.length * fixtures.length * evaluator.config.maxAttempts} requests. Model: ${evaluator.model}.`,
);
const runIds = [];
for (const seed of seeds) {
  for (const fixture of fixtures) {
    let recording = recordingSchema.parse(
      await api("/api/runs", {
        seed,
        fixture,
        durationSeconds,
        evaluate: true,
        ...(m4 && fixture !== "baseline" ? { stopInjectionAtSeconds: 35 } : {}),
      }),
    );
    const id = recording.run.id;
    runIds.push(id);
    console.log(`${fixture} ${seed}: ${id}`);
    if (flags.includes("--speed=5")) {
      recording = recordingSchema.parse(
        await api(`/api/runs/${id}/commands`, {
          commandId: crypto.randomUUID(),
          type: "set-speed",
          speed: 5,
        }),
      );
    }
    const budgetMs =
      durationSeconds * 1000 +
      checkpoints *
        (evaluator.config.maxAttempts *
          (evaluator.config.timeoutMs + evaluator.config.retryDelayMs) +
          2000) +
      60_000;
    const deadline = Date.now() + budgetMs;
    while (recording.run.status === "running") {
      if (Date.now() > deadline)
        throw new Error(
          `Run ${id} exceeded the suite wait budget. Its recording is retained; inspect the backend before continuing.`,
        );
      await delay(1000);
      recording = recordingSchema.parse(await api(`/api/runs/${id}`));
    }
    if (recording.run.status !== "completed")
      throw new Error(
        `Run ${id} ended ${recording.run.status}. Prior runs are retained.`,
      );
    console.log(
      `  ${recording.attempts.filter((attempt) => attempt.status === "succeeded").length} successful attempts / ${recording.attempts.length}; failures retained.`,
    );
  }
}
const report = evaluationReportSchema.parse(
  await api("/api/evaluation-reports", { runIds }),
);
const directory = resolve("data/evaluations");
await mkdir(directory, { recursive: true });
const filename = resolve(directory, `${report.id}.json`);
await writeFile(filename, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  `Saved report ${report.id} in backend SQLite and ${filename}. Open Model evaluation reports in the console.`,
);
const failures = report.runs.reduce(
  (sum, run) => sum + run.failedCheckpoints,
  0,
);
console.log(
  `Failed checkpoints: ${failures}. Attack outcomes: ${report.runs
    .filter(
      (run) =>
        run.fixture === "credential-attack" ||
        run.fixture === "credential-compromise",
    )
    .map((run) => `${run.seed}=${run.attackOutcome}`)
    .join(", ")}.`,
);
// Software/API failures fail the command. A real model miss is a report outcome, not a software failure.
if (failures) process.exitCode = 1;
