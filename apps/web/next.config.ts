import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  agentRules: false,
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@blackout/contracts"],
  poweredByHeader: false,
};

export default config;
