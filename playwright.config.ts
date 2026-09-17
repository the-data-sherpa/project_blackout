import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node apps/server/dist/index.js",
      url: "http://127.0.0.1:3101/api/health",
      env: {
        API_HOST: "127.0.0.1",
        API_PORT: "3101",
        WEB_ORIGIN: "http://localhost:3100",
        DATABASE_PATH: ":memory:",
        LOG_LEVEL: "warn",
      },
      reuseExistingServer: false,
    },
    {
      command: "node scripts/start-web.mjs",
      url: "http://localhost:3100",
      env: { PORT: "3100", PUBLIC_BACKEND_URL: "http://localhost:3101" },
      reuseExistingServer: false,
    },
  ],
});
