"use client";

import { useState } from "react";
import type { Recording } from "@blackout/contracts";
import { DecisionInspector } from "./decision-inspector";
import {
  EnvironmentTopology,
  type TopologySelection,
} from "./environment-topology";
import { TelemetryInspector } from "./telemetry-inspector";
import { InvestigationPanel } from "./investigation-panel";
import {
  inspectAssessment,
  newerAssessmentCount,
  type Inspection,
  PlaybackIndex,
} from "./playback";
import { ProcessingOverview } from "./workspace-overview";
import { JudgmentOverview } from "./judgment-overview";

export function RunInspection({
  recording,
  source = recording,
  connected,
  activityAnimation,
  readOnly = false,
  backendUrl,
  onSaved,
}: {
  recording: Recording;
  source?: Recording;
  connected: boolean;
  activityAnimation?: boolean;
  readOnly?: boolean;
  backendUrl: string;
  onSaved: (recording: Recording) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URL(window.location.href).searchParams.get("decision"),
  );
  const [inspection, setInspection] = useState<Inspection | null>(() =>
    selectedId ? inspectAssessment(source, selectedId) : null,
  );
  const [topologySelection, setTopologySelection] =
    useState<TopologySelection>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEventSequence, setSelectedEventSequence] = useState<
    number | null
  >(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const projected = inspection?.recording ?? recording;
  const eventSequence = projected.events.some(
    (event) => event.sequence === selectedEventSequence,
  )
    ? selectedEventSequence
    : null;
  if (selectedEventSequence !== null && eventSequence === null) {
    setSelectedEventSequence(null);
    setSelectionNotice(
      `Event #${selectedEventSequence} is unavailable at this cursor. Its selection was cleared.`,
    );
  }

  function selectEvent(sequence: number | null) {
    setSelectionNotice(null);
    setSelectedEventSequence(sequence);
  }

  function selectEntity(id: string | null) {
    setSelectedEntityId(id);
    const manifest = projected.run.manifest;
    const organization =
      manifest.schemaVersion === 2 ? manifest.organization : null;
    const kind =
      organization?.hosts.find((host) => host.id === id)?.kind ??
      (organization?.users.some((user) => user.userId === id)
        ? "user"
        : "service");
    setTopologySelection(
      id && organization ? { type: "node", id: `${kind}:${id}` } : null,
    );
  }

  function select(id: string | null) {
    setSelectedId(id);
    setInspection(id ? inspectAssessment(source, id) : null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("decision", id);
    else url.searchParams.delete("decision");
    window.history.replaceState(null, "", url);
  }

  function selectSnapshot(id: string) {
    if (id === "latest") {
      select(null);
      return;
    }
    const snapshot = source.snapshots.find((item) => item.id === id);
    if (!snapshot) return;
    select(null);
    setInspection({
      recording: new PlaybackIndex(source).at(snapshot.simulationTimeMs),
      assessment: null,
    });
  }

  return (
    <>
      <section
        className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border border-cyan-500/50 bg-cyan-950/20 px-3 py-2"
        aria-label="Inspection position"
      >
        <div>
          <p
            className="font-mono text-sm text-cyan-100"
            data-testid="inspection-position"
          >
            {inspection
              ? "Inspecting checkpoint"
              : recording.run.status === "running"
                ? "Following live"
                : "Following playback"}{" "}
            · {(projected.run.simulationTimeMs / 1000).toFixed(1)} s
          </p>
          {inspection && (
            <p
              className="mt-2 text-sm text-slate-300"
              data-testid="newer-assessments"
            >
              {newerAssessmentCount(source, inspection)} newer applied
              assessments.{" "}
              {source.run.status === "running"
                ? "Simulation controls and recording remain independent of inspection."
                : "Playback controls remain independent of inspection."}
            </p>
          )}
        </div>
        {inspection && (
          <button
            className="min-h-11 rounded border border-cyan-300 px-4 py-2 text-sm"
            onClick={() => select(null)}
          >
            {source.run.status === "running"
              ? "Return to live"
              : "Return to playback"}
          </button>
        )}
      </section>
      {selectionNotice && (
        <p role="status" className="mb-3 text-sm text-amber-200">
          {selectionNotice}
        </p>
      )}
      <div className="monitor-grid">
        <div
          className="monitor-environment"
          data-testid="environment-zone"
          role="region"
          aria-label="Environment and evidence"
          tabIndex={0}
        >
          <EnvironmentTopology
            recording={projected}
            activityAnimation={
              !inspection &&
              (activityAnimation ?? recording.run.status === "running")
            }
            selection={topologySelection}
            selectedEventSequence={eventSequence}
            onSelection={(selection) => {
              if (!selection && topologySelection?.type === "relationship") {
                setSelectionNotice(
                  "The selected connection is unavailable at this cursor. Its selection was cleared.",
                );
              }
              setTopologySelection(selection);
            }}
            onEntitySelect={setSelectedEntityId}
            onEventSelect={selectEvent}
            onDecisionSelect={select}
          />
        </div>
        <JudgmentOverview
          recording={projected}
          connected={connected}
          historical={inspection !== null}
          inspectedAttempt={inspection?.assessment ?? null}
          onInspect={select}
        />
      </div>
      <ProcessingOverview
        recording={projected}
        assessment={inspection?.assessment ?? null}
        onInspect={select}
      />
      <DecisionInspector
        recording={projected}
        connected={connected}
        selectedId={selectedId}
        selectedAssessment={inspection?.assessment ?? null}
        availableAttempts={source.attempts}
        historical={inspection !== null}
        onSelect={select}
      />
      <InvestigationPanel
        recording={projected}
        connected={connected}
        readOnly={readOnly || inspection !== null}
        backendUrl={backendUrl}
        onSaved={onSaved}
        onInspect={select}
      />
      <TelemetryInspector
        recording={projected}
        backendUrl={backendUrl}
        decisionId={inspection?.assessment?.id ?? null}
        snapshotId={
          inspection ? (projected.snapshots.at(-1)?.id ?? "latest") : "latest"
        }
        onSnapshotSelect={selectSnapshot}
        selectedEntityId={selectedEntityId}
        selectedEventSequence={eventSequence}
        onEntitySelect={selectEntity}
        onEventSelect={selectEvent}
      />
    </>
  );
}
