"use client";

import { useRef, useState } from "react";
import {
  apiErrorSchema,
  investigationStatus,
  recordingSchema,
  type InvestigationAction,
  type Recording,
} from "@blackout/contracts";

const button =
  "min-h-11 rounded border border-slate-500 px-4 py-2 text-sm hover:border-emerald-300 disabled:opacity-50";

export function InvestigationPanel({
  recording,
  connected,
  readOnly = false,
  backendUrl,
  onSaved,
  onInspect,
}: {
  recording: Recording;
  connected: boolean;
  readOnly?: boolean;
  backendUrl: string;
  onSaved: (recording: Recording) => void;
  onInspect: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<InvestigationAction | null>(null);
  const history = recording.investigationHistory;
  const status = investigationStatus(history);
  const configured =
    recording.run.manifest.schemaVersion === 2 &&
    !!recording.run.manifest.investigation;
  const available =
    !readOnly && !busy && (recording.run.status !== "running" || connected);

  async function act(type: InvestigationAction["type"]) {
    const request =
      retry.current?.type === type
        ? retry.current
        : {
            commandId: crypto.randomUUID(),
            type,
            expectedSequence: history.at(-1)!.sequence,
          };
    retry.current = request;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        new URL(
          `/api/runs/${recording.run.id}/investigation-actions`,
          backendUrl,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) {
        if (response.status < 500) retry.current = null;
        throw new Error(apiErrorSchema.parse(await response.json()).message);
      }
      onSaved(recordingSchema.parse(await response.json()));
      retry.current = null;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this action. Retry or refresh the recording.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="investigation-title"
      className="mb-8 min-w-0 space-y-4 rounded-lg border border-amber-300/40 bg-amber-950/10 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="investigation-title" className="text-xl font-medium">
          Investigation
        </h2>
        <p
          role="status"
          className="font-mono text-sm text-amber-100"
          data-testid="investigation-status"
        >
          {status === "none"
            ? "Not opened"
            : status === "open"
              ? "Open"
              : status === "acknowledged"
                ? "Acknowledged"
                : "Closed by operator"}
        </p>
      </div>
      <p className="text-xs text-slate-400">
        Latest recorded investigation status. Selecting a historical decision
        changes evidence inspection only.
      </p>
      <p className="text-sm text-slate-300">
        Investigation status is separate from Jev’s activity risk. Stopping
        injection and falling risk leave an investigation unresolved. Closure
        records an operator decision; it does not remediate entities or change
        model values.
      </p>
      {!configured ? (
        <p className="text-sm text-slate-400">
          {recording.run.manifest.evaluatorVersion
            ? "This older recording has no investigation policy. Its history has not been reconstructed."
            : "Enable Jev on a new run to apply the investigation policy."}
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          One applied incident advisory opens an investigation. After closure,
          the next matching decision reopens it. Acknowledgement remains until
          closure. Local actions are attributed to “local-operator”; this is not
          an authenticated identity.
        </p>
      )}
      {readOnly && configured && (
        <p className="text-sm text-slate-400">
          Playback is read-only. Investigation actions shown here are stored
          history.
        </p>
      )}
      {(status === "open" || status === "acknowledged") && (
        <div className="flex flex-wrap gap-3">
          <button
            className={button}
            disabled={!available || status !== "open"}
            onClick={() => {
              void act("acknowledge");
            }}
          >
            Acknowledge investigation
          </button>
          <button
            className={button}
            disabled={!available}
            onClick={() => {
              void act("close");
            }}
          >
            Close investigation
          </button>
          {busy && (
            <p role="status" className="self-center text-sm">
              Saving action…
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error} Refresh the recording if its status changed.
        </p>
      )}
      {recording.run.status === "running" && !connected && (
        <p className="text-sm text-slate-400">
          Reconnect to synchronize investigation actions.
        </p>
      )}
      <details className="min-w-0 rounded border border-slate-600 p-4">
        <summary className="cursor-pointer font-medium">
          Investigation history ({history.length})
        </summary>
        {history.length ? (
          <ol className="mt-4 space-y-4 text-sm">
            {history.map((event) => (
              <li
                key={event.sequence}
                className="break-words border-l border-slate-600 pl-3"
                data-testid="investigation-event"
              >
                <p>
                  #{event.sequence} · <strong>{event.type}</strong> ·{" "}
                  {event.simulationTimeMs / 1000} simulation s · {event.actor}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  <time dateTime={event.recordedAt}>{event.recordedAt}</time> ·
                  run revision {event.runRevision} · {event.version}
                </p>
                {event.attemptId && (
                  <button
                    className="min-h-11 text-emerald-300 underline underline-offset-4"
                    onClick={() => onInspect(event.attemptId!)}
                  >
                    Inspect triggering decision #{event.sequence}
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No investigation actions recorded. This does not establish low risk.
          </p>
        )}
      </details>
    </section>
  );
}
