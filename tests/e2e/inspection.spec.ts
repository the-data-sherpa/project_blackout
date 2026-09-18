import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { recordingSchema, type JevResponse } from "@blackout/contracts";
import { buildApp } from "../../apps/server/src/app.js";
import { defaultEvaluation } from "../../apps/server/src/evaluator.js";

const model = (probability: number): JevResponse => ({
  model: "jev-inspection-test",
  answers: {
    compromise: { type: "noul", noul: probability },
    classification: {
      type: "choice",
      choice: "compromise",
      confidence: 0.9,
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

test("pins every view while real streamed recording continues, including held response and completion", async ({
  page,
}) => {
  let tick = () => {};
  let calls = 0;
  let receive!: (response: Response) => void;
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
            receive = resolve;
          });
        return calls === 3
          ? Response.json({ invalid: true })
          : Response.json(model(calls === 1 ? 0.1 : 0.9));
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
            seed: "inspection-browser",
            durationSeconds: 11,
            interactive: true,
            evaluate: true,
          },
        })
      ).json(),
    );
    const path = `/api/runs/${started.run.id}`;
    const read = async () =>
      recordingSchema.parse((await app.inject(path)).json());
    await expect
      .poll(async () => (await read()).run.controls!.waitingForInference)
      .toBe(false);
    let mutations = 0;
    await page.route("http://localhost:3101/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") mutations++;
      const response = await app.inject({
        method: request.method() === "POST" ? "POST" : "GET",
        url: new URL(request.url()).pathname + new URL(request.url()).search,
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
          onInit: (client) => {
            client.on("message", (message) => ws.send(String(message)));
          },
        },
      );
      ws.onClose(() => socket.terminate());
    });
    await page.goto(`/?run=${started.run.id}`);
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Following live · 0.0 s",
    );
    const first = (await read()).attempts[0]!;
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(first.id);
    for (let i = 0; i < 5; i++) tick();
    await expect(page.getByTestId("simulation-time")).toContainText("5.0 /");
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 0.0 s",
    );
    await expect(page.getByTestId("event-row")).toHaveCount(0);
    await expect(page.getByTestId("newer-assessments")).toContainText(
      "0 newer applied assessments",
    );
    await expect(
      page.getByText(/observable events through 0.0 s/),
    ).toBeVisible();
    await app.inject({
      method: "POST",
      url: `${path}/commands`,
      payload: { commandId: randomUUID(), type: "pause" },
    });
    receive(Response.json(model(0.9)));
    await expect
      .poll(async () => (await read()).attempts.at(-1)!.status)
      .toBe("succeeded");
    const held = (await read()).attempts.at(-1)!;
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(held.id);
    await expect(page.getByText(/Received but not applied\./)).toBeVisible();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    await app.inject({
      method: "POST",
      url: `${path}/commands`,
      payload: { commandId: randomUUID(), type: "resume" },
    });
    await expect(page.getByTestId("newer-assessments")).toContainText(
      "1 newer applied assessments",
    );
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    expect(new URL(page.url()).searchParams.get("phase")).toBe("received");
    await page.reload();
    await expect(page.getByText(/Received but not applied\./)).toBeVisible();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Not opened",
    );
    await page
      .getByRole("button", { name: "Return to live", exact: true })
      .click();
    await expect(page.getByTestId("investigation-status")).toHaveText("Open");
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Following live · 5.0 s",
    );
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(held.id);
    for (let i = 0; i < 5; i++) tick();
    await expect
      .poll(async () => (await read()).run.controls!.waitingForInference)
      .toBe(false);
    await expect(page.getByTestId("simulation-time")).toContainText("10.0 /");
    await expect(page.getByTestId("newer-assessments")).toContainText(
      "0 newer applied assessments",
    );
    tick();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 5.0 s",
    );
    await page
      .getByRole("button", { name: "Return to playback", exact: true })
      .click();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Following playback · 11.0 s",
    );
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(first.id);
    await page.getByLabel("Recording timeline").fill("10000");
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 0.0 s",
    );
    await page
      .getByRole("button", { name: "Return to playback", exact: true })
      .click();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Following playback · 10.0 s",
    );
    expect(calls).toBe(4);
    expect(mutations).toBe(0);
    await page.reload();
    await expect(page.getByTestId("inspection-position")).toHaveText(
      "Inspecting checkpoint · 10.0 s",
    );
  } finally {
    await page.close();
    await app.close();
  }
});
