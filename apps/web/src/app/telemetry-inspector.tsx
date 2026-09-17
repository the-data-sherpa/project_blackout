"use client";

import { useState } from "react";
import { z } from "zod";
import {
  scenarioTruthSchema,
  type AggregateMetric,
  type ObservableEvent,
  type Recording,
} from "@blackout/contracts";

const control =
  "min-h-11 max-w-full rounded border border-slate-500 bg-slate-950 px-3 py-2 text-sm text-slate-100";
const button = `${control} hover:border-emerald-300 disabled:opacity-50`;
const metricLabels: Record<AggregateMetric["name"], string> = {
  authenticationAttempts: "Authentication attempts",
  authenticationFailures: "Authentication failures",
  unfamiliarDevices: "Unfamiliar device observations",
  unfamiliarLocations: "Unfamiliar location observations",
  unfamiliarResources: "Unfamiliar resource observations",
  dnsQueries: "DNS queries",
  dnsFailures: "DNS failures",
  networkConnections: "Network connections",
  networkBytes: "Network bytes sent",
  meanCpuPercent: "Mean CPU (%)",
  meanMemoryPercent: "Mean memory (%)",
};
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

function EventTable({
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

export function TelemetryInspector({
  recording,
  backendUrl,
  decisionId = null,
  selectedEntityId = null,
  selectedEventSequence = null,
  onEntitySelect,
  onEventSelect,
}: {
  recording: Recording;
  backendUrl: string;
  decisionId?: string | null;
  selectedEntityId?: string | null;
  selectedEventSequence?: number | null;
  onEntitySelect: (id: string | null) => void;
  onEventSelect: (sequence: number | null) => void;
}) {
  const [phase, setPhase] = useState("live");
  const [kind, setKind] = useState("all");
  const [identity, setIdentity] = useState("");
  const [hostId, setHostId] = useState("");
  const [snapshotId, setSnapshotId] = useState("latest");
  const [windowMs, setWindowMs] = useState(10_000);
  const [metricName, setMetricName] = useState<AggregateMetric["name"]>(
    "authenticationAttempts",
  );
  const [showFocus, setShowFocus] = useState(false);
  const [truth, setTruth] = useState<string | null>(null);
  const [truthError, setTruthError] = useState<string | null>(null);
  const [truthLoading, setTruthLoading] = useState(false);
  const manifest = recording.run.manifest;
  const organization =
    manifest.schemaVersion === 2 ? manifest.organization : null;
  const entity = selectedEntityId ?? "all";
  const selectedEvent =
    selectedEventSequence === null
      ? undefined
      : recording.events.find(
          (event) => event.sequence === selectedEventSequence,
        );
  const visiblePhase = selectedEvent
    ? selectedEvent.simulationTimeMs < 0
      ? "warmup"
      : "live"
    : phase;
  const visibleKind = selectedEvent ? "all" : kind;
  const profile =
    organization?.users.find((user) => user.userId === identity) ??
    organization?.users[0];
  const host =
    organization?.hosts.find((item) => item.id === hostId) ??
    organization?.hosts[0];
  const selectedDecision = recording.attempts.find(
    (item) => item.id === decisionId,
  );
  const evidenceSnapshotId = decisionId
    ? selectedDecision?.snapshotId
    : snapshotId;
  const snapshot =
    evidenceSnapshotId === "latest"
      ? recording.snapshots.at(-1)
      : recording.snapshots.find((item) => item.id === evidenceSnapshotId);
  const window = snapshot?.input.windows.find(
    (item) => item.durationMs === windowMs,
  );
  const metric = window?.metrics.find((item) => item.name === metricName);
  const focus = snapshot?.input.focus;
  const references = new Set(
    (showFocus ? focus?.evidenceSequences : metric?.evidenceSequences) ?? [],
  );
  const evidence = recording.events.filter((event) =>
    references.has(event.sequence),
  );
  const events = recording.events.filter((event) => {
    const selectedResource = organization?.resources.find(
      (resource) => resource.id === entity,
    );
    const matchesEntity =
      entity === "all" ||
      event.hostId === entity ||
      ("userId" in event && event.userId === entity) ||
      (event.type === "network" && event.destinationHostId === entity) ||
      (event.type === "authentication" && event.resource === entity) ||
      (event.type === "dns" &&
        selectedResource !== undefined &&
        event.query === selectedResource.domain);
    return (
      (!decisionId || !!selectedDecision) &&
      event.simulationTimeMs <=
        (snapshot?.simulationTimeMs ?? recording.run.simulationTimeMs) &&
      (visiblePhase === "all" ||
        (visiblePhase === "warmup"
          ? event.simulationTimeMs < 0
          : event.simulationTimeMs >= 0)) &&
      (visibleKind === "all" || event.type === visibleKind) &&
      matchesEntity
    );
  });
  function inspectHistory(id: string) {
    onEntitySelect(id);
    onEventSelect(null);
    setPhase("warmup");
    setKind("all");
    document.getElementById("events-title")?.focus();
    document
      .getElementById("events-title")
      ?.scrollIntoView({ block: "start", behavior: "instant" });
  }

  async function loadTruth() {
    setTruthLoading(true);
    setTruthError(null);
    try {
      const response = await fetch(
        new URL(`/api/runs/${recording.run.id}/truth`, backendUrl),
        { signal: AbortSignal.timeout(10000), cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("Could not load scenario metadata. Try again.");
      const saved = z
        .strictObject({ records: z.array(scenarioTruthSchema) })
        .parse(await response.json());
      setTruth(JSON.stringify(saved, null, 2));
    } catch {
      setTruthError("Could not load scenario metadata. Try again.");
    } finally {
      setTruthLoading(false);
    }
  }

  return (
    <div className="min-w-0 space-y-8">
      {organization && profile && host ? (
        <section
          aria-labelledby="organization-title"
          className="rounded border border-slate-700 p-4"
        >
          <h3 id="organization-title" className="font-medium">
            Synthetic organization
          </h3>
          <p className="mt-2 text-sm text-slate-300">
            {organization.users.length} users · {organization.hosts.length}{" "}
            hosts · {organization.resources.length} resources
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Recorded warm-up: −900 s to −1 s. Visible simulation starts at 0 s.
            Profiles describe expected use; occasional failures and alternate
            devices are normal.
          </p>
          <div className="mt-5 grid min-w-0 gap-6 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <label className="block text-sm">
                Identity profile
                <select
                  name="identity"
                  value={profile.userId}
                  onChange={(event) => setIdentity(event.target.value)}
                  className={`${control} mt-2 block w-full`}
                >
                  {organization.users.map((user) => (
                    <option key={user.userId}>{user.userId}</option>
                  ))}
                </select>
              </label>
              <dl className="space-y-2 break-words text-sm text-slate-300">
                <div>
                  <dt className="text-slate-400">Department</dt>
                  <dd>{profile.department}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Known devices</dt>
                  <dd>{profile.hostIds.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Usual locations</dt>
                  <dd>{profile.locations.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Usual resources</dt>
                  <dd>{profile.resources.join(", ")}</dd>
                </div>
              </dl>
              <button
                className={button}
                onClick={() => inspectHistory(profile.userId)}
              >
                Inspect identity history
              </button>
            </div>
            <div className="min-w-0 space-y-3">
              <label className="block text-sm">
                Host profile
                <select
                  name="host"
                  value={host.id}
                  onChange={(event) => setHostId(event.target.value)}
                  className={`${control} mt-2 block w-full`}
                >
                  {organization.hosts.map((item) => (
                    <option key={item.id}>{item.id}</option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-slate-300">
                {host.kind} · {host.location} · {host.ip}
              </p>
              <p className="break-words text-sm text-slate-300">
                Resources:{" "}
                {organization.resources
                  .filter((item) => item.hostId === host.id)
                  .map((item) => `${item.id} (${item.domain})`)
                  .join(", ") || "User workstation"}
              </p>
              <button
                className={button}
                onClick={() => inspectHistory(host.id)}
              >
                Inspect host history
              </button>
            </div>
          </div>
        </section>
      ) : (
        <p className="text-sm text-slate-300">
          This M1 recording has authentication events only. It has no recorded
          organization, warm-up history or snapshots.
        </p>
      )}

      {snapshot && window && (
        <section
          aria-labelledby="state-title"
          className="min-w-0 rounded border border-slate-700 p-4"
        >
          <h3 id="state-title" className="font-medium">
            Observable state
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Recorded aggregates, not model judgments. Select a metric to inspect
            its evidence. Selection holds that snapshot while generation
            continues.
          </p>
          {decisionId && (
            <p
              className="mt-3 text-sm text-emerald-200"
              data-testid="decision-evidence"
            >
              Evidence for selected decision · {snapshot.id} ·{" "}
              {seconds(snapshot.simulationTimeMs)}. Choose “Follow latest
              attempt” in the Decision Inspector to release this snapshot.
            </p>
          )}
          <div className="my-4 flex flex-wrap gap-4">
            <label className="min-w-0 text-sm">
              Snapshot
              <select
                name="snapshot"
                value={evidenceSnapshotId ?? "latest"}
                disabled={!!decisionId}
                className={`${control} mt-2 block`}
                onChange={(event) => setSnapshotId(event.target.value)}
              >
                <option value="latest">Follow latest</option>
                {recording.snapshots.map((item) => (
                  <option key={item.id} value={item.id}>
                    {seconds(item.simulationTimeMs)} · {item.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Rolling window
              <select
                name="window"
                value={windowMs}
                className={`${control} mt-2 block`}
                onChange={(event) => {
                  setWindowMs(Number(event.target.value));
                  setShowFocus(false);
                }}
              >
                {snapshot.input.windows.map((item) => (
                  <option key={item.durationMs} value={item.durationMs}>
                    {item.durationMs < 60_000
                      ? `${item.durationMs / 1000} seconds`
                      : `${item.durationMs / 60_000} ${item.durationMs === 60_000 ? "minute" : "minutes"}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p
            className="my-3 break-words font-mono text-xs text-slate-300"
            data-testid="window-boundary"
          >
            {snapshot.id} · ({seconds(window.startExclusiveMs)},{" "}
            {seconds(window.endInclusiveMs)}] · start excluded, end included
          </p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {window.metrics.map((item) => (
              <button
                key={item.name}
                className={`${button} min-w-0 text-left ${!showFocus && metricName === item.name ? "border-emerald-300 bg-emerald-950/40" : ""}`}
                aria-pressed={!showFocus && metricName === item.name}
                onClick={() => {
                  setMetricName(item.name);
                  setShowFocus(false);
                  setSnapshotId(snapshot.id);
                }}
              >
                <span className="block text-xs text-slate-300">
                  {metricLabels[item.name]}
                </span>
                <span className="mt-2 block font-mono text-lg">
                  {item.value === null
                    ? "No samples"
                    : Number(item.value.toFixed(2)).toLocaleString("en-US")}
                </span>
              </button>
            ))}
          </div>
          <div className="my-5 rounded border border-slate-600 p-4">
            <h4 className="font-medium">
              Focus identity: {focus?.userId ?? "No authentication evidence"}
            </h4>
            {focus && (
              <>
                <p className="mt-2 text-sm text-slate-300">
                  Last 30 seconds: {focus.attempts} attempts, {focus.failures}{" "}
                  failures, {focus.deviations} profile deviations. Evidence
                  score: {focus.score}.
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {focus.rule}. This selects evidence to inspect; it does not
                  establish compromise.
                </p>
                <button
                  className={`${button} mt-3`}
                  onClick={() => {
                    setShowFocus(true);
                    setSnapshotId(snapshot.id);
                  }}
                >
                  Inspect focus evidence
                </button>
              </>
            )}
          </div>
          {snapshot.input.schemaVersion === "observable-state/2" && (
            <details className="my-4 rounded border border-slate-600 p-4">
              <summary className="cursor-pointer font-medium">
                Focus activity: authentication, DNS and network
              </summary>
              <p className="my-3 text-sm text-slate-300">
                Last 30 seconds: {snapshot.input.focusActivity.totalEvents}{" "}
                observations; {snapshot.input.focusActivity.groups.length}{" "}
                groups shown, {snapshot.input.focusActivity.omittedGroups} older
                groups omitted. The input keeps the most recent groups of
                matching observations. Their evidence appears below in sequence
                order.
              </p>
              <EventTable
                events={recording.events.filter(
                  (event) =>
                    snapshot.input.schemaVersion === "observable-state/2" &&
                    snapshot.input.focusActivity.groups.some((group) =>
                      group.evidenceSequences.includes(event.sequence),
                    ),
                )}
                label="Focus activity observations"
                testId="activity-row"
              />
            </details>
          )}
          <h4 className="mb-3 font-medium" data-testid="evidence-title">
            {showFocus
              ? `Focus evidence · ${focus?.userId ?? "none"} · (${seconds(snapshot.simulationTimeMs - 30_000)}, ${seconds(snapshot.simulationTimeMs)}]`
              : `Evidence · ${metricLabels[metricName]}`}
          </h4>
          <EventTable
            key={`${snapshot.id}:${showFocus}:${metricName}:${windowMs}`}
            events={evidence}
            label="Contributing observations"
            testId="evidence-row"
          />
          <details className="mt-5 rounded border border-slate-600 p-4">
            <summary className="cursor-pointer font-medium">
              Allowlisted evaluator input
            </summary>
            <p className="mt-3 text-sm text-slate-400">
              This snapshot contains observable evidence. The Decision Inspector
              shows whether Jev evaluated it and the exact request it received.
              Event sequences link to this recording; scenario metadata is
              excluded.
            </p>
            <pre
              data-testid="evaluator-input"
              className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs"
            >
              {JSON.stringify(snapshot.input, null, 2)}
            </pre>
          </details>
        </section>
      )}

      <section aria-labelledby="events-title" className="min-w-0">
        <h3 id="events-title" tabIndex={-1} className="mb-2 font-medium">
          Recorded events
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          Oldest first, ordered by sequence. Warning describes an observed
          failure or high host utilization; it is not an attack label.
          {snapshot &&
            ` Showing observations through ${seconds(snapshot.simulationTimeMs)}, the selected snapshot’s time.`}
        </p>
        <div className="mb-4 grid min-w-0 gap-3 sm:grid-cols-3">
          <label className="min-w-0 text-sm">
            Activity period
            <select
              className={`${control} mt-2 block w-full`}
              name="period"
              value={visiblePhase}
              onChange={(event) => {
                onEventSelect(null);
                setPhase(event.target.value);
              }}
            >
              <option value="live">Live activity (0 s onward)</option>
              <option value="warmup">Warm-up history (before 0 s)</option>
              <option value="all">All recorded activity</option>
            </select>
          </label>
          <label className="min-w-0 text-sm">
            Event type
            <select
              className={`${control} mt-2 block w-full`}
              name="event-type"
              value={visibleKind}
              onChange={(event) => {
                onEventSelect(null);
                setKind(event.target.value);
              }}
            >
              <option value="all">All types</option>
              {["authentication", "host-metric", "dns", "network"].map(
                (type) => (
                  <option key={type}>{type}</option>
                ),
              )}
            </select>
          </label>
          <label className="min-w-0 text-sm">
            Entity
            <select
              className={`${control} mt-2 block w-full`}
              name="entity"
              value={entity}
              onChange={(event) => {
                const value = event.target.value;
                onEventSelect(null);
                onEntitySelect(value === "all" ? null : value);
              }}
            >
              <option value="all">All entities</option>
              {manifest.initialState.users
                .concat(
                  manifest.initialState.hosts,
                  organization?.resources.map((resource) => resource.id) ?? [],
                )
                .map((id) => (
                  <option key={id}>{id}</option>
                ))}
            </select>
          </label>
        </div>
        <EventTable
          key={`${entity}:${visiblePhase}:${visibleKind}:${selectedEventSequence ?? "none"}`}
          events={events}
          label="Recorded telemetry events"
          selectedSequence={selectedEventSequence}
          onSelect={onEventSelect}
        />
      </section>

      {manifest.schemaVersion === 2 && (
        <details className="rounded border border-slate-600 p-4">
          <summary className="cursor-pointer font-medium">
            Scenario metadata (excluded from model input)
          </summary>
          <p className="my-3 text-sm text-slate-300">
            Selected fixture: {manifest.fixture}.{" "}
            {manifest.scenario
              ? `Injection starts at ${manifest.scenario.stages[0]!.startMs / 1000} s and stops at ${manifest.scenario.stopAtMs / 1000} s.`
              : manifest.fixture === "baseline"
                ? "No injected activity."
                : "Injection runs from 1–8 s."}{" "}
            Baseline continues for the whole run. Shorter runs contain only
            their elapsed steps.
          </p>
          <p className="my-3 text-sm text-slate-400">
            Truth records are for fixture evaluation. They never determine focus
            selection, event severity or observable state.
          </p>
          <button
            className={button}
            disabled={truthLoading}
            onClick={() => {
              void loadTruth();
            }}
          >
            {truthLoading ? "Loading metadata…" : "Load recorded truth"}
          </button>
          {truthError && (
            <p role="alert" className="mt-3 text-amber-200">
              {truthError}
            </p>
          )}
          {truth && (
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
              {truth}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}
