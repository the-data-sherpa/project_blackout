"use client";

import type { InferenceAttempt, Recording } from "@blackout/contracts";
import { judgmentView, numericChange } from "./judgment-view";
import { openInspectionDetail } from "./workspace-overview";

function Distribution({
  values,
  selected,
  legend,
}: {
  values: Record<string, number>;
  selected?: string | undefined;
  legend?: Record<string, string> | undefined;
}) {
  return (
    <dl className="judgment-distribution">
      {Object.entries(values).map(([label, probability]) => (
        <div key={label} data-selected={selected === label || undefined}>
          <dt title={legend?.[label]}>
            {label}
            {selected === label && <span> · selected</span>}
          </dt>
          <dd>
            <span aria-hidden="true" className="distribution-track">
              <span style={{ width: `${probability * 100}%` }} />
            </span>
            <span>{(probability * 100).toFixed(1)}%</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function JudgmentOverview({
  recording,
  connected,
  historical,
  inspectedAttempt,
  onInspect,
}: {
  recording: Recording;
  connected: boolean;
  historical: boolean;
  inspectedAttempt: InferenceAttempt | null;
  onInspect: (id: string) => void;
}) {
  const { current, previous, latest, state, ageMs } = judgmentView(
    recording,
    inspectedAttempt,
  );
  const answers = current?.response?.answers;
  const prior = previous?.response?.answers;
  const noComparison = "No prior applied assessment";
  const cards = [
    {
      key: "compromise",
      label: "Compromise probability",
      type: "Noul",
      value: answers
        ? `${(answers.compromise.noul * 100).toFixed(1)}%`
        : "Unknown",
      change:
        answers && prior
          ? numericChange(
              answers.compromise.noul * 100,
              prior.compromise.noul * 100,
              "percentage points",
            )
          : noComparison,
      answer: null,
    },
    {
      key: "classification",
      label: "Classification",
      type: "Choice",
      value: answers?.classification.choice ?? "Unknown",
      change:
        answers && prior
          ? prior.classification.choice === answers.classification.choice
            ? "Selected class unchanged"
            : `${prior.classification.choice} → ${answers.classification.choice}`
          : noComparison,
      answer: answers?.classification,
    },
    {
      key: "severity",
      label: "Severity",
      type: "Weighted 0–3",
      value: answers ? `${answers.severity.score.toFixed(2)} / 3` : "Unknown",
      change:
        answers && prior
          ? numericChange(
              answers.severity.score,
              prior.severity.score,
              "severity points",
            )
          : noComparison,
      answer: answers?.severity,
    },
    {
      key: "response",
      label: "Advisory response",
      type: "Choice · advisory only",
      value: answers?.response.choice ?? "Unknown",
      change:
        answers && prior
          ? prior.response.choice === answers.response.choice
            ? "Selected response unchanged"
            : `${prior.response.choice} → ${answers.response.choice}`
          : noComparison,
      answer: answers?.response,
    },
  ];

  return (
    <section
      className="monitor-panel judgments-overview"
      aria-labelledby="judgments-overview-title"
      data-testid="judgment-zone"
    >
      <header className="monitor-panel-heading">
        <h2 id="judgments-overview-title">SystemOne judgments</h2>
        <p>Jev · Global environment assessment</p>
      </header>
      <div className="px-4 pt-2 text-xs text-slate-300">
        <p role="status" data-testid="judgment-state">
          {state}
        </p>
        {!historical && recording.run.status === "running" && !connected && (
          <p>Disconnected · applied results may be stale.</p>
        )}
        {latest && latest.id !== current?.id && (
          <button
            className="min-h-8 text-cyan-200 underline underline-offset-4"
            onClick={() => {
              onInspect(latest.id);
              openInspectionDetail("decision-title");
            }}
          >
            Inspect {latest.status === "pending" ? "pending" : "latest"} attempt
          </button>
        )}
      </div>
      <div className="judgment-cards">
        {cards.map((card) => (
          <article
            key={card.key}
            className="judgment-card"
            data-testid={`judgment-${card.key}`}
          >
            <button
              type="button"
              className="judgment-heading"
              onClick={() => {
                if (current ?? latest) onInspect((current ?? latest)!.id);
                openInspectionDetail("decision-title");
              }}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-1 text-xs text-cyan-100">
                <span>{card.label} ↗</span>
                {card.answer && (
                  <span className="text-[0.65rem] text-slate-400">
                    Confidence:{" "}
                    {card.answer.confidence === undefined ? (
                      <>
                        unknown<span className="sr-only"> · not returned</span>
                      </>
                    ) : (
                      `${(card.answer.confidence * 100).toFixed(1)}%`
                    )}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <strong
                  className="block break-words font-mono text-lg font-normal"
                  data-testid="judgment-value"
                >
                  {card.value}
                </strong>
                <span className="text-[0.65rem] text-slate-400">
                  {card.type}
                </span>
              </span>
            </button>
            <p
              className="mb-2 text-[0.65rem] text-slate-300"
              data-testid="judgment-change"
            >
              {card.change}
            </p>
            {card.answer ? (
              <div className="judgment-output">
                <Distribution
                  values={card.answer.probabilities}
                  selected={
                    card.answer.type === "choice"
                      ? card.answer.choice
                      : undefined
                  }
                  legend={
                    card.answer.type === "score"
                      ? card.answer.legend
                      : undefined
                  }
                />
              </div>
            ) : card.key === "compromise" ? (
              <p className="judgment-output text-[0.65rem] text-slate-400">
                Noul has no separate confidence or category distribution.
              </p>
            ) : (
              <p className="judgment-output text-[0.65rem] text-slate-400">
                No applied distribution available.
              </p>
            )}
          </article>
        ))}
      </div>
      <footer className="px-4 pb-3 text-[0.65rem] text-slate-400">
        <p data-testid="judgment-age">
          {current
            ? `Snapshot ${current.simulationTimeMs / 1000} s · age ${(ageMs! / 1000).toFixed(1)} simulation s at ${historical ? "inspected" : recording.run.status === "running" ? "live" : "playback"} cursor ${recording.run.simulationTimeMs / 1000} s.`
            : "Missing judgments mean unknown risk."}
        </p>
        <details className="mt-1">
          <summary className="min-h-6 cursor-pointer text-cyan-200">
            Definitions and comparison details
          </summary>
          {previous && (
            <p>
              Compared with prior applied snapshot{" "}
              {previous.simulationTimeMs / 1000} s.
            </p>
          )}
          <p>
            Confidence describes distribution concentration, not calibrated
            correctness. Entity selection filters evidence only.
          </p>
          {answers && (
            <div className="mt-2">
              <p>Severity level meanings:</p>
              <ul>
                {Object.entries(answers.severity.legend).map(
                  ([level, meaning]) => (
                    <li key={level}>
                      {level}: {meaning}
                    </li>
                  ),
                )}
              </ul>
              <p>
                The displayed score is the probability-weighted mean of levels
                0–3, not the most likely level.
              </p>
            </div>
          )}
        </details>
      </footer>
    </section>
  );
}
