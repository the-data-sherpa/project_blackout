"use client";

import { useEffect, useState } from "react";
import {
  evaluationReportsSchema,
  type EvaluationReport,
} from "@blackout/contracts";

export function EvaluationReports({ backendUrl }: { backendUrl: string }) {
  const [reports, setReports] = useState<EvaluationReport[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(
          new URL("/api/evaluation-reports", backendUrl),
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(5000),
            ]),
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error("Unavailable");
        const result = evaluationReportsSchema.parse(await response.json());
        if (!controller.signal.aborted) setReports(result.reports);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [backendUrl, refresh]);
  return (
    <details className="min-w-0 rounded-lg border border-slate-700 p-5">
      <summary className="cursor-pointer font-medium">
        Model evaluation reports ({reports.length})
      </summary>
      <button
        className="my-3 min-h-11 rounded border border-slate-500 px-4 text-sm"
        onClick={() => setRefresh((value) => value + 1)}
        disabled={loading}
      >
        {loading ? "Loading reports…" : "Refresh reports"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          Could not load reports. Check the backend and refresh reports.
        </p>
      )}
      {!loading && !error && reports.length === 0 && (
        <p className="text-sm text-slate-300">
          No evaluation reports saved. Run the fixture suite described in the
          README to measure model behavior.
        </p>
      )}
      {reports.map((report) => (
        <details
          key={report.id}
          className="mt-3 min-w-0 rounded border border-slate-600 p-4"
        >
          <summary className="cursor-pointer break-words">
            {report.createdAt} · {report.runs.length} runs ·{" "}
            {report.metricVersion}
          </summary>
          <p className="my-3 text-sm text-slate-300">
            {report.definitions.scope}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Measured fixture outcomes</caption>
              <thead>
                <tr>
                  {[
                    "Run / seed",
                    "Outcome",
                    "Incident / valid",
                    "Failed checkpoints",
                    "Detection delay",
                    "p95 latency",
                    "Actual speed",
                  ].map((label) => (
                    <th key={label} className="p-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.runs.map((run) => (
                  <tr key={run.runId} className="border-t border-slate-700">
                    <td className="p-2">
                      <a
                        className="text-emerald-300 underline"
                        href={`/?run=${run.runId}`}
                      >
                        {run.fixture} · {run.seed}
                      </a>
                    </td>
                    <td className="p-2">
                      {run.attackOutcome === "not_applicable"
                        ? "Control"
                        : run.attackOutcome}
                    </td>
                    <td className="p-2">
                      {run.incidentDecisions} /{" "}
                      {run.successfulCheckpoints - run.unevaluableCheckpoints}
                    </td>
                    <td className="p-2">
                      {run.failedCheckpoints} / {run.checkpoints};{" "}
                      {run.unevaluableCheckpoints} policy unevaluable
                    </td>
                    <td className="p-2">
                      {run.detectionDelaySimulationMs === null
                        ? "—"
                        : `${run.detectionDelaySimulationMs} ms simulation; ${run.detectionDelayWallMs ?? "unknown"} ms wall`}
                    </td>
                    <td className="p-2">
                      {run.latencyMs.p95?.toFixed(0) ?? "—"} ms
                    </td>
                    <td className="p-2">
                      {run.actualSimulationSpeed.toFixed(2)}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.runs.map((run) => (
            <details className="mt-3" key={run.runId}>
              <summary className="cursor-pointer text-sm">
                Decisions: {run.fixture} · {run.seed}
              </summary>
              {run.suspicionOutcome && (
                <p className="mt-3 text-sm text-slate-300">
                  Suspicion (probability ≥ {run.suspicionThreshold}):{" "}
                  {run.suspicionOutcome}. Delay:{" "}
                  {run.suspicionDelaySimulationMs ?? "—"} ms simulation /{" "}
                  {run.suspicionDelayWallMs ?? "—"} ms wall. False incident
                  advisories: {run.falseIncidentDecisions} /{" "}
                  {run.controlCheckpoints} evaluable control checkpoints.
                  Classification switches: {run.classificationSwitches} /{" "}
                  {run.comparablePairs} adjacent successful pairs.
                </p>
              )}
              {run.activityDecline && (
                <div className="mt-3 rounded border border-slate-600 p-3 text-sm text-slate-300">
                  <p>
                    Injection stopped at{" "}
                    {run.activityDecline.stopSimulationMs / 1000} s. Baseline
                    continued.
                  </p>
                  <p className="mt-2">
                    Compromise probability:{" "}
                    {run.activityDecline.referenceProbability?.toFixed(3) ??
                      "Unknown"}{" "}
                    before stop →{" "}
                    {run.activityDecline.finalProbability?.toFixed(3) ??
                      "Unknown"}{" "}
                    at run end. Change:{" "}
                    {run.activityDecline.probabilityChange?.toFixed(3) ??
                      "Unknown"}
                    .
                  </p>
                  <p className="mt-2">
                    Post-stop responses:{" "}
                    {run.activityDecline.successfulCheckpoints} /{" "}
                    {run.activityDecline.postStopCheckpoints};{" "}
                    {run.activityDecline.failedCheckpoints} failed. First
                    probability below{" "}
                    {run.activityDecline.lowProbabilityThreshold}:{" "}
                    {run.activityDecline.firstLowDelaySimulationMs ?? "—"} ms
                    simulation /{" "}
                    {run.activityDecline.firstLowDelayWallMs ?? "—"} ms wall
                    after stop.
                  </p>
                  <p className="mt-2 text-amber-200">
                    Declining activity does not establish remediation. Longer
                    windows retain earlier evidence.
                  </p>
                </div>
              )}
              <ul className="mt-3 space-y-2 text-sm">
                {run.decisions.map((decision) => (
                  <li key={decision.attemptId}>
                    <a
                      className="text-emerald-300 underline"
                      href={`/?run=${run.runId}&decision=${decision.attemptId}#decision-title`}
                    >
                      {decision.simulationTimeMs / 1000}s · {decision.status} ·{" "}
                      {decision.classification ?? decision.error} ·{" "}
                      {decision.outcome}
                      {decision.compromiseProbability !== undefined &&
                        ` · probability ${decision.compromiseProbability?.toFixed(3) ?? "unknown"}`}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm">
              Metric definitions and complete report
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
        </details>
      ))}
    </details>
  );
}
