# PROJECT: BLACKOUT

An interactive synthetic security simulation for inspecting how Jev decisions
change as telemetry evolves. The planned MVP supports one active local simulation
and saved recordings, with observable evidence kept separate from scenario truth.

## Current status

The console can start one seeded authentication run, show its simulation clock
and ordered events, and inspect the persisted manifest and start command. Run
recordings use SQLite; the backend streams each step after it commits.

This implements the first [MVP ticket](docs/MVP-TICKETS.md). The populated
organization, recording browser, attack controls, and Jev evaluation remain in
the backlog. No Jev API key is needed for this slice.

## Quick start with Docker

Install Docker with Compose, then run from the repository root:

```bash
docker compose up --build --wait
```

Open [localhost:3000](http://localhost:3000). Both connection checks should show
**Ready**. The backend health endpoint is
[localhost:3001/api/health](http://localhost:3001/api/health).

Enter a seed and duration, then choose **Start run**. The default run lasts 30
simulation seconds and records two authentication events per second. **Completed**
appears when the last step is saved. Expand **Manifest and command log** to inspect
the inputs. Keep the page's `?run=…` address to reopen that recording; **Refresh
recording** reloads saved events and reconnects live updates. Closing the browser
does not stop generation. Starting a new run preserves previous recordings.

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

## Frameworks

- **Web:** Next.js App Router, React, TypeScript, Tailwind CSS.
- **Backend:** Fastify, WebSockets, SQLite through `better-sqlite3`.
- **Shared contracts:** Zod schemas and inferred TypeScript types.
- **Checks:** Vitest, Playwright, ESLint, Prettier, GitHub Actions.
- **Workspace:** npm workspaces; one long-running backend owns SQLite.

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

The root scripts load `.env`; restart the processes after changing it. Configure
the backend address, allowed browser origin, database path, and log level there.
Compose sets its service environment in `compose.yaml`.

See [development setup](docs/DEVELOPMENT.md#configuration) for each variable and
its default. Keep credentials in server-side configuration; the browser-visible
backend URL is public.

## Validation and production builds

```bash
npm run check       # Formatting, lint, type checking, unit/integration tests
npm run build       # Build shared contracts, backend, and web app
npx playwright install chromium
npm run test:e2e    # Browser tests against the production build
```

Vitest checks transport contracts, configuration, deterministic generation,
transaction rollback, run isolation, and database persistence. Playwright checks
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

The first milestone covers seeded runs and durable recording. Its restart and
recording-browser ticket is next. The full MVP requires milestones M1–M9.
