import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const execute = promisify(execFile);
const project = `blackout-release-${Date.now()}`;
const apiPort = process.env.BLACKOUT_RELEASE_API_PORT ?? "3201";
const webPort = process.env.BLACKOUT_RELEASE_WEB_PORT ?? "3200";
const apiBase = `http://localhost:${apiPort}`;
const webBase = `http://localhost:${webPort}`;
const environment = {
  ...process.env,
  BLACKOUT_API_PORT: apiPort,
  BLACKOUT_WEB_PORT: webPort,
  JEV_API_KEY: "",
};
const manifest = JSON.parse(
  readFileSync(new URL("../demo/manifest.json", import.meta.url), "utf8"),
);
const checks = [];
let browser;
async function compose(...args) {
  try {
    return await execute(
      "docker",
      ["compose", "--project-name", project, ...args],
      { env: environment, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(
      `Compose ${args.join(" ")} failed: ${error.stderr ?? error.message}`,
    );
  }
}
async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function until(read, matches, description, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (matches(value)) return value;
    } catch {
      /* Reconnect while services restart. */
    }
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}
function passed(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
try {
  console.log(
    `Building isolated release project ${project}; ports ${webPort}/${apiPort}.`,
  );
  await compose("build");
  await compose(
    "run",
    "--rm",
    "--no-deps",
    "server",
    "node",
    "scripts/install-demo.mjs",
  );
  await compose("up", "--wait");
  assert.equal((await api("/api/evaluator")).configured, false);
  const original = await api(`/api/runs/${manifest.runId}`);
  assert.equal(original.run.status, "completed");
  assert(original.attempts.some((attempt) => attempt.status === "succeeded"));
  passed("clean Compose launch, bundled demo and missing-key configuration");
  await assert.rejects(
    compose("exec", "-T", "server", "node", "scripts/install-demo.mjs"),
    /database already exists/,
  );
  passed("demo installer refuses to overwrite recordings");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${webBase}/?run=${manifest.runId}`);
  const timeline = page.getByLabel("Recording timeline");
  await timeline.waitFor();
  await context.setOffline(true);
  await timeline.fill("25000");
  await page
    .getByRole("button", { name: /user .* Suspicious evidence/ })
    .first()
    .waitFor();
  await timeline.fill("95000");
  await until(
    () => page.getByTestId("investigation-status").textContent(),
    (status) => status === "Open",
    "recorded open investigation",
  );
  await context.setOffline(false);
  assert.deepEqual(await api(`/api/runs/${manifest.runId}`), original);
  passed(
    "offline recorded seeking, evidence and unresolved investigation; source unchanged",
  );

  const started = await api("/api/runs", {
    seed: "packaged-interactive",
    interactive: true,
    evaluate: true,
    durationSeconds: 45,
  });
  const id = started.run.id;
  const command = (type, extra = {}) =>
    api(`/api/runs/${id}/commands`, {
      commandId: crypto.randomUUID(),
      type,
      ...extra,
    });
  await page.goto(`${webBase}/?run=${id}`);
  await page
    .getByRole("button", { name: "Simulation & details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .waitFor();
  await until(
    () =>
      page
        .getByRole("button", { name: "Pause simulation", exact: true })
        .isEnabled(),
    Boolean,
    "live socket controls",
  );
  await page.getByLabel("Requested speed").selectOption("5");
  await until(
    () => api(`/api/runs/${id}`),
    (saved) => saved.run.simulationTimeMs >= 5000,
    "baseline",
  );
  await page.getByRole("button", { name: "Begin Attack", exact: true }).click();
  const onset = (await api(`/api/runs/${id}`)).run.simulationTimeMs;
  await until(
    () => api(`/api/runs/${id}`),
    (saved) => saved.run.simulationTimeMs >= onset + 15000,
    "escalation observations",
  );
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();
  const paused = await api(`/api/runs/${id}`);
  await delay(500);
  assert.equal(
    (await api(`/api/runs/${id}`)).run.simulationTimeMs,
    paused.run.simulationTimeMs,
  );
  await page
    .getByRole("button", { name: /user .* Suspicious evidence/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Resume simulation", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop Attack", exact: true }).click();
  const stopped = await api(`/api/runs/${id}`);
  const finished = await until(
    () => api(`/api/runs/${id}`),
    (saved) => saved.run.status === "completed",
    "continued baseline",
  );
  assert.equal(
    finished.events.length - stopped.events.length,
    ((45000 - stopped.run.simulationTimeMs) / 1000) * 5,
  );
  assert(
    finished.attempts.every((attempt) => attempt.error?.code === "unavailable"),
  );
  passed(
    "packaged baseline, begin attack, escalation, pause/inspect/resume, stop and continuing baseline with explicit unavailable inference",
  );

  const retained = await api(`/api/runs/${id}`);
  await compose("restart", "server");
  await until(
    () => api("/api/health"),
    (health) => health.status === "ok",
    "backend restart",
  );
  assert.deepEqual(await api(`/api/runs/${id}`), retained);
  const reset = await command("reset");
  assert.deepEqual((await api(`/api/runs/${id}`)).events, retained.events);
  await page.goto(`${webBase}/?run=${reset.run.id}`);
  await page
    .getByRole("button", { name: "Simulation & details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .waitFor();
  await compose("stop", "server");
  await until(
    () =>
      page
        .getByRole("button", { name: "Pause simulation", exact: true })
        .isDisabled(),
    Boolean,
    "disconnected controls",
  );
  await compose("up", "--wait", "server");
  await page
    .getByText("Interrupted", { exact: true })
    .waitFor({ timeout: 30000 });
  const interrupted = await api(`/api/runs/${reset.run.id}`);
  assert.equal(interrupted.run.status, "interrupted");
  passed(
    "volume persistence, reset retention, backend outage/restart and browser reconnect",
  );

  const rerun = await api(`/api/runs/${manifest.runId}/reruns`, {});
  assert.equal(rerun.recording.run.derivation.eventsMatch, true);
  const fresh = await api(`/api/runs/${manifest.runId}/reevaluations`, {});
  assert(
    fresh.recording.attempts.every(
      (attempt) => attempt.error?.code === "unavailable",
    ),
  );
  assert.deepEqual(await api(`/api/runs/${manifest.runId}`), original);
  const blocked = await fetch(`${apiBase}/api/runs/${manifest.runId}`, {
    method: "DELETE",
  });
  assert.equal(blocked.status, 409);
  for (const remove of [
    rerun.recording.run.id,
    fresh.recording.run.id,
    reset.run.id,
    id,
  ])
    await api(`/api/runs/${remove}`, undefined, "DELETE");
  assert.deepEqual(await api(`/api/runs/${manifest.runId}`), original);
  passed(
    "deterministic rerun, fresh unavailable reevaluation, source protection and selected cleanup",
  );
  assert.deepEqual(errors, []);
  const storage = await api("/api/storage");
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/release-verification.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks,
        storage,
        demo: manifest.runId,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks: checks.length, storage }));
} catch (error) {
  mkdirSync("test-results", { recursive: true });
  const logs = await compose("logs", "--no-color").catch(() => ({
    stdout: "Compose logs unavailable.",
  }));
  writeFileSync(
    "test-results/release-failure.log",
    `${String(error)}\n${logs.stdout}`,
  );
  throw error;
} finally {
  await browser?.close();
  // Only this script's fresh, uniquely named project owns these disposable volumes.
  await compose("down", "--volumes", "--remove-orphans");
}
