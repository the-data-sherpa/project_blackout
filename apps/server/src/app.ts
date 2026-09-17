import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import {
  activeRunSchema,
  apiErrorSchema,
  healthSchema,
  recordingSchema,
  runIdSchema,
  runListQuerySchema,
  serverMessageSchema,
  startRunSchema,
} from "@blackout/contracts";
import { openDatabase } from "./database.js";
import { Recordings } from "./recordings.js";
import { RunError, Runs } from "./runs.js";

type AppOptions = {
  databasePath: string;
  webOrigin: string;
  logLevel?: string;
  schedule?: (tick: () => void) => () => void;
};

function scheduleTicks(tick: () => void) {
  const timer = setInterval(tick, 1000);
  timer.unref();
  return () => clearInterval(timer);
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw Object.assign(new Error("Invalid request"), { statusCode: 400 });
  return parsed.data;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logLevel ? { level: options.logLevel } : false,
  });
  const database = openDatabase(options.databasePath);
  let stopTicks: (() => void) | undefined;
  let runs: Runs | undefined;
  app.addHook("onClose", async () => {
    stopTicks?.();
    try {
      runs?.interrupt();
    } finally {
      database.close();
    }
  });

  try {
    const service = new Runs(new Recordings(database));
    runs = service;
    stopTicks = (options.schedule ?? scheduleTicks)(() => service.tick());
    await app.register(cors, { origin: options.webOrigin });
    await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

    app.setErrorHandler((error, _request, reply) => {
      if (
        error instanceof Error &&
        "statusCode" in error &&
        error.statusCode === 400
      ) {
        return reply.code(400).send(
          apiErrorSchema.parse({
            code: "invalid_input",
            message:
              "Use a seed of 1–128 characters, a duration of 1–120 whole seconds, a supported comparison fixture, and a valid run ID.",
          }),
        );
      }
      if (error instanceof RunError) {
        return reply
          .code(error.code === "run_active" ? 409 : 503)
          .send(
            apiErrorSchema.parse({ code: error.code, message: error.message }),
          );
      }
      app.log.error(error);
      return reply.code(503).send(
        apiErrorSchema.parse({
          code: "recording_unavailable",
          message:
            "Recording storage is unavailable. Check the backend and retry.",
        }),
      );
    });

    app.post("/api/runs", async (request, reply) => {
      const recording = service.start(parseInput(startRunSchema, request.body));
      return reply.code(201).send(recordingSchema.parse(recording));
    });

    app.get("/api/runs", async (request) => {
      const { offset, limit } = parseInput(runListQuerySchema, request.query);
      return service.recordings.list(offset, limit);
    });

    app.get("/api/runs/active", async () =>
      activeRunSchema.parse({ runId: service.recordings.active()?.id ?? null }),
    );

    app.get("/api/runs/:id", async (request, reply) => {
      const { id } = parseInput(
        z.strictObject({ id: runIdSchema }),
        request.params,
      );
      const recording = service.recordings.get(id);
      if (!recording)
        return reply.code(404).send(
          apiErrorSchema.parse({
            code: "not_found",
            message: "This recording was not found.",
          }),
        );
      return recording;
    });

    app.get("/api/runs/:id/truth", async (request, reply) => {
      const { id } = parseInput(
        z.strictObject({ id: runIdSchema }),
        request.params,
      );
      if (!service.recordings.get(id))
        return reply.code(404).send(
          apiErrorSchema.parse({
            code: "not_found",
            message: "This recording was not found.",
          }),
        );
      return { records: service.recordings.truth(id) };
    });

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
            return;
          }
          const { runId } = parseInput(
            z.strictObject({ runId: runIdSchema.optional() }),
            request.query,
          );
          if (runId && !service.recordings.get(runId))
            await reply.code(404).send({ error: "Recording not found" });
        },
      },
      (socket, request) => {
        socket.send(
          JSON.stringify(
            serverMessageSchema.parse({
              type: "connection.ready",
              protocolVersion: 1,
            }),
          ),
        );
        const { runId } = z
          .strictObject({ runId: runIdSchema.optional() })
          .parse(request.query);
        if (!runId) return;
        const send = (message: unknown) => {
          if (socket.readyState !== 1) return;
          // A slow or disconnected browser must not stop the recorder.
          if (socket.bufferedAmount > 1024 * 1024) {
            socket.close(1013, "Reconnect to load saved events");
            return;
          }
          try {
            socket.send(JSON.stringify(serverMessageSchema.parse(message)));
          } catch {
            socket.terminate();
          }
        };
        const unsubscribe = service.subscribe((message) => {
          const id =
            message.type === "run.updated"
              ? message.run.id
              : message.type === "run.snapshot"
                ? message.recording.run.id
                : message.runId;
          if (id === runId) send(message);
        });
        socket.on("close", unsubscribe);
        socket.on("error", unsubscribe);
        send({
          type: "run.snapshot",
          recording: service.recordings.get(runId),
        });
        if (service.recordingFailure?.runId === runId)
          send(service.recordingFailure);
      },
    );
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
