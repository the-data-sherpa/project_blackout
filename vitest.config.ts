import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/server/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    restoreMocks: true,
  },
});
