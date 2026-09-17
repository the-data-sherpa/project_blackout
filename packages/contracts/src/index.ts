import { z } from "zod";

export const healthSchema = z.strictObject({
  status: z.literal("ok"),
  service: z.literal("blackout-server"),
  database: z.literal("ready"),
});

export const serverMessageSchema = z.strictObject({
  type: z.literal("connection.ready"),
  protocolVersion: z.literal(1),
});

export type Health = z.infer<typeof healthSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
