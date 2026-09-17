# Jev evaluation and the first model slice

M3 implements issues #7–#10 and has real-API smoke and fixture-suite evidence. Software tests
use an injected transport and do not establish model quality.

## API and evidence boundary

The server posts to `https://api.typesafe.ai/v1/systemone` using the
[official HTTP contract](https://docs.typesafe.ai/api). Four typed questions share
one request: Noul compromise probability, condition Choice, severity Score, and
advisory response Choice. `security-questions/2` defines the current question/input version.
The default model is pinned to `jev-1.13.0`. Each attempt records the returned
model identifier. The manifest keeps the latest returned identifier too.

Request state is the strict `observable-summary/1` projection of `snapshot.input`:
all five rolling windows and metric values, their boundaries, and the selected
focus identity's profile and observed counts. Evidence sequence arrays, the
focus-selection rule and its score remain in the full snapshot for inspection.
No manifest, fixture, command, truth record, run ID, or wall timestamp enters
the model payload. The recorder regenerates the projection from the saved snapshot
and verifies exact equality before accepting an attempt.
Only the report builder uses separate truth rows to identify the first malicious
observation. It never repairs model output to match truth.

Validation checks question IDs/types, option coverage, probability ranges/sums,
highest-probability Choice selection, and probability-weighted Score. Sum
tolerance is 0.01. Score tolerance is 0.02 to allow rounding.

The recorder keeps
confidence only when returned. TypeSafe's [confidence documentation](https://docs.typesafe.ai/confidence)
describes distribution concentration. It does not establish measured correctness.
Noul has no confidence field.

The recorder retains successful and malformed successful-HTTP bodies after credential
redaction, bounded at 64 KiB. It omits error HTTP bodies and thrown transport messages
because proxies can reflect credentials. Safe failure codes,
messages, and HTTP status remain inspectable. Authentication headers are never
recorded. Requests use the fixed HTTPS endpoint and reject redirects.

## Pacing and durability

Evaluation is opt-in per run. Checkpoints occur at zero, multiples of the interval,
and the final snapshot. One request runs at a time. There is no inference queue.

Simulation waits at the checkpoint until its bounded request path settles. The
run stays running until the recorder saves its final evaluation. Browsers can disconnect
without stopping the backend.

Defaults: 5,000 ms simulation interval, 15,000 ms wall timeout, two total attempts,
1,000 ms retry delay. Timeouts, network errors, HTTP 429, and server errors retry
once against the same snapshot. Invalid responses, authentication errors, and
missing credentials do not retry that checkpoint. Future checkpoints still try.

Late responses cannot replace settled attempts. Shutdown cancels requests before
closing SQLite. Restart converts pending attempts into interrupted failures.
Their elapsed duration includes downtime, so latency percentiles exclude them.

SQLite schema 3 adds inference attempts and saved reports. Foreign keys bind
attempts to recorded snapshots. Pending attempts commit before network dispatch.
Response and policy commit together before publication. Storage failure stops
generation. M1/M2 recordings remain readable without implied decisions.

Snapshot wrappers now include wall `recordedAt` for measurement. Deterministic
telemetry and observable state are unchanged.

## Advisory policy

`advisory-policy/2` stores configured thresholds, model inputs, and every rule
result. An `incident_advisory` requires all four default rules:

| Input                     | Rule                  |
| ------------------------- | --------------------- |
| Compromise probability    | ≥ 0.8                 |
| Classification            | `compromise`          |
| Classification confidence | ≥ 0.75                |
| Severity                  | ≥ 2 on the 0–3 rubric |

Missing required inputs yield `unevaluable`. Otherwise suspicious/compromise
classification or an investigate/escalate recommendation yields `review` when
incident rules do not all match. The remaining result is `observe`.
Policy neither executes containment nor changes model output. These are
provisional thresholds for inspection, not validated detection guarantees.
Version 2 records the review fallback rule separately from incident prerequisites.
Outcomes and thresholds are unchanged from version 1 used by the early smoke runs.

## Reproduce the measurements

Run the backend, then use `npm run evaluate -- --smoke` for a 6-second attack
fixture, seed `m3-smoke-001`. `npm run evaluate` runs baseline, attack, and harmless
fixtures for 20 simulation seconds across `m3-001`, `m3-002`, and `m3-003`.
The CLI calls the running backend. No second process opens its database.

Default smoke budget: three checkpoints, at most six requests. Full suite:
45 checkpoints, at most 90 requests. A maximum UI run of 120 seconds uses at
most 50 requests. Each request batches all four questions. The CLI prints the bound for
actual backend settings before starting. No suite repeats automatically.

Token totals use returned usage. Reports do not estimate missing usage. Request counts
do not promise monetary cost or API latency.

Reports are append-only in SQLite and exported under `data/evaluations/`.
They record seeds, run IDs, question/model/policy versions, thresholds, definitions,
and links to terminal attempts at every checkpoint. The inspector exposes earlier
retries too. A question, state projection, policy, or metric change requires a
new version. Preserve earlier reports.

`slice-metrics/2` defines (version 1 lacked separate unevaluable-policy counts):

- **Detection:** first incident advisory at/after the first malicious event.
  Simulation delay is the difference in simulation milliseconds. Wall delay is
  response completion minus the malicious event snapshot's `recordedAt`.
- **Miss:** no detection with every checkpoint successfully evaluated and policy
  evaluable. Failed checkpoints or missing policy fields make no detection `incomplete`.
- **False incidents:** incident advisories / successful policy-evaluable checkpoints
  for baseline and harmless controls. Failures and unevaluable policies are separate.
- **Stability:** classification switches / adjacent successful checkpoint pairs.
  Failure breaks adjacency.
- **Latency:** wall ms per attempt, including failures except restart-interrupted
  attempts and excluding retry delay. Nearest-rank p50/p95 with sample count.
- **Achieved speed:** simulation duration / actual wall run duration.
- **Usage:** returned input/output token sums and count of attempts reporting usage.

This small synthetic suite does not establish calibrated confidence or real-world
security effectiveness. False positives and missed attacks remain visible.

## Validation evidence

The first `security-questions/1` smoke request sent full evidence-reference arrays
and received HTTP 400 `max_tokens_exceeded` (50,690 request bytes). Its three failed
checkpoints remain in run `22f53c3b-acd1-415e-aeaa-3c7acb0db6cd` and report
`71150ba5-c7ae-4fe1-a902-6dd9a28d2403`. One additional diagnostic request confirmed
the API error.

Version 2 removes unresolvable reference arrays from model input.
The questions and observable metric values were unchanged. A second smoke run,
`a85e64c1-561e-4b67-a6b2-305d947f5f4f`, completed all three requests successfully.
Report `0dc050b5-f99b-4cbc-ae4e-52408e8ea731` preserves its policy-level attack miss.
Both earlier reports retain their original metric definitions.

The initial nine-run suite, report `762e4b92-af2b-4ae3-a729-b916bf6f88b8`, completed
43/45 valid checkpoints. It had zero incident advisories: two attack misses and
one incomplete attack run. A baseline response selected `suspicious` at 0.38 while
returning `normal` at 0.39. That contradicts the highest-probability Choice contract
and remains a recorded rejection.

One attack response returned Score 2.11 against
a rounded weighted distribution of 2.09. Binary floating-point arithmetic put its
difference just above the intended inclusive 0.02 tolerance. The validator now
uses a 1e-9 numerical epsilon at the documented tolerance boundaries. It retains
the returned values. Questions, observable features, and policy thresholds are
unchanged for the follow-up suite. The initial report remains available.

The follow-up suite on September 17, 2026, report
`7750080f-753f-431b-8974-3659eb9fdd22`, completed all 45 checkpoints with valid
responses and evaluable policies. It needed no retries. All three attack runs
were policy-level misses. The six control runs produced zero false incident
advisories across 30 evaluable checkpoints.

| Fixture           | Valid checkpoints | Incident advisories | Classification switches | Attack outcome |
| ----------------- | ----------------- | ------------------- | ----------------------- | -------------- |
| Baseline          | 15/15             | 0/15                | 3/12 adjacent pairs     | Not applicable |
| Credential attack | 15/15             | 0/15                | 3/12 adjacent pairs     | 3 misses       |
| Harmless anomaly  | 15/15             | 0/15                | 5/12 adjacent pairs     | Not applicable |

Across all 45 attempts, response latency was 379 ms p50 and 478 ms p95, with a
190–747 ms range. Returned usage totaled 106,525 input and 5,625 output tokens.
The suite ran 180 simulation seconds in 182.652 wall seconds, achieving 0.986×
simulation speed. Compact requests measured 4,744–4,803 bytes.

The model selected `compromise` at 12/15 attack checkpoints, but no checkpoint
met every incident rule. It also selected `suspicious` at 7/15 baseline and
8/15 harmless checkpoints. API reliability therefore does not establish useful
detection performance. These results call for further question, evidence, and
policy evaluation before relying on incident advisories. The thresholds were
not changed to improve the reported outcome.

The checked-in reports preserve each stage:

- [Full-input smoke: token-limit failures](evaluations/m3-smoke-full-input.json)
- [Compact-input smoke: three valid responses, attack miss](evaluations/m3-smoke-summary-input.json)
- [Initial fixture suite: 43/45 valid responses](evaluations/m3-initial-suite.json)
- [Follow-up fixture suite: 45/45 valid responses](evaluations/m3-follow-up-suite.json)

Exact decision links require the matching recordings in the local database.
The reports remain readable without those recordings. The nine follow-up
recordings and all saved reports were identical before and after a Docker
backend restart. Reopening them made no inference requests.

Validation passed 52 Vitest tests, seven Playwright browser tests, formatting,
lint, type checking, production builds, and Docker Compose health checks.
Desktop and narrow-screen inspection used a saved real Jev response.
Automated checks cover snapshot correlation, truth isolation, response rejection,
policy boundaries, missing fields, and credential redaction. They exercise slow
transport, timeout/retry bounds, late replies, outage recovery, storage failure,
and restart interruption. Report denominators, HTTP/WebSocket persistence, and
console inspection also have test coverage.
