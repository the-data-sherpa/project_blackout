import { expect, test } from "@playwright/test";

test("connects to the real backend and WebSocket without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Monitoring workspace" }),
  ).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("shows a backend failure and recovers on retry", async ({ page }) => {
  await page.route("**/api/health", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(1);
  await expect(
    page.getByText("A service is unavailable.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/health");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
});

test("reports a disconnected live connection", async ({ page }) => {
  let disconnect: (() => void) | undefined;
  await page.routeWebSocket("**/ws", (socket) => {
    socket.connectToServer();
    disconnect = () => socket.close();
  });
  await page.goto("/");
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
  disconnect!();
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(1);
});

test("fits a narrow viewport and supports keyboard retry", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Check again" })).toBeFocused();
  await page.getByRole("button", { name: "Check again" }).focus();
  await expect(page.getByRole("button", { name: "Check again" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
