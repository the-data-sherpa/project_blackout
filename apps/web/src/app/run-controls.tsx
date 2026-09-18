"use client";

import { useEffect, useRef, useState } from "react";
import {
  apiErrorSchema,
  interactiveFixtureSchema,
  recordingSchema,
  speedSchema,
  type ControlRun,
  type Recording,
} from "@blackout/contracts";

const button =
  "min-h-11 rounded border border-slate-500 px-4 py-2 text-sm hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-60";
export function RunControls({
  recording,
  connected,
  canReset,
  backendUrl,
  onSaved,
  onNewRun,
}: {
  recording: Recording;
  connected: boolean;
  canReset: boolean;
  backendUrl: string;
  onSaved: (saved: Recording) => void;
  onNewRun: () => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { run } = recording;
  const controls = run.controls;
  const [scenario, setScenario] = useState<
    "credential-compromise" | "benign-maintenance"
  >("credential-compromise");
  const [sending, setSending] = useState(false);
  const [retry, setRetry] = useState<ControlRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (run.manifest.schemaVersion !== 2) return null;
  const disabled = !connected || sending || retry !== null;
  const injecting =
    controls?.injection != null && controls.injection.stoppedAtMs === null;
  const interactive =
    run.manifest.schemaVersion === 2 && run.manifest.interactive;
  const elapsed = Math.max(
    controls?.elapsedWallMs ?? 0,
    now ? now - Date.parse(run.createdAt) : 0,
  );
  async function send(request: ControlRun) {
    setSending(true);
    setError(null);
    let rejected = false;
    try {
      const response = await fetch(
        new URL(`/api/runs/${run.id}/commands`, backendUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!mounted.current) return;
      if (!response.ok) {
        const failure = apiErrorSchema.parse(await response.json());
        if (response.status < 500) {
          rejected = true;
          setRetry(null);
        } else setRetry(request);
        throw new Error(failure.message);
      }
      const saved = recordingSchema.parse(await response.json());
      if (!mounted.current) return;
      setRetry(null);
      onSaved(saved);
    } catch (cause) {
      if (!mounted.current) return;
      // A lost acknowledgement is retried only by the operator, with the same durable ID.
      if (!rejected) setRetry(request);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not confirm the command. Reconnect and retry it.",
      );
    } finally {
      setSending(false);
    }
  }
  if (!controls || run.status !== "running")
    return (
      <section
        aria-label="Simulation controls"
        className="mb-3 space-y-2 rounded border border-slate-700 p-3"
      >
        <details id="simulation-controls">
          <summary className="min-h-8 cursor-pointer text-sm">
            Simulation controls
          </summary>
          <button className={button} onClick={onNewRun}>
            Set up a new run
          </button>
          <button
            className={button}
            disabled={!canReset || sending || retry !== null}
            onClick={() =>
              void send({ commandId: crypto.randomUUID(), type: "reset" })
            }
          >
            Reset run
          </button>
          <p className="text-xs text-slate-400">
            Reset starts the same seed from zero and retains this recording.
            Available when no other run is active.
          </p>
        </details>
        {error && (
          <p role="alert" className="text-sm text-amber-200">
            {error}
          </p>
        )}
        {retry && (
          <button
            className={button}
            disabled={sending}
            onClick={() => void send(retry)}
          >
            Retry unconfirmed command
          </button>
        )}
      </section>
    );
  return (
    <section
      aria-label="Simulation controls"
      className="mb-3 space-y-2 rounded border border-emerald-400/40 bg-emerald-950/10 p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={button}
          disabled={disabled}
          onClick={() =>
            void send({
              commandId: crypto.randomUUID(),
              type: controls.paused ? "resume" : "pause",
            })
          }
        >
          {controls.paused ? "Resume" : "Pause"} simulation
        </button>
        <label className="flex min-w-0 items-center gap-2 text-sm">
          Simulation speed
          <select
            aria-label="Requested speed"
            value={controls.requestedSpeed}
            disabled={disabled}
            className="min-h-11 rounded border border-slate-500 bg-slate-950 px-3"
            onChange={(event) =>
              void send({
                commandId: crypto.randomUUID(),
                type: "set-speed",
                speed: speedSchema.parse(Number(event.target.value)),
              })
            }
          >
            {[0.25, 0.5, 1, 2, 5].map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <details id="simulation-controls" className="space-y-2">
        <summary className="min-h-8 cursor-pointer text-sm">
          Simulation controls
        </summary>
        <div className="flex flex-wrap gap-3">
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              void send({ commandId: crypto.randomUUID(), type: "reset" })
            }
          >
            Reset run
          </button>
          <button className={button} onClick={onNewRun}>
            Set up a new run
          </button>
        </div>
        {interactive && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 text-sm">
              Scenario
              <select
                value={scenario}
                disabled={disabled || injecting}
                className="mt-2 block min-h-11 max-w-full rounded border border-slate-500 bg-slate-950 px-3"
                onChange={(event) =>
                  setScenario(
                    interactiveFixtureSchema.parse(event.target.value),
                  )
                }
              >
                <option value="credential-compromise">
                  Credential compromise
                </option>
                <option value="benign-maintenance">Benign maintenance</option>
              </select>
            </label>
            <button
              className={button}
              disabled={
                disabled ||
                injecting ||
                run.simulationTimeMs >= run.manifest.durationSeconds * 1000
              }
              onClick={() =>
                void send({
                  commandId: crypto.randomUUID(),
                  type: "begin-injection",
                  fixture: scenario,
                })
              }
            >
              {scenario === "credential-compromise"
                ? "Begin Attack"
                : "Begin Control"}
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={button}
            disabled={disabled || !injecting}
            onClick={() =>
              void send({
                commandId: crypto.randomUUID(),
                type: "stop-injection",
              })
            }
          >
            {controls.injection?.fixture === "benign-maintenance"
              ? "Stop Control"
              : "Stop Attack"}
          </button>
          <p className="text-sm text-slate-300">
            {injecting
              ? `Injecting ${controls.injection!.fixture === "credential-compromise" ? "attack" : "benign control"} activity`
              : interactive
                ? "Normal mode — baseline telemetry"
                : "Scheduled fixture"}
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Stop ends injection; baseline traffic continues and existing evidence
          remains. Scenarios end after 30 simulation seconds. Reset starts the
          same seed from zero and retains this recording.
        </p>
      </details>
      <p role="status" className="text-sm text-emerald-200">
        {!connected
          ? "Controls unavailable while reconnecting."
          : sending
            ? "Saving command…"
            : controls.paused
              ? "Paused — simulation time and live decisions are frozen."
              : controls.waitingForInference
                ? "Waiting for Jev — checkpoint held; requested speed may not be reached."
                : "Generating telemetry."}
        {controls.pendingApplication &&
          " A recorded result is held until resume."}
      </p>
      <p className="text-sm text-slate-300" data-testid="actual-progress">
        Average progress:{" "}
        {elapsed > 0 ? (run.simulationTimeMs / elapsed).toFixed(2) : "0.00"}×
        since start, including pauses and inference waits.
      </p>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      {retry && (
        <button
          className={button}
          disabled={!connected || sending}
          onClick={() => void send(retry)}
        >
          Retry unconfirmed command
        </button>
      )}
    </section>
  );
}
