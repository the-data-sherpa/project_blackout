"use client";

import { useState } from "react";
import type { InferenceAttempt, Recording } from "@blackout/contracts";
import { processingGraph } from "./processing-graph";

export function openInspectionDetail(id: string) {
  const element = document.getElementById(id);
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: "start", behavior: "instant" });
}

export function ProcessingOverview({
  recording,
  assessment,
  onInspect,
  onEvidence,
}: {
  recording: Recording;
  assessment: InferenceAttempt | null;
  onInspect: (id: string) => void;
  onEvidence: (throughMs: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const graph = processingGraph(recording, assessment);
  const node = graph.stages
    .flatMap((stage) => stage.nodes)
    .find((item) => item.id === selected);
  return (
    <section
      className="monitor-panel processing-overview"
      aria-labelledby="processing-title"
      data-testid="processing-zone"
    >
      <header className="monitor-panel-heading flex flex-wrap justify-between gap-2">
        <h2 id="processing-title">Recorded decision path</h2>
        <p>
          Checkpoint {graph.evidenceTime / 1000} s · {graph.state}
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
      <p className="px-4 pt-2 text-xs text-slate-400">
        Recorded application behavior. Advisory response is not an incident
        gate.{" "}
        {graph.attempt?.policy?.config.version ??
          "Policy provenance unavailable"}
        .
        {graph.attempt?.appliedAt === undefined &&
          graph.attempt &&
          " Legacy application timing unavailable."}
      </p>
      {!expanded && (
        <div className="processing-summary">
          {graph.stages.map((stage, index) => (
            <button
              key={stage.label}
              className="processing-step min-h-11"
              onClick={() => setExpanded(true)}
            >
              <span className="block font-mono text-[0.65rem] text-slate-400">
                {stage.label} {index < 4 ? "→" : ""}
              </span>
              <span className="block text-xs text-cyan-100">
                {index === 2
                  ? stage.nodes.map((item) => item.value).join(" · ")
                  : index === 3
                    ? (graph.attempt?.policy?.outcome ?? "Unavailable")
                    : stage.nodes[0]?.value}
              </span>
              <span className="text-xs text-slate-400">
                Inspect {index === 3 ? "every condition" : "recorded details"}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="processing-steps" data-expanded={expanded}>
        {graph.stages.map((stage, index) => (
          <div key={stage.label} className="min-w-0">
            <p className="mb-2 font-mono text-[0.65rem] text-slate-400">
              {stage.label} {index < 4 ? "→" : ""}
            </p>
            <div className="processing-nodes grid gap-1">
              {stage.nodes.map((item) => (
                <button
                  key={item.id}
                  className="processing-step min-h-8 w-full"
                  aria-pressed={selected === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="block break-words text-xs text-slate-300">
                    {item.label}
                  </span>
                  <strong className="block text-xs font-medium text-cyan-100">
                    {item.value}
                  </strong>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {node && (
        <div
          className="mx-4 mb-4 min-w-0 rounded border border-slate-600 p-3"
          role="region"
          aria-label="Decision path detail"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm">
              {node.label} · {node.value}
            </h3>
            <button
              className="min-h-11 text-sm text-cyan-200 underline"
              onClick={() => {
                if (node.id === "events") onEvidence(graph.evidenceTime);
                else if (graph.attempt && node.target !== "investigation-title")
                  onInspect(graph.attempt.id);
                openInspectionDetail(node.target);
              }}
            >
              Open{" "}
              {node.id === "events" ? "recorded members" : "full inspector"}
            </button>
            <button
              className="min-h-11 text-sm underline"
              onClick={() => setSelected(null)}
            >
              Close node detail
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">
            {JSON.stringify(node.detail, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
