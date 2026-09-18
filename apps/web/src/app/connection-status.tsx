"use client";

import { useEffect, useState } from "react";
import { healthSchema, serverMessageSchema } from "@blackout/contracts";

type Status = "Checking" | "Ready" | "Unavailable";

export function ConnectionStatus({ backendUrl }: { backendUrl: string }) {
  const [attempt, setAttempt] = useState(0);
  const [api, setApi] = useState<Status>("Checking");
  const [stream, setStream] = useState<Status>("Checking");

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    const socketTimeout = window.setTimeout(() => {
      if (!disposed) setStream("Unavailable");
      socket?.close();
    }, 5000);

    async function checkApi() {
      try {
        const response = await fetch(new URL("/api/health", backendUrl), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Backend unavailable");
        healthSchema.parse(await response.json());
        if (!disposed) setApi("Ready");
      } catch {
        if (!disposed) setApi("Unavailable");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void checkApi();

    try {
      const url = new URL("/ws", backendUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onmessage = (event: MessageEvent<string>) => {
        if (disposed) return;
        window.clearTimeout(socketTimeout);
        try {
          serverMessageSchema.parse(JSON.parse(event.data));
          setStream("Ready");
        } catch {
          setStream("Unavailable");
        }
      };
      socket.onerror = socket.onclose = () => {
        window.clearTimeout(socketTimeout);
        if (!disposed) setStream("Unavailable");
      };
    } catch {
      window.clearTimeout(socketTimeout);
      // Defer so setup failures follow the same asynchronous path as network failures.
      queueMicrotask(() => {
        if (!disposed) setStream("Unavailable");
      });
    }

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearTimeout(socketTimeout);
      socket?.close();
    };
  }, [attempt, backendUrl]);

  const checking = api === "Checking" || stream === "Checking";
  return (
    <section
      className="connection-strip flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-700 py-2"
      aria-labelledby="connections-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="connections-title" className="sr-only">
          Service connections
        </h2>
        <button
          className="min-h-11 rounded border border-slate-600 px-3 py-1 text-xs hover:border-emerald-300 disabled:cursor-wait disabled:opacity-60"
          disabled={checking}
          onClick={() => {
            setApi("Checking");
            setStream("Checking");
            setAttempt((value) => value + 1);
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-2" aria-live="polite">
        {[
          { label: "Backend & storage", status: api },
          { label: "Live connection", status: stream },
        ].map(({ label, status }) => (
          <div key={label} className="flex min-w-0 items-center gap-2 text-xs">
            <dt className="text-slate-400">{label}</dt>
            <dd
              className={`font-mono ${status === "Ready" ? "text-emerald-300" : status === "Unavailable" ? "text-amber-300" : "text-slate-300"}`}
            >
              {status}
            </dd>
          </div>
        ))}
      </dl>
      {(api === "Unavailable" || stream === "Unavailable") && (
        <p className="mt-5 text-sm leading-relaxed text-amber-200">
          A service is unavailable. Start the backend, then check again.
        </p>
      )}
      <p className="sr-only">
        Connection checks do not start a simulation or call Jev.
      </p>
    </section>
  );
}
