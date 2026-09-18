import type { Recording } from "@blackout/contracts";
import { hostSamples } from "./event-search";

export function HostSamples({
  recording,
  hostId,
  onEventSelect,
}: {
  recording: Recording;
  hostId: string;
  onEventSelect: (sequence: number) => void;
}) {
  const { samples, ageMs: age, stale } = hostSamples(recording, hostId);
  return (
    <section
      className="mt-3 min-w-0 text-xs"
      aria-label={`Recorded host samples for ${hostId}`}
      data-testid="host-samples"
    >
      <h4 className="font-medium">Host CPU and memory · {hostId}</h4>
      <p className="mt-2 text-slate-300" role="status">
        {age === null
          ? "No recorded CPU or memory samples at this cursor. Values are unknown."
          : `${stale ? "Stale" : "Recent"} sample · ${(age / 1000).toFixed(1)} simulation s old at inspected cursor.`}
      </p>
      <p className="mt-2 text-slate-400">
        Stale after 30 simulation s; playback wall time does not age these
        samples. Showing the newest {Math.min(samples.length, 8)} of{" "}
        {samples.length} eligible samples, newest first.
      </p>
      {samples.length > 0 && (
        <ul className="mt-2 space-y-2">
          {samples
            .slice(-8)
            .reverse()
            .map(
              (event) =>
                event.type === "host-metric" && (
                  <li key={event.sequence} data-testid="host-sample">
                    <button
                      className="min-h-11 w-full rounded border border-slate-600 px-3 py-2 text-left hover:border-cyan-300"
                      onClick={() => onEventSelect(event.sequence)}
                    >
                      <span className="block">
                        #{event.sequence} · {event.simulationTimeMs / 1000}{" "}
                        simulation s · CPU {event.cpuPercent}% · memory{" "}
                        {event.memoryPercent}%
                      </span>
                      <time
                        className="mt-1 block break-all text-slate-400"
                        dateTime={event.occurredAt}
                      >
                        {event.occurredAt}
                      </time>
                    </button>
                  </li>
                ),
            )}
        </ul>
      )}
    </section>
  );
}
