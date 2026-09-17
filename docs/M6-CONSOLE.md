# M6 — Decision console and investigations

M6 implements [#19](https://github.com/the-data-sherpa/project_blackout/issues/19)
and [#20](https://github.com/the-data-sherpa/project_blackout/issues/20).
The console separates observations, Jev judgments, application policy and operator
actions. All response recommendations remain advisory.

## Inspect a decision and its evidence

1. Start an evaluated run, or open an existing recording.
2. In **Decision timeline**, select a probability point with the pointer or
   keyboard. Failed and pending attempts appear as crosses in the unknown row,
   outside the probability scale. The **Decision Inspector** select offers the
   same attempts, including retries and responses held during pause.
3. Inspect the exact request, response, timestamps and application policy.
   Each incident rule reports Matched, Not matched or Unevaluable. Confidence
   appears in the response only where Jev supplied it. Noul has no confidence
   field; Choice and Score confidence describes distribution concentration.
4. **Observable state** holds the selected attempt's snapshot. Choose a rolling
   window and metric to inspect its contributing observations. **Recorded
   events** uses that snapshot's time as an inclusive cutoff; type, entity and
   warm-up/live filters apply within that boundary. Later observations cannot
   appear as evidence for the selected decision.
5. Choose **Follow latest attempt** to release the decision selection. The
   current successful decision and its age continue above the inspector while
   a historical attempt is selected. A `?run=…&decision=…` address restores the
   selection after reload. An unknown decision ID produces an explicit error.

The probability plot uses unsmoothed points at recorded simulation times. It
does not interpolate through failed checkpoints, turn failures into zero risk,
or manufacture a decline after injection stops. Snapshot IDs and event sequences
are scoped to the run. Attempts retain their snapshot ID, exact request, response
and versioned policy result in SQLite; `GET /api/runs/:id` returns those records
together for inspection without new inference.

Pause holds the live timeline, current successful decision and attempt metrics.
A response received during pause is recorded against its original snapshot and
can be explicitly inspected, but enters the live display and investigation
policy only after resume. Receipt and application timestamps remain distinct.
Saved, unapplied responses are labeled as such; they do not count as applied
decisions or retroactively open an investigation.

## Metrics

Metrics cover the selected run and do not change with event filters.

| Metric                        | Definition                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events processed              | Recorded observations at simulation time ≥ 0; warm-up observations are counted separately.                                                                                   |
| Model attempts                | All started attempts, including retries, with pending and failed counts.                                                                                                     |
| Applied model decisions       | Successful responses applied to the run, including the initial checkpoint. Legacy responses without application metadata retain their original display semantics.            |
| Decisions / simulation minute | Applied decisions × 60,000 ÷ elapsed simulation milliseconds. Undefined at time zero. This cumulative rate includes the initial checkpoint and is not wall-clock throughput. |
| Median attempt latency        | Median recorded wall-clock milliseconds across completed attempts; average of the middle pair for an even sample count.                                                      |
| p95 attempt latency           | Nearest-rank 95th percentile over the same samples.                                                                                                                          |
| Latency samples               | Completed successes and failures, including locally unavailable attempts. Pending attempts and interrupted attempts whose duration includes backend downtime are excluded.   |
| Snapshot age                  | Current simulation time minus the latest applied successful decision's snapshot time, in simulation seconds.                                                                 |
| Received age                  | While running, wall seconds since that decision's response was received. This can increase while simulation time is paused.                                                  |

Missing decisions mean unknown risk. A failed newer attempt leaves the last
successful decision visible with its age and an unavailable status.

## Investigation policy

New evaluated runs record `investigation-policy/1` in their manifest alongside
the evaluator and `advisory-policy/2` configurations. One applied decision opens
an investigation when **all** incident rules match:

- Compromise probability ≥ 0.8.
- Classification is `compromise`.
- Returned classification confidence ≥ 0.75.
- Severity ≥ 2 on the 0–3 scale.

These retain the provisional thresholds used in the [M4 evaluation](M4-SCENARIOS.md).
The M4 three-seed suite produced incident advisories within 15–20 simulation
seconds of attack onset and no false incident advisories across 123 control
checkpoints. That small synthetic evaluation does not validate security
effectiveness or calibrate confidence. It supports retaining the measured
first-matching-decision behavior for this showcase, rather than adding an
unmeasured consecutive-checkpoint delay. Missing confidence makes the policy
unevaluable even when the reported probability is high.

No numerical smoothing, opening persistence or automatic closing threshold is
applied. Investigation status stays open or acknowledged as raw risk fluctuates.

| Current status       | Trigger                                                                          | Result                                             |
| -------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Not opened           | Applied incident advisory                                                        | Open; record triggering attempt and snapshot.      |
| Open                 | Operator acknowledges                                                            | Acknowledged.                                      |
| Open or acknowledged | Operator closes                                                                  | Closed by operator.                                |
| Closed               | Next newly applied incident advisory                                             | Reopened; acknowledgement must be performed again. |
| Any                  | Falling risk, unevaluable/failed attempt, stopping injection, or finishing a run | No investigation transition.                       |

One investigation history belongs to each run. Reopening continues that history.
Re-saving an already applied attempt cannot reopen it. An operator can acknowledge
or close an inactive recording as well as a live run. Reset retains the old
history and starts the replacement run with no investigation actions.

Acknowledgement and closure use the server-assigned actor `local-operator`.
This identifies a local action, not an authenticated person. Automatic transitions
use `advisory-policy`. History records simulation time, wall timestamp, a
strictly increasing investigation sequence and the owning run revision. Wall
timestamps may tie; sequence and revision define order. Closure does not alter
telemetry, model outputs, advisory rules, simulated sessions or accounts.

## Storage and API

SQLite migration 4 adds `investigation_events`, with ordered per-run records,
unique operator request IDs and links to triggering inference attempts. The
history and run revision commit atomically; automatic opening also shares the
transaction that applies the model response. Migration retains existing records
without inventing historical investigations. Older manifests lacking the new
policy are labeled accordingly.

`GET /api/runs/:id` includes `investigationHistory`. Relevant `inference.updated`
and `run.updated` messages carry the committed history; full reconnect snapshots
restore it. Live operator controls wait for a synchronized connection.

`POST /api/runs/:id/investigation-actions` accepts:

```json
{
  "commandId": "157687f0-bc27-4bad-843b-4b57a7578b30",
  "type": "acknowledge",
  "expectedSequence": 1
}
```

Use `close` to close. `expectedSequence` is the last investigation history
sequence the operator saw. A repeated identical request returns the latest
recording without adding another action. Reusing the ID with different inputs
or another run returns 409 `command_conflict`. An invalid or stale transition
returns 409 `invalid_transition`; unknown runs return 404. Malformed requests
return 400. Actor overrides are rejected. The action-ID namespace is separate
from simulation control commands.

## Validation

Automated backend tests cover threshold boundaries, missing confidence, falling
risk, stopping injection, acknowledgement/closure, stale and duplicate actions,
reopening, pause/resume application, transaction rollback, reset isolation,
restart persistence and history delivery over the run stream. Metric tests cover
retries, failures, zero elapsed time and measured latency denominators.

The expiry test generates the full scenario, then advances synthetic baseline
observations through 15 minutes after the last injected event. That event remains
in the 15-minute window one millisecond before expiry and is absent at expiry;
baseline remains and the investigation stays open. This tests the software's
time boundaries without requiring Jev to return to normal.

Browser tests exercise keyboard timeline selection, snapshot/event correlation,
filters, missing confidence, failure inspection, deep-link reload, operator action
retry, persisted history and 320/375-pixel layouts. The M6 browser test uses the
real backend and SQLite with a deterministic Jev transport. It makes no live
Jev calls and does not constitute a new model-performance evaluation.

M7 adds whole-console recorded playback, temporal seeking, deterministic
telemetry reruns and linked fresh reevaluation. See
[M7 — Playback, seeking, reruns and reevaluation](M7-PLAYBACK.md). The M6
decision timeline remains the evidence selector within live and recorded views.
