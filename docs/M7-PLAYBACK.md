# M7 — Playback, seeking, reruns and reevaluation

M7 implements [#21](https://github.com/the-data-sherpa/project_blackout/issues/21),
[#22](https://github.com/the-data-sherpa/project_blackout/issues/22),
[#23](https://github.com/the-data-sherpa/project_blackout/issues/23) and
[#24](https://github.com/the-data-sherpa/project_blackout/issues/24).

## Recorded playback

Open any completed, interrupted or failed run from **Stored runs**. The console
enters **Recorded playback · offline · simulation read-only** at simulation time 0. Playback
provides play/pause, 0.25×, 0.5×, 1×, 2× and 5× speeds, ±10-second navigation and
a timeline slider. It does not call Jev or accept live simulation commands.

`PlaybackIndex` projects the retained recording at a bounded simulation-time
cursor. It uses binary cutoffs over ordered events, commands and snapshots.
Model attempts become visible at their recorded application time. Attempts that
never entered the live display appear only at the recording endpoint. An
automatic investigation action cannot appear before its triggering attempt.
Repeated forward and backward seeks construct the same projection.

Response receipt and display application remain separate fields. The decision
inspector shows `completedAt`, `appliedAt` and `appliedSimulationTimeMs`. Command
sequence preserves pause and resume order when several actions share one frozen
simulation timestamp. Seeking that timestamp selects the last retained state at
that timestamp; the inspector and command log retain the intermediate wall-time
provenance.

Playback starts from a complete stored recording. It does not issue HTTP requests
while the cursor moves. Opening the recording performs the normal local recording
fetch and WebSocket synchronization before playback begins.

At the recording endpoint, an original run retains the M6 acknowledge and close
actions. These append operator history; they do not change telemetry or resume
the simulation. Historical cursor positions and all linked derived runs keep
those actions disabled.

## Deterministic telemetry rerun

Choose **Reproduce telemetry** on an original saved run. The backend creates a
separate linked recording from the source manifest and simulation-time command
schedule. It generates no Jev attempts. The source remains unchanged.

The installed implementation supports schema 2 recordings with `telemetry/1`,
`fixtures/1` or `scenarios/1`, and `rolling-state/1` or `rolling-state/2`.
Unsupported manifests return an `incompatible` result with an explicit message;
they do not create a run or claim a match.

The linked run records source and reproduced event counts, whether every event
matches after replacing the run ID, and the first mismatching sequence. The UI
shows this comparison and links back to the source. A telemetry match does not
imply that Jev would return the same response.

```http
POST /api/runs/:id/reruns
```

A compatible request returns `201` with `{ "status": "created", "recording": … }`.
An incompatible request returns `200` with the source ID and compatibility
message. Unknown IDs return `404`.

## Fresh Jev reevaluation

Choose **Reevaluate with Jev** on an original saved run. The backend reuses the
source observable inputs at their original evaluated checkpoints. For a
telemetry-only source, it uses the current evaluation interval and the terminal
snapshot. It records the current question, model, evaluation and policy
configuration in a separate linked run. It does not regenerate telemetry or
change the source snapshots, attempts or policy results.

The linked run reads its observable events and snapshots from the source
recording. Its attempts have independent IDs, requests, responses, errors and
policy results. The comparison table aligns original and fresh outcomes by
simulation time. Missing credentials and bounded request failures are retained
as failed fresh attempts.

```http
POST /api/runs/:id/reevaluations
```

A compatible request returns `201` after the bounded checkpoint requests finish.
A recording without compatible observable snapshots returns an explicit
`incompatible` result. Unknown IDs return `404`.

### Real Jev sample

On 2026-09-17, one five-second `credential-attack` recording used seed
`m7-real-reevaluation` and `jev-1.13.0`. The fresh run reused checkpoints at 0
and 5 seconds. The source remained byte-for-byte unchanged.

| Checkpoint | Source                                  | Fresh reevaluation                                 |
| ---------- | --------------------------------------- | -------------------------------------------------- |
| 0 s        | 0.16 compromise; `normal`; `observe`    | 0.13 compromise; `normal`; `observe`               |
| 5 s        | 0.79 compromise; `compromise`; `review` | 0.80 compromise; `compromise`; `incident_advisory` |

The policy disagreement at 5 seconds remains inspectable in both linked records.
This single sample demonstrates record separation, not model quality or expected
variance. The machine-readable sample is
[`docs/evaluations/m7-reevaluation-sample.json`](evaluations/m7-reevaluation-sample.json).

## Measured seek behavior

A local in-process benchmark generated a full 120-second baseline recording with
5,100 events and 121 snapshots, then performed 10,000 seeks across the recording.
Median projection time was 0.004 ms, p95 was 0.006 ms and the maximum observed
projection time was 0.915 ms on the documented development workstation. This
measures projection only. It does not measure React rendering, browser paint or
lower-powered hardware.

## Validation

Backend tests cover full interactive telemetry reproduction across pause,
resume, stop-injection and speed commands; incompatible legacy manifests;
differing fresh responses; unavailable Jev access; source immutability; and
round-trip seeking without future decision or investigation leakage.

The browser scenario starts a real recording, seeks backward and forward,
checks the visible event cutoff, creates an exact telemetry rerun, returns to the
source, creates an unavailable reevaluation and inspects the comparison. Desktop
and 375-pixel browser checks confirm the playback mode, current cursor, linked
identity and controls without horizontal overflow.
