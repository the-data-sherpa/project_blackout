# PROJECT: BLACKOUT — Full MVP Roadmap

Status: M1–M3 implemented; M4–M9 remain. See [M3 measurements and limitations](JEV-EVALUATION.md).
Decision baseline: PRD review accepted by the owner on 2026-09-17.  
Product specification: [PRD](PRD.md).  
Implementation backlog: [31 approved GitHub tickets across M1–M9](MVP-TICKETS.md).

This roadmap covers the complete MVP. The first end-to-end slice is an early
validation milestone, not the delivery endpoint. Milestone breakdowns and checks
below translate the accepted product decisions into an implementation plan;
they are not claims that model performance has already been demonstrated.

## Agreed product and architecture

- Build an inspectable Jev showcase. Display real model misses and uncertainty.
  Software correctness and model performance are evaluated separately.
- Support one active local simulation with saved recordings. Hosted independent
  sessions and multi-user control are outside MVP.
- Use Next.js/React, a long-running Node/TypeScript backend, WebSockets, SQLite,
  TypeScript event generators, and the Jev API. Use Docker Compose for local
  startup and persistent run storage.
- Keep the generator, scenario engine, aggregator, evaluator, policy engine,
  and recorder as modules within the backend. No Redis or external event broker
  is needed for MVP. SQLite writes have one backend owner.
- Include one flagship credential-compromise-to-lateral-movement scenario and a
  benign anomaly control. Basic user profiles and inspectable baseline history
  are required. A standalone operational-failure scenario is deferred.
- Evaluate immutable observable snapshots at fixed simulation-time checkpoints.
  Preserve checkpoints by slowing live progression when inference cannot keep
  up. Display waiting, stale, and unavailable states explicitly.
- Pause freezes simulation time and the visible timeline. An in-flight response
  may be recorded against its original snapshot, but is applied to the live
  display after resume. Inspection remains available while paused.
- STOP ATTACK stops malicious injection only. Activity risk can decline while an
  incident stays unresolved. Operator acknowledgement or closure is recorded;
  it does not prove remediation or change the model's risk estimate.
- Jev recommendations remain advisory. Actual simulated containment mechanics
  are deferred.
- Separate recorded playback, deterministic telemetry reruns, and fresh model
  reevaluation. Offline playback is explicitly labeled and makes no API calls.
- Show global model judgments separately from rule-derived entity evidence.
  Never imply Jev identified a compromised host unless it evaluated that host.

## Delivery sequence

| Milestone | Outcome | Depends on |
| --- | --- | --- |
| M1 | Deterministic run foundation and durable recording | — |
| M2 | Inspectable telemetry, baseline history, and state aggregation | M1 |
| M3 | First live Jev slice and basic Decision Inspector | M2 |
| M4 | Complete flagship scenario and benign control evaluation | M3 |
| M5 | Reliable interactive simulation controls | M4 |
| M6 | Full decision console, policies, and incident lifecycle | M5 |
| M7 | Recorded playback, seeking, and reevaluation | M6 |
| M8 | Evidence-based topology and finished console experience | M7 |
| M9 | Packaged, verified full MVP | M8 |

## M1 — Deterministic run foundation

Deliver:

- Project structure for the Next.js UI, backend, and shared runtime-validated
  contracts. Document local configuration without storing API credentials in runs.
- Run lifecycle, explicit simulation clock, seeded randomness, stable event
  ordering, and command records containing simulation time and command order.
- Versioned run manifest: seed, initial state, generator/scenario/schema versions,
  policy and evaluator configuration, requested model identifier, and model
  version returned by the API when available.
- SQLite recording of events, snapshots, commands, inference attempts/responses,
  and policy results. Correlate each record to its run and relevant snapshot.
- Separate scenario truth records from the evaluator's observable input contract.
- Persistent completed/failed/interrupted run status. Reset starts a new run;
  previous recordings remain available.

Exit criteria:

- The same versioned inputs and command sequence generate identical ordered
  telemetry, independently of wall-clock scheduling.
- Recorded data survives a backend restart; interrupted runs are identified
  honestly rather than presented as complete.
- Contract and recording tests cover ordering, invalid inputs, and run isolation.
- No model API dependency is required for these checks.

## M2 — Observable telemetry and state

Deliver:

- One synthetic organization within the PRD's 10–25 host and 20–60 user ranges.
- Continuous authentication, basic host metrics, DNS, and network telemetry.
- Deterministic user profiles and generated baseline history before visible time
  zero. History is available for inspection and fills configured rolling windows.
- Rolling aggregates for 10 seconds, 30 seconds, 1 minute, 5 minutes, and 15 minutes,
  with documented boundaries and simulation-time expiry.
- A minimal credential-attack fixture and harmless anomaly fixture for the first
  slice; the complete scenario follows in M4.
- Evidence-derived focus-identity selection and entity evidence. The aggregator
  cannot select targets using scenario metadata.

Exit criteria:

- Feature calculations match known event fixtures, including window expiry and
  warm-up history. Pausing time cannot expire observations.
- Baseline and injected events use the same observable schema; identifiers,
  source labels, ordering, and severity fields do not encode their origin.
- Evaluator inputs exclude scenario names, stages, truth labels, and command
  metadata. Tests exercise this boundary and focus selection.
- Every displayed aggregate can be traced to recorded telemetry and its window.

## M3 — First end-to-end Jev slice

Deliver:

- Server-side Jev integration behind a narrow evaluator interface. Capture exact
  decision questions, observable request payloads, typed responses, and errors;
  redact authentication headers and transport secrets.
- Noul for compromise probability, Choice for condition classification, Score
  for severity, and an advisory response Choice. Questions share the same snapshot.
- Fixed simulation-time checkpoints, request/snapshot correlation, bounded
  timeouts, and recorded failures. No unbounded queue of outstanding inference.
- A basic UI with current model state, events, and a Decision Inspector showing
  exact inputs, outputs, timestamps, and measured wall-clock latency.
- Minimal versioned deterministic policy evaluation with an inspectable result.
- Separate probability, confidence where supplied, and severity. Do not fabricate
  confidence for Noul or describe confidence as established correctness.

Exit criteria:

- One real API run traverses generator → aggregator → Jev → policy → recorder → UI.
- The inspector proves which snapshot each response evaluated and which policy
  rules used it. It can also inspect an unsuccessful inference attempt.
- Timeout, malformed response, and unavailable-service checks show explicit
  failure/staleness without inventing decisions.
- Baseline, attack, and benign fixture runs across several documented seeds
  produce an initial model-behavior report. Report misses as well as successes.
- API latency, output fields, and achievable cadence are measured in this app;
  illustrative PRD numbers are not treated as guarantees.

This milestone validates the core hypothesis. It does not complete the MVP.
If results are weak, revise observable features/questions and rerun the recorded
evaluation suite before investing in the full topology. Keep prior results.

## M4 — Complete flagship scenario and evaluation

Deliver:

- Declarative flagship sequence: weak authentication signal, increasing failures,
  unusual successful login, abnormal resource access, discovery, and lateral movement.
- Benign anomaly control using legitimate unusual behavior with sufficient
  observable context to evaluate it fairly.
- Baseline traffic that continues during and after injection. Stage progression
  changes emitted telemetry, never the UI's model state directly.
- A repeatable evaluation runner using scenario truth outside the evaluator.
- A report of detection delay, false incident decisions during baseline/control,
  classification stability, and activity-risk behavior after injection stops.
  Record seeds, thresholds, denominators, misses, and both relevant clocks.

Exit criteria:

- Full attack and benign runs can be reproduced from manifests and command logs.
- Truth isolation holds across every stage, including post-authentication activity.
- Evaluation definitions and provisional performance targets are documented from
  M3/M4 evidence, with achieved results and unmet targets visible.
- A model miss is recorded as a model result, not repaired by a scripted UI label.
- No security-effectiveness or calibrated-confidence claim exceeds the evidence.

## M5 — Interactive controls and timing

Deliver:

- Normal mode, scenario selection, Begin Attack, Stop Attack, Pause, Resume,
  Reset, and requested speeds of 0.25×, 0.5×, 1×, 2×, and 5×.
- Checkpoint-preserving pacing with requested speed and actual progress visible.
  While a request is pending, slow/wait rather than skip checkpoints. Once its
  bounded timeout expires, record a failed checkpoint and allow telemetry to
  continue; retry attempts remain attributable to the original snapshot.
- Idempotent command handling, run identifiers, and rejection of invalid control
  transitions. An old response cannot update a new/reset run.
- WebSocket snapshots/deltas with sequence information and reconnect resync.
  Batch UI updates so rendering does not govern simulation time.

Exit criteria:

- Pause during an in-flight request preserves the frozen visible state; the
  response is stored and becomes applicable on resume.
- Stop Attack leaves baseline generation running. Reset preserves old recordings.
- Changing requested speed changes pacing, not event order or evaluation points
  for an otherwise identical command schedule.
- Delayed responses, duplicate commands, disconnect/reconnect, and reset races
  cannot corrupt the run or attach decisions to the wrong state.
- API outage does not create an indefinite wait or silently switch to playback.

## M6 — Decision console and incident lifecycle

Deliver:

- Event filtering, threat timeline, current Jev decision panel, telemetry metrics,
  and an expanded Decision Inspector with policy rule-by-rule evaluation.
- Visible distinctions among raw observations, model judgments, deterministic
  policy outcomes, and operator actions.
- Configured incident thresholds and state transition rules, recorded with policy
  versions. Display actual model fluctuations even if policy uses persistence or
  hysteresis to avoid rapidly opening/closing incident indicators.
- Separate activity risk and investigation status. Support operator acknowledgement
  and closure, recording who/what performed the local action and when.
- Counters and measured inference latency summaries. Show the age of the latest
  successful decision; unavailable results are never interpreted as low risk.

Exit criteria:

- An operator can answer the PRD's data → decision → action questions from the UI.
- Falling activity risk does not automatically resolve an investigation. Closure
  does not alter evidence, model output, or simulate account/session remediation.
- Every timeline point opens the correct state, response, and policy evaluation.
- Confidence appears only where returned and is described accurately.
- Full 15-minute window expiry is checked in accelerated software tests; a short
  live demo is not required to clear all history or force Jev back to normal.

## M7 — Playback, seeking, and reevaluation

Deliver:

- Saved-run browser and explicitly labeled recorded playback with play/pause,
  speed controls, ±10-second navigation, and timeline seeking.
- Playback reconstructs the recorded events, state, decisions, policy results,
  and incident actions at the selected time. Use indexed records/checkpoints to
  support seeking without sending new inference requests.
- Deterministic telemetry rerun using the original manifest and command log.
- Fresh model reevaluation of recorded observable snapshots as a separate linked
  run. Preserve original responses and policy versions.
- Recorded demonstration usable without a Jev API key or internet connection.

Exit criteria:

- Seeking to a known point reproduces recorded state without showing later
  decisions or actions as if already known.
- Playback issues zero Jev requests and never identifies itself as live inference.
- A matching generator version reproduces telemetry; an incompatible manifest
  produces an explicit compatibility message rather than a false replay claim.
- Reevaluation may differ from the original; both records remain inspectable.
- Pause-time response arrival and resume-time application retain their distinct
  meaning in playback.

## M8 — Topology and complete console experience

Deliver:

- Users, workstations, servers, and services linked by observed communication.
- Selectable entities with supporting event evidence and bounded event animation.
- Entity highlighting derived from explicit evidence rules, labeled accordingly;
  global Jev assessment is shown separately.
- Coherent live and playback selection behavior: entity, timestamp, event, and
  decision inspection remain correlated.
- Dark SOC visual treatment with readable labels, keyboard-operable controls,
  visible focus, and text/icons supporting color-coded states.

Exit criteria:

- Every suspicious entity indicator has inspectable supporting observations and
  rule provenance. Scenario truth is never used as model-attributed coloring.
- Topology reconstructs correctly during recorded seeking.
- Full-length runs at all requested speeds have bounded rendered event history
  and animation work; complete evidence remains in storage.
- UI remains usable while waiting for Jev, disconnected, paused, and replaying.

## M9 — Full MVP release readiness

Deliver:

- Docker Compose startup, environment example, durable SQLite volume, and README
  instructions for live use, recorded use, reset, recordings, and troubleshooting.
- A saved demonstration with its actual outcome and a presenter walkthrough.
- Automated software checks for deterministic generation, state windows, truth
  isolation, policy behavior, control races, reconnect, persistence, and replay.
- Final model evaluation report using documented seeds and unchanged evaluation
  definitions, distinguishing measured performance from software correctness.
- Documented storage growth and recording cleanup, with explicit deletion rather
  than silently losing run evidence during reset or restart.

Exit criteria:

- A clean local setup launches from the documented instructions and completes
  the flagship live sequence with an API key and connectivity.
- Baseline → injection → escalation observations → pause/inspect → resume → stop
  injection → continued baseline is operable end to end. Jev's actual trajectory
  remains visible whether it matches the intended scenario or not.
- Benign control, service outage, backend restart, browser reconnect, recorded
  playback without connectivity, and fresh reevaluation are exercised.
- Recordings survive restart, contain no API credentials, and can be inspected
  without the original running process.
- M1–M8 exit criteria pass; remaining model limitations and unmet performance
  targets are documented. No required MVP feature is silently deferred.

## Deferred beyond MVP

Hosted independent sessions, concurrent incidents, simulated containment effects,
standalone operational failures, elaborate presentation/analyst modes, scenario
editing/marketplace, external ingestion, additional model comparison, advanced
identity profiling, endpoint process/cloud/Kubernetes telemetry, and MITRE mapping.

Basic identity profiles, a usable console, and a complete inspector are in MVP;
their more advanced variants are the deferred work.

## Remaining implementation details

These do not change the agreed MVP boundary. Resolve and record them in the
milestone that needs them, using measurements where appropriate:

- M1: package tooling, backend HTTP library, migrations, and contract validation.
- M3: model availability/version pinning, request cadence, timeout/retry limits,
  and live API cost budget. The PRD's 1–2 simulation-second cadence is a starting
  point to measure, not a promised wall-clock throughput.
- M4/M6: evidence-derived policy thresholds and numerical model-performance targets.
- M7/M8: seek indexing, chart/topology libraries, and measured rendering budgets.
- M9: retained-recording storage budget and release environment requirements.
