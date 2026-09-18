"use client";

import { useState } from "react";
import type { ObservableEvent } from "@blackout/contracts";

const button =
  "min-h-11 max-w-full rounded border border-slate-500 bg-slate-950 px-3 py-2 text-sm text-slate-100 hover:border-emerald-300 disabled:opacity-50";
const seconds = (time: number) => `${time / 1000} s`;

function describe(event: ObservableEvent) {
  switch (event.type) {
    case "authentication":
      return `${event.outcome} · ${event.resource} · ${event.sourceIp}${"location" in event ? ` · ${event.location}` : ""}`;
    case "host-metric":
      return `CPU ${event.cpuPercent}% · memory ${event.memoryPercent}%`;
    case "dns":
      return `${event.query} · ${event.outcome} · ${event.answerIp ?? "no answer"}`;
    case "network":
      return `${event.destinationHostId}:${event.destinationPort} · ${event.bytesSent.toLocaleString("en-US")} bytes · ${event.outcome}`;
  }
}

export function EventTable({
  events,
  label,
  testId = "event-row",
  selectedSequence = null,
  onSelect,
}: {
  events: ObservableEvent[];
  label: string;
  testId?: string;
  selectedSequence?: number | null;
  onSelect?: (sequence: number) => void;
}) {
  const [page, setPage] = useState(() => {
    if (selectedSequence === null) return 0;
    const index = events.findIndex(
      (event) => event.sequence === selectedSequence,
    );
    return index < 0 ? 0 : Math.floor(index / 50);
  });
  const offset = Math.min(
    page * 50,
    Math.max(0, Math.ceil(events.length / 50) - 1) * 50,
  );
  const visible = events.slice(offset, offset + 50);
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <p role="status">
          {events.length
            ? `${offset + 1}–${offset + visible.length} of ${events.length} observations`
            : "No observations match this selection."}
        </p>
        <div className="flex gap-2">
          <button
            className={button}
            disabled={offset === 0}
            onClick={() => setPage(Math.max(0, offset / 50 - 1))}
            aria-label={`Previous ${label}`}
          >
            Previous
          </button>
          <button
            className={button}
            disabled={offset + 50 >= events.length}
            onClick={() => setPage(offset / 50 + 1)}
            aria-label={`Next ${label}`}
          >
            Next
          </button>
        </div>
      </div>
      <div
        className="max-h-[32rem] overflow-auto rounded border border-slate-700"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {label}, oldest first. Sequence breaks same-time ties.
          </caption>
          <thead className="sticky top-0 bg-slate-900 text-xs text-slate-300">
            <tr>
              {[
                "Sequence / time",
                "Observation",
                "Identity / host",
                "Details",
              ].map((title) => (
                <th key={title} scope="col" className="px-3 py-3 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((event) => (
              <tr
                key={event.sequence}
                data-testid={testId}
                data-selected={
                  selectedSequence === event.sequence ? "true" : undefined
                }
                className={`border-t border-slate-800 align-top ${selectedSequence === event.sequence ? "bg-cyan-950/40" : ""}`}
              >
                <td className="px-3 py-3 font-mono text-xs">
                  <span className="block">#{event.sequence}</span>
                  <time
                    className="mt-1 block"
                    dateTime={event.occurredAt}
                    title={event.occurredAt}
                  >
                    {seconds(event.simulationTimeMs)}
                  </time>
                  <span className="mt-1 block text-slate-400">
                    {event.simulationTimeMs < 0 ? "Warm-up" : "Live"}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs">
                  <span className="block">{event.type}</span>
                  {"source" in event && (
                    <>
                      <span className="mt-1 block text-slate-400">
                        {event.source}
                      </span>
                      <span className="mt-1 block">{event.severity}</span>
                    </>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-xs">
                  <span className="block">
                    {"userId" in event ? event.userId : "Host observation"}
                  </span>
                  <span className="mt-1 block text-slate-400">
                    {event.hostId}
                  </span>
                </td>
                <td className="max-w-xs px-3 py-3 text-xs">
                  <p className="break-words">{describe(event)}</p>
                  {onSelect && (
                    <button
                      type="button"
                      aria-pressed={selectedSequence === event.sequence}
                      className="mt-2 min-h-11 text-cyan-200 underline underline-offset-4"
                      onClick={() => onSelect(event.sequence)}
                    >
                      Inspect event #{event.sequence}
                    </button>
                  )}
                  <details className="mt-2">
                    <summary className="min-h-8 cursor-pointer text-emerald-300">
                      Raw event #{event.sequence}
                    </summary>
                    <pre className="max-w-64 overflow-auto whitespace-pre-wrap break-all py-2 text-xs">
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
