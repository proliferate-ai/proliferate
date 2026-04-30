import {
  normalizeSessionEventEnvelope,
  type SessionEventEnvelope,
} from "../types/events.js";
import {
  emitAnyHarnessTimingEvent,
  hashTimingScope,
} from "../client/core.js";

export interface SessionStreamOptions {
  baseUrl: string;
  sessionId: string;
  authToken?: string;
  headers?: HeadersInit;
  afterSeq?: number;
  onEvent: (envelope: SessionEventEnvelope) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
  timing?: {
    category: "session.stream";
    measurementOperationId?: string;
    runtimeUrlHash?: string;
  };
}

export interface SessionStreamHandle {
  close: () => void;
}

export function streamSession(options: SessionStreamOptions): SessionStreamHandle {
  const query = options.afterSeq != null
    ? `?after_seq=${encodeURIComponent(String(options.afterSeq))}`
    : "";
  const url = `${options.baseUrl.replace(/\/+$/, "")}/v1/sessions/${encodeURIComponent(options.sessionId)}/stream${query}`;
  const controller = new AbortController();
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const runtimeUrlHash = options.timing?.runtimeUrlHash ?? hashTimingScope(baseUrl);
  const streamStartedAt = timingNow();
  let openAt: number | null = null;
  let firstEventAt: number | null = null;
  let lastEventAt: number | null = null;
  let eventCount = 0;
  let malformedEventCount = 0;
  let maxInterArrivalGapMs = 0;

  const emitTiming = (
    phase: "connect" | "first_event" | "event" | "close" | "abort" | "network_error",
    fields: {
      durationMs?: number;
      eventCount?: number;
      maxInterArrivalGapMs?: number;
      malformedEventCount?: number;
    } = {},
  ) => {
    if (!options.timing) {
      return;
    }
    emitAnyHarnessTimingEvent({
      type: "stream",
      category: "session.stream",
      phase,
      measurementOperationId: options.timing.measurementOperationId,
      runtimeUrlHash,
      ...fields,
    });
  };

  void (async () => {
    try {
      const headers = new Headers({ accept: "text/event-stream" });
      if (options.headers) {
        const requestHeaders = new Headers(options.headers);
        requestHeaders.forEach((value, key) => {
          headers.set(key, value);
        });
      }
      if (options.authToken) {
        headers.set("authorization", `Bearer ${options.authToken}`);
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        emitTiming("connect", { durationMs: timingNow() - streamStartedAt });
        throw new Error(`Session stream failed with status ${response.status}`);
      }

      openAt = timingNow();
      emitTiming("connect", { durationMs: openAt - streamStartedAt });
      options.onOpen?.();

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Session stream response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let dataLines: string[] = [];

      const flushEvent = () => {
        if (dataLines.length === 0) {
          return;
        }
        const payload = dataLines.join("\n");
        dataLines = [];
        if (!payload) return;
        try {
          const envelope = normalizeSessionEventEnvelope(
            JSON.parse(payload) as SessionEventEnvelope,
          );
          const now = timingNow();
          if (firstEventAt === null) {
            firstEventAt = now;
            emitTiming("first_event", {
              durationMs: openAt === null ? now - streamStartedAt : now - openAt,
            });
          }
          if (lastEventAt !== null) {
            maxInterArrivalGapMs = Math.max(maxInterArrivalGapMs, now - lastEventAt);
          }
          lastEventAt = now;
          eventCount += 1;
          const dispatchStartedAt = timingNow();
          options.onEvent(envelope);
          emitTiming("event", {
            durationMs: timingNow() - dispatchStartedAt,
            eventCount: 1,
          });
        } catch {
          malformedEventCount += 1;
          // Ignore malformed payloads.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          flushEvent();
          emitTiming("close", {
            durationMs: timingNow() - streamStartedAt,
            eventCount,
            malformedEventCount,
            maxInterArrivalGapMs,
          });
          options.onClose?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let lineBreakIndex = buffer.indexOf("\n");
        while (lineBreakIndex >= 0) {
          let line = buffer.slice(0, lineBreakIndex);
          buffer = buffer.slice(lineBreakIndex + 1);
          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (line === "") {
            flushEvent();
          } else if (line.startsWith("event:")) {
            // Event names are not used for dispatch; the JSON payload is the
            // source of truth for normalized session events.
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          } else if (line.startsWith(":")) {
            // Comment line; ignore.
          }

          lineBreakIndex = buffer.indexOf("\n");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        emitTiming("abort", {
          durationMs: timingNow() - streamStartedAt,
          eventCount,
          malformedEventCount,
          maxInterArrivalGapMs,
        });
        return;
      }
      emitTiming("network_error", {
        durationMs: timingNow() - streamStartedAt,
        eventCount,
        malformedEventCount,
        maxInterArrivalGapMs,
      });
      options.onError?.(
        error instanceof Error ? error : new Error("Session stream failed"),
      );
    }
  })();

  return {
    close: () => controller.abort(),
  };
}

function timingNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
