"use client";

import { useEffect, useState } from "react";
import type { InferenceAttempt, Recording } from "@blackout/contracts";
import { visibleAttempts } from "./decision-view";

export const telemetryFreshnessMs = 30_000;
export type TelemetryReceipt = {
  runId: string;
  sequence: number;
  wallMs: number;
};

export function assessmentHealth(
  recording: Recording,
  selected?: InferenceAttempt | null,
) {
  const latest = selected ?? recording.attempts.at(-1);
  const success = visibleAttempts(recording).findLast(
    (attempt) => attempt.status === "succeeded" && attempt.appliedAt !== null,
  );
  const state = !latest
    ? "Never evaluated · risk unknown"
    : latest.status === "pending"
      ? latest.attemptNumber > 1
        ? "Retrying"
        : "Pending"
      : latest.appliedAt === null
        ? "Received / held until application"
        : latest.status === "failed"
          ? recording.run.controls?.waitingForInference
            ? "Retry pending after failure"
            : "Failed / unavailable"
          : "Successful / applied";
  return {
    state,
    latest,
    success,
    stale:
      !!success && latest?.status === "failed" && latest.appliedAt !== null,
    ageMs: success
      ? Math.max(0, recording.run.simulationTimeMs - success.simulationTimeMs)
      : null,
  };
}

export function PipelineHealth({
  recording,
  stream,
  receipt,
}: {
  recording: Recording;
  stream: string;
  receipt: TelemetryReceipt | null;
}) {
  const [now, setNow] = useState<number | null>(null);
  const live = recording.run.status === "running";
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  const { run } = recording;
  const health = assessmentHealth(recording);
  const event = recording.events.at(-1);
  const age = event
    ? Math.max(0, run.simulationTimeMs - event.simulationTimeMs)
    : null;
  const received =
    receipt?.runId === run.id && now !== null
      ? Math.max(0, (now - receipt.wallMs) / 1000)
      : null;
  return (
    <section
      aria-label={live ? "Live pipeline health" : "Recorded pipeline health"}
      className="pipeline-health mb-2 min-w-0 rounded border border-slate-700 px-3 py-1"
    >
      <p className="mb-1 font-mono text-[0.65rem] uppercase text-slate-400">
        {live
          ? "Live status · independent of inspection"
          : "Recorded status · end of recording"}
      </p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-slate-400">Connection</dt>
          <dd data-testid="pipeline-connection">
            {live ? stream : "Offline playback · no live transport"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Telemetry freshness</dt>
          <dd data-testid="pipeline-telemetry">
            {age === null
              ? "Unknown · no telemetry"
              : `${age > telemetryFreshnessMs ? "Quiet / stale" : "Fresh"} · ${(age / 1000).toFixed(1)} simulation s`}
            {live && run.controls?.paused && " · simulation paused"}
            {live &&
              received !== null &&
              ` · received ${received.toFixed(0)} wall s ago`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Evaluation</dt>
          <dd data-testid="pipeline-evaluation">
            {health.state}
            {health.stale && " · prior success retained, stale"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Measured request latency</dt>
          <dd data-testid="pipeline-latency">
            {health.latest?.latencyMs == null
              ? "Unknown / unavailable"
              : `${health.latest.latencyMs.toFixed(0)} ms · wall time`}
          </dd>
        </div>
      </dl>
      <details className="mt-1 text-xs text-slate-400">
        <summary className="cursor-pointer">
          {live ? "Live status" : "Recorded status"} · timing and last success
        </summary>
        <p>
          Telemetry is quiet / stale after more than 30 simulation seconds
          without an observation. Pauses and quiet telemetry do not prove
          disconnection. Receipt age is wall time since this browser received
          telemetry; it does not age risk.
        </p>
        <p>
          {health.success
            ? `Last applied success: snapshot ${health.success.simulationTimeMs / 1000} s; received ${health.success.completedAt ?? "time unavailable"}; age ${(health.ageMs! / 1000).toFixed(1)} simulation s.`
            : "No applied success recorded. Risk remains unknown."}
        </p>
        {health.latest?.error && (
          <p>
            Recorded failure: {health.latest.error.code} ·{" "}
            {health.latest.error.message}
          </p>
        )}
        {!live && (
          <p>
            Live connection and browser receipt age are unavailable during
            recorded playback.
          </p>
        )}
      </details>
    </section>
  );
}

export function InspectedAssessmentHealth({
  recording,
  assessment,
}: {
  recording: Recording;
  assessment: InferenceAttempt | null;
}) {
  const health = assessmentHealth(recording, assessment);
  return (
    <p className="mt-1 text-xs text-slate-300" data-testid="inspected-health">
      Inspected assessment: {health.state}
      {health.ageMs !== null
        ? ` · last applied snapshot age ${(health.ageMs / 1000).toFixed(1)} simulation s`
        : " · no applied success"}
      .{" "}
      {health.latest?.latencyMs != null
        ? `Recorded latency ${health.latest.latencyMs.toFixed(0)} wall ms.`
        : "Recorded latency unavailable."}
    </p>
  );
}
