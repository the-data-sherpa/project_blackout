# PROJECT: BLACKOUT

An interactive synthetic security simulation for inspecting how Jev decisions
change as telemetry evolves. The planned MVP supports one active local simulation
and saved recordings, with observable evidence kept separate from scenario truth.

## Current status

The framework foundation is implemented. The app starts a Next.js console and a
long-running TypeScript backend, opens SQLite, and verifies HTTP and WebSocket
connections. The page shows connection failures and supports retrying them.

Simulation runs, telemetry generators, recording schemas, attack controls, and
Jev evaluation remain in the [MVP backlog](docs/MVP-TICKETS.md). No Jev API key is
needed to run the foundation.

## Quick start with Docker

Install Docker with Compose, then run from the repository root:

```bash
docker compose up --build --wait
```

Open [localhost:3000](http://localhost:3000). Both connection checks should show
**Ready**. The backend health endpoint is
[localhost:3001/api/health](http://localhost:3001/api/health).

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

Vitest checks transport contracts, configuration, and database persistence.
Playwright checks real connections, failure recovery, keyboard access, and a
narrow viewport. Browser tests use ports 3100/3101 and an in-memory database.

GitHub Actions runs these checks and verifies Docker Compose startup. To run the
production build locally after `npm run build`, stop development or Compose and
run `npm start`.

See the [development guide](docs/DEVELOPMENT.md) for architecture details and
storage behavior.

## Product plan

- [Product requirements and reviewed MVP decisions](docs/PRD.md)
- [Full MVP roadmap: milestones M1–M9 and acceptance criteria](docs/MVP-ROADMAP.md)
- [Published GitHub tickets and blocking dependencies](docs/MVP-TICKETS.md)

The first milestone adds seeded simulation runs and durable recording. The full
MVP requires milestones M1–M9; the framework setup alone completes no milestone.
