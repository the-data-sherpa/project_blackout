# Observable telemetry and state (M2)

M2 introduced manifest schema 2, generator `telemetry/1`, scenario `fixtures/1`
and aggregator `rolling-state/1`. Current runs use `rolling-state/2`, with
recent focus activity; full scenarios use `scenarios/1`. See the
[M4 extension](M4-SCENARIOS.md#observable-input-and-compatibility). M1 recordings remain readable with their original
schema and events. SQLite migration 2 adds snapshots and a separate truth table;
it does not regenerate old recordings.

## Try the milestone

1. Start the app using the [development guide](DEVELOPMENT.md).
2. Choose a seed, a duration of at least 9 seconds and **Baseline only**. Start the run.
3. Inspect the organization: 32 users, 12 workstations, 4 servers and 6 resources.
   Select an identity or host and choose **Inspect identity history** or
   **Inspect host history** to see its recorded warm-up observations.
4. In **Recorded events**, choose live activity and inspect authentication, host
   metrics, DNS or network events. Expand a raw event to inspect its envelope.
5. Select a snapshot and rolling window. Select an aggregate or **Inspect focus
   evidence** to see its contributing events. Selecting evidence holds the current
   snapshot while generation continues; **Follow latest** returns to current state.
6. Run the same seed with **Minimal credential attack**, then **Harmless anomaly**.
   Compare failures, unfamiliar device/location/resource counts and network bytes.
   Inspect **Allowlisted evaluator input** and the separate **Scenario metadata**.

The snapshots contain observations and deterministic calculations. Jev evaluation
is opt-in for M3. The two fixtures are small controls for that first slice; the full
scenario is implemented in M4; interactive attack controls belong to M5.

## Organization and history

The seed determines each identity's department, two known devices, usual locations,
and three usual resources. The organization contains engineering, finance and
operations profiles. Authentication chooses identities, resources and occasional
alternate devices independently at each simulation second. Identity-specific
failure rates produce ordinary failures without assigning an attack label.

A start transaction saves the manifest, start command, all 4,500 warm-up events,
and the initial snapshot before returning success. Warm-up runs from −900,000 ms
through −1,000 ms at 1,000 ms intervals. There is no event at time zero. The visible
clock starts at zero; the first live step is at 1,000 ms. The UI labels the boundary
and initially shows live events. **Saved events** includes warm-up.

Each baseline step records two authentications, one host metric observation, one
DNS query and one network connection. These are generated data: no host sampling,
DNS resolution, sockets, endpoint commands or security actions are executed.
Addresses use the documentation range `192.0.2.0/24`; domains end in `.test`.

## Observable envelope and ordering

Every current event contains a run ID, sequential event ID, sequence, signed
simulation time, derived timestamp, type, source, severity and host reference.
Event-specific fields refer to existing users, hosts and resources.

| Observation    | Source              | Warning condition       |
| -------------- | ------------------- | ----------------------- |
| Authentication | `identity-provider` | Failed authentication   |
| Host metrics   | `host-monitor`      | CPU ≥85% or memory ≥90% |
| DNS            | `dns-resolver`      | NXDOMAIN                |
| Network        | `network-sensor`    | Denied connection       |

All other observations are informational. These labels describe measurements,
not generator intent. Failed baseline and failed fixture authentication use the
same source and severity. IDs are `event-000001`, etc.; they never encode a fixture,
stage or target. Sequence numbers are unique within the run, including warm-up.

Baseline randomness is keyed by generator version, seed and simulation time.
Fixture injection cannot consume baseline randomness. Combined observations are
ordered by a deterministic content hash before the common envelope assigns IDs.
No origin flag enters this ordering or the observable schema. Run UUIDs and
wall-clock timestamps differ between executions; compare telemetry without its
run UUID when checking reproducibility.

## Rolling snapshots

The backend records an immutable snapshot at time zero and after every committed
live step. Snapshot IDs are local to a run (`snapshot-000001` at zero). The pair
`(runId, snapshotId)` identifies a saved snapshot. Construction clones and deeply
freezes data so later events cannot mutate an earlier checkpoint.

The windows are **10 seconds, 30 seconds, 1 minute, 5 minutes and 15 minutes**.
For checkpoint `t` and width `w`, an event contributes precisely when:

```text
t - w < event.simulationTimeMs <= t
```

The left endpoint is excluded; the right endpoint is included. Warm-up evidence
uses the same rule. Future events are excluded. Wall time, browser inspection and
system-clock changes cannot expire evidence. At time zero the 10-second window
therefore contains 18 authentication attempts (−9 s through −1 s).

Each window stores its endpoints and these metrics:

- Counts: authentication attempts/failures, unfamiliar device/location/resource
  observations, DNS queries/failures and network connections.
- Sum: bytes sent by recorded network connections.
- Arithmetic means: CPU and memory percentages across host samples. These are
  means of the samples in the window, not time-weighted utilization per host.
  No samples produces `null`, displayed as **No samples**; empty counts/sums are zero.

Every metric carries its contributing `evidenceSequences`. Deviation metrics count
observations, not distinct devices, locations or resources. A failed authentication
on an unfamiliar device can contribute to several metrics. Profile comparisons
use the run's initial organization; it is not updated with fixture activity.

The API returns snapshots and events together in `GET /api/runs/:id`. Resolve a
metric's sequence within that run to retrieve the complete observation. The UI
shows those records in pages of 50, including raw envelopes. Pagination limits
rendered rows, not retained evidence or the aggregate calculation.

## Focus identity

Focus is computed only from authentication in `(t − 30 s, t]` and the initial
profiles. For each identity:

```text
deviations = unfamiliar device observations
           + unfamiliar location observations
           + unfamiliar resource observations
score = 3 × deviations + failed authentication count
```

Choose highest score, then highest authentication-attempt count, then ascending
user ID. Identities without authentication evidence are excluded; no candidates
means no focus. A selected identity is not a compromise judgment. The inspector
shows its score, counts, comparison profile, rule and event references. Tests
exercise each tie-break and empty evidence, including expiry.

## Fixtures and the truth boundary

`POST /api/runs` accepts an optional `fixture`: `baseline` (default),
`credential-attack` or `harmless-anomaly` for the M2 fixtures. M4 also accepts
`credential-compromise` and `benign-maintenance`; their [schedule and stop option](M4-SCENARIOS.md)
are documented separately. The manifest and start command record
the choice. No target, truth label, custom event or arbitrary scenario name is
accepted through this endpoint.

Both fixtures choose a seeded identity and inject during simulation seconds 1–8.
Shorter runs contain only their elapsed steps. Baseline runs throughout.

| Fixture           | Observable behavior                                                                                                                                                                           | Separate truth interpretation |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Credential attack | Three attempts per second from a device, location and resource outside the identity's profile. Failures during seconds 1–4; successes during seconds 5–8.                                     | `credential-misuse`           |
| Harmless anomaly  | Three attempts per second using the identity's registered alternate device, usual location and usual resource. Initial failures, then successful sign-ins, plus an 8 MB transfer each second. | `authorized-burst`            |

Fixture truth includes its interpretation, target and injected event references.
It is saved in `scenario_truth`, separate from events and snapshots, and read only
through `GET /api/runs/:id/truth`. The console loads it explicitly in the scenario
metadata section. Ordinary recordings and WebSocket updates contain no truth rows.
The manifest does contain run controls and fixture choice; it is not evaluator input.

Version 1 of `evaluatorInputSchema` is a strict allowlist with `schemaVersion`,
`simulationTimeMs`, `windows` and `focus`. Version 2 adds the bounded, observed
`focusActivity` groups described in the [M4 guide](M4-SCENARIOS.md). Nested structures are strict too. The
aggregator accepts an organization, observations and a simulation time, never a
manifest, command, fixture or truth record. The snapshot wrapper carries recording
IDs and a wall timestamp. M3 derives a strict compact model payload from `.input`,
preserving observed metric values and profiles while keeping evidence-reference
arrays in the recording. See [Jev input revisions](JEV-EVALUATION.md). Seeds, wall
clocks, run controls, scenario names/stages and truth labels are excluded.

The event and snapshot payloads do not change if only persisted truth is changed.
Tests also check strict nested allowlists, ordinary source labels and IDs,
shared baseline randomness, evidence-derived focus and complete fixture reruns.
M3 measures whether these observable features are useful to Jev; M2 makes no
model-quality or calibrated-confidence claim.

## Durability and verification

Each step commits events, snapshot, truth (if any), run clock and status together.
Only then can a WebSocket update publish them. A failure rolls back the whole
step. Restart marks unfinished runs interrupted; it preserves the last committed
snapshot and events without resuming generation. Database version 1 migrates
forward; newer unsupported versions still fail startup.

`npm run check` covers schema validation, references, deterministic history and
fixture reruns, exact aggregates and expiry, focus ties, immutability, truth
isolation, transaction rollback, legacy migration and process restart. Build and
run `npm run test:e2e` to exercise the inspectors, held checkpoints, both fixtures,
metadata retry, keyboard controls and narrow screens.

The bounded MVP recording endpoint loads the full recording. It does not yet page
stored event bodies or deduplicate evidence arrays between snapshots. Storage
inspection/retention and sustained-load work remain in M8/M9.
