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

export function RunInspection({
  recording,
  connected,
  activityAnimation,
  readOnly = false,
  backendUrl,
  onSaved,
}: {
  recording: Recording;
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
  const [topologySelection, setTopologySelection] =
    useState<TopologySelection>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEventSequence, setSelectedEventSequence] = useState<
    number | null
  >(null);
  const previousCursor = useRef(recording.run.simulationTimeMs);
  function select(id: string | null) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("decision", id);
    else url.searchParams.delete("decision");
    window.history.replaceState(null, "", url);
  }
  useEffect(() => {
    const cursorChanged =
      previousCursor.current !== recording.run.simulationTimeMs;
    previousCursor.current = recording.run.simulationTimeMs;
    const decisionInvalid =
      cursorChanged &&
      selectedId !== null &&
      !recording.attempts.some((attempt) => attempt.id === selectedId);
    const eventInvalid =
      selectedEventSequence !== null &&
      !recording.events.some(
        (event) => event.sequence === selectedEventSequence,
      );
    if (!decisionInvalid && !eventInvalid) return;
    const timer = window.setTimeout(() => {
      if (decisionInvalid) select(null);
      if (eventInvalid) setSelectedEventSequence(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    recording.attempts,
    recording.events,
    recording.run.simulationTimeMs,
    selectedEventSequence,
    selectedId,
  ]);
  return (
    <>
      <EnvironmentTopology
        recording={recording}
        activityAnimation={
          activityAnimation ?? recording.run.status === "running"
        }
        selection={topologySelection}
        selectedEventSequence={selectedEventSequence}
        onSelection={setTopologySelection}
        onEntitySelect={setSelectedEntityId}
        onEventSelect={setSelectedEventSequence}
        onDecisionSelect={select}
      />
      <DecisionInspector
        recording={recording}
        connected={connected}
        selectedId={selectedId}
        onSelect={select}
      />
      <InvestigationPanel
        recording={recording}
        connected={connected}
        readOnly={readOnly}
        backendUrl={backendUrl}
        onSaved={onSaved}
        onInspect={select}
      />
      <TelemetryInspector
        recording={recording}
        backendUrl={backendUrl}
        decisionId={selectedId}
        selectedEntityId={selectedEntityId}
        selectedEventSequence={selectedEventSequence}
        onEntitySelect={setSelectedEntityId}
        onEventSelect={setSelectedEventSequence}
      />
    </>
  );
}
