import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  recordingSchema,
  startRunSchema,
  commandSchema,
  type JevResponse,
} from "@blackout/contracts";
import { buildApp } from "../../apps/server/src/app.js";
import { defaultEvaluation } from "../../apps/server/src/evaluator.js";
import { openDatabase } from "../../apps/server/src/database.js";
import { Recordings } from "../../apps/server/src/recordings.js";
import {
  createTelemetryManifest,
  observe,
} from "../../apps/server/src/telemetry.js";

const result = (later = false): JevResponse => ({
  model: "jev-dashboard-test",
  usage: { input_tokens: 123, output_tokens: 45 },
  answers: {
    compromise: { type: "noul", noul: later ? 0.85 : 0.1 },
    classification: {
      type: "choice",
      choice: later ? "compromise" : "normal",
      ...(later ? {} : { confidence: 0.7 }),
      probabilities: later
        ? {
            normal: 0.01,
            benign_anomaly: 0.02,
            suspicious: 0.07,
            compromise: 0.9,
          }
        : {
            normal: 0.6,
            benign_anomaly: 0.2,
            suspicious: 0.15,
            compromise: 0.05,
          },
    },
    severity: {
      type: "score",
      score: later ? 2.1 : 1.3,
      probabilities: later
        ? { "0": 0.1, "1": 0.1, "2": 0.4, "3": 0.4 }
        : { "0": 0.2, "1": 0.4, "2": 0.3, "3": 0.1 },
      legend: { "0": "none", "1": "limited", "2": "serious", "3": "critical" },
    },
    response: {
      type: "choice",
      choice: later ? "escalate" : "observe",
      probabilities: later
        ? { observe: 0.05, investigate: 0.25, escalate: 0.7 }
        : { observe: 0.6, investigate: 0.3, escalate: 0.1 },
    },
  },
});

async function connect(
  page: Page,
  getApp: () => Awaited<ReturnType<typeof buildApp>>,
) {
  const methods: string[] = [];
  await page.route("http://localhost:3101/**", async (route) => {
    const request = route.request();
    methods.push(request.method());
    const address = new URL(request.url());
    const response = await getApp().inject({
      method: "GET",
      url: address.pathname + address.search,
    });
    await route.fulfill({
      status: response.statusCode,
      contentType: "application/json",
      body: response.body,
    });
  });
  await page.routeWebSocket(/\/ws/, async (ws) => {
    const address = new URL(ws.url());
    const socket = await getApp().injectWS(
      address.pathname + address.search,
      { headers: { origin: "http://localhost:3100" } },
      {
        onInit: (client) =>
          client.on("message", (message) => ws.send(String(message))),
      },
    );
    ws.onClose(() => socket.terminate());
  });
  return methods;
}

test("shows validated distributions together through pending, retry, held, failure, historical inspection and database reopen", async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-judgments-"));
  const databasePath = join(directory, "recording.sqlite");
  let tick = () => {};
  const responses: ((response: Response) => void)[] = [];
  let calls = 0;
  let app = await buildApp({
    databasePath,
    webOrigin: "http://localhost:3100",
    schedule: (step) => {
      tick = step;
      return () => {};
    },
    evaluator: {
      apiKey: "test-only",
      config: { ...defaultEvaluation, retryDelayMs: 100 },
      fetch: async () => {
        calls++;
        return new Promise<Response>((resolve) => responses.push(resolve));
      },
    },
  });
  try {
    const started = recordingSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: {
            seed: "judgment-distributions",
            durationSeconds: 10,
            interactive: true,
            evaluate: true,
          },
        })
      ).json(),
    );
    const path = `/api/runs/${started.run.id}`;
    const read = async () =>
      recordingSchema.parse((await app.inject(path)).json());
    const methods = await connect(page, () => app);
    await page.goto(`/?run=${started.run.id}`);
    await expect(page.getByTestId("judgment-state")).toHaveText(
      "Pending · attempt 1",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
    responses[0]!(Response.json(result()));
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "10.0%",
      "normal",
      "1.30 / 3",
      "observe",
    ]);
    await expect(
      page.getByTestId("judgment-classification").locator("dd"),
    ).toHaveText(["60.0%", "20.0%", "15.0%", "5.0%"]);
    await expect(
      page.getByTestId("judgment-severity").locator("dd"),
    ).toHaveText(["20.0%", "40.0%", "30.0%", "10.0%"]);
    await expect(
      page.getByTestId("judgment-response").locator("dd"),
    ).toHaveText(["60.0%", "30.0%", "10.0%"]);
    await expect(page.getByTestId("judgment-classification")).toContainText(
      "Confidence: 70.0%",
    );
    await expect(
      page.getByTestId("judgment-compromise").getByRole("button"),
    ).toHaveAccessibleName(/10\.0%/);
    await expect(
      page.getByTestId("judgment-classification").getByRole("button"),
    ).toHaveAccessibleName(/Confidence: 70\.0%/);
    await expect(page.getByTestId("judgment-severity")).toContainText(
      "Confidence: unknown · not returned",
    );
    const first = (await read()).attempts[0]!;
    for (let i = 0; i < 5; i++) tick();
    await expect(page.getByTestId("judgment-age")).toContainText(
      "age 5.0 simulation s at live cursor 5 s",
    );
    responses[1]!(new Response("temporary", { status: 503 }));
    await expect(page.getByTestId("judgment-state")).toHaveText(
      "Retrying · attempt 2",
    );
    await expect(page.getByTestId("pipeline-evaluation")).toHaveText(
      "Retrying",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "10.0%",
      "normal",
      "1.30 / 3",
      "observe",
    ]);
    await app.inject({
      method: "POST",
      url: `${path}/commands`,
      payload: { commandId: randomUUID(), type: "pause" },
    });
    responses[2]!(Response.json(result(true)));
    await expect(page.getByTestId("judgment-state")).toContainText(
      "held, not applied",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "10.0%",
      "normal",
      "1.30 / 3",
      "observe",
    ]);
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(first.id);
    await app.inject({
      method: "POST",
      url: `${path}/commands`,
      payload: { commandId: randomUUID(), type: "resume" },
    });
    await expect(page.getByTestId("newer-assessments")).toContainText(
      "1 newer applied assessments",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "10.0%",
      "normal",
      "1.30 / 3",
      "observe",
    ]);
    await expect(page.getByTestId("judgment-age")).toContainText(
      "age 0.0 simulation s at inspected cursor 0 s",
    );
    await page
      .getByRole("button", { name: "Return to live", exact: true })
      .click();
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "85.0%",
      "compromise",
      "2.10 / 3",
      "escalate",
    ]);
    await expect(page.getByTestId("judgment-change")).toHaveText([
      "+75.00 percentage points",
      "normal → compromise",
      "+0.80 severity points",
      "observe → escalate",
    ]);
    await expect(page.getByTestId("judgment-classification")).toContainText(
      "Confidence: unknown · not returned",
    );
    await expect(page.getByTestId("judgment-zone")).toContainText(
      "Compared with prior applied snapshot 0 s",
    );
    for (let i = 0; i < 5; i++) tick();
    responses[3]!(Response.json({ invalid: true }));
    await expect(page.getByTestId("judgment-state")).toContainText(
      "Unavailable · malformed_response · last applied result is stale",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "85.0%",
      "compromise",
      "2.10 / 3",
      "escalate",
    ]);
    await expect.poll(async () => (await read()).run.status).toBe("completed");
    const saved = await read();
    await app.close();
    app = await buildApp({
      databasePath,
      webOrigin: "http://localhost:3100",
      evaluator: {
        fetch: async () => {
          calls++;
          throw new Error("No new model calls allowed");
        },
      },
    });
    expect((await read()).attempts).toEqual(saved.attempts);
    await page.reload();
    await expect(page.getByTestId("judgment-age")).toContainText(
      "age 5.0 simulation s at inspected cursor 10 s",
    );
    await page
      .getByRole("button", { name: "Return to playback", exact: true })
      .click();
    await expect(page.getByTestId("judgment-age")).toContainText(
      "age 5.0 simulation s at playback cursor 10 s",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "85.0%",
      "compromise",
      "2.10 / 3",
      "escalate",
    ]);
    await page.getByTestId("judgment-severity").getByRole("button").click();
    await expect(
      page.getByLabel("Decision Inspector", { exact: true }),
    ).toHaveValue(saved.attempts[2]!.id);
    await page
      .getByText("Exact request: questions and observable state", {
        exact: true,
      })
      .click();
    await expect(
      page
        .locator("details")
        .filter({
          has: page.getByText("Exact request: questions and observable state", {
            exact: true,
          }),
        })
        .getByText(/jev-1.13.0/),
    ).toBeVisible();
    await page
      .getByText("Model response and distributions", { exact: true })
      .click();
    await expect(
      page
        .locator("details")
        .filter({
          has: page.getByText("Model response and distributions", {
            exact: true,
          }),
        })
        .getByText(/input_tokens/),
    ).toContainText("123");
    expect(calls).toBe(4);
    expect(methods.every((method) => method === "GET")).toBe(true);
  } finally {
    await page.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("searches all 5,000+ eligible events with combined filters, evidence selection, host samples and historical limits", async ({
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
          payload: {
            seed: "evidence-search",
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
    expect(saved.events.length).toBeGreaterThan(5000);
    const methods = await connect(page, () => app);
    await page.goto(`/?run=${started.run.id}`);
    const timeline = page.getByLabel("Recording timeline");
    await timeline.fill("120000");
    const query = page.getByLabel("Search recorded events", { exact: true });
    const type = page.getByRole("combobox", {
      name: "Event type",
      exact: true,
    });
    const period = page.getByRole("combobox", {
      name: "Activity period",
      exact: true,
    });
    const entity = page.getByRole("combobox", { name: "Entity", exact: true });
    const from = page.getByLabel("From time (simulation seconds)", {
      exact: true,
    });
    const through = page.getByLabel("Through time (simulation seconds)", {
      exact: true,
    });
    await page
      .getByRole("button", { name: "Clear all event filters", exact: true })
      .click();
    await expect(page.getByTestId("event-search-count")).toContainText(
      `${saved.events.length} matching / ${saved.events.length} eligible`,
    );
    await expect(page.getByTestId("event-row")).toHaveCount(50);
    const last = saved.events.at(-1)!;
    if (!("eventId" in last)) throw new Error("Expected a versioned event");
    await query.fill(`  ${last.eventId.toUpperCase()}  `);
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    await expect(page.getByTestId("event-row")).toContainText(
      `#${last.sequence}`,
    );
    await page
      .getByTestId("event-row")
      .getByRole("button", {
        name: `Inspect event #${last.sequence}`,
        exact: true,
      })
      .click();
    await expect(page.getByTestId("selected-event")).toContainText(
      last.occurredAt,
    );
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await expect(
      page.locator('[data-testid="event-row"][data-selected="true"]'),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Clear event selection", exact: true })
      .click();
    const warmup = saved.events.find(
      (event) => event.type === "dns" && event.simulationTimeMs < 0,
    )!;
    expect(warmup.type).toBe("dns");
    if (warmup.type !== "dns") throw new Error("Expected DNS observation");
    await period.selectOption("warmup");
    await type.selectOption("dns");
    await entity.selectOption(warmup.hostId);
    await from.fill(String(warmup.simulationTimeMs / 1000));
    await through.fill(String(warmup.simulationTimeMs / 1000));
    await query.fill(warmup.query.toUpperCase());
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    await expect(page.getByTestId("event-row")).toContainText(
      `#${warmup.sequence}`,
    );
    await from.fill(String(warmup.simulationTimeMs / 1000 + 1));
    await expect(
      page.getByRole("alert").filter({ hasText: "From time" }),
    ).toBeVisible();
    await expect(page.getByTestId("event-row")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Clear from time", exact: true })
      .click();
    await expect(type).toHaveValue("dns");
    await expect(period).toHaveValue("warmup");
    await expect(query).toHaveValue(warmup.query.toUpperCase());
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Clear all event filters", exact: true })
      .click();
    await timeline.fill("12000");
    const suspicious = page
      .getByRole("button", { name: /user .* Suspicious evidence/ })
      .first();
    await suspicious.click();
    await expect(page.getByText(/Rule entity-evidence\/1/)).toBeVisible();
    const evidence = page
      .getByTestId("topology-evidence")
      .getByRole("button")
      .last();
    await evidence.click();
    await expect(page.getByTestId("selected-event")).toBeVisible();
    await expect(page.getByTestId("judgment-zone")).toContainText(
      "Global environment assessment",
    );
    await timeline.fill("0");
    await expect(
      page.getByText(
        /Event #.*unavailable at this cursor. Its selection was cleared/,
      ),
    ).toBeVisible();
    await expect(page.getByTestId("selected-event")).toHaveCount(0);
    await timeline.fill("12000");
    await expect(page.getByTestId("selected-event")).toHaveCount(0);
    const metric = saved.events.findLast(
      (event) =>
        event.type === "host-metric" && event.simulationTimeMs <= 12000,
    )!;
    if (metric.type !== "host-metric") throw new Error("Expected host metric");
    await entity.selectOption(metric.hostId);
    await expect(page.getByTestId("host-samples")).toContainText(
      `CPU ${metric.cpuPercent}% · memory ${metric.memoryPercent}%`,
    );
    await expect(page.getByTestId("host-samples")).toContainText(
      metric.occurredAt,
    );
    expect(await page.getByTestId("host-sample").count()).toBeLessThanOrEqual(
      8,
    );
    await expect(page.getByTestId("host-samples")).toContainText(
      "simulation s old at inspected cursor",
    );
    await page
      .getByRole("button", { name: "Clear all event filters", exact: true })
      .click();
    await query.fill(last.eventId);
    await expect(page.getByTestId("event-row")).toHaveCount(0);
    await timeline.fill("120000");
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    expect(methods.every((method) => method === "GET")).toBe(true);
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  } finally {
    await page.close();
    await app.close();
  }
});

test("distinguishes missing and stale host measurements and clears connections outside the cursor", async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-sparse-evidence-"));
  const databasePath = join(directory, "recording.sqlite");
  const id = randomUUID();
  const manifest = createTelemetryManifest(
    startRunSchema.parse({ seed: "sparse-host-samples", durationSeconds: 60 }),
  );
  const host = manifest.organization.hosts[0]!;
  const other = manifest.organization.hosts[1]!;
  const at = "2026-01-01T09:00:00.000Z";
  const db = openDatabase(databasePath);
  new Recordings(db).create(
    {
      id,
      manifest,
      status: "completed",
      simulationTimeMs: 60000,
      lastSequence: 2,
      createdAt: at,
      endedAt: "2026-01-01T09:01:00.000Z",
      revision: 0,
    },
    commandSchema.parse({
      runId: id,
      sequence: 1,
      simulationTimeMs: 0,
      recordedAt: at,
      type: "start",
    }),
    [
      observe(
        {
          type: "host-metric",
          hostId: host.id,
          cpuPercent: 78,
          memoryPercent: 64,
        },
        manifest,
        id,
        0,
        1,
      ),
      observe(
        {
          type: "network",
          hostId: host.id,
          userId: manifest.organization.users[0]!.userId,
          destinationHostId: other.id,
          destinationPort: 443,
          bytesSent: 1024,
          outcome: "allowed",
        },
        manifest,
        id,
        10000,
        2,
      ),
    ],
  );
  db.close();
  const app = await buildApp({
    databasePath,
    webOrigin: "http://localhost:3100",
  });
  try {
    const methods = await connect(page, () => app);
    await page.goto(`/?run=${id}`);
    const timeline = page.getByLabel("Recording timeline");
    await timeline.fill("60000");
    const entity = page.getByRole("combobox", { name: "Entity", exact: true });
    await entity.selectOption(other.id);
    await expect(page.getByTestId("host-samples")).toContainText(
      "No recorded CPU or memory samples at this cursor. Values are unknown.",
    );
    await entity.selectOption(host.id);
    await expect(page.getByTestId("host-samples")).toContainText(
      "Stale sample · 60.0 simulation s old",
    );
    await expect(page.getByTestId("host-samples")).toContainText(
      "CPU 78% · memory 64%",
    );
    await expect(page.getByTestId("host-samples")).toContainText(at);
    await page.getByTestId("topology-relationship").first().click();
    await expect(page.getByTestId("selected-event")).toContainText(
      "Selected event #2",
    );
    await timeline.fill("0");
    await expect(page.getByTestId("selected-event")).toHaveCount(0);
    await expect(page.getByTestId("topology-relationship")).toHaveCount(0);
    await expect(
      page.getByText(
        "The selected connection is unavailable at this cursor. Its selection was cleared.",
      ),
    ).toBeVisible();
    await entity.selectOption(host.id);
    await expect(page.getByTestId("host-samples")).toContainText(
      "Recent sample · 0.0 simulation s old",
    );
    await expect(page.getByTestId("judgment-state")).toHaveText(
      "Never evaluated · telemetry only",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
    expect(methods.every((method) => method === "GET")).toBe(true);
    const unavailable = recordingSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { seed: "no-model-key", durationSeconds: 1, evaluate: true },
        })
      ).json(),
    );
    await page.goto(`/?run=${unavailable.run.id}`);
    await expect(page.getByTestId("judgment-state")).toContainText(
      "risk unknown",
    );
    await expect(page.getByTestId("judgment-state")).toContainText(
      "Unavailable",
    );
    await expect(page.getByTestId("judgment-value")).toHaveText([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
    expect(methods.every((method) => method === "GET")).toBe(true);
  } finally {
    await page.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
