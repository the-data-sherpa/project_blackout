"use client";

import { useState } from "react";
import type { Recording } from "@blackout/contracts";
import { DecisionInspector } from "./decision-inspector";
import { TelemetryInspector } from "./telemetry-inspector";
import { InvestigationPanel } from "./investigation-panel";

export function RunInspection({
  recording,
  connected,
  readOnly = false,
  backendUrl,
  onSaved,
}: {
  recording: Recording;
  connected: boolean;
  readOnly?: boolean;
  backendUrl: string;
  onSaved: (recording: Recording) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URL(window.location.href).searchParams.get("decision"),
  );
  function select(id: string | null) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("decision", id);
    else url.searchParams.delete("decision");
    window.history.replaceState(null, "", url);
  }
  return (
    <>
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
      />
    </>
  );
}
