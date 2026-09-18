"use client";

import { useState } from "react";
import {
  investigationStatus,
  type InferenceAttempt,
  type Recording,
} from "@blackout/contracts";
import { visibleAttempts } from "./decision-view";

export function openInspectionDetail(id: string) {
  const element = document.getElementById(id);
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: "start", behavior: "instant" });
}

export function JudgmentOverview({
  recording,
  onInspect,
}: {
  recording: Recording;
  onInspect: (id: string) => void;
}) {
  const attempts = visibleAttempts(recording);
  const latest = attempts.at(-1);
  const success = attempts.findLast(
    (attempt) => attempt.status === "succeeded" && attempt.appliedAt !== null,
  );
  const answers = success?.response?.answers;
  const state = !attempts.length
    ? "No applied assessment"
    : latest?.status === "failed"
      ? success
        ? "Unavailable · showing last applied result"
        : "Unavailable · no applied result"
      : latest?.status === "pending"
        ? recording.run.status === "running"
          ? "Pending · waiting for an applied result"
          : "Saved attempt · no applied result"
        : "Recorded assessment";
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
      <p role="status" className="px-4 pt-3 text-xs text-slate-300">
        {state}
      </p>
      <div className="px-4 pb-2">
        {[
          [
            "Compromise probability",
            "Noul",
            answers
              ? `${(answers.compromise.noul * 100).toFixed(1)}%`
              : "Unknown",
          ],
          [
            "Classification",
            "Choice",
            answers?.classification.choice ?? "Unknown",
          ],
          [
            "Severity",
            "Weighted score, 0–3",
            answers ? `${answers.severity.score.toFixed(2)} / 3` : "Unknown",
          ],
          [
            "Advisory response",
            "Choice · advisory only",
            answers?.response.choice ?? "Unknown",
          ],
        ].map(([label, type, value]) => (
          <button
            key={label}
            className="judgment-preview"
            onClick={() => {
              if (success) onInspect(success.id);
              openInspectionDetail("decision-title");
            }}
          >
            <span className="flex flex-wrap justify-between gap-2 text-xs text-slate-300">
              <span>{label} ↗</span>
              <span className="text-slate-400">{type}</span>
            </span>
            <strong className="mt-2 block break-words font-mono text-lg font-normal text-slate-100">
              {value}
            </strong>
          </button>
        ))}
      </div>
      <p className="px-4 pb-4 text-xs text-slate-400">
        {success
          ? `Snapshot ${success.simulationTimeMs / 1000} s · age ${((recording.run.simulationTimeMs - success.simulationTimeMs) / 1000).toFixed(1)} simulation s`
          : "Missing judgments mean unknown risk."}
      </p>
    </section>
  );
}

export function ProcessingOverview({
  recording,
  assessment,
  onInspect,
}: {
  recording: Recording;
  assessment: InferenceAttempt | null;
  onInspect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = investigationStatus(recording.investigationHistory);
  const attempt = assessment ?? visibleAttempts(recording).at(-1);
  const snapshot = attempt
    ? recording.snapshots.find((item) => item.id === attempt.snapshotId)
    : recording.snapshots.at(-1);
  const evidenceTime =
    snapshot?.simulationTimeMs ?? recording.run.simulationTimeMs;
  const evidenceCount = recording.events.filter(
    (event) => event.simulationTimeMs <= evidenceTime,
  ).length;
  const applied =
    attempt?.status === "succeeded" &&
    attempt.appliedAt !== null &&
    (attempt.appliedSimulationTimeMs ?? attempt.simulationTimeMs) <=
      recording.run.simulationTimeMs;
  return (
    <section
      className="monitor-panel processing-overview"
      aria-labelledby="processing-title"
      data-testid="processing-zone"
    >
      <header className="monitor-panel-heading flex flex-wrap justify-between gap-2">
        <h2 id="processing-title">Recorded decision path</h2>
        <p>
          Checkpoint {evidenceTime / 1000} s · recorded application behavior
        </p>
        <button
          type="button"
          className="processing-toggle min-h-11 text-xs text-cyan-200"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Collapse decision path" : "Expand decision path"}
        </button>
      </header>
      <div className="processing-steps" data-expanded={expanded}>
        {[
          [
            "01 / Evidence",
            `${evidenceCount.toLocaleString("en-US")} observations`,
            "Recorded events including warm-up",
            "events-title",
          ],
          [
            "02 / Input",
            snapshot?.id ?? "No snapshot",
            "Observable state only",
            "state-title",
          ],
          [
            "03 / Judgments",
            attempt
              ? `${attempt.status}${applied ? " · applied" : " · not applied"}`
              : "Not evaluated",
            "Four global SystemOne outputs",
            "decision-title",
          ],
          [
            "04 / Policy",
            attempt?.policy?.outcome ?? "Not available",
            "Recorded advisory conditions",
            "decision-title",
          ],
          [
            "05 / Investigation",
            status === "none" ? "Not opened" : status,
            `${recording.investigationHistory.length} recorded transitions`,
            "investigation-title",
          ],
        ].map(([label, value, detail, target]) => (
          <button
            key={label}
            className="processing-step"
            disabled={target === "state-title" && !snapshot}
            onClick={() => {
              if (attempt && target !== "investigation-title")
                onInspect(attempt.id);
              openInspectionDetail(target!);
            }}
          >
            <span className="block font-mono text-[0.65rem] uppercase tracking-wider text-slate-400">
              {label}
            </span>
            <strong className="my-2 block break-words text-sm font-normal text-slate-100">
              {value}
            </strong>
            <span className="block text-xs text-slate-400">{detail} ↗</span>
          </button>
        ))}
      </div>
    </section>
  );
}
