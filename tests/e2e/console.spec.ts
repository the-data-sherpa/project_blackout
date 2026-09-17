import { expect, test, type Page } from "@playwright/test";
import { recordingSchema, type JevResponse } from "@blackout/contracts";
import { buildApp } from "../../apps/server/src/app.js";
import { defaultEvaluation } from "../../apps/server/src/evaluator.js";

async function seekToEnd(page: Page) {
  const timeline = page.getByLabel("Recording timeline");
  await expect(timeline).toBeVisible();
  await timeline.fill((await timeline.getAttribute("max"))!);
}

test("follows exact timeline evidence, filters observations, and persists operator actions with retry and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let tick = () => {};
  let calls = 0;
  const model = (p: number): JevResponse => ({
    model: "jev-console-test",
    answers: {
      compromise: { type: "noul", noul: p },
      classification: {
        type: "choice",
        choice: "compromise",
        probabilities: {
          normal: 0,
          benign_anomaly: 0,
          suspicious: 0,
          compromise: 1,
        },
        ...(p > 0.8 ? { confidence: 0.9 } : {}),
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
  // Real backend and SQLite; only the Jev transport is deterministic and offline.
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
        return calls === 3
          ? Response.json({ invalid: true })
          : Response.json(model(calls === 1 ? 0.9 : 0.1));
      },
    },
  });
  try {
    const started = recordingSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { seed: "browser-m6", evaluate: true, durationSeconds: 6 },
        })
      ).json(),
    );
    const url = `/api/runs/${started.run.id}`;
    for (let i = 0; i < 6; i++) {
      await expect
        .poll(
          async () =>
            recordingSchema.parse((await app.inject(url)).json()).run.controls!
              .waitingForInference,
        )
        .toBe(false);
      tick();
    }
    await expect
      .poll(
        async () =>
          recordingSchema.parse((await app.inject(url)).json()).run.status,
      )
      .toBe("completed");
    const saved = recordingSchema.parse((await app.inject(url)).json());
    await page.route("http://localhost:3101/**", async (route) => {
      const request = route.request();
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
    await page.goto(`/?run=${started.run.id}`);
    await seekToEnd(page);
    await expect(page.getByTestId("investigation-status")).toHaveText("Open");
    await expect(page.getByTestId("decision-metrics")).toContainText(
      "3 (0 pending; 1 failed)",
    );
    const point = page.getByRole("button", {
      name: "Inspect 0s · attempt 1 · succeeded · 90.0% compromise probability",
      exact: true,
    });
    await point.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByLabel("Decision Inspector", { exact: true }),
    ).toHaveValue(saved.attempts[0]!.id);
    await expect(page.getByTestId("decision-evidence")).toContainText(
      "snapshot-000001 · 0 s",
    );
    await expect(
      page.getByRole("combobox", { name: "Snapshot", exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId("event-row")).toHaveCount(0);
    await page.getByLabel("Activity period").selectOption("warmup");
    await expect(page.getByTestId("event-row")).toHaveCount(50);
    await page
      .getByLabel("Decision Inspector", { exact: true })
      .selectOption(saved.attempts[1]!.id);
    await page.getByLabel("Activity period").selectOption("live");
    await page.getByLabel("Event type").selectOption("network");
    await expect(page.getByTestId("decision-evidence")).toContainText(
      "snapshot-000006 · 5 s",
    );
    await expect(page.getByTestId("event-row")).toHaveCount(5);
    await page
      .getByText("Application policy: unevaluable", { exact: true })
      .click();
    await expect(
      page.getByText("classification confidence >= 0.75:", { exact: false }),
    ).toContainText("Unevaluable");
    await page.reload();
    await seekToEnd(page);
    await expect(page.getByTestId("decision-evidence")).toContainText(
      "snapshot-000006 · 5 s",
    );
    await page
      .getByRole("button", { name: /Inspect 6s · attempt 1 · failed/ })
      .click();
    await expect(page.getByTestId("decision-evidence")).toContainText(
      "snapshot-000007 · 6 s",
    );
    await expect(
      page.getByText(/Selected attempt: malformed_response/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Acknowledge investigation", exact: true })
      .click();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Acknowledged",
    );
    await expect(
      page.getByRole("button", {
        name: "Acknowledge investigation",
        exact: true,
      }),
    ).toBeDisabled();
    await page.route("**/investigation-actions", (route) => route.abort(), {
      times: 1,
    });
    await page
      .getByRole("button", { name: "Close investigation", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Refresh the recording" }),
    ).toBeVisible();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Acknowledged",
    );
    await page
      .getByRole("button", { name: "Close investigation", exact: true })
      .click();
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Closed by operator",
    );
    await page.reload();
    await seekToEnd(page);
    await expect(page.getByTestId("investigation-status")).toHaveText(
      "Closed by operator",
    );
    await page.getByText("Investigation history (3)", { exact: true }).click();
    await expect(page.getByTestId("investigation-event")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Inspect triggering decision #1" })
      .click();
    await expect(page.getByTestId("decision-evidence")).toContainText("0 s");
    for (const width of [1280, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: "test-results/m6-console-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page
      .getByRole("heading", { name: "Jev decisions", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/m6-console-desktop.png" });
    expect(calls).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
