import { cpus, totalmem, platform, release } from "node:os";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { recordingSchema } from "@blackout/contracts";
import { buildApp } from "../../apps/server/src/app.js";
import { buildTopology } from "../../apps/web/src/app/topology.js";

const mebibyte = 1024 * 1024;

test("keeps evidence topology synchronized and bounded through a full recording", async ({
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
            seed: "m8-full-length",
            fixture: "credential-compromise",
            durationSeconds: 120,
          },
        })
      ).json(),
    );
    for (let second = 0; second < 120; second++) tick();
    const saved = recordingSchema.parse(
      (await app.inject(`/api/runs/${started.run.id}`)).json(),
    );
    expect(saved.run.status).toBe("completed");
    expect(saved.run.simulationTimeMs).toBe(120_000);
    expect(saved.events.length).toBeGreaterThan(5000);

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
    await expect(
      page.getByRole("heading", { name: "Environment topology" }),
    ).toBeVisible();
    await expect(page.getByTestId("topology-jev-state")).toHaveText(
      "No applied assessment",
    );

    const timeline = page.getByLabel("Recording timeline");
    await timeline.fill("12000");
    const suspiciousUser = page
      .getByRole("button", { name: /user .* Suspicious evidence/ })
      .first();
    await expect(suspiciousUser).toBeVisible();
    await suspiciousUser.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Rule entity-evidence\/1/)).toBeVisible();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.activeElement!).outlineStyle,
      ),
    ).toBe("solid");
    const evidenceEvent = page
      .getByTestId("topology-evidence")
      .getByRole("button")
      .last();
    await evidenceEvent.click();
    await expect(
      page.locator('[data-testid="event-row"][data-selected="true"]'),
    ).toHaveCount(1);
    await timeline.fill("0");
    await expect(
      page.locator('[data-testid="event-row"][data-selected="true"]'),
    ).toHaveCount(0);
    await timeline.fill("12000");
    await suspiciousUser.click();
    const renderStarted = performance.now();
    await timeline.fill("120000");
    await expect(
      page.locator('[data-testid="topology-node"][aria-pressed="true"]'),
    ).not.toHaveAttribute("aria-label", /Suspicious evidence/);
    const seekRenderMs = performance.now() - renderStarted;
    expect(seekRenderMs).toBeLessThan(1000);

    for (const speed of ["0.25", "0.5", "1", "2", "5"])
      await page.getByLabel("Speed").selectOption(speed);
    await expect(
      page.getByText("Paused at 120.0 s", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("topology-relationship")).not.toHaveCount(0);
    expect(
      await page.getByTestId("topology-relationship").count(),
    ).toBeLessThanOrEqual(64);
    expect(await page.getByTestId("event-row").count()).toBeLessThanOrEqual(50);

    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const metrics = (await session.send("Performance.getMetrics")) as {
      metrics: Array<{ name: string; value: number }>;
    };
    const heap = metrics.metrics.find(
      (metric) => metric.name === "JSHeapUsedSize",
    )?.value;
    expect(heap).toBeDefined();
    expect(heap!).toBeLessThan(128 * mebibyte);
    const measurement = {
      recordedAt: new Date().toISOString(),
      browser: page.context().browser()!.version(),
      platform: platform(),
      osRelease: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(1)),
      viewport: page.viewportSize(),
      durationMs: saved.run.simulationTimeMs,
      events: saved.events.length,
      eventRows: await page.getByTestId("event-row").count(),
      relationships: await page.getByTestId("topology-relationship").count(),
      seekToRenderMs: Number(seekRenderMs.toFixed(2)),
      heapMiB: Number((heap! / mebibyte).toFixed(2)),
    };
    const organization =
      saved.run.manifest.schemaVersion === 2
        ? saved.run.manifest.organization
        : null;
    expect(organization).not.toBeNull();
    const endIds = new Set(
      buildTopology(organization!, saved.events, 120_000)
        .relationships.slice(0, 64)
        .map((relationship) => relationship.id),
    );
    const early = buildTopology(
      organization!,
      saved.events,
      12_000,
    ).relationships.slice(0, 64);
    const retainedIndex = early.findIndex(
      (relationship) => !endIds.has(relationship.id),
    );
    expect(retainedIndex).toBeGreaterThanOrEqual(0);
    await timeline.fill("12000");
    await page.getByTestId("topology-relationship").nth(retainedIndex).click();
    await timeline.fill("120000");
    await expect(page.getByTestId("relationship-budget")).toContainText(
      "64 + selected",
    );
    await expect(page.getByTestId("topology-relationship")).toHaveCount(65);

    await timeline.fill("119000");
    await page.getByLabel("Speed").selectOption("0.25");
    await page
      .getByRole("button", { name: "Play recording", exact: true })
      .click();
    await expect(page.locator(".topology-activity").first()).toBeVisible();
    const animations = await page.locator(".topology-activity").count();
    expect(animations).toBeLessThanOrEqual(12);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".topology-activity")
        .evaluateAll((elements) =>
          elements.every(
            (element) => getComputedStyle(element).animationName === "none",
          ),
        ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Pause playback", exact: true })
      .click();
    await timeline.fill("120000");
    Object.assign(measurement, {
      relationshipsWithRetainedSelection: 65,
      animations,
      reducedMotion: true,
    });
    writeFileSync(
      "test-results/monitoring-performance.json",
      JSON.stringify(measurement, null, 2) + "\n",
    );

    for (const width of [1280, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: "test-results/m8-console-mobile.png",
      fullPage: false,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("heading", { name: "Environment topology" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/m8-console-desktop.png",
      fullPage: false,
    });
  } finally {
    await app.close();
  }
});
