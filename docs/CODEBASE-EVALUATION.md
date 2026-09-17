# Codebase evaluation after M9

Evaluated September 17, 2026 against the M9 working tree, based on commit
`1f716f1`. The codebase is ready for its defined local synthetic-demo MVP.
The main next investment should be durable reevaluation jobs, followed by storage
accounting that avoids scanning historical payloads. Neither calls for changing
the deterministic generator, observable input contract, or model policies.

## Findings

### P2: reevaluation outlives its browser request under slow inference

The [browser allows 180 seconds](../apps/web/src/app/run-console.tsx#L158), while
the [backend evaluates every checkpoint sequentially in memory](../apps/server/src/runs.ts#L257)
before creating the linked recording. A 95-second source has 20 default
checkpoints; two 15-second attempts and a one-second retry delay can take about
620 seconds. If the browser times out, the backend continues and can still save
a result. Retrying can start another operation because there is no durable
operation ID or admission limit. An abrupt process exit loses partial progress.

M9 protects the source during evaluation, waits/cancels on graceful shutdown,
and rejects partial completion on cancellation. It does not turn this into a
durable job. This limitation is exposed in the release guide. The normal real
20-checkpoint reevaluation succeeded and left its source unchanged; prolonged
HTTP timeout behavior is established from the configured bounds and source,
not an additional ten-minute live-API experiment.

Recommended next change: one durable reevaluation job with an idempotent start
ID, recorded progress, cancellation, and a result link. The interface should let
a caller start, inspect and cancel the job. Move reevaluation ownership out of
`Runs` as part of that feature, preserving the existing `Evaluator` seam and
source-recording protection. Limit admission so retries cannot multiply spend.

### P3: storage accounting scans payloads on the simulation thread

[RecordingStorage](../apps/server/src/recording-storage.ts#L38) sums UTF-8 JSON
lengths, and [each visible run summary](../apps/server/src/recordings.ts#L94)
does this across seven tables. `GET /api/storage` scans all retained records.
These synchronous SQLite reads share the Node event loop with simulation pulses.

At 51 retained runs and 248.44 MiB of recording JSON, five local measurements
were 83.8–92.0 ms for storage totals and 68.8–71.4 ms for a 20-row run list.
See [measurement evidence](evaluations/m9-measurements.json). That remains usable
for the current local workload; it is already a material part of a 200 ms tick
at requested 5× speed. It should not be extrapolated to unlimited retention.

Recommended next change, before raising storage/run limits: maintain owned-byte
counters in the same transaction as writes/deletion and index derivation lookup.
Keep physical allocation/WAL metrics separate. Re-measure before adding paging
or a new database architecture; the current 120-second recording limit and
explicit retention policy make those larger changes unnecessary for MVP.

## Architecture and correctness

The current module structure fits the product. Deterministic telemetry and
aggregation are separated from model transport; the evaluator accepts immutable
observable snapshots, and policy functions interpret returned values. This lets
software tests control model responses without changing generation. There is
one SQLite owner and transactions establish the publish-after-commit rule.

The strongest invariants have direct tests: exact replay across speeds, five
window boundaries and historical expiry, truth isolation, snapshot/request
matching, pause-time arrival versus resume-time application, late responses
after reset, source immutability, restart interruption, and deletion rollback.
The real model suite remains separate from those software guarantees.

M9's storage module concentrates accounting, linked-source protection, in-flight
leases and atomic deletion behind a small interface. It avoids putting SQLite
deletion order in HTTP handlers or React. The demo installer verifies a checksum,
publishes a complete file atomically, and refuses existing data. Saved report
availability is calculated for the API view; measured reports stay unchanged.

The most complicated module is `Runs`, which owns timing, controls, evaluation,
derived recordings and investigations. Its size alone is not a reason to split
it. The durable-job feature provides a concrete seam for reducing those
responsibilities without spreading run invariants across generic services.

During M9, review found and fixed chained reevaluation evidence lookup, deletion
versus reevaluation races, retrying a reset whose result had been deleted, and
false completion of an aborted reevaluation. Tests cover these paths. Linked
creation now requires a finished source so a saved derivation cannot borrow
evidence that is still changing.

## Evidence and scope

- Reviewed the M9 diff plus the main orchestration, persistence, evaluator,
  playback, browser command, and storage paths. This is a targeted correctness
  and architecture review, not a claim of line-by-line review of every file.
- Passed 98 unit/integration tests in 14 files, 13 production-browser tests,
  TypeScript, ESLint, formatting, production build, clean dependency install,
  and the six-group isolated packaged rehearsal.
- Real final suite: 180/180 valid checkpoints, 3/3 attacks detected at a
  15-second delay, 0/123 false control incidents. The 20-attempt fresh
  reevaluation retained the original exactly. All final demonstration targets
  passed; none of the attack probabilities fell below 0.2 by 95 seconds.
- The storage workflow was exercised for confirm/cancel, failed-request retry,
  keyboard activation, success, selected-view clearing, retained-run navigation
  and a 320-pixel viewport. Disabled protection is checked through the backend
  and the packaged source-deletion conflict. Native confirmation states the
  exact recording and permanent consequence. Model/API failures remain distinct
  from low risk. New action/recovery copy scored 1.4 weighted violations per
  100 words in the UX skill's strict linter (one passive construction).

No unresolved high-priority defect was found in the reviewed scope. Retain the
current architecture, make reevaluation durable next, and optimize measured
storage scans before increasing retention or run duration.
