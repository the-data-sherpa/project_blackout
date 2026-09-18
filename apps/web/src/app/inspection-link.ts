import type { Recording } from "@blackout/contracts";
import {
  emptyEventFilters,
  eventEntities,
  type EventFilters,
} from "./event-search";
import {
  inspectAssessment,
  inspectBoundary,
  PlaybackIndex,
  type Inspection,
  type InspectionBoundary,
} from "./playback";

export const judgmentKeys = [
  "compromise",
  "classification",
  "severity",
  "response",
] as const;
export type JudgmentKey = (typeof judgmentKeys)[number];
export type InspectionView = {
  decision: string | null;
  phase: "pending" | "received" | "applied" | null;
  judgment: JudgmentKey | null;
  entity: string | null;
  event: number | null;
  filters: EventFilters;
};
export const defaultInspectionView: InspectionView = {
  decision: null,
  phase: null,
  judgment: null,
  entity: null,
  event: null,
  filters: { ...emptyEventFilters, period: "live" },
};

export function restoreInspection(url: URL, source: Recording) {
  const params = url.searchParams;
  const notices: string[] = [];
  let inspection: Inspection | null = null;
  const state: InspectionView = {
    ...defaultInspectionView,
    filters: { ...defaultInspectionView.filters },
  };
  const decision = params.get("decision");
  if (decision) {
    const phase = params.get("phase");
    state.phase =
      phase === "pending" || phase === "received" || phase === "applied"
        ? phase
        : null;
    inspection = inspectAssessment(source, decision, state.phase);
    if (inspection) state.decision = decision;
    else
      notices.push(
        "The linked decision is unavailable. Inspection was pinned to the start.",
      );
  }
  const time = params.get("time");
  if (time !== null) {
    const cursor = Number(time);
    if (
      time.trim() === "" ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > source.run.simulationTimeMs
    ) {
      notices.push(
        "The linked checkpoint is outside this recording. Inspection was pinned to the start.",
      );
      state.decision = null;
      inspection = {
        recording: new PlaybackIndex(source).at(0),
        assessment: null,
      };
    } else if (
      inspection &&
      inspection.recording.run.simulationTimeMs !== cursor
    ) {
      notices.push(
        "The linked decision does not belong to the requested checkpoint. Its selection was cleared.",
      );
      state.decision = null;
      inspection = {
        recording: new PlaybackIndex(source).at(cursor),
        assessment: null,
      };
    } else if (!inspection)
      inspection = {
        recording: new PlaybackIndex(source).at(cursor),
        assessment: null,
      };
  } else if (decision && !inspection)
    inspection = {
      recording: new PlaybackIndex(source).at(0),
      assessment: null,
    };
  if (params.has("view") && params.get("view") !== "1") {
    notices.push(
      "Unsupported inspection link version. Inspection was pinned to the start.",
    );
    inspection = {
      recording: new PlaybackIndex(source).at(0),
      assessment: null,
    };
    state.decision = null;
  }
  if (params.has("boundary")) {
    const phase = params.get("atPhase");
    const history = Number(params.get("history"));
    const commands = Number(params.get("commands"));
    const at = inspection?.recording.run.simulationTimeMs;
    const valid =
      params.get("boundary") === "1" &&
      at !== undefined &&
      !notices.length &&
      params.has("history") &&
      params.has("commands") &&
      Number.isSafeInteger(history) &&
      history >= 0 &&
      Number.isSafeInteger(commands) &&
      commands >= 0 &&
      (!params.has("attempt") ||
        phase === "pending" ||
        phase === "received" ||
        phase === "applied");
    const frozen = valid
      ? inspectBoundary(source, at, {
          attemptId: params.get("attempt"),
          phase:
            phase === "pending" || phase === "received" || phase === "applied"
              ? phase
              : null,
          historySequence: history,
          commandSequence: commands,
        })
      : null;
    if (frozen) {
      const selected =
        frozen.attempts.find((attempt) => attempt.id === state.decision) ??
        (state.decision && state.decision === params.get("attempt")
          ? (inspectAssessment(
              source,
              state.decision,
              phase === "pending" || phase === "received" || phase === "applied"
                ? phase
                : null,
            )?.assessment ?? null)
          : null);
      if (state.decision && !selected) {
        notices.push(
          "The selected decision is unavailable at the linked boundary. Its selection was cleared.",
        );
        state.decision = null;
      }
      inspection = { recording: frozen, assessment: selected };
    } else {
      notices.push(
        "The linked inspection boundary is unavailable. Inspection was pinned to the start.",
      );
      inspection = {
        recording: new PlaybackIndex(source).at(0),
        assessment: null,
      };
      state.decision = null;
    }
  }
  const judgment = params.get("judgment");
  if (judgmentKeys.some((key) => key === judgment) && state.decision)
    state.judgment = judgment as JudgmentKey;
  else if (judgment)
    notices.push(
      "The linked judgment selection is unavailable and was cleared.",
    );
  const projected =
    inspection?.recording ??
    new PlaybackIndex(source).at(
      source.run.status === "running" ? source.run.simulationTimeMs : 0,
    );
  state.entity = params.get("entity") || null;
  if (state.entity) {
    const manifest = source.run.manifest;
    const known = new Set([
      ...manifest.initialState.users,
      ...manifest.initialState.hosts,
      ...(manifest.schemaVersion === 2
        ? manifest.organization.resources.map((resource) => resource.id)
        : []),
      ...projected.events.flatMap((event) => eventEntities(event, projected)),
    ]);
    if (!known.has(state.entity))
      notices.push(
        "The linked entity is unavailable at this cursor. Its filter is retained; no future evidence is shown.",
      );
  }
  if (params.has("event")) {
    const sequence = Number(params.get("event"));
    if (
      Number.isSafeInteger(sequence) &&
      projected.events.some((event) => event.sequence === sequence)
    )
      state.event = sequence;
    else
      notices.push(
        "The linked event is unavailable at this cursor. Its selection was cleared.",
      );
  }
  state.filters.query = params.get("q") ?? "";
  const kind = params.get("type");
  if (
    kind &&
    ["all", "authentication", "host-metric", "dns", "network"].includes(kind)
  )
    state.filters.kind = kind as EventFilters["kind"];
  else if (kind)
    notices.push(
      "The linked event type is invalid. The type filter was cleared.",
    );
  const period = params.get("period");
  if (period === "all" || period === "live" || period === "warmup")
    state.filters.period = period;
  else if (period)
    notices.push(
      "The linked period is invalid. The live-period filter is in use.",
    );
  state.filters.from = params.get("from") ?? "";
  state.filters.through = params.get("through") ?? "";
  return { state, inspection, notice: notices.join(" ") || null };
}

// Only stable IDs and operator view state are shareable. No recording payloads.
export function inspectionUrl(
  base: string,
  runId: string,
  state: InspectionView,
  cursorMs: number | null,
  boundary?: InspectionBoundary,
) {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  const params = url.searchParams;
  params.set("run", runId);
  params.set("view", "1");
  if (cursorMs !== null) params.set("time", String(cursorMs));
  if (boundary && cursorMs !== null) {
    params.set("boundary", "1");
    params.set("history", String(boundary.historySequence));
    params.set("commands", String(boundary.commandSequence));
    if (boundary.attemptId && boundary.phase) {
      params.set("attempt", boundary.attemptId);
      params.set("atPhase", boundary.phase);
    }
  }
  if (state.decision) params.set("decision", state.decision);
  if (state.decision && state.phase) params.set("phase", state.phase);
  if (state.judgment) params.set("judgment", state.judgment);
  if (state.entity) params.set("entity", state.entity);
  if (state.event !== null) params.set("event", String(state.event));
  if (state.filters.query) params.set("q", state.filters.query);
  params.set("type", state.filters.kind);
  params.set("period", state.filters.period);
  if (state.filters.from) params.set("from", state.filters.from);
  if (state.filters.through) params.set("through", state.filters.through);
  return url;
}
