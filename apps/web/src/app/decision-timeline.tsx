"use client";

import type { InferenceAttempt, Recording } from "@blackout/contracts";
import { decisionMetrics, visibleAttempts } from "./decision-view";

export function DecisionTimeline({
  recording,
  selectedId,
  onSelect,
}: {
  recording: Recording;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const attempts = visibleAttempts(recording);
  const metrics = decisionMetrics(recording);
  const span = Math.max(1000, recording.run.simulationTimeMs);
  const x = (time: number) => 50 + (690 * time) / span;
  const probability = (attempt: InferenceAttempt) =>
    attempt.response?.answers.compromise.noul;
  const label = (attempt: InferenceAttempt) =>
    `${attempt.simulationTimeMs / 1000}s · attempt ${attempt.attemptNumber} · ${attempt.status}${probability(attempt) === undefined ? " · probability unknown" : ` · ${(probability(attempt)! * 100).toFixed(1)}% compromise probability`}${attempt.appliedAt === null && attempt.status !== "pending" ? " · not applied" : ""}`;
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="timeline-title">
      <h3 id="timeline-title" className="font-medium">
        Decision timeline
      </h3>
      <p className="text-sm text-slate-300">
        Select a point to inspect its snapshot, observations and policy.
        Probabilities are raw model values; failures and pending attempts have
        no probability.
      </p>
      {attempts.length ? (
        <div
          className="overflow-x-auto rounded border border-slate-700"
          role="region"
          aria-label="Probability timeline"
          tabIndex={0}
        >
          <svg
            viewBox="0 0 790 290"
            className="min-w-[36rem] w-full"
            aria-label="Unsmoothed compromise probability by simulation time"
          >
            {[0, 0.5, 1].map((p) => (
              <g key={p}>
                <line
                  x1="50"
                  x2="740"
                  y1={180 - p * 150}
                  y2={180 - p * 150}
                  stroke="#334155"
                />
                <text x="8" y={185 - p * 150} fill="#cbd5e1" fontSize="12">
                  {p * 100}%
                </text>
              </g>
            ))}
            <text x="50" y="273" fill="#cbd5e1" fontSize="12">
              0 s
            </text>
            <text x="740" y="273" textAnchor="end" fill="#cbd5e1" fontSize="12">
              {span / 1000} simulation seconds
            </text>
            <text x="50" y="213" fill="#cbd5e1" fontSize="11">
              Unknown / pending
            </text>
            {attempts.map((attempt) => {
              const p = probability(attempt);
              const cy =
                p === undefined
                  ? 229 + (attempt.attemptNumber - 1) * 15
                  : 180 - p * 150;
              const cx = x(attempt.simulationTimeMs);
              return (
                <g
                  key={attempt.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${label(attempt)}`}
                  aria-pressed={selectedId === attempt.id}
                  className="cursor-pointer"
                  onClick={() => onSelect(attempt.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(attempt.id);
                    }
                  }}
                >
                  <title>{label(attempt)}</title>
                  <circle cx={cx} cy={cy} r="13" fill="transparent" />
                  {p === undefined ? (
                    <path
                      d={`M${cx - 5},${cy - 5} l10,10 m0,-10 l-10,10`}
                      stroke="#fcd34d"
                      strokeWidth="2"
                    />
                  ) : (
                    <circle cx={cx} cy={cy} r="5" fill="#c4b5fd" />
                  )}
                  {selectedId === attempt.id && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r="10"
                      fill="none"
                      stroke="#6ee7b7"
                      strokeWidth="2"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          No model attempts recorded. Telemetry remains inspectable below.
        </p>
      )}
      <dl
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        data-testid="decision-metrics"
      >
        {[
          [
            "Events processed (0 s onward)",
            metrics.events.toLocaleString("en-US"),
          ],
          [
            "Warm-up observations",
            metrics.warmupEvents.toLocaleString("en-US"),
          ],
          [
            "Model attempts",
            `${metrics.attempts} (${metrics.pending} pending; ${metrics.failures} failed)`,
          ],
          ["Applied model decisions", String(metrics.decisions)],
          [
            "Decisions / simulation minute",
            metrics.decisionsPerMinute?.toFixed(1) ?? "N/A at 0 s",
          ],
          [
            "Median attempt latency",
            metrics.medianLatencyMs === null
              ? "No samples"
              : `${metrics.medianLatencyMs.toFixed(0)} ms`,
          ],
          [
            "p95 attempt latency",
            metrics.p95LatencyMs === null
              ? "No samples"
              : `${metrics.p95LatencyMs.toFixed(0)} ms`,
          ],
          ["Latency samples", String(metrics.latencySamples)],
        ].map(([name, value]) => (
          <div key={name} className="min-w-0">
            <dt className="text-xs text-slate-400">{name}</dt>
            <dd className="mt-2 break-words font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="text-xs text-slate-400">
        <summary className="min-h-8 cursor-pointer">Metric definitions</summary>
        <p>
          Totals cover this run, independent of event filters. Attempts include
          retries. Decisions count successful responses applied to the run,
          including the initial checkpoint. Rate = decisions ÷ elapsed
          simulation minutes; undefined at zero. Latency uses completed
          attempts’ wall time in milliseconds, including failures and local
          unavailable results; pending and restart-interrupted attempts are
          excluded. Median averages the middle pair; p95 is nearest rank. Counts
          and timeline hold unapplied responses while paused.
        </p>
      </details>
    </section>
  );
}
