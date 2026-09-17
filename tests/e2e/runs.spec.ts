import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

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
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  expect(await page.getByTestId("event-row").allInnerTexts()).toEqual(
    firstEvents,
  );
  await page.goto(firstUrl);
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await expect(page.getByTestId("event-row")).toHaveCount(15);
  await page.getByRole("button", { name: `Inspect run ${secondId}` }).click();
  await expect(page.getByTestId("run-id")).toHaveText(secondId!);
  await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Inspect run ${firstId}` }).click();
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);

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
  await expect(page.getByTestId("window-boundary")).toContainText(
    "snapshot-000001",
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
