# PROJECT: BLACKOUT

An interactive synthetic security simulation for inspecting how Jev decisions
change as telemetry evolves. The planned MVP supports one active local simulation
and saved recordings, with observable evidence kept separate from scenario truth.

## Current status

M1–M5 are implemented, including interactive controls, reconnect recovery, the full scenario, benign control, and saved Jev reports.
The console starts a seeded 32-user, 16-host
organization with 15 minutes of recorded baseline history. It streams authentication,
host metrics, DNS and network events, and records five rolling windows with
inspectable evidence and a focus identity chosen from observed activity.

Choose baseline, the full credential-compromise sequence, or benign maintenance
to compare observable state. The smaller M3 fixtures remain available. Scenario truth stays separate from the evaluator input.
Stored runs survive restart. Unfinished runs become **Interrupted**. M1 recordings
remain readable.

Telemetry-only runs need no API key. Opt-in Jev evaluation adds
recorded decisions, deterministic advisory policies, and a Decision Inspector.
API failures stay visible and do not become low-risk decisions.

See the [M2 walkthrough and state rules](docs/OBSERVABLE-STATE.md).
See the [M3 evaluator and measurement guide](docs/JEV-EVALUATION.md).
See the [M4 scenarios, schedule and evaluation](docs/M4-SCENARIOS.md).
See the [M5 controls, timing and reconnect guide](docs/M5-CONTROLS.md).

## Quick start with Docker

Install Docker with Compose, then run from the repository root:

```bash
docker compose up --build --wait
```

Open [localhost:3000](http://localhost:3000). Both connection checks should show
**Ready**. The backend health endpoint is
[localhost:3001/api/health](http://localhost:3001/api/health).

Enter a seed and duration, then choose **Start run**. The default run lasts 30
simulation seconds and records five baseline events per second, plus warm-up history.
The full attack and benign control inject activity during seconds 5–34 and stop at
35 seconds; choosing either sets a 95-second duration to observe continued baseline.
The smaller fixtures inject during seconds 1–8. **Completed**
appears when the backend saves the last step. Expand **Manifest and command log** to inspect
the inputs.

Keep the page's `?run=…` address to reopen that recording. **Refresh
recording** reloads saved events and reconnects active-run updates. **Stored runs**
lists saved recordings, newest first. Choose a row to inspect it, or choose
**View active run** to return to ongoing generation. Closing the browser does
not stop generation. Starting a new run preserves previous recordings.

```bash
docker compose logs -f  # Follow service logs
docker compose down    # Stop services; retain the database
```

SQLite data lives in the `blackout-data` named volume and survives container
restarts and `docker compose down`. Removing that volume deletes its data.

## Local development

Use Node.js 24.21.0 (pinned in `.node-version`), npm 11, and Python 3 plus a C++
build toolchain for SQLite ([details](docs/DEVELOPMENT.md#local-workflow)):

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The page checks the backend, SQLite,
and WebSocket connection. Use `localhost` to match the configured browser origin.
`npm run dev` watches the web app, backend, and shared contracts.

If you use mise, `mise.toml` selects the pinned Node version:

```bash
mise install
mise exec -- npm ci
mise exec -- npm run dev
```

Stop Compose before starting local development: both use ports 3000 and 3001.
Local development stores SQLite at `data/blackout.sqlite`, separately from the
Docker volume.

## Control an interactive run

Select **Interactive mode**, enter a seed and duration, then **Start run**.
Choose a scenario and **Begin Attack** or **Begin Control**. **Pause** freezes
simulation time and live decisions while preserving inspection. **Resume** applies
held Jev results before continuing. **Stop Attack** ends injection while baseline
traffic and existing evidence remain.

Requested speeds range from 0.25× to 5×. The console shows achieved progress and
inference waits; evaluation checkpoints are never skipped. **Reset run** starts
the same seed from zero and retains the previous recording. Reconnect is automatic
and restores controls from the saved state. See the
[M5 walkthrough and API](docs/M5-CONTROLS.md).

## Evaluate with Jev

Copy `.env.example` to `.env` if you have not already configured it, and set
`JEV_API_KEY` there. Keep this file local. Only the backend uses the key.
Request records and the browser do not contain it. `JEV_MODEL` defaults to the
pinned `jev-1.13.0` model. Restart local processes after changing configuration,
or run `docker compose up --build --wait` to recreate the services.

1. Choose a fixture, check **Evaluate with Jev**, and start a run.
2. Jev answers compromise probability (Noul), condition (Choice), severity (Score,
   0–3), and advisory response (Choice) against one snapshot.
3. In **Jev decisions**, select an attempt under **Decision Inspector**. Inspect
   exact questions/state, distributions, timestamps, latency, and application
   policy rules. Selecting an attempt holds the inspector while live state
   continues above it. The address preserves the selected run and attempt.
4. Reopen the saved run at any time. Inspection makes no new API calls.

Default checkpoints occur at 0, 5, 10, … simulation seconds and the terminal
snapshot. Each request has a 15-second wall timeout and at most one retry after
one second. The simulation waits at each checkpoint, then resumes after success
or a recorded failure. A 30-second run uses 7 requests, at most 14 with retries.
A 120-second run uses at most 50.

Missing credentials produce **Unavailable**
attempts. The last successful decision remains visible with its age. Missing
decisions mean unknown risk.

An incident advisory requires compromise probability ≥ 0.8, classification
`compromise`, classification confidence ≥ 0.75, and severity ≥ 2. These are
provisional application rules, not validated detection thresholds. Missing
required fields make policy unevaluable.

Actions are advisory. The application
does not contain or remediate threats. Confidence is distribution concentration, not measured
correctness. Noul has no separate confidence field.

## Measure the first model slice

With the backend running and its Jev key configured:

```bash
npm run evaluate -- --smoke # One 6-second attack run; up to 6 requests
npm run evaluate           # Three seeds × three fixtures; up to 90 requests
```

The full suite uses `m3-001`, `m3-002`, and `m3-003` across baseline, credential
attack, and harmless anomaly, with 20 simulation seconds per run. The command
prints the budget for the backend's actual configuration. It keeps every run
and saves a report in the backend database plus `data/evaluations/<report-id>.json`.
Open **Model evaluation reports** and choose **Refresh reports** to inspect
outcomes and follow links to exact decisions.

Failures, misses, false incident decisions, classification changes, returned
token usage, latency, and achieved speed stay visible with denominators. API
failures exit nonzero after saving the report. A model miss is a measured outcome.
Prior reports are never replaced. `BLACKOUT_API_URL` selects another backend.
See [metric definitions and validation evidence](docs/JEV-EVALUATION.md).

The September 17, 2026 follow-up suite returned 45/45 valid responses, with
379 ms median latency and 478 ms p95. All three attack runs were policy-level
misses. The six control runs produced zero incident advisories across 30
checkpoints. These results do not establish detection effectiveness.
The [saved report](docs/evaluations/m3-follow-up-suite.json) preserves every outcome.

## Evaluate the full scenario

```bash
npm run evaluate -- --m4 --smoke # One full attack, 20 checkpoints
npm run evaluate -- --m4         # Three seeds × baseline/attack/benign, 180 checkpoints
```

Each run lasts 95 simulation seconds; injection stops at 35 seconds while baseline
continues. The suite uses at most 360 requests with default retries. Reports
include suspicion and detection delays, control false advisories, classification
switches, and probability changes after cessation. Failed endpoints remain unknown.
Open **Model evaluation reports**, expand a run’s decisions, and follow links to
exact attempts. Declining activity does not establish remediation. See the
[M4 guide and measured targets](docs/M4-SCENARIOS.md) for definitions and results.

The September 17, 2026 suite returned 180/180 valid responses. All three attacks
produced incident advisories within 15–20 simulation seconds of onset, with zero
false advisories across 123 control checkpoints. Attack probabilities declined
but none fell below 0.2 after injection stopped. The separate smoke run detected
only after cessation; its result is preserved alongside the full suite.

## Frameworks

- **Web:** Next.js App Router, React, TypeScript, Tailwind CSS.
- **Backend:** Fastify, WebSockets, SQLite through `better-sqlite3`.
- **Shared contracts:** Zod schemas and inferred TypeScript types.
- **Checks:** Vitest, Playwright, ESLint, Prettier, GitHub Actions.
- **Workspace:** npm workspaces. One long-running backend owns SQLite.

```text
apps/web/            Next.js console and styles
apps/server/         Fastify backend and SQLite access
packages/contracts/  Shared runtime schemas and TypeScript types
tests/e2e/           Browser tests
docs/                Product requirements, roadmap, and development guide
```

## Configuration

Defaults work without an environment file. To customize local development:

```bash
cp .env.example .env
```

The root scripts load `.env`. Restart the processes after changing it. Configure
the backend address, allowed browser origin, database path, and log level there.
Compose sets its service environment in `compose.yaml`.

See [development setup](docs/DEVELOPMENT.md#configuration) for each variable and
its default. Keep credentials in server-side configuration. The browser-visible
backend URL is public.

## Validation and production builds

```bash
npm run check       # Formatting, lint, type checking, unit/integration tests
npm run build       # Build shared contracts, backend, and web app
npx playwright install chromium
npm run test:e2e    # Browser tests against the production build
```

Vitest checks transport contracts, configuration, deterministic generation,
transaction rollback, run isolation, and database persistence through process
termination and restart. Playwright checks stored-run browsing,
start-to-inspect, recording reload, real connections, failure recovery, keyboard
access, and a narrow viewport. Browser tests use ports 3100/3101 and an in-memory
database.

GitHub Actions runs these checks and verifies Docker Compose startup. To run the
production build locally after `npm run build`, stop development or Compose and
run `npm start`.

See the [development guide](docs/DEVELOPMENT.md) for architecture details and
storage behavior.

## Product plan

- [Product requirements and reviewed MVP decisions](docs/PRD.md)
- [Full MVP roadmap: milestones M1–M9 and acceptance criteria](docs/MVP-ROADMAP.md)
- [Published GitHub tickets and blocking dependencies](docs/MVP-TICKETS.md)

The next milestone, M6, adds the decision timeline, filtered evidence and incident lifecycle.
The full MVP requires milestones M1–M9.
