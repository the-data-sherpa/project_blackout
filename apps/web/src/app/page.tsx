import { ConnectionStatus } from "./connection-status";
import { RunConsole } from "./run-console";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 pb-6">
        <span className="font-mono text-lg font-bold tracking-[0.2em]">
          BLACKOUT<span className="text-emerald-300">_</span>
        </span>
        <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
          Local environment
        </span>
      </header>
      <RunConsole
        backendUrl={process.env.PUBLIC_BACKEND_URL ?? "http://localhost:3001"}
      />
      <ConnectionStatus
        backendUrl={process.env.PUBLIC_BACKEND_URL ?? "http://localhost:3001"}
      />
      <footer className="mt-auto pt-12 font-mono text-xs leading-relaxed text-slate-400">
        Synthetic telemetry · Observable evidence · Inspectable decisions
      </footer>
    </main>
  );
}
