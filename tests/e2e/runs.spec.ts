import { expect, test, type Page } from "@playwright/test";
import { recordingSchema, type JevResponse } from "@blackout/contracts";
import { evaluatePolicy } from "../../apps/server/src/policy.js";

test.describe.configure({ mode: "serial" });
async function seekToEnd(page: Page) {
  const timeline = page.getByLabel("Recording timeline");
  await expect(timeline).toBeVisible();
  await timeline.fill((await timeline.getAttribute("max"))!);
}

test("records unavailable Jev attempts and inspects saved model and policy evidence", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Seed", { exact: true }).fill("browser-jev");
  await page.getByLabel("Duration (simulation seconds)").fill("1");
  await page.getByLabel("Evaluate with Jev (uses API credits)").check();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("No successful decision yet. Risk is unknown."),
  ).toBeVisible();
  await page
    .getByLabel("Decision Inspector", { exact: true })
    .selectOption({ label: "0s · attempt 1 · failed" });
  await page
    .getByText("Exact request: questions and observable state", { exact: true })
    .click();
  await expect(
    page.locator("details[open] pre").filter({ hasText: '"compromise"' }),
  ).toContainText('"type": "noul"');
  await page
    .getByText("Application policy: unevaluable", { exact: true })
    .click();
  await expect(
    page.getByText("severity >= 2 (0–3):", { exact: false }),
  ).toContainText("Unevaluable");

  const id = (await page.getByTestId("run-id").textContent())!;
  const saved = recordingSchema.parse(
    await (await request.get(`http://localhost:3101/api/runs/${id}`)).json(),
  );
  const attempt = saved.attempts[0]!;
  const response: JevResponse = {
    model: "jev-ui-test",
    answers: {
      compromise: { type: "noul", noul: 0.85 },
      classification: {
        type: "choice",
        choice: "compromise",
        confidence: 0.9,
        probabilities: {
          normal: 0,
          benign_anomaly: 0,
          suspicious: 0.05,
          compromise: 0.95,
        },
      },
      severity: {
        type: "score",
        score: 2,
        probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
        legend: Object.fromEntries(
          attempt.request.questions.severity.criteria.map((value, index) => [
            String(index),
            value,
          ]),
        ),
        confidence: 1,
      },
      response: {
        type: "choice",
        choice: "escalate",
        confidence: 1,
        probabilities: { observe: 0, investigate: 0, escalate: 1 },
      },
    },
  };
  // Browser-only fixture: real transport/persistence is verified in integration tests and the live smoke run.
  saved.attempts[0] = {
    ...attempt,
    status: "succeeded",
    error: null,
    response,
    responseBody: JSON.stringify(response),
    policy: evaluatePolicy(response),
  };
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({ json: saved }),
  );
  await page.reload();
  await seekToEnd(page);
  await expect(
    page.getByLabel("Decision Inspector", { exact: true }),
  ).toHaveValue(attempt.id);
  await expect(page.getByText("85.0%", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Last successful decision:", { exact: false }),
  ).toContainText("Snapshot age: 0.0 simulation seconds");
  await page
    .getByText("Application policy: incident_advisory", { exact: true })
    .click();
  await expect(
    page.getByText("compromise probability >= 0.8:", { exact: false }),
  ).toContainText("Matched");
  await page
    .getByText("Model response and distributions", { exact: true })
    .click();
  await expect(
    page.locator("details[open] pre").filter({ hasText: '"jev-ui-test"' }),
  ).toContainText('"confidence": 0.9');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByLabel("Decision Inspector", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("starts, watches, reloads and inspects isolated seeded recordings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Seed", { exact: true }).fill("browser-demo");
  await page.getByLabel("Duration (simulation seconds)").fill("3");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeDisabled();
  const firstUrl = page.url();
  const firstId = await page.getByTestId("run-id").textContent();
  await expect(
    page.getByRole("button", { name: `Inspect run ${firstId}` }),
  ).toBeVisible();
  await expect(page.getByTestId("event-count")).toHaveText("4515");
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await seekToEnd(page);
  await expect(page.getByTestId("simulation-time")).toHaveText("3.0 / 3 s");
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  const firstEvents = await page.getByTestId("event-row").allInnerTexts();
  await page.getByText("Manifest and command log", { exact: true }).click();
  await expect(
    page
      .locator("details")
      .filter({
        has: page.getByText("Manifest and command log", { exact: true }),
      })
      .locator("pre"),
  ).toContainText('"seed": "browser-demo"');
  await expect(
    page
      .locator("details")
      .filter({
        has: page.getByText("Manifest and command log", { exact: true }),
      })
      .locator("pre"),
  ).toContainText('"type": "start"');
  await page.reload();
  await seekToEnd(page);
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  expect(await page.getByTestId("event-row").allInnerTexts()).toEqual(
    firstEvents,
  );

  await page.getByLabel("Seed", { exact: true }).fill("browser-demo");
  await page.getByLabel("Duration (simulation seconds)").fill("3");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByTestId("run-id")).not.toHaveText(firstId!);
  const secondId = await page.getByTestId("run-id").textContent();
  await page.getByRole("button", { name: `Inspect run ${firstId}` }).click();
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await expect(
    page.getByText("Viewing saved events.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "View active run" }).click();
  await expect(page.getByTestId("run-id")).toHaveText(secondId!);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await seekToEnd(page);
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  expect(await page.getByTestId("event-row").allInnerTexts()).toEqual(
    firstEvents,
  );
  await page.goto(firstUrl);
  await seekToEnd(page);
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  await page.getByRole("button", { name: `Inspect run ${secondId}` }).click();
  await expect(page.getByTestId("run-id")).toHaveText(secondId!);
  await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Inspect run ${firstId}` }).click();
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await seekToEnd(page);

  await page.route("**/api/runs?*", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh runs", exact: true }).click();
  await expect(
    page.getByText("Could not load stored runs.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await page.unroute("**/api/runs?*");
  await page.getByRole("button", { name: "Refresh runs", exact: true }).click();
  await expect(
    page.getByText("Could not load stored runs.", { exact: false }),
  ).not.toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "recording_unavailable",
        message:
          "Recording storage is unavailable. Check the backend and retry.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Recording storage" }),
  ).toContainText("Recording storage is unavailable");
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  await page.unroute("**/api/runs");
  await page.goto("/?run=c1f40c25-3d9a-416c-ad1b-bb88db21977c");
  await expect(
    page.getByText("This recording was not found.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to run setup" }).click();
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("No run selected.", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("inspects organization history, held snapshot evidence and both comparison fixtures", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Seed", { exact: true }).fill("m2-browser");
  await page.getByLabel("Duration (simulation seconds)").fill("9");
  await page.getByLabel("Comparison fixture").selectOption("credential-attack");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(
    page.getByText("32 users · 16 hosts · 6 resources"),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Snapshot", exact: true })
    .selectOption("snapshot-000001");
  await page
    .getByRole("button", { name: "Authentication attempts", exact: false })
    .click();
  await expect(page.getByTestId("window-boundary")).toContainText(
    "(-10 s, 0 s]",
  );
  await expect(page.getByTestId("evidence-row")).toHaveCount(18);
  await expect(page.getByTestId("evidence-row").first()).toContainText(
    "Warm-up",
  );
  await page.getByLabel("Rolling window").selectOption("900000");
  await expect(page.getByTestId("window-boundary")).toContainText(
    "(-900 s, 0 s]",
  );
  await expect(page.getByTestId("evidence-row")).toHaveCount(50);
  await page
    .getByRole("button", { name: "Next Contributing observations" })
    .click();
  await expect(page.getByText("51–100 of 1798 observations")).toBeVisible();
  await page.getByRole("button", { name: "Inspect identity history" }).click();
  await expect(page.getByLabel("Activity period")).toHaveValue("warmup");
  await expect(
    page.getByRole("combobox", { name: "Entity", exact: true }),
  ).toHaveValue("user-001");
  await expect(page.getByTestId("event-row").first()).toContainText("user-001");
  await expect(page.getByTestId("event-row").first()).toContainText("Warm-up");
  await page.getByLabel("Host profile").selectOption("host-013");
  await page.getByRole("button", { name: "Inspect host history" }).click();
  await expect(
    page.getByRole("combobox", { name: "Entity", exact: true }),
  ).toHaveValue("host-013");
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await seekToEnd(page);
  await page
    .getByRole("button", { name: "Return to playback", exact: true })
    .click();
  await expect(page.getByTestId("window-boundary")).toContainText(
    "snapshot-000010",
  );
  await page
    .getByRole("combobox", { name: "Snapshot", exact: true })
    .selectOption("latest");
  await page.getByLabel("Rolling window").selectOption("10000");
  await page
    .getByRole("button", {
      name: "Unfamiliar device observations",
      exact: false,
    })
    .click();
  await expect(page.getByTestId("evidence-row")).toHaveCount(24);
  await page.getByRole("button", { name: "Inspect focus evidence" }).click();
  await expect(page.getByTestId("evidence-title")).toContainText(
    "Focus evidence",
  );
  await page.getByText("Allowlisted evaluator input", { exact: true }).click();
  const payload = JSON.parse(
    (await page.getByTestId("evaluator-input").textContent())!,
  );
  expect(Object.keys(payload).sort()).toEqual([
    "focus",
    "focusActivity",
    "schemaVersion",
    "simulationTimeMs",
    "windows",
  ]);
  expect(payload.focus.deviations).toBe(72);
  await page
    .getByText("Scenario metadata (excluded from model input)", { exact: true })
    .click();
  await page.route("**/truth", (route) => route.abort());
  await page.getByRole("button", { name: "Load recorded truth" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load scenario metadata" }),
  ).toBeVisible();
  await page.unroute("**/truth");
  await page.getByRole("button", { name: "Load recorded truth" }).click();
  await expect(
    page.getByText('"interpretation": "credential-misuse"', { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Activity period").selectOption("live");
  await page
    .getByRole("combobox", { name: "Entity", exact: true })
    .selectOption("all");
  for (const type of ["authentication", "host-metric", "dns", "network"]) {
    await page.getByLabel("Event type").selectOption(type);
    await expect(page.getByTestId("event-row").first()).toContainText(type);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const attackId = await page.getByTestId("run-id").textContent();
  await page.getByLabel("Comparison fixture").selectOption("harmless-anomaly");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByTestId("run-id")).not.toHaveText(attackId!);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await seekToEnd(page);
  await page
    .getByRole("button", {
      name: "Unfamiliar device observations",
      exact: false,
    })
    .click();
  await expect(page.getByTestId("evidence-row")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Network bytes sent", exact: false }),
  ).toContainText(/64,/);
  await page.getByRole("button", { name: "Inspect focus evidence" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("evidence-title")).toContainText(
    "Focus evidence",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("launches the full sequence, inspects second-host evidence and retains unavailable decline measurements", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Comparison fixture")
    .selectOption("credential-compromise");
  await expect(page.getByLabel("Duration (simulation seconds)")).toHaveValue(
    "95",
  );
  await expect(
    page.getByText("With default settings, this run uses", { exact: false }),
  ).toContainText("20 requests");
  await page.getByLabel("Duration (simulation seconds)").fill("40");
  await page.getByLabel("Evaluate with Jev (uses API credits)").check();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await seekToEnd(page);
  const id = (await page.getByTestId("run-id").textContent())!;
  const saved = recordingSchema.parse(
    await (await request.get(`http://localhost:3101/api/runs/${id}`)).json(),
  );
  if (saved.run.manifest.schemaVersion !== 2)
    throw new Error("Expected telemetry run");
  const secondHost = saved.run.manifest.scenario!.secondHostId;
  expect(saved.commands.map((command) => command.type)).toEqual([
    "start",
    "begin-injection",
    "stop-injection",
  ]);
  await page.getByText("Manifest and command log", { exact: true }).click();
  await expect(
    page.locator("pre").filter({ hasText: '"stop-injection"' }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Snapshot", exact: true })
    .selectOption("snapshot-000031");
  await page
    .getByText("Focus activity: authentication, DNS and network", {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("table", { name: "Focus activity observations" }),
  ).toContainText(secondHost);
  await expect(
    page.getByRole("table", { name: "Focus activity observations" }),
  ).toContainText("445");
  await expect(
    page.getByText("No successful decision yet. Risk is unknown."),
  ).toBeVisible();
  const response = await request.post(
    "http://localhost:3101/api/evaluation-reports",
    { data: { runIds: [id] } },
  );
  expect(response.status()).toBe(201);
  await page.getByText(/Model evaluation reports \(/).click();
  await page.getByRole("button", { name: "Refresh reports" }).click();
  await page.getByText(/1 runs · scenario-metrics\/1/).click();
  await page.getByText(/Decisions: credential-compromise/).click();
  await expect(
    page.getByText("Compromise probability:", { exact: false }),
  ).toContainText("Unknown before stop → Unknown at run end");
  await expect(
    page.getByText("Post-stop responses:", { exact: false }),
  ).toContainText("0 / 2");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByLabel("Comparison fixture")
    .selectOption("benign-maintenance");
  await expect(page.getByLabel("Duration (simulation seconds)")).toHaveValue(
    "95",
  );
  await page.getByLabel("Duration (simulation seconds)").fill("6");
  await page.getByLabel("Evaluate with Jev (uses API credits)").uncheck();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByTestId("run-id")).not.toHaveText(id);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test("controls an interactive run, retries a lost acknowledgement and recovers stream gaps and disconnected reset", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  let disconnect: (() => void) | undefined;
  let connections = 0;
  let dropOne = false;
  let duplicateOne = false;
  let holdConnection = false;
  await page.routeWebSocket(/\/ws\?runId=/, (ws) => {
    connections++;
    const server = ws.connectToServer();
    disconnect = () => {
      ws.close();
      server.close();
    };
    server.onMessage((message) => {
      if (holdConnection) return;
      const parsed = JSON.parse(String(message));
      if (dropOne && parsed.type === "run.updated" && parsed.events.length) {
        dropOne = false;
        return;
      }
      ws.send(message);
      if (duplicateOne && parsed.type === "run.updated") {
        duplicateOne = false;
        ws.send(message);
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("Interactive mode", { exact: false }).check();
  await page.getByLabel("Duration (simulation seconds)").fill("20");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await expect(pause).toBeEnabled();
  const original = (await page.getByTestId("run-id").textContent())!;
  await pause.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  const frozenTime = await page.getByTestId("simulation-time").textContent();
  const frozenEvents = await page.getByTestId("event-count").textContent();
  await page
    .getByRole("combobox", { name: "Requested speed", exact: true })
    .selectOption("5");
  await page.getByRole("button", { name: "Begin Attack", exact: true }).click();
  await expect(
    page.getByText("Injecting attack activity", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("simulation-time")).toHaveText(frozenTime!);
  await expect(page.getByTestId("event-count")).toHaveText(frozenEvents!);
  await page.getByRole("button", { name: "Stop Attack", exact: true }).click();
  await expect(
    page.getByText("Normal mode — baseline telemetry", { exact: true }),
  ).toBeVisible();

  // Commit the command but lose its HTTP acknowledgement. Retrying reuses its ID.
  let loseOnce = true;
  await page.route(`**/api/runs/${original}/commands`, async (route) => {
    if (loseOnce && route.request().postDataJSON().type === "resume") {
      loseOnce = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  duplicateOne = true;
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry unconfirmed command" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Retry unconfirmed command" }).click();
  await expect(pause).toBeEnabled();
  await pause.click();
  const saved = recordingSchema.parse(
    await (
      await request.get(`http://localhost:3101/api/runs/${original}`)
    ).json(),
  );
  expect(saved.commands.filter((c) => c.type === "resume")).toHaveLength(1);
  await page.unroute(`**/api/runs/${original}/commands`);

  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Requested speed", exact: true }),
  ).toHaveValue("5");
  const beforeGap = connections;
  dropOne = true;
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(() => connections).toBeGreaterThan(beforeGap);
  await expect(pause).toBeEnabled();
  await pause.click();

  holdConnection = true;
  disconnect!();
  await expect(
    page.getByText(/^(Disconnected|Resynchronizing)$/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeDisabled();
  const reset = recordingSchema.parse(
    await (
      await request.post(
        `http://localhost:3101/api/runs/${original}/commands`,
        { data: { commandId: crypto.randomUUID(), type: "reset" } },
      )
    ).json(),
  );
  await request.post(
    `http://localhost:3101/api/runs/${reset.run.id}/commands`,
    { data: { commandId: crypto.randomUUID(), type: "pause" } },
  );
  holdConnection = false;
  await expect(
    page.getByText("Reset ended this run.", { exact: false }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "View active run" }).click();
  await expect(page.getByTestId("run-id")).toHaveText(reset.run.id);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Requested speed", exact: true }),
  ).toHaveValue("1");
  await expect(page.getByTestId("event-count")).toHaveText("4500");
  await page.getByRole("button", { name: "Reset run", exact: true }).click();
  await expect(page.getByTestId("run-id")).not.toHaveText(reset.run.id);
  await expect(pause).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Requested speed", exact: true })
    .selectOption("5");
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  expect(errors).toEqual([]);
});
test("plays, seeks, reproduces and reevaluates a saved recording", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start run", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Seed", { exact: true }).fill("m7-browser");
  await page.getByLabel("Duration (simulation seconds)").fill("2");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  const sourceId = await page.getByTestId("run-id").textContent();
  await page.reload();

  await expect(
    page.getByText("Recorded playback · offline · simulation read-only", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Paused at 0.0 s", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("event-row")).toHaveCount(0);
  await page.getByRole("button", { name: "+10 seconds" }).click();
  await expect(
    page.getByText("Paused at 2.0 s", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("event-row")).toHaveCount(10);
  await page.getByLabel("Recording timeline").fill("0");
  await expect(page.getByTestId("event-row")).toHaveCount(0);
  await page.getByLabel("Recording timeline").fill("2000");
  await expect(page.getByTestId("event-row")).toHaveCount(10);

  await page.getByRole("button", { name: "Reproduce telemetry" }).click();
  await expect(
    page.getByRole("heading", { name: "Deterministic telemetry rerun" }),
  ).toBeVisible();
  await expect(page.getByTestId("rerun-comparison")).toContainText(
    "Full telemetry match",
  );
  await expect(page.getByTestId("run-id")).not.toHaveText(sourceId!);
  await page.getByRole("button", { name: "View source recording" }).click();
  await expect(page.getByTestId("run-id")).toHaveText(sourceId!);

  await page.getByRole("button", { name: "Reevaluate with Jev" }).click();
  await expect(
    page.getByRole("heading", { name: "Fresh Jev reevaluation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Original and fresh outcomes" }),
  ).toBeVisible();
  await expect(page.getByText("Failed: unavailable").first()).toBeVisible();
  await expect(
    page.getByText("Playback sends zero Jev requests", { exact: false }),
  ).toBeVisible();
});
