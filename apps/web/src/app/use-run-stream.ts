"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  activeRunSchema,
  apiErrorSchema,
  recordingSchema,
  serverMessageSchema,
  type Recording,
  type RunMessage,
} from "@blackout/contracts";
import { receiveRunMessage } from "./run-stream";

export function useRunStream({
  backendUrl,
  runId,
  attempt,
  setRecording,
  setStream,
  setError,
  setActiveRunId,
}: {
  backendUrl: string;
  runId: string | null;
  attempt: number;
  setRecording: Dispatch<SetStateAction<Recording | null>>;
  setStream: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setActiveRunId: Dispatch<SetStateAction<string | null>>;
}) {
  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let current: Recording | null = null;
    let retries = 0;
    let retryTimer: number | undefined;
    let flushTimer: number | undefined;
    let timeout: number | undefined;
    let queue: RunMessage[] = [];
    const controller = new AbortController();
    const signal = () =>
      AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    const commit = (recording: Recording) =>
      setRecording((previous) =>
        previous?.run.id === recording.run.id &&
        previous.run.revision > recording.run.revision
          ? previous
          : recording,
      );
    function reconnect() {
      if (disposed || retryTimer !== undefined) return;
      window.clearTimeout(timeout);
      window.clearTimeout(flushTimer);
      queue = [];
      flushTimer = undefined;
      setStream("Disconnected");
      retryTimer = window.setTimeout(
        () => {
          retryTimer = undefined;
          void connect();
        },
        Math.min(500 * 2 ** retries++, 5000),
      );
    }
    function flush() {
      flushTimer = undefined;
      if (disposed) return;
      try {
        for (const message of queue) {
          if (message.type === "recording.error") {
            setError(message.message);
            continue;
          }
          current = receiveRunMessage(current, message, runId!);
        }
        queue = [];
        if (!current) return;
        commit(current);
        if (current.run.status === "running") setStream("Connected");
        else {
          setStream("Recorded");
          socket?.close();
          void refreshActive().catch(reconnect);
        }
      } catch {
        setStream("Resynchronizing");
        socket?.close();
        reconnect();
      }
    }
    async function refreshActive() {
      const response = await fetch(new URL("/api/runs/active", backendUrl), {
        signal: signal(),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not check the active run.");
      const active = activeRunSchema.parse(await response.json());
      if (!disposed) setActiveRunId(active.runId);
    }
    async function connect() {
      if (disposed) return;
      setStream("Resynchronizing");
      try {
        await refreshActive();
        const response = await fetch(
          new URL(`/api/runs/${runId}`, backendUrl),
          { signal: signal(), cache: "no-store" },
        );
        if (!response.ok)
          throw new Error(apiErrorSchema.parse(await response.json()).message);
        const saved = recordingSchema.parse(await response.json());
        if (disposed) return;
        if (saved.run.id !== runId) throw new Error("Unexpected recording");
        setError(null);
        current = saved;
        commit(saved);
        if (saved.run.status !== "running") {
          setStream("Recorded");
          return;
        }
        const url = new URL("/ws", backendUrl);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("runId", runId!);
        const connection = new WebSocket(url);
        socket = connection;
        let synchronized = false;
        timeout = window.setTimeout(() => connection.close(), 5000);
        connection.onmessage = (event: MessageEvent<string>) => {
          if (disposed || socket !== connection || retryTimer !== undefined)
            return;
          try {
            const message = serverMessageSchema.parse(JSON.parse(event.data));
            if (message.type === "connection.ready") return;
            if (!synchronized && message.type !== "run.snapshot")
              throw new Error("Snapshot required");
            if (message.type === "run.snapshot") {
              current = receiveRunMessage(current, message, runId!);
              synchronized = true;
              retries = 0;
              window.clearTimeout(timeout);
            } else queue.push(message);
            // Batching is a presentation concern. Close and resync instead of accumulating without limit.
            if (queue.length > 128) throw new Error("Client fell behind");
            if (flushTimer === undefined)
              flushTimer = window.setTimeout(flush, 50);
          } catch {
            connection.close();
            reconnect();
          }
        };
        connection.onclose = () => {
          if (disposed || socket !== connection) return;
          if (queue.length) flush();
          if (current?.run.status === "running") reconnect();
        };
        connection.onerror = () => connection.close();
      } catch (cause) {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the recording.",
          );
          reconnect();
        }
      }
    }
    void connect();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      window.clearTimeout(flushTimer);
      window.clearTimeout(timeout);
      socket?.close();
    };
  }, [
    backendUrl,
    runId,
    attempt,
    setRecording,
    setStream,
    setError,
    setActiveRunId,
  ]);
}
