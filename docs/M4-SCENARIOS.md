# Full scenarios and activity decline

M4 implements tickets #11–#14. It adds the full credential-compromise sequence,
a benign maintenance control, and a repeatable comparison with baseline traffic.
The scenario is synthetic. Its selection and hidden stage truth never set a
model judgment, event severity, or policy outcome.

## Run and inspect

Choose **Full credential compromise** or **Benign maintenance control** under
**Comparison fixture**. Selecting either sets the duration to 95 simulation
seconds. Jev remains opt-in; telemetry-only runs need no key.

With the default five-second checkpoints, a 95-second run sends 20 requests,
at most 40 with retries. Each request contains all four questions. A shorter
run records only its elapsed stages. The scheduler preserves checkpoints while
waiting for Jev, so wall duration can exceed simulation duration.

In **Observable state**, choose a snapshot and open **Focus activity:
authentication, DNS and network**. The table links the evidence available in
that snapshot, including source hosts, destination hosts and ports. Select an
attempt in **Decision Inspector** to see the exact request, actual response,
and policy rules. Stage names appear only in the separate scenario metadata.

## Declarative schedule

`scenarios/1` records the selected identity, entry host, second host, resource,
location, stage intervals and cessation time in the manifest. Seeded selection
uses the same organization as baseline. Stage intervals include their start and
exclude their end. The simulation ticks once per second.

| Simulation time | Attack stage        | Emitted observations per tick                                                                                          |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0–4 s           | Before injection    | Baseline only                                                                                                          |
| 5–9 s           | Weak signal         | One failed authentication from an unfamiliar workstation and location                                                  |
| 10–14 s         | Increasing failures | Four failed authentications from the same entry host                                                                   |
| 15–19 s         | Unusual success     | Successful authentication, mail DNS resolution and HTTPS traffic                                                       |
| 20–24 s         | Resource access     | Successful access to intranet outside the identity's profile, DNS and a 4 MB transfer                                  |
| 25–29 s         | Discovery           | DNS lookups across six resources, allowed/denied port-445 connections                                                  |
| 30–34 s         | Lateral movement    | Access and port-445 traffic to the second host, followed by authentication, DNS and document traffic originating there |
| 35–95 s         | Injection stopped   | Baseline continues; observed history expires by simulation time                                                        |

The entry host, identity and unfamiliar location stay consistent across stages.
The second host hosts the accessed intranet resource. DNS answers and network
destinations refer to existing organization entities. Events use the same
source/severity rules and content-derived ordering as baseline. There are no
real network probes or authentication attempts.

The benign control uses an established secondary workstation, its usual location,
and resources already in the user's recorded profile. It models a bulk document
and department-data synchronization: sign-in at 5–14 s, document transfer at
15–24 s, and department synchronization at 25–34 s. The first sign-in fails once;
later attempts succeed. Transfers use HTTPS, with 8 MB/6 MB bursts. This unusual
volume has observable profile context; no authorization label enters Jev's input.
The seeded department/resource and identity vary across runs.

Baseline emits five events every tick during and after either scenario. At
5 s a `begin-injection` command is recorded; at 35 s a `stop-injection` command
and empty `stopped` truth row are recorded with the baseline snapshot. Each
command has simulation time, wall recorded time and a stable sequence number.
Commands, truth, events and snapshots commit in one transaction. A failed commit
cannot leave an applied command without its evidence.

The API/runner can set `stopInjectionAtSeconds` from 1–35, within the requested
run duration, for either full scenario. A stop before 5 s emits no scenario
observations and is reported as `not_exposed`, not an attack miss. The UI uses
the standard 35-second schedule. Interactive start/stop/pause controls remain M5.

## Observable input and compatibility

`rolling-state/2` retains the five existing aggregate windows and unchanged
focus-selection rule. `observable-state/2` adds recent focus activity: groups
of identical authentication, DNS or network observations within `(now − 30 s,
now]`, each with count, first/last simulation time, and evidence sequence links.
The most recent 16 groups are retained, with deterministic tie ordering. Total
events and omitted group count disclose truncation. Focus still comes from
observed authentication deviations/failures; this is not exhaustive detection
of every identity or network event.

`observable-summary/2` sends those observations and counts to Jev without their
local evidence IDs. It retains all existing rolling metric values and window
boundaries. `security-questions/3` explains the grouped observations, truncation,
longer historical windows, and the distinction between decline and remediation.
The recorded snapshot must reproduce the exact request projection. Model and
policy thresholds are unchanged from M3.

No seed, scenario name, stage, target selection, command, truth interpretation,
or run identifier enters the evaluator input. The organization/profile is the
same regardless of scenario. Changing stored truth cannot rewrite observable
snapshots or decisions.

M1–M3 recordings, `observable-state/1`, `observable-summary/1`, question versions
1–2 and earlier metric reports remain readable. No prior report is replaced.
SQLite schema remains version 3: the existing JSON records accommodate these
versioned contracts. Replaying telemetry with incompatible generation versions
is separate M7 work.

## Repeat the real evaluation

With the Docker or local backend running and its Jev key configured:

```bash
npm run evaluate -- --m4 --smoke  # One full 95-second attack; at most 40 requests
npm run evaluate -- --m4         # Nine runs; at most 360 requests
```

The full suite uses `m4-001`, `m4-002`, `m4-003`, each with baseline, full attack,
and benign maintenance. Every run lasts 95 simulation seconds. Both scenarios
explicitly schedule cessation at 35 s. The runner prints a bound using the
backend's actual checkpoint/retry settings. It saves each run, an append-only
SQLite report, and `data/evaluations/<report-id>.json`. Failed checkpoints remain
in the report and make the command exit nonzero. A model miss does not fail the
software check. Existing `npm run evaluate` / `--smoke` still select M3 fixtures,
but new evaluations use the current questions/input and metrics.

## Metric definitions

`scenario-metrics/1` preserves the original detection, latency, usage, speed and
stability measurements and adds:

- **Suspicion:** first successful checkpoint at or after the first malicious
  observation with compromise probability ≥ 0.5. This is separate from policy
  detection. A confirmed suspicion miss requires all checkpoints to succeed.
- **Policy detection:** first `incident_advisory` at/after the first malicious
  observation. The unchanged policy requires probability ≥ 0.8, `compromise`
  classification, classification confidence ≥ 0.75, and severity ≥ 2. Missing
  policy fields make an undetected run incomplete.
- **Control false incidents:** incident advisories divided by successful,
  policy-evaluable checkpoints in baseline/benign runs and before malicious
  onset in attack runs. API failures and unevaluable policies are excluded and
  reported separately. A pre-onset advisory does not count as attack detection.
- **Decline:** terminal compromise probability minus the last checkpoint's
  probability strictly before the stop. If either endpoint failed, the result
  is unknown. Links retain the exact endpoint attempts; there is no substitution
  of an earlier successful response.
- **Low activity:** first post-stop checkpoint with probability < 0.2. Missing
  crossings are null. This is an exploratory activity threshold, not a claim of
  account/session remediation. Reported post-stop counts include the stop
  checkpoint, with successful and failed denominators.

Suspicion/detection simulation delay starts at the first malicious observation;
wall delay starts at that observation snapshot's `recordedAt` and ends when the
response completes. Decline/low-activity timing starts at the recorded stop
command, using its simulation time or wall `recordedAt`. Delays are never inferred
from playback speed. Classification stability counts switches over adjacent
successful checkpoint pairs; failure breaks adjacency.

At 95 s, the last injected event at 34 s has expired from the 10-, 30-, and
60-second windows. It remains in the 5- and 15-minute windows. Risk need not return
to normal in this short demonstration. The stop does not remediate an account,
close an investigation, or rewrite evidence.

## Provisional targets

M3 observed 45/45 valid responses, zero incident advisories in controls, and three
policy-level attack misses. The following M4 demonstration targets use those
observations as the starting point. They are exploratory acceptance targets for
this fixed synthetic suite, not calibrated security guarantees. Questions and
policy thresholds are not tuned after seeing a run to turn a miss into success.

| Target               | Denominator / criterion                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| Complete evaluation  | 180/180 valid, policy-evaluable checkpoints                                         |
| Early suspicion      | 3/3 attack runs reach probability ≥ 0.5 within 10 simulation seconds of onset       |
| Policy detection     | 3/3 attack runs produce an incident advisory by the end of injection (delay ≤ 30 s) |
| No control incidents | 0 false advisories across all evaluable baseline/benign and pre-onset checkpoints   |
| Activity decline     | 3/3 attack runs fall at least 0.2 from the pre-stop checkpoint to 95 s              |
| Stable controls      | At most 20% classification switches among comparable baseline/benign pairs          |

The saved results below report achieved and unmet targets, including every
failure. A small suite cannot establish real-world false-positive rates or
confidence calibration.

## Smoke evidence

The first full live run, `c1136b69-f924-46b0-a271-db69c5274380`, completed all
20 checkpoints without a retry. [Its saved report](evaluations/m4-smoke.json)
records immediate suspicion at the first malicious observation. The first incident
advisory arrived at 40 s: 35 simulation seconds after onset and five seconds
after injection stopped. Its wall detection delay was 35,596 ms. This misses the
provisional target of detecting before cessation.

Compromise probability fell from 0.78 at the last pre-stop checkpoint to 0.29
at run end, a change of −0.49. All 13 post-stop checkpoints succeeded, but none
fell below 0.2. The model still classified the final snapshot as compromise.
This is an observed trajectory, not a scripted return to normal.

## Seed-suite results

The September 17, 2026 suite, report
`7309a4c2-3cfa-4bb0-87c1-f5ee709297d4`, returned 180/180 valid responses with
180 evaluable policies and no retries. All requests used `jev-1.13.0`,
`security-questions/3`, `observable-summary/2`, and unchanged `advisory-policy/2`
thresholds. [The complete report](evaluations/m4-suite.json) preserves all nine
runs and every checkpoint link.

| Seed     | Attack suspicion delay (simulation / wall) | Attack detection delay (simulation / wall) | Pre-stop → final probability | Attack incident checkpoints |
| -------- | ------------------------------------------ | ------------------------------------------ | ---------------------------- | --------------------------- |
| `m4-001` | 0 ms / 424 ms                              | 15,000 ms / 15,469 ms                      | 0.86 → 0.39 (−0.47)          | 6/20                        |
| `m4-002` | 0 ms / 475 ms                              | 15,000 ms / 15,404 ms                      | 0.79 → 0.37 (−0.42)          | 3/20                        |
| `m4-003` | 0 ms / 415 ms                              | 20,000 ms / 20,532 ms                      | 0.81 → 0.31 (−0.50)          | 8/20                        |

All three attacks were detected before cessation. None was a miss or incomplete.
All six baseline/benign runs had zero incident advisories across 120 evaluable
checkpoints. The three pre-onset attack checkpoints also had none: the combined
false-advisory denominator is **0/123**. Baseline classification switched 9 times
across 57 adjacent successful pairs; benign classification switched 8/57. Attack
classification switched 11/57. These are model-output fluctuations, not incident
lifecycle transitions.

| Provisional target                    | Achieved result                                | Status |
| ------------------------------------- | ---------------------------------------------- | ------ |
| Complete evaluation                   | 180/180 valid responses and evaluable policies | Met    |
| Early suspicion within 10 s           | 3/3 at the first malicious checkpoint          | Met    |
| Policy detection before cessation     | 3/3, delays 15 s, 15 s, 20 s                   | Met    |
| No control incidents                  | 0/123 evaluable control checkpoints            | Met    |
| Attack probability decline ≥ 0.2      | 3/3, drops 0.47, 0.42, 0.50                    | Met    |
| Control classification switches ≤ 20% | 17/114 pairs (14.9%)                           | Met    |

No provisional seed-suite target was unmet. The separate smoke run missed the
before-cessation detection target and remains in the evidence above. **No attack
run, including the smoke run, reached probability < 0.2 after the stop.** The
suite's attack endpoints were classified as compromise twice and suspicious once;
the short run does
not demonstrate a return to normal or remediation. This low-activity threshold
is reported as exploratory, not promoted to a passed target.

Across the suite, wall latency was 411 ms p50 and 680 ms p95 over 180 attempts,
with a 186–1,164 ms range. Returned usage totaled 614,689 input and 22,520 output
tokens; all 180 attempts reported usage. The largest request was 8,636 bytes.
The suite simulated 855 seconds in 865.355 wall seconds, achieving 0.988× speed.
These are observations from one fixed synthetic suite, not latency or cost
promises. M3/M4 are not an isolated feature ablation: the scenarios, observable
projection and question version changed together, so improved detection cannot
be attributed to one change alone.

## Software and persistence checks

Validation passed 59 Vitest tests, all eight Playwright tests, formatting, lint,
type checks, production builds, and Docker image builds. The new checks cover
all stages across three seeds, baseline continuity, profile-consistent benign
activity, second-host evidence, time boundaries, group truncation, truth isolation,
repeatable telemetry/commands, early cessation, transaction rollback, report
thresholds and failed-endpoint handling. Existing M1–M3 tests remain passing.

Browser checks exercised both launch options, a live command log, second-host
inspection, the unavailable-model report path, saved real-model reports, and a
375-pixel viewport. The new working surfaces retain the existing Tailwind/SOC
styles and native controls. The scoped copy check returned 0.0 violations per
100 words over 164 words; it does not establish full accessibility conformance.

A separate verification rebuilt every recorded request projection from its
snapshot and checked the full stage/command schedule. All nine suite recordings,
their separate truth rows, and all six stored reports were identical before and
after the backend/container update. Reading those recordings made no new Jev
requests. Exact decision links require the matching local SQLite recordings;
the checked-in reports remain readable without them.
