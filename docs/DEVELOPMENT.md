# Development setup

## Scope

This foundation boots the web app and backend, opens persistent SQLite storage,
validates transport payloads, and verifies HTTP and WebSocket connectivity. It
does not implement runs, telemetry generation, recording schemas, simulation
controls, or Jev evaluation. No MVP ticket is complete from this setup alone.

## Workspace

| Path                 | Responsibility                                                                   |
| -------------------- | -------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router console, React components, Tailwind styles                    |
| `apps/server`        | Long-running Fastify process; sole owner of SQLite and future simulation modules |
| `packages/contracts` | Browser-safe Zod schemas and inferred types shared by both apps                  |
| `tests/e2e`          | Playwright checks against the built apps                                         |

Keep credentials, database access, scenario truth, and model calls in the backend.
Add shared transport contracts only when both sides need them. The current schemas
cover health and connection readiness; domain contracts arrive with their features.

The backend uses standard TypeScript compilation with Node ESM imports. Relative
backend imports use `.js` extensions. Shared contracts compile before either app;
`npm run dev` watches all three workspaces. No task runner beyond npm workspaces
and the process supervisor is needed at this size.

Fastify provides HTTP routing, lifecycle hooks, in-process request tests, and a
WebSocket plugin in one server. SQLite uses `better-sqlite3`, with WAL, foreign
keys, and a five-second busy timeout. Recording tables and versioned migrations
belong to M1; the foundation does not invent a run schema.

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
failed check. These checks neither generate telemetry nor call a model.

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
Jev credentials are not configured or consumed until the evaluator is implemented.
Local `.env` files, databases, build output, and test artifacts are ignored by git.

## Checks

```bash
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest covers runtime contracts, HTTP readiness, WebSocket origin checks, invalid
configuration, foreign keys, and SQLite persistence across reopen. Playwright
uses ports 3100/3101 and an in-memory database, leaving development data alone.
It checks real backend connectivity, failures and retry, disconnection, keyboard
access, and a narrow viewport. Build before running the browser tests.

`npm run test:watch` watches tests; `npm run format` formats source and tooling.
The existing planning documents and local review artifacts are excluded from
formatting. GitHub Actions runs the checks, production build, browser tests, and
a separate Compose startup check.

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
