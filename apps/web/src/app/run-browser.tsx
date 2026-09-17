"use client";

import { useEffect, useState } from "react";
import {
  apiErrorSchema,
  runListSchema,
  storageUsageSchema,
  type RunList,
} from "@blackout/contracts";

const buttonClass =
  "min-h-11 rounded border border-slate-500 px-4 py-2 text-sm hover:border-emerald-300 disabled:opacity-50";
const pageSize = 20;
function size(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export function RunBrowser({
  backendUrl,
  selectedId,
  refreshKey,
  onSelect,
  onActiveRun,
  onDeleted,
}: {
  backendUrl: string;
  selectedId: string | null;
  refreshKey: string;
  onSelect: (id: string) => void;
  onActiveRun: (id: string | null) => void;
  onDeleted: (id: string) => void;
}) {
  const [page, setPage] = useState<RunList | null>(null);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [storage, setStorage] = useState<ReturnType<
    typeof storageUsageSchema.parse
  > | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);

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
        const [response, usage] = await Promise.all(
          [url, new URL("/api/storage", backendUrl)].map((address) =>
            fetch(address, {
              signal: controller.signal,
              cache: "no-store",
            }),
          ),
        );
        if (!response!.ok || !usage!.ok)
          throw new Error("Recording list unavailable");
        const saved = runListSchema.parse(await response!.json());
        const stored = storageUsageSchema.parse(await usage!.json());
        if (!disposed) {
          setPage(saved);
          setStorage(stored);
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

  async function deleteRun(run: RunList["runs"][number]) {
    if (
      !window.confirm(
        `Permanently delete recording ${run.seed} (${run.id}) and its owned evidence? This cannot be undone. Saved evaluation summaries remain, with this recording marked unavailable.`,
      )
    )
      return;
    setDeleting(run.id);
    setDeletionError(null);
    setDeleted(null);
    try {
      const response = await fetch(new URL(`/api/runs/${run.id}`, backendUrl), {
        method: "DELETE",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(apiErrorSchema.parse(await response.json()).message);
      setDeleted(run.id);
      onDeleted(run.id);
      setOffset(0);
      setAttempt((value) => value + 1);
    } catch (cause) {
      setDeletionError(
        `${cause instanceof Error ? cause.message : "Deletion could not be confirmed."} Refresh runs to check storage, then retry if the recording remains.`,
      );
    } finally {
      setDeleting(null);
    }
  }

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
        runs stay stopped. Recordings are kept until you delete them. Reset and
        restart preserve history.
      </p>
      {storage && (
        <p className="mt-3 text-sm text-slate-300" data-testid="storage-usage">
          Recordings: {size(storage.recordingBytes)} · Reports:{" "}
          {size(storage.reportBytes)} · SQLite pages:{" "}
          {size(storage.databaseBytes)} · Reusable:{" "}
          {size(storage.reusableBytes)} · Write-ahead log:{" "}
          {size(storage.walBytes)}. Row sizes count owned JSON; shared evidence
          is counted at its source. Deleted space is reused by later runs.
        </p>
      )}
      {deletionError && (
        <p role="alert" className="mt-3 text-amber-200">
          {deletionError}
        </p>
      )}
      {deleted && (
        <p role="status" className="mt-3 break-all text-sm text-slate-300">
          Deleted recording {deleted}.
        </p>
      )}
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
                {run.derivation && (
                  <span className="mt-1 block text-xs text-violet-200">
                    {run.derivation.type === "telemetry-rerun"
                      ? "Telemetry rerun"
                      : "Jev reevaluation"}{" "}
                    · linked to {run.derivation.sourceRunId}
                  </span>
                )}
                <time
                  dateTime={run.createdAt}
                  className="mt-1 block text-xs text-slate-400"
                >
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </button>
              {run.storage && (
                <div className="mt-2 flex flex-wrap items-center gap-3 px-2 text-sm text-slate-300">
                  <span>
                    {size(run.storage.ownedBytes)} owned
                    {run.storage.sharedSourceRunId
                      ? " · shares source evidence"
                      : ""}
                  </span>
                  <button
                    className={buttonClass}
                    aria-label={`Delete recording ${run.id}`}
                    disabled={
                      loading ||
                      deleting !== null ||
                      run.storage.deletionBlockers.length > 0
                    }
                    onClick={() => void deleteRun(run)}
                  >
                    {deleting === run.id ? "Deleting…" : "Delete recording"}
                  </button>
                  {run.storage.deletionBlockers.map((reason) => (
                    <p
                      key={reason}
                      className="w-full break-words text-xs text-amber-200"
                    >
                      {reason}
                    </p>
                  ))}
                </div>
              )}
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
