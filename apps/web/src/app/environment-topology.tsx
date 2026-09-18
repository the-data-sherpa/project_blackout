"use client";

import { useEffect, useMemo } from "react";
import type { ObservableEvent, Recording } from "@blackout/contracts";
import {
  buildTopology,
  maxAnimatedRelationships,
  maxRenderedRelationships,
  type EvidenceStatus,
  type TopologyNode,
  type TopologyRelationship,
} from "./topology";

export type TopologySelection =
  { type: "node"; id: string } | { type: "relationship"; id: string } | null;

const statusPresentation: Record<
  EvidenceStatus,
  { symbol: string; label: string; classes: string }
> = {
  normal: {
    symbol: "✓",
    label: "Normal evidence",
    classes: "border-emerald-500/60 bg-emerald-950/30 text-emerald-100",
  },
  suspicious: {
    symbol: "▲",
    label: "Suspicious evidence",
    classes: "border-orange-400/70 bg-orange-950/30 text-orange-100",
  },
  unavailable: {
    symbol: "—",
    label: "No recent evidence",
    classes: "border-slate-600 bg-slate-900/70 text-slate-300",
  },
};

function describeEvent(event: ObservableEvent) {
  switch (event.type) {
    case "authentication":
      return `${event.userId} authenticated to ${event.resource} from ${event.hostId}: ${event.outcome}`;
    case "host-metric":
      return `${event.hostId}: CPU ${event.cpuPercent}%, memory ${event.memoryPercent}%`;
    case "dns":
      return `${event.userId} queried ${event.query} from ${event.hostId}: ${event.outcome}`;
    case "network":
      return `${event.userId}: ${event.hostId} → ${event.destinationHostId}:${event.destinationPort} · ${event.outcome}`;
  }
}

function nodeLabel(node: TopologyNode) {
  return `${node.kind} ${node.id}`;
}

export function EnvironmentTopology({
  recording,
  activityAnimation,
  selection,
  selectedEventSequence,
  onSelection,
  onEntitySelect,
  onEventSelect,
  onDecisionSelect,
}: {
  recording: Recording;
  activityAnimation: boolean;
  selection: TopologySelection;
  selectedEventSequence: number | null;
  onSelection: (selection: TopologySelection) => void;
  onEntitySelect: (entityId: string | null) => void;
  onEventSelect: (sequence: number | null) => void;
  onDecisionSelect: (id: string) => void;
}) {
  const manifest = recording.run.manifest;
  const organization =
    manifest.schemaVersion === 2 ? manifest.organization : null;
  const topology = useMemo(
    () =>
      organization
        ? buildTopology(
            organization,
            recording.events,
            recording.run.simulationTimeMs,
          )
        : null,
    [organization, recording.events, recording.run.simulationTimeMs],
  );
  const nodeMap = useMemo(
    () => new Map(topology?.nodes.map((node) => [node.key, node]) ?? []),
    [topology],
  );
  const relationshipMap = useMemo(
    () =>
      new Map(
        topology?.relationships.map((relationship) => [
          relationship.id,
          relationship,
        ]) ?? [],
      ),
    [topology],
  );
  const eventMap = useMemo(
    () => new Map(recording.events.map((event) => [event.sequence, event])),
    [recording.events],
  );
  const selectedNode =
    selection?.type === "node" ? nodeMap.get(selection.id) : undefined;
  const selectedRelationship =
    selection?.type === "relationship"
      ? relationshipMap.get(selection.id)
      : undefined;
  const evidenceSequences =
    selectedNode?.evidenceSequences ??
    selectedRelationship?.evidenceSequences ??
    [];
  const evidence = evidenceSequences
    .map((sequence) => eventMap.get(sequence))
    .filter((event): event is ObservableEvent => event !== undefined);
  const selectedRelationshipOutsideBudget =
    selectedRelationship &&
    !topology?.relationships
      .slice(0, maxRenderedRelationships)
      .some((relationship) => relationship.id === selectedRelationship.id)
      ? selectedRelationship
      : null;
  const renderedRelationships = topology
    ? [
        ...topology.relationships.slice(0, maxRenderedRelationships),
        ...(selectedRelationshipOutsideBudget
          ? [selectedRelationshipOutsideBudget]
          : []),
      ]
    : [];
  const latestDecision = recording.attempts.findLast(
    (attempt) => attempt.status === "succeeded" && attempt.appliedAt !== null,
  );

  useEffect(() => {
    if (
      selection &&
      !(
        (selection.type === "node" && nodeMap.has(selection.id)) ||
        (selection.type === "relationship" && relationshipMap.has(selection.id))
      )
    ) {
      onSelection(null);
    }
  }, [nodeMap, onSelection, relationshipMap, selection]);

  if (!organization || !topology)
    return (
      <p className="mb-8 rounded border border-slate-700 p-4 text-sm text-slate-300">
        This legacy recording has no versioned organization for topology
        reconstruction.
      </p>
    );

  const selectNode = (node: TopologyNode) => {
    onSelection({ type: "node", id: node.key });
    onEntitySelect(node.id);
    onEventSelect(node.evidenceSequences.at(-1) ?? null);
  };
  const selectRelationship = (relationship: TopologyRelationship) => {
    onSelection({ type: "relationship", id: relationship.id });
    onEntitySelect(null);
    onEventSelect(relationship.evidenceSequences.at(-1) ?? null);
  };

  return (
    <section
      className="topology-panel mb-8 min-w-0 rounded-lg border border-cyan-400/30 bg-slate-950/60 p-4 sm:p-5"
      aria-labelledby="topology-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-cyan-300">
            Observable relationship graph
          </p>
          <h2 id="topology-title" className="mt-2 text-xl font-medium">
            Environment topology
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Nodes and links come only from recorded organization data and
            observable events through {(topology.cursorMs / 1000).toFixed(1)} s.
            Entity color never uses scenario truth or a global model score.
          </p>
        </div>
        <div className="topology-assessment rounded border border-violet-400/40 bg-violet-950/20 px-3 py-2 text-sm">
          <span className="block text-xs uppercase tracking-wide text-violet-200">
            Global Jev assessment · separate
          </span>
          <span
            className="mt-1 block font-mono"
            data-testid="topology-jev-state"
          >
            {latestDecision
              ? `${latestDecision.response!.answers.classification.choice} · ${(latestDecision.response!.answers.compromise.noul * 100).toFixed(1)}%`
              : "No applied assessment"}
          </span>
          {latestDecision && (
            <button
              type="button"
              className="mt-2 min-h-11 text-left text-xs text-violet-200 underline underline-offset-4"
              onClick={() => onDecisionSelect(latestDecision.id)}
            >
              Inspect current applied decision
            </button>
          )}
        </div>
      </div>

      <div
        className="mt-5 grid gap-4 lg:grid-cols-4"
        aria-label="Topology nodes"
      >
        {(["user", "workstation", "server", "service"] as const).map((kind) => {
          const nodes = topology.nodes.filter((node) => node.kind === kind);
          return (
            <section key={kind} className="min-w-0">
              <h3 className="font-mono text-xs uppercase tracking-wide text-slate-400">
                {kind === "user" ? "Users" : `${kind}s`} · {nodes.length}
              </h3>
              <div
                className="mt-2 max-h-64 space-y-2 overflow-auto pr-1"
                tabIndex={0}
              >
                {nodes.map((node) => {
                  const presentation = statusPresentation[node.status];
                  const selected =
                    selection?.type === "node" && selection.id === node.key;
                  return (
                    <button
                      key={node.key}
                      type="button"
                      aria-pressed={selected}
                      data-testid="topology-node"
                      aria-label={`${nodeLabel(node)} · ${presentation.label}`}
                      className={`min-h-11 w-full rounded border px-3 py-2 text-left text-xs ${presentation.classes} ${selected ? "ring-2 ring-cyan-300" : ""}`}
                      onClick={() => selectNode(node)}
                    >
                      <span aria-hidden="true" className="mr-2 font-bold">
                        {presentation.symbol}
                      </span>
                      <span className="break-all font-mono">{node.id}</span>
                      <span className="mt-1 block text-[0.7rem] opacity-80">
                        {presentation.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-6" aria-labelledby="relationships-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="relationships-title" className="font-medium">
            Observed relationships
          </h3>
          <p
            className="text-xs text-slate-400"
            data-testid="relationship-budget"
          >
            Showing{" "}
            {Math.min(topology.relationships.length, maxRenderedRelationships)}
            {selectedRelationshipOutsideBudget ? " + selected" : ""} of{" "}
            {topology.relationships.length}; animations limited to{" "}
            {maxAnimatedRelationships} recent links.
          </p>
        </div>
        {renderedRelationships.length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {renderedRelationships.map((relationship, index) => {
              const source = nodeMap.get(relationship.sourceKey);
              const target = nodeMap.get(relationship.targetKey);
              const active =
                activityAnimation &&
                !recording.run.controls?.paused &&
                index < maxAnimatedRelationships &&
                relationship.lastSimulationTimeMs > topology.cursorMs - 3000;
              const selected =
                selection?.type === "relationship" &&
                selection.id === relationship.id;
              return (
                <button
                  key={relationship.id}
                  type="button"
                  aria-pressed={selected}
                  data-testid="topology-relationship"
                  className={`min-h-11 rounded border border-slate-700 bg-slate-900/70 p-3 text-left text-xs hover:border-cyan-300 ${selected ? "ring-2 ring-cyan-300" : ""}`}
                  onClick={() => selectRelationship(relationship)}
                >
                  <span
                    aria-hidden="true"
                    className={`mr-2 inline-block h-2 w-2 rounded-full ${active ? "topology-activity bg-cyan-300" : "bg-slate-500"}`}
                  />
                  <span className="font-mono">
                    {source?.id ?? relationship.sourceKey} →{" "}
                    {target?.id ?? relationship.targetKey}
                  </span>
                  <span className="mt-1 block text-slate-400">
                    {relationship.type} · {relationship.count} observation
                    {relationship.count === 1 ? "" : "s"} ·{" "}
                    {active ? "Active" : "Observed"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No observable relationships exist at this recorded moment.
          </p>
        )}
      </section>

      <section
        className="mt-6 rounded border border-slate-700 bg-slate-900/40 p-4"
        aria-labelledby="topology-selection-title"
      >
        <h3 id="topology-selection-title" className="font-medium">
          Selection and evidence
        </h3>
        {selectedNode ? (
          <>
            <p className="mt-2 text-sm">
              {nodeLabel(selectedNode)} ·{" "}
              {statusPresentation[selectedNode.status].symbol}{" "}
              {statusPresentation[selectedNode.status].label}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {selectedNode.explanation}
            </p>
            <p className="mt-2 font-mono text-xs text-slate-400">
              Rule {topology.rule.id} · window (
              {(topology.cursorMs - topology.rule.windowMs) / 1000},{" "}
              {topology.cursorMs / 1000}] seconds · {topology.rule.expression}
            </p>
          </>
        ) : selectedRelationship ? (
          <p className="mt-2 text-sm text-slate-300">
            {nodeMap.get(selectedRelationship.sourceKey)?.id} →{" "}
            {nodeMap.get(selectedRelationship.targetKey)?.id} ·{" "}
            {selectedRelationship.type} · {selectedRelationship.count} recorded
            observations. The references below are the newest retained display
            links; complete events remain in the recording.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            Select a node or relationship to inspect its rule result and
            supporting observations.
          </p>
        )}
        {evidence.length > 0 && (
          <ul className="mt-4 space-y-2" data-testid="topology-evidence">
            {evidence.map((event) => (
              <li key={event.sequence}>
                <button
                  type="button"
                  aria-pressed={selectedEventSequence === event.sequence}
                  className={`min-h-11 w-full rounded border border-slate-600 px-3 py-2 text-left text-xs hover:border-cyan-300 ${selectedEventSequence === event.sequence ? "bg-cyan-950/40 ring-2 ring-cyan-300" : ""}`}
                  onClick={() => onEventSelect(event.sequence)}
                >
                  <span className="font-mono">
                    #{event.sequence} · {event.simulationTimeMs / 1000}s
                  </span>
                  <span className="mt-1 block text-slate-300">
                    {describeEvent(event)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
