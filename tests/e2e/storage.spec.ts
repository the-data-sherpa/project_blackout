import { expect, test } from "@playwright/test";
import { buildApp } from "../../apps/server/src/app.js";

test("confirms selected cleanup, recovers a failed delete, and keeps another recording inspectable", async ({
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
    const ids: string[] = [];
    for (const seed of ["keep-this-recording", "delete-this-recording"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { seed, durationSeconds: 1 },
      });
      ids.push(response.json().run.id);
      tick();
    }
    let failDelete = true;
    await page.route("http://localhost:3101/**", async (route) => {
      const request = route.request();
      if (request.method() === "DELETE" && failDelete) return route.abort();
      const response = await app.inject({
        method: request.method() === "DELETE" ? "DELETE" : "GET",
        url: new URL(request.url()).pathname + new URL(request.url()).search,
      });
      await route.fulfill({
        status: response.statusCode,
        contentType: "application/json",
        body: response.body,
      });
    });
    await page.goto(`/?run=${ids[1]}`);
    await page
      .getByRole("button", { name: "Recordings & storage", exact: true })
      .click();
    await expect(page.getByTestId("storage-usage")).toContainText("MiB");
    const remove = page.getByRole("button", {
      name: `Delete recording ${ids[1]}`,
      exact: true,
    });
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("delete-this-recording");
      await dialog.dismiss();
    });
    await remove.click();
    await expect(
      page.getByRole("button", { name: `Inspect run ${ids[1]}`, exact: true }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Refresh runs to check storage" }),
    ).toBeVisible();
    failDelete = false;
    page.once("dialog", (dialog) => dialog.accept());
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `Deleted recording ${ids[1]}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Inspect run ${ids[1]}`, exact: true }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/run=/);
    await page
      .getByRole("button", { name: `Inspect run ${ids[0]}`, exact: true })
      .click();
    await expect(page.getByTestId("run-id")).toHaveText(ids[0]!);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/m9-storage-mobile.png" });
  } finally {
    await app.close();
  }
});
