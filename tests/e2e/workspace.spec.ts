import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { commandSchema, startRunSchema } from "@blackout/contracts";
import { openDatabase } from "../../apps/server/src/database.js";
import { Recordings } from "../../apps/server/src/recordings.js";
import {
  createManifest,
  authenticationStep,
} from "../../apps/server/src/authentication.js";
import { buildApp } from "../../apps/server/src/app.js";

async function connect(page: Page, app: Awaited<ReturnType<typeof buildApp>>) {
  const requests: string[] = [];
  await page.route("http://localhost:3101/**", async (route) => {
    const request = route.request();
    requests.push(request.method());
    const response = await app.inject({
      method: "GET",
      url: new URL(request.url()).pathname + new URL(request.url()).search,
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
  return requests;
}

test("opens setup for an empty store and explains invalid explicit links without falling back", async ({
  page,
}) => {
  const app = await buildApp({
    databasePath: ":memory:",
    webOrigin: "http://localhost:3100",
    schedule: () => () => {},
  });
  try {
    const requests = await connect(page, app);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Start run", exact: true }),
    ).toBeEnabled();
    expect((await app.inject("/api/runs")).json().total).toBe(0);
    await page.goto("/?run=invalid-recording");
    await expect(
      page.getByRole("alert").filter({ hasText: "Could not load the run" }),
    ).toBeVisible();
    await expect(page.getByTestId("run-id")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Return to run setup", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start run", exact: true }),
    ).toBeEnabled();
    expect(requests.every((method) => method === "GET")).toBe(true);
  } finally {
    await page.close();
    await app.close();
  }
});

test("prioritizes linked, active and newest recordings and preserves all secondary views", async ({
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
    const create = async (seed: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: { seed, durationSeconds: 1 },
        })
      ).json().run.id as string;
    const older = await create("workspace-older");
    tick();
    const newest = await create("workspace-newest");
    tick();
    const requests = await connect(page, app);
    await page.goto("/");
    await expect(page.getByTestId("run-id")).toHaveText(newest);
    await expect(
      page.getByText(/Saved recording · offline playback/),
    ).toBeVisible();
    const active = await create("workspace-active");
    await page.goto("/");
    await expect(page.getByTestId("run-id")).toHaveText(active);
    await expect(page.getByText(/Live active run/)).toBeVisible();
    await page.goto(`/?run=${older}`);
    await expect(page.getByTestId("run-id")).toHaveText(older);
    await page
      .getByRole("button", { name: "Recordings & storage", exact: true })
      .click();
    await expect(page.getByTestId("storage-usage")).toBeVisible();
    await page
      .getByRole("button", { name: `Inspect run ${newest}`, exact: true })
      .click();
    await expect(page.getByTestId("run-id")).toHaveText(newest);
    await page
      .getByRole("button", { name: "Evaluation reports", exact: true })
      .click();
    await expect(
      page.getByText(/^Model evaluation reports \(0\)$/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to dashboard", exact: true })
      .click();
    await expect(page.getByTestId("environment-zone")).toBeVisible();
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start run", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Return to dashboard", exact: true })
      .click();
    await page.goto("/?run=c1f40c25-3d9a-416c-ad1b-bb88db21977c");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "This recording was not found" }),
    ).toBeVisible();
    await expect(page.getByTestId("run-id")).toHaveCount(0);
    expect(requests.every((method) => method === "GET")).toBe(true);
  } finally {
    await page.close();
    await app.close();
  }
});

test("renders the packaged real-response recording offline in three zones and stacked narrow layouts", async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-workspace-"));
  const filename = join(directory, "demo.sqlite");
  writeFileSync(
    filename,
    gunzipSync(readFileSync("demo/blackout-demo.sqlite.gz")),
  );
  let modelCalls = 0;
  const app = await buildApp({
    databasePath: filename,
    webOrigin: "http://localhost:3100",
    schedule: () => () => {},
    evaluator: {
      fetch: async () => {
        modelCalls++;
        throw new Error("No network in playback");
      },
    },
  });
  try {
    const requests = await connect(page, app);
    const id = JSON.parse(readFileSync("demo/manifest.json", "utf8")).runId;
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/?run=${id}`);
    await expect(page.getByTestId("run-id")).toHaveText(id);
    const timeline = page.getByLabel("Recording timeline");
    await timeline.fill("30000");
    const environment = await page
      .getByTestId("environment-zone")
      .boundingBox();
    const judgments = await page.getByTestId("judgment-zone").boundingBox();
    const processing = await page.getByTestId("processing-zone").boundingBox();
    await page.screenshot({ path: "test-results/workspace-desktop.png" });
    expect(environment!.x).toBeLessThan(judgments!.x);
    expect(environment!.y).toBe(judgments!.y);
    expect(processing!.y).toBeGreaterThan(environment!.y);
    expect(processing!.y + processing!.height).toBeLessThan(1100);
    await expect(page.getByTestId("judgment-zone")).not.toContainText(
      "Unknown",
    );
    await page.screenshot({ path: "test-results/workspace-desktop.png" });
    await timeline.fill("31000");
    await expect(page.getByTestId("processing-zone")).toContainText(
      "Checkpoint 30 s",
    );
    await expect(page.getByTestId("processing-zone")).toContainText(
      "snapshot-000031",
    );
    await page
      .getByTestId("judgment-zone")
      .getByRole("button", { name: /Compromise probability/ })
      .click();
    await expect(page.getByTestId("inspection-position")).toContainText(
      "Inspecting checkpoint",
    );
    await page
      .getByRole("button", { name: "Return to playback", exact: true })
      .click();
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page
      .getByRole("button", { name: "Expand decision path", exact: true })
      .click();
    await expect(
      page
        .getByTestId("processing-zone")
        .getByRole("button", { name: /01 \/ Evidence/ }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/workspace-mobile.png",
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Monitor", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "New run", exact: true }),
    ).toBeFocused();
    expect(requests.every((method) => method === "GET")).toBe(true);
    expect(modelCalls).toBe(0);
  } finally {
    await page.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps legacy recordings inspectable and recovers an initial data-load failure", async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "blackout-legacy-workspace-"));
  const filename = join(directory, "legacy.sqlite");
  const id = randomUUID();
  const manifest = createManifest(
    startRunSchema.parse({ seed: "legacy-entry", durationSeconds: 1 }),
  );
  const db = openDatabase(filename);
  const at = "2026-01-01T09:00:00.000Z";
  new Recordings(db).create(
    {
      id,
      manifest,
      status: "completed",
      simulationTimeMs: 1000,
      lastSequence: 2,
      createdAt: at,
      endedAt: "2026-01-01T09:00:01.000Z",
      revision: 0,
    },
    commandSchema.parse({
      runId: id,
      sequence: 1,
      simulationTimeMs: 0,
      recordedAt: at,
      type: "start",
    }),
    authenticationStep(manifest, id, 1000),
  );
  db.close();
  const app = await buildApp({
    databasePath: filename,
    webOrigin: "http://localhost:3100",
    schedule: () => () => {},
  });
  try {
    const requests = await connect(page, app);
    await page.route("**/api/runs?limit=1", (route) => route.abort(), {
      times: 1,
    });
    await page.goto("/");
    await expect(
      page.getByRole("alert").filter({ hasText: "Could not load the run" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to run setup", exact: true })
      .click();
    await page.getByRole("button", { name: "Monitor", exact: true }).click();
    await expect(page.getByTestId("run-id")).toHaveText(id);
    await page.getByLabel("Recording timeline").fill("1000");
    await expect(page.getByTestId("event-row")).toHaveCount(2);
    await expect(
      page.getByText("This legacy recording has no versioned organization", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("judgment-zone")).toContainText("Unknown");
    expect(requests.every((method) => method === "GET")).toBe(true);
  } finally {
    await page.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
