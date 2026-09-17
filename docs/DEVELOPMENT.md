# Development setup

## Scope

The app starts seeded synthetic organizations with recorded baseline history,
authentication, host metrics, DNS and network telemetry. Rolling snapshots retain
the evidence behind every aggregate and the focus identity. Two minimal fixtures
support comparison while scenario truth stays separate. Stored runs remain
inspectable after restart. Bounded runs complete automatically. Opt-in Jev evaluation
records model decisions and policies; interactive attack controls arrive in M5.
See [Jev evaluation](JEV-EVALUATION.md) for contracts, pacing, and the report runner.

See [observable state](OBSERVABLE-STATE.md) for the M2 walkthrough, exact window
boundaries, focus rule, fixture behavior and truth boundary.

## Workspace

| Path                 | Responsibility                                                                   |
| -------------------- | -------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router console, React components, Tailwind styles                    |
| `apps/server`        | Long-running Fastify process; sole owner of SQLite and future simulation modules |
| `packages/contracts` | Browser-safe Zod schemas and inferred types shared by both apps                  |
| `tests/e2e`          | Playwright checks against the built apps                                         |

Keep credentials, database access, scenario truth, and model calls in the backend.
Add shared transport contracts only when both sides need them. Schemas cover
health, connection readiness, start requests, recordings, and run updates.

The backend uses standard TypeScript compilation with Node ESM imports. Relative
backend imports use `.js` extensions. Shared contracts compile before either app;
`npm run dev` watches all three workspaces. No task runner beyond npm workspaces
and the process supervisor is needed at this size.

Fastify provides HTTP routing, lifecycle hooks, in-process request tests, and a
WebSocket plugin in one server. SQLite uses `better-sqlite3`, with WAL, foreign
keys, and a five-second busy timeout. Schema version 1 adds run, command, and event
tables in one migration. Version 2 adds snapshots and separate scenario truth,
tracked by `PRAGMA user_version`. Version 3 adds inference attempts and evaluation
reports. M1/M2 recordings retain their original payloads.
A newer, unsupported
database version fails startup rather than being rewritten.

TypeScript is pinned to 6.0.3, within the installed TypeScript ESLint parser's
supported range. Node 24 LTS is pinned across local setup, CI, and Docker; use the
same major version when installing the native SQLite binding.
ESLint stays on 9.39.5 because the React and import plugins bundled by the current
Next.js lint configuration do not yet declare ESLint 10 support.

## Local workflow

Install Node from `.node-version`. The native SQLite driver also requires Python 3,
make, and a C++ compiler (on Debian/Ubuntu: `python3 build-essential`; on Arch:
`python base-devel`). Docker installs these in its build stages only. Then run:

```bash
npm ci
npm run dev
```

With mise installed, the project `mise.toml` selects the pinned runtime.
`mise install node@24.21.0` installs it if needed.
`mise exec node@24.21.0 -- npm run dev` explicitly selects it without changing
your global Node version. Use the same prefix for `npm ci` and other commands.

Open `http://localhost:3000` (use this hostname to match the allowed browser origin).
The backend listens at `http://localhost:3001`. `GET /api/health` checks SQLite;
`/ws` sends a versioned `connection.ready` greeting. Browser WebSockets must use
the configured web origin. The browser validates both responses and can retry a
failed check. These checks neither generate telemetry nor call a model. The
separate **Start run** form begins generation.

`npm run dev` stops the other processes if one exits. Ctrl+C closes the backend
and its database. `npm run build` followed by `npm start` runs the production build.
Do not run development, production, and Compose simultaneously on the same ports.

## Configuration

The defaults work without an environment file. Root development/start scripts use
`dotenv-cli` to load an optional root `.env` before launching processes. This avoids
passing Node environment-file flags into Next.js workers. Next.js also supports
its usual app-local environment files.
Changing the root environment requires restarting the processes.

| Variable             | Default                  | Meaning                                                 |
| -------------------- | ------------------------ | ------------------------------------------------------- |
| `API_HOST`           | `127.0.0.1`              | Backend bind address; Compose uses `0.0.0.0` internally |
| `API_PORT`           | `3001`                   | Backend port                                            |
| `WEB_ORIGIN`         | `http://localhost:3000`  | Allowed browser origin for CORS and WebSockets          |
| `PUBLIC_BACKEND_URL` | `http://localhost:3001`  | Browser-visible backend URL, read by Next.js at runtime |
| `DATABASE_PATH`      | `./data/blackout.sqlite` | SQLite file; relative paths resolve from the repo root  |
| `LOG_LEVEL`          | `info`                   | Fastify log level                                       |

`PUBLIC_BACKEND_URL` is intentionally public; it must never contain credentials.
`JEV_API_KEY` is server-only and used only for opted-in runs. `JEV_MODEL` defaults
to `jev-1.13.0`. `JEV_CHECKPOINT_MS=5000`, `JEV_TIMEOUT_MS=15000`, and
`JEV_MAX_ATTEMPTS=2` set the bounded lifecycle. Allowed ranges are 1,000–30,000 ms
(whole seconds), 100–60,000 ms, and 1–2 attempts respectively.
`POLICY_INCIDENT_PROBABILITY=0.8`, `POLICY_CLASSIFICATION_CONFIDENCE=0.75`, and
`POLICY_INCIDENT_SEVERITY=2` configure provisional thresholds. Probability and
confidence range from 0–1, severity from 0–3. Compose forwards these variables
from `.env`. `BLACKOUT_API_URL` selects the evaluation CLI's running backend.
Local `.env` files, databases, build output, and test artifacts are ignored by git.

## Checks

```bash
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest covers runtime contracts, HTTP readiness, WebSocket origin checks, invalid
configuration, foreign keys, deterministic steps under irregular scheduling,
same-time event ordering, write rollback, committed stream delivery, cross-run
isolation, and SQLite persistence across reopen. A separate test launches the real
backend entry point with a file database, kills it with SIGKILL, and restarts it.
It verifies the exact last committed records, interruption status, clean shutdown,
and the absence of credential sentinels from API responses and SQLite files. Playwright
uses ports 3100/3101 and an in-memory database, leaving development data alone.
It checks start-to-inspect, same-seed runs, stored-run browsing, recording reload, storage errors,
backend connectivity, retry, disconnection, keyboard access, and a narrow
viewport. Build before running the browser tests.

`npm run test:watch` watches tests; `npm run format` formats source and tooling.
The existing planning documents and local review artifacts are excluded from
formatting. GitHub Actions runs the checks, production build, browser tests, and
a separate Compose startup check.

## Seeded run recording

New runs use manifest schema 2 and a 32-user, 16-host organization. The start
transaction records 15 minutes of warm-up history and an initial snapshot alongside
the manifest and start command. Five baseline observations arrive each second;
fixtures add events during seconds 1–8. See the [state rules](OBSERVABLE-STATE.md)
for exact generation, sequencing, aggregation and comparison behavior.

The manifest records seed, initial entity lists and profiles, fixed simulation
origin, duration, step size, warm-up length, fixture choice and version identifiers.
Policy, evaluator, requested-model and resolved-model fields remain null until used.
The simulation origin is `2026-01-01T09:00:00.000Z`, independent of wall-clock dates.
Warm-up uses negative simulation times; the visible clock starts at zero.

Each delivered timer callback advances exactly 1,000 simulation milliseconds.
Late callbacks slow progression; they cannot skip steps or alter event order.
The first live events arrive at 1,000 ms, and the last step is at the chosen duration.
A start command records time zero, command sequence 1 and its fixture selection.
Completion is automatic and does not invent an operator command.

The backend is the sole database writer; run only one backend per database file.
A partial unique index also prevents two active rows. Each transaction saves events,
snapshot, truth, clock and terminal status before publishing its WebSocket update.
A write failure rolls back that entire step and stops generation. Failure status
is saved if storage permits; `recording.error` reports the failure even if that
status cannot be saved. The frontend retains only saved events and snapshots.
Check storage and restart the backend before retrying.

SQLite uses WAL with `synchronous=FULL`. Successful commits are the durability
boundary, subject to the filesystem and device honoring SQLite's sync requests.
`:memory:` databases are temporary and are used by isolated automated tests.
Clean shutdown and startup mark unfinished runs interrupted without resuming
generation. Recovery leaves completed and failed statuses intact. A crash during
a transaction preserves the previous commit. A crash after commit may preserve
more events than the browser last received; recovery exposes that saved state.

The stored-run list shows summaries, newest first, with a stable run-ID tiebreaker.
It loads 20 rows per page and refreshes when the selected run changes status or the
operator chooses **Refresh runs**. Selecting a completed, failed, or interrupted
recording reads its records without opening a generation stream or calling Jev.
An active run continues while the operator inspects a different recording;
**View active run** returns to it. List errors retain the last loaded rows with
an error message. No recording deletion or automatic retention limit is applied.

If a write fails and failure status cannot be saved, the database retains the
previous committed `running` status. The active process stops generation and
reports `recording.error` to subscribers, including newly connected subscribers.
After storage is repaired, restart marks that unfinished run interrupted. Invalid
stored payloads return a storage error, rather than blaming the request input.

| API                               | Behavior                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/runs`                  | Strict JSON `{ "seed": "demo", "durationSeconds": 30, "fixture": "baseline" }`; seed is 1–128 trimmed characters, duration is an integer from 1–120 (default 30). Fixture defaults to `baseline`; also accepts `credential-attack` or `harmless-anomaly`. Returns the committed recording with HTTP 201. |
| `GET /api/runs?offset=0&limit=20` | Lists run summaries, total count, next offset, and active run ID. Limit accepts 1–100; offset accepts 0–1,000,000. It does not load event bodies.                                                                                                                                                        |
| `GET /api/runs/active`            | Returns `{ "runId": "…" }` or `{ "runId": null }`.                                                                                                                                                                                                                                                       |
| `GET /api/runs/:id`               | Returns the manifest, status, clock, ordered events, commands and snapshots from SQLite; no truth rows.                                                                                                                                                                                                  |
| `GET /api/runs/:id/truth`         | Returns `{ "records": [...] }` from the separate truth table for explicit fixture evaluation.                                                                                                                                                                                                            |
| `GET /ws?runId=<uuid>`            | Sends `connection.ready`, a full saved `run.snapshot`, then committed `run.updated` event batches with their snapshot or `recording.error`. Omitting `runId` gives only the connection check.                                                                                                            |

Malformed requests return HTTP 400, a second active run returns 409, missing
recordings return 404, and storage failures return 503. Unknown request fields
are rejected, including credentials. The recorder accepts only defined domain
fields and never copies process environment or HTTP headers into a manifest.

Run sockets carry only their selected run. On refresh, the full snapshot closes
the gap between the HTTP read and socket subscription. Automatic reconnection
and broader recovery controls belong to ticket #18. Slow clients are disconnected
when their outbound buffer exceeds 1 MiB and can reload the saved recording.

## Docker

```bash
docker compose up --build --wait
docker compose logs -f
docker compose down
```

Both ports bind only to the host loopback interface. Containers run as the Node
user, and the web container starts after backend readiness. The web image uses
Next.js standalone output. Browser configuration comes from the Compose file;
root `.env` defaults do not override its explicit service environment.

The `blackout-data` named volume stores `/app/data/blackout.sqlite`. Container
restarts, rebuilds, and `docker compose down` preserve it. Do not use
`docker compose down --volumes` unless you intend to delete that database.
Host development storage and Compose storage are separate.

## Framework references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [Fastify WebSocket lifecycle and testing](https://github.com/fastify/fastify-websocket)
- [SQLite driver API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [Next.js Playwright setup](https://nextjs.org/docs/app/guides/testing/playwright)
- [Node.js release support](https://nodejs.org/en/about/previous-releases)
