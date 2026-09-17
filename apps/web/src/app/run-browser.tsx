"use client";

import { useEffect, useState } from "react";
import { runListSchema, type RunList } from "@blackout/contracts";

const buttonClass =
  "min-h-11 rounded border border-slate-500 px-4 py-2 text-sm hover:border-emerald-300 disabled:opacity-50";
const pageSize = 20;

export function RunBrowser({
  backendUrl,
  selectedId,
  refreshKey,
  onSelect,
  onActiveRun,
}: {
  backendUrl: string;
  selectedId: string | null;
  refreshKey: string;
  onSelect: (id: string) => void;
  onActiveRun: (id: string | null) => void;
}) {
  const [page, setPage] = useState<RunList | null>(null);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const url = new URL("/api/runs", backendUrl);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(pageSize));
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Recording list unavailable");
        const saved = runListSchema.parse(await response.json());
        if (!disposed) {
          setPage(saved);
          onActiveRun(saved.activeRunId);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        window.clearTimeout(timeout);
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [backendUrl, offset, attempt, refreshKey, onActiveRun]);

  return (
    <section
      aria-labelledby="stored-runs-title"
      className="min-w-0 rounded-lg border border-slate-700 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="stored-runs-title" className="text-xl font-medium">
          Stored runs
        </h2>
        <button
          className={buttonClass}
          disabled={loading}
          onClick={() => {
            setOffset(0);
            setAttempt((value) => value + 1);
          }}
        >
          {loading ? "Loading runs…" : "Refresh runs"}
        </button>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        Open a recording to inspect its saved events. Completed and interrupted
        runs stay stopped.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-amber-200">
          Could not load stored runs. Check the backend, then refresh runs. Any
          rows below show the last loaded list.
        </p>
      )}
      {!loading && !error && page?.total === 0 && (
        <p role="status" className="mt-5 text-sm text-slate-300">
          No stored runs yet. Start a run to create a recording.
        </p>
      )}
      {page && page.runs.length > 0 && (
        <ul
          className="mt-5 max-h-80 space-y-2 overflow-auto"
          aria-label="Stored runs"
          aria-busy={loading}
        >
          {page.runs.map((run) => (
            <li key={run.id}>
              <button
                className={`w-full rounded border p-4 text-left hover:border-emerald-300 ${selectedId === run.id ? "border-emerald-300 bg-emerald-950/30" : "border-slate-600"}`}
                aria-pressed={selectedId === run.id}
                aria-label={`Inspect run ${run.id}`}
                onClick={() => onSelect(run.id)}
              >
                <span className="flex min-w-0 flex-wrap justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-sm">
                    {run.seed}
                  </span>
                  <span className="text-xs capitalize text-slate-300">
                    {run.status} · {run.lastSequence} events
                  </span>
                </span>
                <span className="mt-2 block break-all font-mono text-xs text-slate-400">
                  {run.id}
                </span>
                <time
                  dateTime={run.createdAt}
                  className="mt-1 block text-xs text-slate-400"
                >
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
      {page && page.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">
            {page.total} stored {page.total === 1 ? "run" : "runs"}
          </p>
          {(offset > 0 || page.nextOffset !== null) && (
            <div className="flex gap-2">
              <button
                className={buttonClass}
                disabled={loading || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                Previous runs
              </button>
              <button
                className={buttonClass}
                disabled={loading || page.nextOffset === null}
                onClick={() => {
                  if (page.nextOffset !== null) setOffset(page.nextOffset);
                }}
              >
                More runs
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
