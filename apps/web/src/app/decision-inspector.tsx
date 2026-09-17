"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Recording } from "@blackout/contracts";
import { visibleAttempts } from "./decision-view";
import { DecisionTimeline } from "./decision-timeline";

function Json({ title, children }: { title: string; children: unknown }) {
  return (
    <details className="min-w-0 rounded border border-slate-600 p-4">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-300">
        {JSON.stringify(children, null, 2)}
      </pre>
    </details>
  );
}
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="mt-2 break-words font-mono text-sm">{children}</dd>
    </div>
  );
}

export function DecisionInspector({
  recording,
  connected,
  selectedId,
  onSelect,
}: {
  recording: Recording;
  connected: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const { attempts, run } = recording;
  const visible = visibleAttempts(recording);
  const latest = visible.at(-1);
  const success = visible.findLast(
    (attempt) => attempt.status === "succeeded" && attempt.appliedAt !== null,
  );
  const selected = selectedId
    ? attempts.find((attempt) => attempt.id === selectedId)
    : latest;
  const enabled = run.manifest.schemaVersion === 2 && !!run.manifest.evaluation;
  const active = run.status === "running";
  const pending = latest?.status === "pending";
  const failed = latest?.status === "failed";
  const ageSimulation = success
    ? (run.simulationTimeMs - success.simulationTimeMs) / 1000
    : null;
  const ageWall =
    success?.completedAt && now
      ? Math.max(0, (now - Date.parse(success.completedAt)) / 1000)
      : null;
  const answers = selected?.response?.answers;
  const state = !enabled
    ? "Not enabled"
    : !active
      ? "Recorded results"
      : !connected
        ? "Disconnected — state may be stale"
        : run.controls?.paused
          ? "Paused — live decisions frozen; saved attempts remain inspectable"
          : pending
            ? "Waiting for Jev — simulation held"
            : failed
              ? "Unavailable — last decision may be stale"
              : "Live inference";
  return (
    <section
      className="mb-8 min-w-0 space-y-4 rounded-lg border border-violet-400/40 bg-violet-950/10 p-4 sm:p-5"
      aria-labelledby="decision-title"
    >
      <h2 id="decision-title" className="text-xl font-medium">
        Jev decisions
      </h2>
      <p role="status" className="text-sm text-violet-200">
        {state}
      </p>
      <DecisionTimeline
        recording={recording}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      {selectedId && !selected && (
        <p role="alert" className="text-amber-200">
          This decision is not in this recording.{" "}
          <button className="min-h-11 underline" onClick={() => onSelect(null)}>
            Follow latest attempt
          </button>
        </p>
      )}
      {!enabled ? (
        <p className="text-sm text-slate-300">
          This run contains telemetry only. Enable “Evaluate with Jev” when
          starting a new run to record decisions.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-300">
            {success
              ? `Last successful decision: ${success.response!.answers.classification.choice}; ${(success.response!.answers.compromise.noul * 100).toFixed(1)}% compromise probability. Snapshot age: ${ageSimulation!.toFixed(1)} simulation seconds.${active && ageWall !== null ? ` Received ${ageWall.toFixed(0)} wall seconds ago.` : ""}`
              : "No successful decision yet. Risk is unknown."}
          </p>
          {latest?.error && (
            <p className="text-sm text-amber-200">
              {latest.error.message}{" "}
              {active
                ? "Telemetry resumes after the bounded attempt path."
                : "Saved failure; no new request is made when opening this recording."}
            </p>
          )}
          {selected && (
            <>
              <label className="block text-sm text-slate-300">
                Decision Inspector
                <select
                  aria-label="Decision Inspector"
                  name="decision"
                  className="mt-2 min-h-11 w-full rounded border border-slate-500 bg-slate-950 px-3"
                  value={selectedId ?? "latest"}
                  onChange={(event) => {
                    const id =
                      event.target.value === "latest"
                        ? null
                        : event.target.value;
                    onSelect(id);
                  }}
                >
                  <option value="latest">Follow latest attempt</option>
                  {attempts.map((attempt) => (
                    <option key={attempt.id} value={attempt.id}>
                      {attempt.simulationTimeMs / 1000}s · attempt{" "}
                      {attempt.attemptNumber} · {attempt.status}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-400">
                {selectedId
                  ? active
                    ? "Inspecting a saved attempt. Its snapshot and event cutoff are held below; live decisions continue above."
                    : "Inspecting a saved attempt from this recording."
                  : "Following the newest attempt."}
              </p>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Value label="Snapshot">
                  {selected.snapshotId} · {selected.simulationTimeMs / 1000}s
                </Value>
                <Value label="Attempt">
                  {selected.attemptNumber} · {selected.status}
                </Value>
                <Value label="Response received">
                  {selected.completedAt ?? "Pending"}
                </Value>
                <Value label="Applied to live display">
                  {selected.appliedAt === undefined
                    ? "Legacy recording"
                    : selected.appliedAt === null
                      ? "Not applied"
                      : `${selected.appliedAt} · ${(selected.appliedSimulationTimeMs ?? 0) / 1000}s`}
                </Value>
                <Value label="Wall latency">
                  {selected.latencyMs === null
                    ? "Pending"
                    : `${selected.latencyMs.toFixed(0)} ms`}
                </Value>
                <Value label="Compromise probability (Noul)">
                  {answers
                    ? `${(answers.compromise.noul * 100).toFixed(1)}%`
                    : "Unavailable"}
                </Value>
                <Value label="Classification">
                  {answers?.classification.choice ?? "Unavailable"}
                </Value>
                <Value label="Severity (Score, 0–3)">
                  {answers?.severity.score.toFixed(2) ?? "Unavailable"}
                </Value>
                <Value label="Model advisory">
                  {answers?.response.choice ?? "Unavailable"}
                </Value>
                <Value label="Returned model">
                  {selected.response?.model ?? "Not returned"}
                </Value>
              </dl>
              <p className="text-xs leading-relaxed text-slate-400">
                Probability, severity and confidence measure different things.
                Choice and Score confidence describes distribution
                concentration, not measured correctness. Noul has no separate
                confidence. Confidence is shown below only when returned.
              </p>
              {selected.error && (
                <p className="text-sm text-amber-200">
                  Selected attempt: {selected.error.code} —{" "}
                  {selected.error.message}
                </p>
              )}
              <Json title="Exact request: questions and observable state">
                {selected.request}
              </Json>
              <Json title="Model response and distributions">
                {selected.response ?? {
                  error: selected.error,
                  responseBody: selected.responseBody,
                }}
              </Json>
              <details className="rounded border border-slate-600 p-4">
                <summary className="cursor-pointer font-medium">
                  Application policy: {selected.policy?.outcome ?? "Pending"}
                </summary>
                <p className="my-3 text-sm text-slate-300">
                  Advisory only. No infrastructure or simulated containment
                  changes. An incident advisory requires every incident rule to
                  match. Review applies when its fallback rule matches and the
                  incident rules do not all match. Missing inputs remain
                  unevaluable.
                </p>
                <ul className="space-y-2 text-sm">
                  {selected.policy?.rules.map((rule) => (
                    <li key={rule.id}>
                      {rule.group === "review"
                        ? "Review fallback: "
                        : "Incident rule: "}
                      {rule.expression}:{" "}
                      <strong>
                        {rule.matched === null
                          ? "Unevaluable"
                          : rule.matched
                            ? "Matched"
                            : "Not matched"}
                      </strong>
                    </li>
                  ))}
                </ul>
                <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(selected.policy, null, 2)}
                </pre>
              </details>
              <Json title="Attempt provenance and sanitized response body">
                {{
                  id: selected.id,
                  runId: selected.runId,
                  snapshotId: selected.snapshotId,
                  questionVersion: selected.questionVersion,
                  startedAt: selected.startedAt,
                  completedAt: selected.completedAt,
                  appliedAt: selected.appliedAt,
                  appliedSimulationTimeMs: selected.appliedSimulationTimeMs,
                  latencyMs: selected.latencyMs,
                  responseBody: selected.responseBody,
                }}
              </Json>
            </>
          )}
        </>
      )}
    </section>
  );
}
