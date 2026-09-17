import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_PATH: z.string().min(1).default("./data/blackout.sqlite"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return {
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    webOrigin: new URL(parsed.WEB_ORIGIN).origin,
    databasePath:
      parsed.DATABASE_PATH === ":memory:"
        ? ":memory:"
        : resolve(repositoryRoot, parsed.DATABASE_PATH),
    logLevel: parsed.LOG_LEVEL,
  };
}
