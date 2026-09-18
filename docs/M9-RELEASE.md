# M9 release and presenter guide

M9 packages the local MVP, adds selected recording cleanup, and verifies the
release in an isolated Docker Compose project. Software checks and measured Jev
behavior are reported separately. This is a synthetic demonstration, not a
validated security detector or a hosted multi-user service.

## Requirements and clean startup

Use Docker with Compose, or Node 24.21.0, npm 11, Python 3, make and a C++
compiler. Building images and installing dependencies require network access.
Recorded playback needs no internet connection after installation. Live Jev
evaluation requires a configured backend key and access to the Jev endpoint.

```bash
docker compose up --build --wait
```

Open <http://localhost:3000>. The backend and WebSocket checks should read
**Ready**. Start a short seeded run, wait for **Completed**, and keep its
`?run=…` address. `docker compose restart` preserves it. `docker compose down`
stops the app and retains the named SQLite volume. Exactly one backend owns it.

Copy `.env.example` to `.env` only if configuration is needed. Set `JEV_API_KEY`
there for live evaluation, then rebuild/recreate with the command above. The
key is neither a browser variable nor part of a recording or image. Without a
key, telemetry works and opted-in evaluations explicitly say **Unavailable**.

The two host ports default to 3000/3001. `BLACKOUT_WEB_PORT` and
`BLACKOUT_API_PORT` select alternative Compose host ports and update the browser
origin/address together. Container health checks keep using internal ports.

## Install the recorded demonstration

The [demo manifest](../demo/manifest.json) identifies three real Jev recordings
of `m4-001`: baseline, credential compromise and benign maintenance. The archive
contains their original events, snapshots, responses, policies, command logs,
investigation history, separate truth records and a three-run evaluation report.
Installation verifies the archive checksum and refuses an existing database,
including SQLite sidecar files. It never merges or overwrites local recordings.

Use a separate Compose project and ports to keep your current recordings:

```bash
export BLACKOUT_WEB_PORT=3300 BLACKOUT_API_PORT=3301
docker compose --project-name blackout-demo build
docker compose --project-name blackout-demo run --rm --no-deps server node scripts/install-demo.mjs
docker compose --project-name blackout-demo up --wait
```

Open <http://localhost:3300>, select the credential-compromise recording in
**Stored runs**, and use **Recorded playback**. The other two recordings provide
controls. Stop this project with the same project name; its volume remains.
If the installer reports an existing database, open the existing app or select
a new project name. Do not delete a volume merely to make installation pass.

For a local Node build, choose a fresh path and start with that same path:

```bash
DATABASE_PATH=./data/presenter.sqlite npm run demo:install
DATABASE_PATH=./data/presenter.sqlite npm start
```

Build first with `npm ci && npm run build`. To regenerate the archive from
completed scheduled recordings, build the backend and run
`npm run demo:package -- <baseline-id> <attack-id> <benign-id>`. Packaging copies
validated records through the local API and makes no model requests. It verifies
round-trip equality and foreign keys before writing the archive.

## Presenter walkthrough

The completed monitoring workspace has a [step-by-step operator guide](MONITORING-WORKSPACE.md)
and a [measured acceptance record](MONITORING-ACCEPTANCE.md). Its graph expansion,
inspection links, compact transport controls and health labels work with this same
packaged archive. The deterministic tests use controlled model responses; the
offline rehearsal below displays only the archive's original Jev responses.

1. Open the saved attack recording. State that this is **recorded playback**
   of actual model responses. Seek to zero and show baseline history, the five
   window boundaries, and the exact evaluator input.
2. Seek to 10–25 seconds. Select suspicious entity evidence, then a decision
   timeline point. Show the event references, exact question/state, probability,
   returned confidence, severity and each application policy rule. Entity
   highlighting follows `entity-evidence/1`; it is not a per-host Jev diagnosis.
3. Seek to 35 seconds and then 95 seconds. Injection has stopped and baseline
   continues. Show the actual probability trajectory and the open investigation.
   Declining activity does not prove remediation. Acknowledge or close only in
   the run's investigation controls; these are recorded advisory operator actions.
4. Open the saved baseline and benign controls. Compare model decisions and
   observable behavior. The final report records misses and classification
   switches as well as detections. Do not present confidence as accuracy.
5. For live use, enable **Interactive mode** and **Evaluate with Jev**, choose
   a seed and 95-second duration, and start. After baseline observations, choose
   **Begin Attack**. Inspect escalation, **Pause simulation**, select evidence, **Resume simulation**,
   then **Stop Attack** while injection is active. Baseline continues. If the
   model misses the scenario, show that outcome. No decision is forced.
6. Explain **Reset run**: it creates another recording and retains the previous
   evidence. Reopen the original, use deterministic rerun, then optionally fresh
   reevaluation. Reevaluation is a separate linked result and uses live API calls.

## Retention and cleanup

There is no automatic eviction, run-count cap, or reset-time cleanup. **Stored
runs** shows each recording's owned JSON bytes and whether it shares evidence.
The storage summary separates recording/report bytes from allocated SQLite
pages, reusable pages and the current write-ahead log. These quantities are not
additive: JSON is inside database pages, and reusable pages are part of allocation.
Indexes, page overhead and filesystem overhead prevent a per-run physical-byte
promise. Shared evidence is counted only at its owner; reevaluations also own
their checkpoint copies and attempts.

**Delete recording** names the seed and run ID in a confirmation. It permanently
removes that run's evidence in one transaction. The backend rechecks protection
even if the browser's list is stale. Active runs, in-flight reevaluation sources,
and sources with linked recordings cannot be deleted. Delete descendants first,
including telemetry reruns, so provenance links remain intact. Reevaluation
chains resolve back to their evidence owner. Other recordings are unchanged.

Saved evaluation summaries remain immutable. Their API/browser view marks deleted
recordings unavailable and removes navigation to their raw evidence. Exported
JSON in `data/evaluations/` and the shipped demo archive are independent files;
deleting a database recording does not delete these copies. Reset links are
historical references; retrying a reset after its replacement was deleted is
rejected instead of executing it again.

If deletion returns a storage error, the transaction rolls back. If its response
is lost, refresh the list and retry only if the row remains. DELETE is idempotent:
an already-absent valid run ID returns 204. Disk pages freed by deletion are
reused; the database file need not shrink. No automatic VACUUM runs during use.

For a local presentation workstation, reserve at least 2 GiB of free disk and
review retention when allocated database plus WAL approaches 1 GiB. This is an
operating recommendation, not an enforced quota. Measure actual runs through
`GET /api/storage`; response payloads and configuration change growth. Back up
the database while Compose is stopped, including sidecars if present, before
manual storage maintenance. Never operate a second writer on the same file.

| Interface              | Behavior                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/storage`     | Allocated, reusable, WAL, recording JSON and report JSON bytes                     |
| `GET /api/runs`        | Paginated summaries with owned bytes, shared source and deletion blockers          |
| `DELETE /api/runs/:id` | 204 for deleted/already absent; 409 protected; 400 invalid ID; 503 storage failure |

## Verification and coverage

```bash
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:release
npm run evaluate -- --m4 --speed=5
```

`test:release` creates a unique disposable Compose project on ports 3200/3201,
installs the demo into a fresh volume, launches Chromium, and removes only that
project's test volume when finished. It clears the backend key, so it cannot
spend API credits. Override its host ports with `BLACKOUT_RELEASE_WEB_PORT` and
`BLACKOUT_RELEASE_API_PORT`. It writes `test-results/release-verification.json`.
CI runs both the regular checks and this packaged rehearsal.

The real suite uses unchanged M4 seeds, fixtures, 95-second durations, questions,
thresholds and `scenario-metrics/1` definitions. `--speed=5` requests faster
pacing through recorded commands; checkpoints are preserved and achieved speed
is measured. Nine runs have 180 checkpoints, at most 360 requests with default
retries. Full-length fresh reevaluation can spend another 20–40 requests.

| Milestone | Deliverables and exit checks accounted for                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | Seed/manifests, ordered commands/events, run isolation, rollback, restart interruption, durability and credential sentinels: `runs`, `restart`, `database`, `app` tests                                                 |
| M2        | Organization/profiles, four telemetry families, warm-up, five exact windows, full 15-minute expiry, focus evidence and truth isolation: `telemetry`, `scenarios`, `console` tests and event-inspector browser tests     |
| M3        | Exact live inputs/responses, policy provenance, fixed checkpoints, bounded retry/timeouts, malformed/unavailable state and measured seeds: `evaluator` tests, prior reports and final suite                             |
| M4        | All attack stages, benign context, deterministic generation, independent truth, delay/control/decline definitions and honest targets: `scenarios` tests and final suite                                                 |
| M5        | Every speed, pause-time arrival/resume-time application, idempotency, reset races, disconnect/resync and continued baseline: `controls` tests, browser controls and packaged rehearsal                                  |
| M6        | Timeline/event correlation, thresholds, fluctuations, unknown risk, confidence, latency and durable investigation actions: `console` tests, browser console and release rehearsal                                       |
| M7        | Offline playback, seek without future evidence, compatible rerun, linked fresh decisions and unchanged source: `m7`, `storage`, `release` tests and packaged rehearsal                                                  |
| M8        | Evidence rules/provenance, entity relationships, seek correlation, bounded event/animation work, all speeds, keyboard and narrow viewports: `m8` tests/browser budgets and packaged rehearsal                           |
| M9        | Persistent packaging, no-overwrite demo installation, owned/shared storage accounting, transactional deletion, cleanup race/rollback and report retention: `storage` tests, cleanup browser test and packaged rehearsal |

## Troubleshooting and limits

- **Ready never appears:** inspect `docker compose logs`, verify host ports are
  free, and use the documented `localhost` origin. Rebuild after source changes;
  a running old image does not pick up a Git checkout automatically.
- **Unavailable Jev:** set the backend key and recreate the server. A retry or
  fresh evaluation creates new attempts; it does not rewrite a prior failure.
- **Disconnected controls:** let reconnect restore the authoritative run. A
  backend restart marks unfinished generation **Interrupted**. Inspect it or
  reset into a new run; it is not silently resumed.
- **Storage failure:** free disk space or correct volume permissions, then restart
  the backend. Keep the last recording. Never delete the whole volume as a
  routine fix. Interrupted deletion is atomic and safe to retry.
- **Long reevaluation:** the current operation returns when all checkpoints
  finish. A lost browser response can leave a completed linked recording in
  **Stored runs**; refresh before starting another. Abrupt shutdown can discard
  in-memory reevaluation progress, while the original remains durable. Durable
  background reevaluation jobs are a follow-up, not a claim of this release.
- **Local scope:** bind addresses default to loopback; the app has no user
  authentication or hosted tenancy. Keep one backend per database. The UI loads
  a complete bounded recording for inspection; unbounded recordings are outside
  the 120-second MVP run limit.

## September 17, 2026 release evidence

The [final report](evaluations/m9-final-suite.json) is
`d2f73a4f-58ee-4082-8eb5-eb91c5302532`, measured against the rebuilt M9 Compose
backend with `jev-1.13.0`, `security-questions/3`, `rolling-state/2`,
`advisory-policy/2` and `scenario-metrics/1`. It contains all nine run IDs and
every decision reference. Seeds are `m4-001`, `m4-002`, `m4-003` across baseline,
credential compromise and benign maintenance; each lasts 95 simulation seconds
with injection ending at 35 seconds. No questions or thresholds were changed.

| Documented target                          | Final measurement                               | Result |
| ------------------------------------------ | ----------------------------------------------- | ------ |
| Complete, policy-evaluable responses       | 180/180; zero failed or unevaluable checkpoints | Met    |
| Suspicion within 10 s of onset             | 3/3; all at the onset checkpoint, delay 0 s     | Met    |
| Incident by end of injection, delay ≤ 30 s | 3/3; delay 15 s for every attack                | Met    |
| No false control incidents                 | 0/123 evaluable control checkpoints             | Met    |
| Attack probability decline ≥ 0.2           | Drops 0.41, 0.42, 0.53                          | Met    |
| Control classification switches ≤ 20%      | 19/114 adjacent comparable pairs, 16.7%         | Met    |

No final seed-suite target was unmet and no attack was a policy-level miss.
All three attacks nevertheless remained above the exploratory 0.2 low-risk
threshold at 95 seconds: 0.43, 0.37, 0.29. Earlier evidence remains relevant:
M3's policy misses and the M4 smoke run's late detection are preserved in their
reports. Three synthetic attack seeds cannot establish security effectiveness,
false-positive rates on real traffic, or calibrated confidence.

[Measured wall latency](evaluations/m9-measurements.json) across all 180 attempts
was 224 ms median and 399 ms p95. Achieved speed ranged from 3.66× to 3.85× at
5× requested speed; no checkpoints were skipped. Returned usage totaled
614,689 input and 22,514 output tokens, with usage present on 180/180 attempts.

The first rehearsal found that the existing Compose containers predated M6.
Its [180-checkpoint pre-rebuild report](evaluations/m9-pre-rebuild-suite.json)
is retained separately and is not the final release evidence. Containers were
rebuilt before the final suite and portable demonstration were produced.

The [real fresh reevaluation](evaluations/m9-reevaluation-sample.json) of the
full saved attack returned 20/20 valid attempts. Its linked run is
`365842cb-26d2-4d3b-bedd-d768ec58865c`. The original recording, events and snapshots
remained exactly equal; changed model responses are shown checkpoint by
checkpoint. The final suite and this sample made 200 real requests; the retained
pre-rebuild rehearsal made another 180.

Software validation passed: 98 unit/integration tests, 13 browser tests,
formatting, lint, TypeScript checking, production build and clean `npm ci`.
The [packaged rehearsal evidence](evaluations/m9-release-verification.json)
records six groups of checks against a fresh isolated Compose volume, including
offline seek, the full interactive observation/control path, restart/reconnect,
rerun, unavailable reevaluation and targeted cleanup. It uses no model key;
the real model results above are separate. CI is configured to repeat these
software checks; this record reports local execution, not a remote CI result.

The portable archive is 3,623,704 bytes (3.46 MiB). Its three recordings own
21,159,493 JSON bytes (20.18 MiB); installed SQLite allocation is 23,695,360 bytes
(22.60 MiB). The flagship owns 7,369,458 bytes (7.03 MiB), baseline 6.44 MiB and
benign control 6.71 MiB. These measurements include warm-up and every snapshot
and response. After the rehearsal created and deleted temporary linked runs,
SQLite retained 38.19 MiB of pages, including 15.57 MiB reusable. This verifies
why deletion reduces retained evidence without promising a smaller database file.
