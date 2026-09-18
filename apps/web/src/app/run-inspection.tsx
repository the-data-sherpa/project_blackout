"use client";

import { useEffect, useRef, useState } from "react";
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
  inspectionBoundary,
  assessmentPhase,
  newerAssessmentCount,
  type Inspection,
  PlaybackIndex,
} from "./playback";
import { ProcessingOverview } from "./workspace-overview";
import { JudgmentOverview } from "./judgment-overview";
import {
  defaultInspectionView,
  inspectionUrl,
  restoreInspection,
  type InspectionView,
  type JudgmentKey,
} from "./inspection-link";
import { InspectedAssessmentHealth } from "./pipeline-health";
import { emptyEventFilters } from "./event-search";

export function RunInspection({
  recording,
  source = recording,
  connected,
  activityAnimation,
  readOnly = false,
  backendUrl,
  onSaved,
  onFollow,
}: {
  recording: Recording;
  source?: Recording;
  connected: boolean;
  activityAnimation?: boolean;
  readOnly?: boolean;
  backendUrl: string;
  onSaved: (recording: Recording) => void;
  onFollow: () => void;
}) {
  const [restored] = useState(() =>
    typeof window === "undefined"
      ? { state: defaultInspectionView, inspection: null, notice: null }
      : restoreInspection(new URL(window.location.href), source),
  );
  const [view, setView] = useState(restored.state);
  const pendingUrl = useRef<URL | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const [inspection, setInspection] = useState<Inspection | null>(
    restored.inspection,
  );
  const [topologySelection, setTopologySelection] = useState<TopologySelection>(
    () => entitySelection(restored.state.entity, source),
  );
  const [selectionNotice, setSelectionNotice] = useState<string | null>(
    restored.notice,
  );
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState("");
  const selectedId = view.decision;
  const selectedEntityId = view.entity;
  const selectedEventSequence = view.event;

  function update(patch: Partial<InspectionView>, nextInspection = inspection) {
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next;
    setView(next);
    setInspection(nextInspection);
    setCopyNotice(null);
    const url = inspectionUrl(
      window.location.href,
      source.run.id,
      next,
      nextInspection?.recording.run.simulationTimeMs ??
        (source.run.status === "running"
          ? null
          : recording.run.simulationTimeMs),
      inspectionBoundary(
        nextInspection?.recording ?? recording,
        nextInspection?.assessment,
      ),
    );
    if (!pendingUrl.current)
      queueMicrotask(() => {
        const nextUrl = pendingUrl.current;
        pendingUrl.current = null;
        if (nextUrl && nextUrl.href !== window.location.href)
          window.history.pushState(null, "", nextUrl);
      });
    pendingUrl.current = url;
  }
  const projected = inspection?.recording ?? recording;
  useEffect(() => {
    if (inspection || source.run.status === "running") return;
    const url = inspectionUrl(
      window.location.href,
      source.run.id,
      view,
      recording.run.simulationTimeMs,
      inspectionBoundary(recording),
    );
    window.history.replaceState(null, "", url);
  }, [recording, source.run.id, source.run.status, inspection, view]);
  const eventSequence = projected.events.some(
    (event) => event.sequence === selectedEventSequence,
  )
    ? selectedEventSequence
    : null;
  if (selectedEventSequence !== null && eventSequence === null) {
    setView({ ...view, event: null });
    setSelectionNotice(
      `Event #${selectedEventSequence} is unavailable at this cursor. Its selection was cleared.`,
    );
  }

  function selectEvent(sequence: number | null) {
    setSelectionNotice(null);
    update({ event: sequence });
  }

  function selectEntity(id: string | null) {
    update({ entity: id });
    setTopologySelection(entitySelection(id, projected));
  }

  function select(id: string | null, judgment: JudgmentKey | null = null) {
    const nextInspection = id
      ? inspection?.assessment?.id === id
        ? inspection
        : inspection && projected.attempts.some((attempt) => attempt.id === id)
          ? inspectAssessment(projected, id)
          : inspectAssessment(source, id)
      : null;
    if (!id) onFollow();
    const assessment = nextInspection?.assessment;
    const phase = assessment ? assessmentPhase(assessment) : null;
    update({ decision: id, judgment, phase }, nextInspection);
  }

  function selectSnapshot(id: string) {
    if (id === "latest") {
      select(null);
      return;
    }
    const snapshot = source.snapshots.find((item) => item.id === id);
    if (!snapshot) return;
    update(
      { decision: null, judgment: null },
      {
        recording: new PlaybackIndex(source).at(snapshot.simulationTimeMs),
        assessment: null,
      },
    );
  }

  async function copyLink() {
    const url = inspectionUrl(
      window.location.href,
      source.run.id,
      { ...view, event: eventSequence },
      projected.run.simulationTimeMs,
      inspectionBoundary(projected, inspection?.assessment),
    );
    setCopiedUrl(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopyNotice("Inspection link copied.");
    } catch {
      setCopyNotice(
        "Clipboard unavailable. Select and copy the inspection link below.",
      );
    }
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
          <InspectedAssessmentHealth
            recording={projected}
            assessment={inspection?.assessment ?? null}
          />
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
        <button
          className="min-h-11 rounded border border-slate-500 px-3 text-sm"
          onClick={() => void copyLink()}
        >
          Copy inspection link
        </button>
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
      {copyNotice && (
        <div className="mb-3 min-w-0 text-sm" role="status">
          <p>{copyNotice}</p>
          {copyNotice.startsWith("Clipboard") && (
            <input
              aria-label="Inspection link"
              className="min-h-11 w-full bg-slate-950"
              readOnly
              value={copiedUrl}
              onFocus={(event) => event.target.select()}
            />
          )}
        </div>
      )}
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
            onEntitySelect={(entity) => update({ entity })}
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
          selectedJudgment={view.judgment}
        />
      </div>
      <ProcessingOverview
        recording={projected}
        assessment={inspection?.assessment ?? null}
        onInspect={(id) => {
          const assessment =
            inspection?.assessment?.id === id
              ? inspection.assessment
              : projected.attempts.find((attempt) => attempt.id === id);
          if (assessment)
            update(
              {
                decision: id,
                phase: assessmentPhase(assessment),
                judgment: null,
              },
              { recording: projected, assessment },
            );
        }}
        onEvidence={(throughMs) =>
          update({
            entity: null,
            filters: {
              ...emptyEventFilters,
              through: String(throughMs / 1000),
            },
          })
        }
      />
      <InvestigationPanel
        recording={projected}
        connected={connected}
        readOnly={readOnly || inspection !== null}
        backendUrl={backendUrl}
        onSaved={onSaved}
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
        eventFilters={view.filters}
        onFiltersChange={(filters) => update({ filters })}
      />
    </>
  );
}

function entitySelection(
  id: string | null,
  recording: Recording,
): TopologySelection {
  const manifest = recording.run.manifest;
  if (!id || manifest.schemaVersion !== 2) return null;
  const kind =
    manifest.organization.hosts.find((host) => host.id === id)?.kind ??
    (manifest.organization.users.some((user) => user.userId === id)
      ? "user"
      : "service");
  return { type: "node", id: `${kind}:${id}` };
}
