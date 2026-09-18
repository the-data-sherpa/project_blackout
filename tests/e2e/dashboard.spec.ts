import { expect, test, type Page } from "@playwright/test";
import { recordingSchema, type JevResponse } from "@blackout/contracts";
import { buildApp } from "../../apps/server/src/app.js";
import { defaultEvaluation } from "../../apps/server/src/evaluator.js";

const model = (compromised: boolean, confidence = true): JevResponse => ({
  model: "dashboard-controlled-response",
  answers: {
    compromise: { type: "noul", noul: compromised ? 0.9 : 0.1 },
    classification: {
      type: "choice",
      choice: compromised ? "compromise" : "normal",
      ...(confidence ? { confidence: 0.9 } : {}),
      probabilities: {
        normal: compromised ? 0 : 1,
        benign_anomaly: 0,
        suspicious: 0,
        compromise: compromised ? 1 : 0,
      },
    },
    severity: {
      type: "score",
      score: compromised ? 2 : 0,
      probabilities: {
        "0": compromised ? 0 : 1,
        "1": 0,
        "2": compromised ? 1 : 0,
        "3": 0,
      },
      legend: { "0": "none", "1": "low", "2": "high", "3": "critical" },
    },
    response: {
      type: "choice",
      choice: compromised ? "escalate" : "observe",
      probabilities: {
        observe: compromised ? 0 : 1,
        investigate: 0,
        escalate: compromised ? 1 : 0,
      },
    },
  },
});

async function connect(page: Page, app: Awaited<ReturnType<typeof buildApp>>) {
  const mutations: string[] = [];
  await page.route("http://localhost:3101/**", async (route) => {
    const request = route.request();
    const address = new URL(request.url());
    if (request.method() !== "GET") mutations.push(address.pathname);
    const response = await app.inject({
      method: request.method() === "POST" ? "POST" : "GET",
      url: address.pathname + address.search,
      ...(request.postData()
        ? {
            payload: request.postData()!,
            headers: { "content-type": "application/json" },
          }
        : {}),
    });
    await route.fulfill({
      status: response.statusCode,
      contentType: "application/json",
      body: response.body,
    });
  });
  await page.routeWebSocket(/\/ws/, async (ws) => {
    const address = new URL(ws.url());
    const socket = await app.injectWS(
      address.pathname + address.search,
      { headers: { origin: "http://localhost:3100" } },
      {
        onInit: (client) =>
          client.on("message", (message) => ws.send(String(message))),
      },
    );
    ws.onClose(() => socket.terminate());
  });
  return mutations;
}

test("operates the compact workspace and traces held, applied, missing-confidence and failed judgments", async ({
  page,
  context,
}) => {
  let tick = () => {};
  let calls = 0;
  let held!: (response: Response) => void;
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3100",
    schedule: (step) => {
      tick = step;
      return () => {};
    },
    evaluator: {
      apiKey: "test-only",
      config: { ...defaultEvaluation, maxAttempts: 1 },
      fetch: async () => {
        calls++;
        if (calls === 2)
          return new Promise<Response>((resolve) => {
            held = resolve;
          });
        if (calls === 5) return Response.json({ invalid: true });
        return Response.json(model(calls > 1, calls !== 4));
      },
    },
  });
  try {
    const mutations = await connect(page, app);
    await page.goto("/");
    await page.getByLabel("Seed", { exact: true }).fill("integrated-dashboard");
    await page.getByLabel("Interactive mode", { exact: false }).check();
    await page.getByLabel("Duration (simulation seconds)").fill("21");
    await page.getByLabel("Evaluate with Jev", { exact: false }).check();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByTestId("pipeline-evaluation")).toHaveText(
      "Successful / applied",
    );
    const id = (await page.getByTestId("run-id").textContent())!;
    const read = async () =>
      recordingSchema.parse((await app.inject(`/api/runs/${id}`)).json());
    const graph = page.getByTestId("processing-zone");
    await page
      .getByRole("button", { name: "Expand decision path", exact: true })
      .click();
    await expect(
      graph.getByRole("button", { name: /compromise probability >= 0.8/ }),
    ).toContainText("Not matched");
    await graph
      .getByRole("button", { name: /classification confidence >= 0.75/ })
      .click();
    await expect(
      page.getByRole("region", { name: "Decision path detail" }),
    ).toContainText('"classificationConfidence": 0.9');
    await page.getByRole("button", { name: "Close node detail" }).click();
    await page
      .getByRole("button", { name: "Simulation & details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Begin Attack", exact: true })
      .click();
    await page.getByLabel("Requested speed").selectOption("2");
    for (let i = 0; i < 5; i++) tick();
    await expect(page.getByTestId("pipeline-evaluation")).toHaveText("Pending");
    await page
      .getByRole("button", { name: "Pause simulation", exact: true })
      .click();
    held(Response.json(model(true)));
    await expect(page.getByTestId("pipeline-evaluation")).toHaveText(
      "Received / held until application",
    );
    await expect(page.getByTestId("pipeline-telemetry")).toContainText(
      "simulation paused",
    );
    await expect(graph).toContainText("Received / held — not applied");
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByRole("button", { name: "Copy inspection link", exact: true })
      .click();
    const heldLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(heldLink).searchParams.has("decision")).toBe(false);
    await page
      .getByRole("button", { name: "Resume simulation", exact: true })
      .click();
    await expect(page.getByTestId("investigation-status")).toHaveText("Open");
    await expect(graph).toContainText("opened at 5 s");
    await page
      .getByRole("button", { name: "Acknowledge investigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close investigation", exact: true })
      .click();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Closed by operator",
    );
    for (let i = 0; i < 5; i++) tick();
    await expect(page.getByTestId("investigation-status")).toHaveText("Open");
    await expect(graph).toContainText("reopened at 10 s");
    await page
      .getByRole("button", { name: "Stop Attack", exact: true })
      .click();
    await expect(page.getByTestId("investigation-status")).toHaveText("Open");
    for (let i = 0; i < 5; i++) tick();
    await expect(
      graph.getByRole("button", { name: /classification confidence >= 0.75/ }),
    ).toContainText("Unevaluable");
    for (let i = 0; i < 5; i++) tick();
    await expect(page.getByTestId("pipeline-evaluation")).toContainText(
      "Failed / unavailable",
    );
    await expect(page.getByTestId("pipeline-evaluation")).toContainText(
      "prior success retained, stale",
    );
    await expect(
      graph.getByRole("button", { name: /Compromise probability Failed/ }),
    ).toBeVisible();
    await expect(page.getByTestId("judgment-compromise")).toContainText(
      "90.0%",
    );
    const saved = await read();
    expect(saved.investigationHistory.map((event) => event.type)).toEqual([
      "opened",
      "acknowledged",
      "closed",
      "reopened",
    ]);
    expect(saved.commands.map((command) => command.type)).toEqual([
      "start",
      "begin-injection",
      "set-speed",
      "pause",
      "resume",
      "stop-injection",
    ]);
    const before = mutations.length;
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(saved.attempts[1]!.id);
    await expect(graph).toContainText("opened at 5 s");
    await expect(page.getByTestId("inspected-health")).toContainText(
      "Successful / applied",
    );
    await expect(page.getByTestId("pipeline-evaluation")).toContainText(
      "Failed / unavailable",
    );
    await graph.getByRole("button", { name: /Recorded events/ }).click();
    await page
      .getByRole("button", { name: "Open recorded members", exact: true })
      .click();
    await expect(
      page.getByLabel("Through time (simulation seconds)"),
    ).toHaveValue("5");
    await expect(page.getByLabel("Activity period")).toHaveValue("all");
    await page.goto(heldLink);
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    await expect(page.getByTestId("inspected-health")).toContainText(
      "Received / held",
    );
    await page
      .getByRole("button", { name: "Inspect latest attempt", exact: true })
      .click();
    await expect(page.getByText(/Received but not applied\./)).toBeVisible();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    await page.goto(heldLink);
    await page
      .getByRole("button", { name: "Expand decision path", exact: true })
      .click();
    await graph
      .getByRole("button", { name: /Compromise probability 90/ })
      .click();
    await page
      .getByRole("button", { name: "Open full inspector", exact: true })
      .click();
    await expect(page.getByText(/Received but not applied\./)).toBeVisible();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    expect(mutations).toHaveLength(before);
    expect(calls).toBe(5);
  } finally {
    await page.close();
    await app.close();
  }
});

test("copies and restores exact event filters, selections and checkpoints across refresh and navigation", async ({
  page,
  context,
}) => {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3100",
    schedule: (step) => {
      tick = step;
      return () => {};
    },
  });
  try {
    const started = recordingSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: {
            seed: "inspection-links",
            durationSeconds: 120,
            fixture: "credential-compromise",
          },
        })
      ).json(),
    );
    for (let i = 0; i < 120; i++) tick();
    const saved = recordingSchema.parse(
      (await app.inject(`/api/runs/${started.run.id}`)).json(),
    );
    const selected = saved.events.findLast(
      (event) =>
        event.type === "host-metric" && event.simulationTimeMs <= 60_000,
    )!;
    expect(selected.sequence).toBeGreaterThan(50);
    const mutations = await connect(page, app);
    await page.goto(`/?run=${saved.run.id}`);
    await page.getByLabel("Recording timeline").fill("60000");
    await page.getByLabel("Search recorded events").fill(selected.hostId);
    expect(new URL(page.url()).searchParams.get("time")).toBe("60000");
    await page.reload();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 60.0 s",
    );
    await expect(page.getByLabel("Search recorded events")).toHaveValue(
      selected.hostId,
    );
    await page.goto(
      `/?run=${saved.run.id}&time=60000&entity=${selected.hostId}&event=${selected.sequence}&q=${selected.hostId}&type=host-metric&period=all&from=-15&through=60&view=1`,
    );
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 60.0 s",
    );
    await expect(page.getByLabel("Entity", { exact: true })).toHaveValue(
      selected.hostId,
    );
    await expect(page.getByLabel("Search recorded events")).toHaveValue(
      selected.hostId,
    );
    await expect(page.getByLabel("From time (simulation seconds)")).toHaveValue(
      "-15",
    );
    await expect(
      page.getByLabel("Through time (simulation seconds)"),
    ).toHaveValue("60");
    await expect(page.getByTestId("selected-event")).toContainText(
      String(selected.sequence),
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByRole("button", { name: "Copy inspection link", exact: true })
      .click();
    await expect(
      page.getByText("Inspection link copied.", { exact: true }),
    ).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).searchParams.get("time")).toBe("60000");
    await page
      .getByRole("button", { name: "Clear all event filters", exact: true })
      .click();
    await expect(page.getByLabel("Entity", { exact: true })).toHaveValue("all");
    await page.goBack();
    await expect(page.getByLabel("Search recorded events")).toHaveValue(
      selected.hostId,
    );
    await page.goForward();
    await expect(page.getByLabel("Search recorded events")).toHaveValue("");
    await page.goto(copied);
    await page.reload();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 60.0 s",
    );
    await expect(page.getByTestId("selected-event")).toContainText(
      String(selected.sequence),
    );
    await expect(
      page.getByText("Paused at 60.0 s", { exact: true }),
    ).toBeVisible();
    await page.goto(
      `/?run=${saved.run.id}&time=5000&event=${selected.sequence}`,
    );
    await expect(
      page.getByText(/linked event is unavailable at this cursor/),
    ).toBeVisible();
    await expect(page.getByTestId("selected-event")).toHaveCount(0);
    await page.goto(`/?run=${saved.run.id}&time=999999`);
    await expect(
      page.getByText(/linked checkpoint is outside this recording/),
    ).toBeVisible();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 0.0 s",
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async () => {
            throw new Error("Denied");
          },
        },
        configurable: true,
      });
    });
    await page
      .getByRole("button", { name: "Copy inspection link", exact: true })
      .click();
    await expect(
      page.getByLabel("Inspection link", { exact: true }),
    ).toBeVisible();
    expect(mutations).toHaveLength(0);
  } finally {
    await page.close();
    await app.close();
  }
});

test("opens a historical judgment link while live simulation continues and preserves judgment selection", async ({
  page,
}) => {
  let tick = () => {};
  let calls = 0;
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3100",
    schedule: (step) => {
      tick = step;
      return () => {};
    },
    evaluator: {
      apiKey: "test-only",
      fetch: async () => {
        calls++;
        return Response.json(model(true));
      },
    },
  });
  try {
    const started = recordingSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { seed: "live-link", durationSeconds: 15, evaluate: true },
        })
      ).json(),
    );
    const read = async () =>
      recordingSchema.parse(
        (await app.inject(`/api/runs/${started.run.id}`)).json(),
      );
    await expect
      .poll(async () => (await read()).run.controls!.waitingForInference)
      .toBe(false);
    const first = (await read()).attempts[0]!;
    const mutations = await connect(page, app);
    await page.goto(
      `/?run=${started.run.id}&decision=${first.id}&judgment=severity`,
    );
    await expect(
      page.getByTestId("judgment-severity").getByRole("button"),
    ).toHaveAttribute("aria-pressed", "true");
    for (let i = 0; i < 5; i++) tick();
    await expect(page.getByTestId("newer-assessments")).toContainText(
      "1 newer applied assessments",
    );
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 0.0 s",
    );
    await page.reload();
    await expect(
      page.getByTestId("judgment-severity").getByRole("button"),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Return to live", exact: true })
      .click();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Following live · 5.0 s",
    );
    expect(new URL(page.url()).searchParams.has("decision")).toBe(false);
    expect(new URL(page.url()).searchParams.has("time")).toBe(false);
    expect((await read()).run.controls!.paused).toBe(false);
    expect(mutations).toHaveLength(0);
    expect(calls).toBe(2);
  } finally {
    await page.close();
    await app.close();
  }
});

test("resynchronizes a full 128-entry stream queue before enabling live controls", async ({
  page,
}) => {
  let tick = () => {};
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3100",
    schedule: (step) => {
      tick = step;
      return () => {};
    },
  });
  try {
    const started = recordingSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { seed: "stream-backpressure", durationSeconds: 120 },
        })
      ).json(),
    );
    await connect(page, app);
    let connections = 0;
    let burst = () => {};
    await page.routeWebSocket(/\/ws/, async (ws) => {
      connections++;
      const address = new URL(ws.url());
      const socket = await app.injectWS(
        address.pathname + address.search,
        { headers: { origin: "http://localhost:3100" } },
        {
          onInit: (client) =>
            client.on("message", (data) => {
              const message = String(data);
              ws.send(message);
              if (JSON.parse(message).type === "run.updated")
                burst = () => {
                  for (let i = 0; i < 129; i++) ws.send(message);
                };
            }),
        },
      );
      ws.onClose(() => socket.terminate());
    });
    await page.goto(`/?run=${started.run.id}`);
    await expect(page.getByTestId("pipeline-connection")).toHaveText(
      "Connected",
    );
    tick();
    await expect(page.getByTestId("simulation-time")).toContainText("1.0 /");
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    burst();
    await expect(page.getByTestId("pipeline-connection")).toHaveText(
      "Resynchronizing",
    );
    await expect(
      page.getByRole("button", { name: "Pause simulation", exact: true }),
    ).toBeDisabled();
    await page.clock.runFor(1000);
    await expect.poll(() => connections).toBeGreaterThan(1);
    await page.clock.resume();
    await expect(page.getByTestId("pipeline-connection")).toHaveText(
      "Connected",
    );
    await expect(page.getByTestId("simulation-time")).toContainText("1.0 /");
    await expect(
      page.getByRole("button", { name: "Pause simulation", exact: true }),
    ).toBeEnabled();
    expect(
      recordingSchema.parse(
        (await app.inject(`/api/runs/${started.run.id}`)).json(),
      ).commands,
    ).toHaveLength(1);
  } finally {
    await page.close();
    await app.close();
  }
});
