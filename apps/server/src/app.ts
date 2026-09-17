import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { healthSchema, serverMessageSchema } from "@blackout/contracts";
import { openDatabase } from "./database.js";

type AppOptions = {
  databasePath: string;
  webOrigin: string;
  logLevel?: string;
};

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logLevel ? { level: options.logLevel } : false,
  });
  const database = openDatabase(options.databasePath);
  app.addHook("onClose", async () => {
    database.close();
  });

  try {
    await app.register(cors, { origin: options.webOrigin });
    await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

    app.get("/api/health", async () => {
      database.prepare("SELECT 1").get();
      return healthSchema.parse({
        status: "ok",
        service: "blackout-server",
        database: "ready",
      });
    });

    app.get(
      "/ws",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          const origin = request.headers.origin;
          if (origin && origin !== options.webOrigin) {
            await reply.code(403).send({ error: "Origin not allowed" });
          }
        },
      },
      (socket) => {
        socket.send(
          JSON.stringify(
            serverMessageSchema.parse({
              type: "connection.ready",
              protocolVersion: 1,
            }),
          ),
        );
      },
    );
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
