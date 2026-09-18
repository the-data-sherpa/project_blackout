import type { ObservableEvent, Recording } from "@blackout/contracts";

export type EventFilters = {
  query: string;
  kind: ObservableEvent["type"] | "all";
  period: "all" | "live" | "warmup";
  from: string;
  through: string;
};

export const emptyEventFilters: EventFilters = {
  query: "",
  kind: "all",
  period: "all",
  from: "",
  through: "",
};

export const hostSampleFreshnessMs = 30_000;

export function hostSamples(recording: Recording, hostId: string) {
  const samples = recording.events.filter(
    (event) =>
      event.type === "host-metric" &&
      event.hostId === hostId &&
      event.simulationTimeMs <= recording.run.simulationTimeMs,
  );
  const latest = samples.at(-1);
  const ageMs = latest
    ? recording.run.simulationTimeMs - latest.simulationTimeMs
    : null;
  return {
    samples,
    ageMs,
    stale: ageMs !== null && ageMs > hostSampleFreshnessMs,
  };
}

export function eventEntities(event: ObservableEvent, recording: Recording) {
  const manifest = recording.run.manifest;
  const resource =
    event.type === "dns" && manifest.schemaVersion === 2
      ? manifest.organization.resources.find(
          (item) => item.domain === event.query,
        )?.id
      : null;
  return [
    ...new Set([
      event.hostId,
      ...("userId" in event ? [event.userId] : []),
      ...(event.type === "network" ? [event.destinationHostId] : []),
      ...(event.type === "authentication" ? [event.resource] : []),
      ...(resource ? [resource] : []),
    ]),
  ];
}

export function indexEvents(recording: Recording) {
  return recording.events.map((event) => ({
    event,
    // All schema fields are primitive values. Keep boundaries between values:
    // a query must occur in one recorded value, never across unrelated fields.
    values: Object.values(event).map((value) => String(value).toLowerCase()),
    entities: eventEntities(event, recording),
  }));
}

export function searchEvents(
  index: ReturnType<typeof indexEvents>,
  cursorMs: number,
  filters: EventFilters,
  entity: string | null,
) {
  const from =
    filters.from.trim() === "" ? -Infinity : Number(filters.from) * 1000;
  const through =
    filters.through.trim() === "" ? Infinity : Number(filters.through) * 1000;
  const error =
    (filters.from.trim() !== "" && !Number.isFinite(from)) ||
    (filters.through.trim() !== "" && !Number.isFinite(through))
      ? "Time bounds must be finite simulation seconds."
      : from > through
        ? "From time must be at or before through time."
        : null;
  const eligible = index.filter(
    ({ event }) => event.simulationTimeMs <= cursorMs,
  );
  const query = filters.query.trim().toLowerCase();
  return {
    eligible: eligible.length,
    error,
    events: error
      ? []
      : eligible
          .filter(
            ({ event, values, entities }) =>
              (!query || values.some((value) => value.includes(query))) &&
              (!entity || entities.includes(entity)) &&
              (filters.kind === "all" || event.type === filters.kind) &&
              (filters.period === "all" ||
                (filters.period === "warmup"
                  ? event.simulationTimeMs < 0
                  : event.simulationTimeMs >= 0)) &&
              event.simulationTimeMs >= from &&
              event.simulationTimeMs <= through,
          )
          .map(({ event }) => event),
  };
}
