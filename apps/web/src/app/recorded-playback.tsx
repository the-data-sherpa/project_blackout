"use client";

import { useEffect, useMemo, useState } from "react";
import {
  recordingSchema,
  type InferenceAttempt,
  type Recording,
} from "@blackout/contracts";
import { PlaybackIndex } from "./playback";
import { RunInspection } from "./run-inspection";

const control =
  "min-h-11 rounded border border-slate-500 bg-slate-950 px-3 py-2 text-sm hover:border-emerald-300 disabled:opacity-50";
const speeds = [0.25, 0.5, 1, 2, 5] as const;

function finalAttempt(attempts: InferenceAttempt[], simulationTimeMs: number) {
  return attempts
    .filter((attempt) => attempt.simulationTimeMs === simulationTimeMs)
    .at(-1);
}

function outcome(attempt: InferenceAttempt | undefined) {
  if (!attempt) return "Not recorded";
  if (attempt.status === "failed") return `Failed: ${attempt.error?.code}`;
  if (attempt.status === "pending") return "Pending";
  return `${attempt.response!.answers.classification.choice} · ${(attempt.response!.answers.compromise.noul * 100).toFixed(1)}%`;
}

function ReevaluationComparison({
  recording,
  backendUrl,
}: {
  recording: Recording;
  backendUrl: string;
}) {
  const derivation = recording.run.derivation;
  const [source, setSource] = useState<Recording | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (derivation?.type !== "reevaluation") return;
    const controller = new AbortController();
    void fetch(new URL(`/api/runs/${derivation.sourceRunId}`, backendUrl), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Source recording unavailable");
        setSource(recordingSchema.parse(await response.json()));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [backendUrl, derivation]);
  if (derivation?.type !== "reevaluation") return null;
  const checkpoints = [
    ...new Set(recording.attempts.map((attempt) => attempt.simulationTimeMs)),
  ].sort((a, b) => a - b);
  return (
    <section
      className="mb-6 rounded border border-violet-400/40 bg-violet-950/10 p-4"
      aria-labelledby="reevaluation-comparison-title"
    >
      <h3 id="reevaluation-comparison-title" className="font-medium">
        Original and fresh outcomes
      </h3>
      <p className="mt-2 text-sm text-slate-300">
        Fresh Jev attempts use the source recording’s observable snapshots. The
        original decisions and policy results remain unchanged.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          The source recording could not be loaded for comparison.
        </p>
      )}
      {!source && !error && (
        <p role="status" className="mt-3 text-sm text-slate-400">
          Loading source outcomes…
        </p>
      )}
      {source && (
        <div className="mt-4 overflow-x-auto rounded border border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs text-slate-300">
              <tr>
                <th className="px-3 py-3 font-medium">Checkpoint</th>
                <th className="px-3 py-3 font-medium">Original</th>
                <th className="px-3 py-3 font-medium">Fresh reevaluation</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((time) => (
                <tr key={time} className="border-t border-slate-800">
                  <th className="px-3 py-3 font-mono font-normal">
                    {time / 1000} s
                  </th>
                  <td className="px-3 py-3">
                    {outcome(finalAttempt(source.attempts, time))}
                  </td>
                  <td className="px-3 py-3">
                    {outcome(finalAttempt(recording.attempts, time))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function RecordedPlayback({
  recording,
  backendUrl,
  onSaved,
}: {
  recording: Recording;
  backendUrl: string;
  onSaved: (recording: Recording) => void;
}) {
  const index = useMemo(() => new PlaybackIndex(recording), [recording]);
  const [cursorMs, setCursorMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCursorMs((cursor) => {
        const next = Math.min(index.endMs, cursor + 100 * speed);
        if (next === index.endMs) setPlaying(false);
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [index, playing, speed]);
  const projected = index.at(cursorMs);
  const seek = (value: number) =>
    setCursorMs(Math.max(0, Math.min(index.endMs, value)));
  return (
    <div className="min-w-0">
      <section
        className="mb-6 rounded-lg border border-emerald-400/50 bg-emerald-950/10 p-4 sm:p-5"
        aria-labelledby="playback-title"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">
          Recorded playback · offline · simulation read-only
        </p>
        <h3 id="playback-title" className="mt-2 text-lg font-medium">
          Playback controls
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          Stored telemetry, decisions, policy results and investigation actions
          only. Playback sends zero Jev requests and accepts no live commands.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={control}
            onClick={() => setPlaying((value) => !value)}
            disabled={
              index.endMs === 0 || (cursorMs === index.endMs && playing)
            }
          >
            {playing ? "Pause playback" : "Play recording"}
          </button>
          <button
            type="button"
            className={control}
            onClick={() => seek(cursorMs - 10_000)}
            disabled={cursorMs === 0}
          >
            −10 seconds
          </button>
          <button
            type="button"
            className={control}
            onClick={() => seek(cursorMs + 10_000)}
            disabled={cursorMs === index.endMs}
          >
            +10 seconds
          </button>
          <label className="text-sm text-slate-300">
            Speed
            <select
              className={`${control} ml-2`}
              value={speed}
              onChange={(event) =>
                setSpeed(Number(event.target.value) as (typeof speeds)[number])
              }
            >
              {speeds.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-4 block text-sm text-slate-300">
          Timeline · {(cursorMs / 1000).toFixed(1)} / {index.endMs / 1000} s
          <input
            className="mt-2 block min-h-11 w-full accent-emerald-300"
            aria-label="Recording timeline"
            type="range"
            min={0}
            max={index.endMs}
            step={Math.min(1000, Math.max(1, index.endMs))}
            value={cursorMs}
            onChange={(event) => {
              setPlaying(false);
              seek(Number(event.target.value));
            }}
          />
        </label>
        <p role="status" className="mt-2 font-mono text-sm text-emerald-200">
          {playing ? "Playing" : "Paused"} at {(cursorMs / 1000).toFixed(1)} s
        </p>
      </section>
      <ReevaluationComparison recording={recording} backendUrl={backendUrl} />
      <RunInspection
        recording={projected}
        connected={false}
        activityAnimation={playing}
        readOnly={
          cursorMs !== index.endMs || recording.run.derivation !== undefined
        }
        backendUrl={backendUrl}
        onSaved={onSaved}
      />
    </div>
  );
}
