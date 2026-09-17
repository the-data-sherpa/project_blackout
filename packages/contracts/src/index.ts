import { z } from "zod";
import { runMessageSchema } from "./runs.js";

export * from "./runs.js";
export * from "./telemetry.js";
export * from "./decisions.js";
export * from "./reports.js";
export * from "./investigations.js";

export const healthSchema = z.strictObject({
  status: z.literal("ok"),
  service: z.literal("blackout-server"),
  database: z.literal("ready"),
});

const connectionReadySchema = z.strictObject({
  type: z.literal("connection.ready"),
  protocolVersion: z.literal(1),
});

export const serverMessageSchema = z.union([
  connectionReadySchema,
  runMessageSchema,
]);

export type Health = z.infer<typeof healthSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
