import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import {
  activeRunSchema,
  controlRunSchema,
  investigationActionSchema,
  apiErrorSchema,
  healthSchema,
  recordingSchema,
  runIdSchema,
  runListQuerySchema,
  serverMessageSchema,
  startRunSchema,
  type RunMessage,
} from "@blackout/contracts";
import { openDatabase } from "./database.js";
import { Recordings } from "./recordings.js";
import { RunError, Runs } from "./runs.js";
import type { EvaluatorOptions } from "./evaluator.js";
import { defaultEvaluation } from "./evaluator.js";
import { createEvaluationReport } from "./evaluation-report.js";

type AppOptions = {
  databasePath: string;
  webOrigin: string;
  logLevel?: string;
  schedule?: (tick: () => void) => () => void;
  evaluator?: EvaluatorOptions;
};

function scheduleTicks(tick: () => void) {
  const timer = setInterval(tick, 25);
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
      await runs?.close();
    } finally {
      database.close();
    }
  });

  try {
    const service = new Runs(new Recordings(database), options.evaluator);
    runs = service;
    stopTicks = options.schedule
      ? options.schedule(() => service.tick())
      : scheduleTicks(() => service.pulse());
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
          .code(error.code === "recording_unavailable" ? 503 : 409)
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

    app.post("/api/runs/:id/commands", async (request) => {
      const { id } = parseInput(
        z.strictObject({ id: runIdSchema }),
        request.params,
      );
      return service.control(id, parseInput(controlRunSchema, request.body));
    });

    app.get("/api/evaluator", async () => ({
      configured: Boolean(options.evaluator?.apiKey),
      model: options.evaluator?.model ?? "jev-1.13.0",
      config: options.evaluator?.config ?? defaultEvaluation,
    }));

    app.post("/api/runs/:id/investigation-actions", async (request, reply) => {
      const { id } = parseInput(
        z.strictObject({ id: runIdSchema }),
        request.params,
      );
      if (!service.recordings.run(id))
        return reply.code(404).send(
          apiErrorSchema.parse({
            code: "not_found",
            message: "This recording was not found.",
          }),
        );
      return service.investigate(
        id,
        parseInput(investigationActionSchema, request.body),
      );
    });

    app.get("/api/evaluation-reports", async () => ({
      reports: service.recordings.reports(),
    }));
    app.post("/api/evaluation-reports", async (request, reply) => {
      const { runIds } = parseInput(
        z.strictObject({
          runIds: z
            .array(runIdSchema)
            .min(1)
            .max(30)
            .refine((ids) => new Set(ids).size === ids.length),
        }),
        request.body,
      );
      const records = runIds.map((id) => ({
        recording: service.recordings.get(id),
        truth: service.recordings.truth(id),
      }));
      if (
        records.some(
          ({ recording }) =>
            !recording ||
            recording.run.status !== "completed" ||
            recording.run.manifest.schemaVersion !== 2 ||
            recording.run.manifest.interactive ||
            recording.commands.some(
              (command) => command.request && command.type === "stop-injection",
            ) ||
            !recording.run.manifest.evaluation,
        )
      )
        return reply.code(400).send(
          apiErrorSchema.parse({
            code: "invalid_input",
            message:
              "Select completed, scheduled Jev-evaluated runs for the report. Interactive runs have operator-defined timing.",
          }),
        );
      const report = createEvaluationReport(
        records.map(({ recording, truth }) => ({
          recording: recording!,
          truth,
        })),
      );
      service.recordings.saveReport(report);
      return reply.code(201).send(report);
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
        let initialBytes = 0;
        const send = (message: RunMessage) => {
          if (socket.readyState !== 1) return;
          // A slow or disconnected browser must not stop the recorder.
          // The bounded recording can itself exceed 1 MiB. Allow its initial
          // transfer plus at most 1 MiB of queued updates until it flushes.
          if (socket.bufferedAmount > initialBytes + 1024 * 1024) {
            socket.close(1013, "Reconnect to load saved events");
            return;
          }
          try {
            const payload = JSON.stringify(serverMessageSchema.parse(message));
            const initial = message.type === "run.snapshot";
            if (initial) initialBytes = Buffer.byteLength(payload);
            socket.send(payload, (error) => {
              if (initial) initialBytes = 0;
              if (error) socket.terminate();
            });
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
          recording: service.recordings.get(runId)!,
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
