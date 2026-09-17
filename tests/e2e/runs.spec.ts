import { expect, test } from "@playwright/test";

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
  await expect(page.getByTestId("event-count")).toHaveText("6");
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("simulation-time")).toHaveText("3.0 / 3 s");
  await expect(page.getByTestId("event-row")).toHaveCount(6);
  const firstEvents = await page.getByTestId("event-row").allTextContents();
  await page.getByText("Manifest and command log", { exact: true }).click();
  await expect(page.locator("pre")).toContainText('"seed": "browser-demo"');
  await expect(page.locator("pre")).toContainText('"type": "start"');
  await page.reload();
  await expect(page.getByTestId("event-row")).toHaveCount(6);
  expect(await page.getByTestId("event-row").allTextContents()).toEqual(
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
  await expect(page.getByTestId("event-row")).toHaveCount(6);
  expect(await page.getByTestId("event-row").allTextContents()).toEqual(
    firstEvents,
  );
  await page.goto(firstUrl);
  await expect(page.getByTestId("run-id")).toHaveText(firstId!);
  await expect(page.getByTestId("event-row")).toHaveCount(6);
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
  await expect(page.getByTestId("event-row")).toHaveCount(6);
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
