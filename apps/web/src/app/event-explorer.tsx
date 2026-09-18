"use client";

import { useMemo } from "react";
import type { Recording } from "@blackout/contracts";
import { EventTable } from "./event-table";
import {
  emptyEventFilters,
  eventEntities,
  indexEvents,
  searchEvents,
  type EventFilters,
} from "./event-search";

const control =
  "min-h-11 max-w-full rounded border border-slate-500 bg-slate-950 px-3 py-2 text-sm text-slate-100";
const clear =
  "min-h-8 text-xs text-cyan-200 underline underline-offset-4 disabled:opacity-50";

export function EventExplorer({
  recording,
  selectedEntityId,
  selectedEventSequence,
  onEntitySelect,
  onEventSelect,
  filters,
  onFiltersChange,
}: {
  recording: Recording;
  selectedEntityId: string | null;
  selectedEventSequence: number | null;
  onEntitySelect: (id: string | null) => void;
  onEventSelect: (sequence: number | null) => void;
  filters: EventFilters;
  onFiltersChange: (filters: EventFilters) => void;
}) {
  const index = useMemo(() => indexEvents(recording), [recording]);
  const result = useMemo(
    () =>
      searchEvents(
        index,
        recording.run.simulationTimeMs,
        filters,
        selectedEntityId,
      ),
    [index, recording.run.simulationTimeMs, filters, selectedEntityId],
  );
  const selected = recording.events.find(
    (event) =>
      event.sequence === selectedEventSequence &&
      event.simulationTimeMs <= recording.run.simulationTimeMs,
  );
  const selectedMatches =
    selected &&
    result.events.some((event) => event.sequence === selected.sequence);
  const manifest = recording.run.manifest;
  const entities = [
    ...new Set([
      ...manifest.initialState.users,
      ...manifest.initialState.hosts,
      ...(manifest.schemaVersion === 2
        ? manifest.organization.resources.map((resource) => resource.id)
        : []),
      // Preserve inspectability of legacy event resources absent from a manifest.
      ...index.flatMap((item) => item.entities),
    ]),
  ];
  function change<K extends keyof EventFilters>(
    key: K,
    value: EventFilters[K],
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }
  return (
    <section aria-labelledby="events-title" className="min-w-0 space-y-4">
      <h3 id="events-title" tabIndex={-1} className="font-medium">
        Recorded events
      </h3>
      <p className="text-sm text-slate-400">
        Search all recorded field values through{" "}
        {recording.run.simulationTimeMs / 1000} simulation s, including events
        beyond the displayed page. Matching uses a case-insensitive literal
        substring; surrounding search spaces are ignored. Filters combine, and
        both time bounds are inclusive.
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <div className="min-w-0 sm:col-span-3">
          <label className="block text-sm">
            Search recorded events
            <input
              type="search"
              value={filters.query}
              onChange={(event) => change("query", event.target.value)}
              className={`${control} mt-2 block w-full`}
            />
          </label>
          <button
            className={clear}
            disabled={!filters.query}
            onClick={() => change("query", "")}
          >
            Clear search
          </button>
        </div>
        <div className="min-w-0">
          <label className="block text-sm">
            Activity period
            <select
              name="period"
              value={filters.period}
              onChange={(event) =>
                change("period", event.target.value as EventFilters["period"])
              }
              className={`${control} mt-2 block w-full`}
            >
              <option value="live">Live activity (0 s onward)</option>
              <option value="warmup">Warm-up history (before 0 s)</option>
              <option value="all">All recorded activity</option>
            </select>
          </label>
          <button
            className={clear}
            disabled={filters.period === "all"}
            onClick={() => change("period", "all")}
          >
            Clear period filter
          </button>
        </div>
        <div className="min-w-0">
          <label className="block text-sm">
            Event type
            <select
              name="event-type"
              value={filters.kind}
              onChange={(event) =>
                change("kind", event.target.value as EventFilters["kind"])
              }
              className={`${control} mt-2 block w-full`}
            >
              <option value="all">All types</option>
              {["authentication", "host-metric", "dns", "network"].map(
                (type) => (
                  <option key={type}>{type}</option>
                ),
              )}
            </select>
          </label>
          <button
            className={clear}
            disabled={filters.kind === "all"}
            onClick={() => change("kind", "all")}
          >
            Clear type filter
          </button>
        </div>
        <div className="min-w-0">
          <label className="block text-sm">
            Entity
            <select
              name="entity"
              value={selectedEntityId ?? "all"}
              onChange={(event) =>
                onEntitySelect(
                  event.target.value === "all" ? null : event.target.value,
                )
              }
              className={`${control} mt-2 block w-full`}
            >
              <option value="all">All entities</option>
              {entities.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <button
            className={clear}
            disabled={!selectedEntityId}
            onClick={() => onEntitySelect(null)}
          >
            Clear entity filter
          </button>
        </div>
        {(
          [
            ["from", "From time (simulation seconds)"],
            ["through", "Through time (simulation seconds)"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="min-w-0">
            <label className="block text-sm">
              {label}
              <input
                type="number"
                step="any"
                value={filters[key]}
                aria-invalid={!!result.error}
                aria-describedby={result.error ? "event-time-error" : undefined}
                onChange={(event) => change(key, event.target.value)}
                className={`${control} mt-2 block w-full`}
              />
            </label>
            <button
              className={clear}
              disabled={!filters[key]}
              onClick={() => change(key, "")}
            >
              Clear {key} time
            </button>
          </div>
        ))}
        <button
          className={`${control} self-start hover:border-cyan-300`}
          onClick={() => {
            onFiltersChange(emptyEventFilters);
            onEntitySelect(null);
          }}
        >
          Clear all event filters
        </button>
      </div>
      {result.error && (
        <p
          id="event-time-error"
          role="alert"
          className="text-sm text-amber-200"
        >
          {result.error}
        </p>
      )}
      <p
        role="status"
        className="text-sm text-slate-300"
        data-testid="event-search-count"
      >
        {result.events.length} matching / {result.eligible} eligible
        observations. Oldest first; sequence breaks same-time ties. At most 50
        result rows are displayed.
      </p>
      {selectedEventSequence !== null && !selected && (
        <p role="status" className="text-sm text-amber-200">
          Event #{selectedEventSequence} is unavailable at this cursor.
        </p>
      )}
      {selected && (
        <section
          className="min-w-0 rounded border border-cyan-400/40 bg-cyan-950/10 p-4 text-sm"
          aria-label="Selected event"
          data-testid="selected-event"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium">
              Selected event #{selected.sequence} · {selected.type} ·{" "}
              {selected.simulationTimeMs / 1000} s
            </h4>
            <button className={clear} onClick={() => onEventSelect(null)}>
              Clear event selection
            </button>
          </div>
          {!selectedMatches && (
            <p className="mt-2 text-amber-200">
              This event is outside the current filters.{" "}
              <button
                className={clear}
                onClick={() => {
                  onFiltersChange(emptyEventFilters);
                  onEntitySelect(null);
                }}
              >
                Show selected event in results
              </button>
            </p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Related entities · select to filter evidence; the model assessment
            remains global.
          </p>
          <div className="flex flex-wrap gap-2">
            {eventEntities(selected, recording).map((entity) => (
              <button
                key={entity}
                className={`${clear} break-all`}
                aria-pressed={selectedEntityId === entity}
                onClick={() => onEntitySelect(entity)}
              >
                {entity}
              </button>
            ))}
          </div>
          <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
            {Object.entries(selected).map(([name, value]) => (
              <div key={name} className="min-w-0">
                <dt className="text-xs text-slate-400">{name}</dt>
                <dd className="break-all font-mono text-xs">
                  {value === null ? "null" : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <EventTable
        key={`${JSON.stringify(filters)}:${selectedEntityId}:${selectedEventSequence}`}
        events={result.events}
        label="Recorded telemetry events"
        selectedSequence={selectedEventSequence}
        onSelect={onEventSelect}
      />
    </section>
  );
}
