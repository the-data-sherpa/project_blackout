import { ConnectionStatus } from "./connection-status";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 sm:px-12 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 pb-6">
        <span className="font-mono text-lg font-bold tracking-[0.2em]">
          BLACKOUT<span className="text-emerald-300">_</span>
        </span>
        <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
          Local environment
        </span>
      </header>
      <section className="py-16 sm:py-24" aria-labelledby="page-title">
        <p className="mb-4 font-mono text-xs uppercase tracking-widest text-emerald-300">
          Development foundation
        </p>
        <h1
          id="page-title"
          className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl"
        >
          The console starts here.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
          BLACKOUT will let you inspect how Jev decisions change as synthetic
          security telemetry evolves.
        </p>
        <p className="mt-4 max-w-xl leading-relaxed text-slate-400">
          This setup verifies the local services. Simulation controls,
          recordings, and live Jev decisions are still to come.
        </p>
      </section>
      <ConnectionStatus
        backendUrl={process.env.PUBLIC_BACKEND_URL ?? "http://localhost:3001"}
      />
      <footer className="mt-auto pt-12 font-mono text-xs leading-relaxed text-slate-400">
        Synthetic telemetry · Observable evidence · Inspectable decisions
      </footer>
    </main>
  );
}
