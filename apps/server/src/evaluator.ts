import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  evaluationConfigSchema,
  inferenceAttemptSchema,
  jevRequestSchema,
  jevResponseSchema,
  summarizeInput,
  type EvaluationConfig,
  type InferenceAttempt,
  type JevRequest,
  type ObservableSnapshot,
  type PolicyConfig,
} from "@blackout/contracts";
import { defaultPolicy, evaluatePolicy } from "./policy.js";

export const defaultEvaluation: EvaluationConfig = {
  checkpointMs: 5000,
  timeoutMs: 15_000,
  maxAttempts: 2,
  retryDelayMs: 1000,
};
export const questionVersion = "security-questions/3";
export const questions: JevRequest["questions"] = {
  compromise: {
    type: "noul",
    instructions:
      "Does the observable telemetry indicate active credential compromise? Use the recent focus identity, its observed authentication/DNS/network groups, and rolling windows; unusual authorized behavior alone is insufficient. Groups include counts and first/last observation times within 30 seconds; at most 16 most recent groups are shown and omittedGroups discloses truncation. Larger windows contain historical activity, not necessarily current activity. Falling activity does not establish remediation.",
    criteria: {
      true: "Evidence supports unauthorized credential use.",
      false:
        "Observed activity is consistent with authorized behavior or lacks evidence of compromise.",
    },
  },
  classification: {
    type: "choice",
    instructions:
      "Which condition best describes the recent observed security activity? Judge current evidence, allowing for historical observations in longer windows.",
    criteria: {
      normal: "Routine authorized activity.",
      benign_anomaly:
        "Unusual activity consistent with the identity's established profile.",
      suspicious:
        "Concerning evidence, insufficient to establish credential compromise.",
      compromise: "Evidence of unauthorized credential use.",
    },
  },
  severity: {
    type: "score",
    instructions:
      "How severe is the current observed security activity? Assess impact indicated by the evidence, separately from certainty.",
    criteria: [
      "No material security impact",
      "Limited anomaly needing inspection",
      "Serious suspected unauthorized access",
      "Critical widespread unauthorized access",
    ],
  },
  response: {
    type: "choice",
    instructions:
      "Which advisory next step does the observable evidence warrant? This recommends analyst attention only; no containment is executed.",
    criteria: {
      observe: "Continue observing routine or explainable activity.",
      investigate: "Inspect suspicious or ambiguous evidence.",
      escalate:
        "Recommend urgent human incident review for apparent compromise.",
    },
  },
};

export type EvaluatorOptions = {
  apiKey?: string | undefined;
  model?: string;
  config?: EvaluationConfig;
  policy?: PolicyConfig;
  // Tests inject the transport; production always uses the official HTTPS endpoint.
  fetch?: typeof fetch;
};

class EvaluationFailure extends Error {
  constructor(
    readonly code: NonNullable<InferenceAttempt["error"]>["code"],
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

function sanitize(body: string, key: string | undefined) {
  let clean = key ? body.split(key).join("[REDACTED]") : body;
  clean = clean.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]");
  clean = clean.replace(
    /("(?:authorization|api[_-]?key|access[_-]?token|secret|password|cookie)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    '$1"[REDACTED]"',
  );
  return clean;
}

async function readBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65_536) {
        await reader.cancel();
        throw new EvaluationFailure(
          "malformed_response",
          "Jev response exceeded the 64 KiB recording limit.",
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

// The only outbound state is the strict observable input. Correlation stays local.
export class Evaluator {
  readonly config: EvaluationConfig;
  readonly policy: PolicyConfig;
  readonly model: string;
  constructor(private readonly options: EvaluatorOptions = {}) {
    this.config = evaluationConfigSchema.parse(
      options.config ?? defaultEvaluation,
    );
    this.policy = options.policy ?? defaultPolicy;
    this.model = options.model ?? "jev-1.13.0";
  }

  async checkpoint(
    snapshot: ObservableSnapshot,
    save: (attempt: InferenceAttempt) => void,
    signal: AbortSignal,
  ) {
    const request = jevRequestSchema.parse({
      model: this.model,
      state: summarizeInput(snapshot.input),
      questions,
    });
    for (
      let number = 1;
      number <= this.config.maxAttempts && !signal.aborted;
      number++
    ) {
      const started = performance.now();
      const pending: InferenceAttempt = inferenceAttemptSchema.parse({
        id: randomUUID(),
        runId: snapshot.runId,
        snapshotId: snapshot.id,
        simulationTimeMs: snapshot.simulationTimeMs,
        questionVersion,
        attemptNumber: number,
        request,
        status: "pending",
        startedAt: new Date().toISOString(),
        completedAt: null,
        latencyMs: null,
        response: null,
        responseBody: null,
        error: null,
        policy: null,
      });
      save(pending);
      let body: string | null = null;
      let response: InferenceAttempt["response"] = null;
      let failure: InferenceAttempt["error"] = null;
      const controller = new AbortController();
      const combined = AbortSignal.any([signal, controller.signal]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        if (!this.options.apiKey)
          throw new EvaluationFailure(
            "unavailable",
            "Jev is unavailable: configure JEV_API_KEY on the backend, then start a new run.",
          );
        const operation = async () => {
          const result = await (this.options.fetch ?? fetch)(
            "https://api.typesafe.ai/v1/systemone",
            {
              method: "POST",
              redirect: "error",
              signal: combined,
              headers: {
                Authorization: `Bearer ${this.options.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(request),
            },
          );
          // Failure bodies may contain proxy credentials or reflected headers. Do not record them.
          if (!result.ok) {
            await result.body?.cancel();
            throw new EvaluationFailure(
              "http_error",
              `Jev returned HTTP ${result.status}.`,
              result.status,
            );
          }
          const raw = sanitize(await readBody(result), this.options.apiKey);
          // A transport ignoring cancellation cannot mutate a settled attempt.
          if (combined.aborted)
            throw new EvaluationFailure("timeout", "Jev request expired.");
          body = raw;
          try {
            return jevResponseSchema.parse(JSON.parse(raw));
          } catch {
            throw new EvaluationFailure(
              "malformed_response",
              "Jev returned a response that does not match the requested question contract.",
            );
          }
        };
        response = await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            onAbort = () =>
              reject(
                new EvaluationFailure(
                  signal.aborted ? "interrupted" : "timeout",
                  signal.aborted
                    ? "Evaluation interrupted by backend shutdown."
                    : `Jev exceeded the ${this.config.timeoutMs} ms timeout.`,
                ),
              );
            combined.addEventListener("abort", onAbort, { once: true });
            if (combined.aborted) onAbort();
            timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
          }),
        ]);
      } catch (error) {
        failure =
          error instanceof EvaluationFailure
            ? {
                code: error.code,
                message: error.message,
                httpStatus: error.httpStatus,
              }
            : {
                code: "unavailable",
                message:
                  "Jev could not be reached. Check backend connectivity; future checkpoints will try again.",
                httpStatus: null,
              };
      } finally {
        clearTimeout(timer);
        if (onAbort) combined.removeEventListener("abort", onAbort);
      }
      const attempt = inferenceAttemptSchema.parse({
        ...pending,
        status: failure ? "failed" : "succeeded",
        completedAt: new Date().toISOString(),
        latencyMs: Math.max(0, performance.now() - started),
        response,
        responseBody: body,
        error: failure,
        policy: evaluatePolicy(response, this.policy),
      });
      save(attempt);
      const retryable =
        failure &&
        (failure.code === "timeout" ||
          (failure.code === "unavailable" && !!this.options.apiKey) ||
          (failure.code === "http_error" &&
            (failure.httpStatus === 429 || (failure.httpStatus ?? 0) >= 500)));
      if (!retryable || number === this.config.maxAttempts) return;
      try {
        await delay(this.config.retryDelayMs, undefined, { signal });
      } catch {
        return;
      }
    }
  }
}
