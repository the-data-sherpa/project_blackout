"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  activeRunSchema,
  fixtureSchema,
  type Fixture,
  apiErrorSchema,
  recordingSchema,
  runIdSchema,
  startRunSchema,
  type Recording,
} from "@blackout/contracts";
import { RunBrowser } from "./run-browser";
import { TelemetryInspector } from "./telemetry-inspector";
import { DecisionInspector } from "./decision-inspector";
import { EvaluationReports } from "./evaluation-reports";
import { useRunStream } from "./use-run-stream";
import { RunControls } from "./run-controls";

const buttonClass =
  "min-h-11 rounded border border-slate-500 px-4 py-2 text-sm hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-60";
const statusLabels = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

export function RunConsole({ backendUrl }: { backendUrl: string }) {
  const [fixture, setFixture] = useState<Fixture>("baseline");
  const [evaluate, setEvaluate] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [seed, setSeed] = useState("blackout-demo-001");
  const [duration, setDuration] = useState("30");
  const [runId, setRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState("Not connected");
  const [attempt, setAttempt] = useState(0);
  const [setupAttempt, setSetupAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    async function load() {
      try {
        const selected = new URL(window.location.href).searchParams.get("run");
        let id: string | null;
        if (selected !== null) id = runIdSchema.parse(selected);
        else {
          const response = await fetch(
            new URL("/api/runs/active", backendUrl),
            { signal: controller.signal, cache: "no-store" },
          );
          if (!response.ok)
            throw new Error(
              "Could not check the active run. Check the backend and refresh the page.",
            );
          id = activeRunSchema.parse(await response.json()).runId;
          if (!disposed) setActiveRunId(id);
        }
        if (!disposed) setRunId(id);
      } catch {
        if (!disposed)
          setError(
            "Could not load the run. Check the backend and the run ID in the address, then refresh the page.",
          );
      } finally {
        window.clearTimeout(timeout);
        if (!disposed) setBusy(false);
      }
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [backendUrl, setupAttempt]);

  useRunStream({
    backendUrl,
    runId,
    attempt,
    setRecording,
    setStream,
    setError,
    setActiveRunId,
  });

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = startRunSchema.safeParse({
      seed,
      durationSeconds: Number(duration),
      fixture: interactive ? "baseline" : fixture,
      evaluate,
      interactive,
      commandId: crypto.randomUUID(),
    });
    if (!input.success) {
      setError(
        "Enter a seed of 1–128 characters and a duration of 1–120 whole seconds.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(new URL("/api/runs", backendUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(apiErrorSchema.parse(await response.json()).message);
      const saved = recordingSchema.parse(await response.json());
      setRecording(saved);
      setRunId(saved.run.id);
      setActiveRunId(saved.run.id);
      const url = new URL(window.location.href);
      url.searchParams.set("run", saved.run.id);
      url.searchParams.delete("decision");
      window.history.replaceState(null, "", url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start the run. Check the backend.",
      );
    } finally {
      setBusy(false);
    }
  }

  const run = recording?.run;
  function selectRun(id: string) {
    setError(null);
    if (id !== runId) setRecording(null);
    setRunId(id);
    setAttempt((value) => value + 1);
    const url = new URL(window.location.href);
    url.searchParams.set("run", id);
    url.searchParams.delete("decision");
    window.history.replaceState(null, "", url);
  }
  const loading = busy || (runId !== null && run?.id !== runId);
  return (
    <section className="min-w-0 space-y-6 py-8" aria-labelledby="runs-title">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">
          Observable telemetry
        </p>
        <h1
          id="runs-title"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Start a recorded run.
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-slate-300">
          Inspect a synthetic organization, watch its telemetry and trace
          rolling state to recorded evidence. The same versioned inputs
          reproduce the stream. Enable Jev to record model decisions alongside
          the evidence.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          void start(event);
        }}
        className="rounded-lg border border-slate-700 bg-slate-900/40 p-5 sm:p-6"
      >
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_auto]">
          <label className="min-w-0 text-sm text-slate-300">
            Seed
            <input
              className="mt-2 block min-h-11 w-full rounded border border-slate-500 bg-slate-950 px-3 font-mono text-slate-100"
              name="seed"
              required
              maxLength={128}
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
          <label className="min-w-0 text-sm text-slate-300">
            Duration (simulation seconds)
            <input
              className="mt-2 block min-h-11 w-full rounded border border-slate-500 bg-slate-950 px-3 text-slate-100"
              name="duration"
              type="number"
              required
              min={1}
              max={120}
              step={1}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <button
            className={`${buttonClass} bg-emerald-300 font-medium text-slate-950 hover:bg-emerald-200`}
            disabled={
              loading || activeRunId !== null || run?.status === "running"
            }
            type="submit"
          >
            {loading ? "Loading…" : "Start run"}
          </button>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={interactive}
            onChange={(event) => {
              setInteractive(event.target.checked);
              if (event.target.checked) setDuration("95");
            }}
            className="h-5 w-5"
          />
          Interactive mode — start normal, then begin and stop a scenario
        </label>
        <label className="mt-4 block text-sm text-slate-300">
          Comparison fixture (scheduled)
          <select
            className="mt-2 block min-h-11 w-full rounded border border-slate-500 bg-slate-950 px-3 text-slate-100"
            name="fixture"
            disabled={interactive}
            value={fixture}
            onChange={(event) => {
              const selected = fixtureSchema.parse(event.target.value);
              setFixture(selected);
              if (
                selected === "credential-compromise" ||
                selected === "benign-maintenance"
              )
                setDuration("95");
            }}
          >
            <option value="baseline">Baseline only</option>
            <option value="credential-compromise">
              Full credential compromise
            </option>
            <option value="benign-maintenance">
              Benign maintenance control
            </option>
            <option value="credential-attack">Minimal credential attack</option>
            <option value="harmless-anomaly">Harmless anomaly</option>
          </select>
        </label>
        {!interactive &&
          (fixture === "credential-compromise" ||
            fixture === "benign-maintenance") && (
            <p className="mt-3 text-sm text-slate-300">
              Injection starts at 5 s and stops at 35 s. A 95-second run
              includes 60 seconds of continued baseline traffic after the stop.
              Shorter runs contain only their elapsed stages. Scenario choice
              does not set Jev’s judgment.
            </p>
          )}
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            name="evaluate"
            checked={evaluate}
            onChange={(event) => setEvaluate(event.target.checked)}
            className="h-5 w-5"
          />
          Evaluate with Jev (uses API credits)
        </label>
        <p className="mt-2 text-sm text-slate-400">
          With default settings, this run uses{" "}
          {Math.ceil(Number(duration || 0) / 5) + 1} requests, up to{" "}
          {(Math.ceil(Number(duration || 0) / 5) + 1) * 2} with retries. Missing
          credentials produce recorded unavailable attempts.
        </p>
        <p className="mt-3 text-sm text-slate-400">
          One active run at a time. Each run ends at its chosen duration.
        </p>
      </form>
      {activeRunId && activeRunId !== runId && (
        <p className="text-sm text-slate-300">
          A run is still active.{" "}
          <button
            className="min-h-11 underline underline-offset-4"
            onClick={() => selectRun(activeRunId)}
          >
            View active run
          </button>
        </p>
      )}
      <RunBrowser
        backendUrl={backendUrl}
        selectedId={runId}
        refreshKey={`${run?.id ?? ""}:${run?.status ?? ""}`}
        onSelect={selectRun}
        onActiveRun={setActiveRunId}
      />
      <EvaluationReports backendUrl={backendUrl} />
      {error && (
        <div
          role="alert"
          className="rounded border border-amber-500/60 bg-amber-950/30 p-4 text-sm text-amber-100"
        >
          {error}
          {!recording && (
            <button
              type="button"
              onClick={() => {
                setBusy(true);
                setError(null);
                setRecording(null);
                setRunId(null);
                window.history.replaceState(null, "", "/");
                setSetupAttempt((value) => value + 1);
              }}
              className="mt-3 block underline underline-offset-4"
            >
              Return to run setup
            </button>
          )}
        </div>
      )}
      {!run && (
        <p
          role="status"
          className="rounded-lg border border-dashed border-slate-600 p-8 text-slate-300"
        >
          {error
            ? "No recording loaded. Resolve the error above to continue."
            : busy || runId
              ? "Loading recording…"
              : "No run selected. Start a run to see its clock and recorded events."}
        </p>
      )}
      {run && recording && (
        <section
          className="min-w-0 rounded-lg border border-slate-700 p-5 sm:p-6"
          aria-labelledby="recording-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="recording-title" className="text-xl font-medium">
                Recorded run
              </h2>
              <p
                className="mt-2 break-all font-mono text-xs text-slate-400"
                data-testid="run-id"
              >
                {run.id}
              </p>
            </div>
            <button
              className={buttonClass}
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Refresh recording
            </button>
          </div>
          <dl className="my-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-slate-400">Last saved status</dt>
              <dd role="status" className="mt-2 font-mono text-emerald-300">
                {run.status === "running" && run.controls?.paused
                  ? "Paused"
                  : statusLabels[run.status]}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-400">Simulation time</dt>
              <dd className="mt-2 font-mono" data-testid="simulation-time">
                {(run.simulationTimeMs / 1000).toFixed(1)} /{" "}
                {run.manifest.durationSeconds} s
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-400">Saved events</dt>
              <dd className="mt-2 font-mono" data-testid="event-count">
                {run.lastSequence}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-400">Live updates</dt>
              <dd className="mt-2 font-mono text-sm">{stream}</dd>
            </div>
          </dl>
          <RunControls
            key={`controls-${run.id}`}
            recording={recording}
            connected={stream === "Connected"}
            canReset={
              stream === "Connected" ||
              (stream === "Recorded" && activeRunId === null)
            }
            backendUrl={backendUrl}
            onSaved={(saved) => {
              if (saved.run.id !== run.id) {
                setRecording(saved);
                selectRun(saved.run.id);
                setActiveRunId(saved.run.id);
              } else
                setRecording((previous) =>
                  previous?.run.id === saved.run.id &&
                  previous.run.revision > saved.run.revision
                    ? previous
                    : saved,
                );
            }}
          />
          {run.status !== "running" && (
            <p className="mb-5 text-sm text-slate-300">
              Viewing saved events. Opening this recording does not restart
              generation.
            </p>
          )}
          {run.status === "failed" && (
            <p className="mb-5 text-sm text-amber-200">
              Recording stopped after a write failure. Only committed events are
              available.
            </p>
          )}
          {stream === "Disconnected" && (
            <p className="mb-5 text-sm text-amber-200">
              Live updates disconnected. Reconnecting automatically; controls
              return after the saved state is synchronized.
            </p>
          )}
          {run.status === "interrupted" && (
            <p className="mb-5 text-sm text-amber-200">
              {run.endedReason === "reset"
                ? "Reset ended this run. Its evidence and decisions are retained."
                : "The backend stopped before this run finished. These are its saved events."}
            </p>
          )}
          <details className="mb-6 rounded border border-slate-600 p-4">
            <summary className="cursor-pointer font-medium">
              Manifest and command log
            </summary>
            <p className="mt-3 text-sm text-slate-400">
              Versioned inputs and command times define this run. Event records
              below contain observable evidence.
            </p>
            <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-300">
              {JSON.stringify(
                {
                  manifest: run.manifest,
                  createdAt: run.createdAt,
                  endedAt: run.endedAt,
                  commands: recording.commands,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <DecisionInspector
            key={`decisions-${run.id}`}
            recording={recording}
            connected={stream === "Connected"}
          />
          <TelemetryInspector
            key={run.id}
            recording={recording}
            backendUrl={backendUrl}
          />
        </section>
      )}
    </section>
  );
}
