import type { components } from "../generated/openapi.js";

/** One harness's status document (agent_auth spec §2) — served verbatim. */
type AgentAuthStatusDoc = components["schemas"]["AgentAuthStatusDoc"];

/** The SSE event name the runtime stamps on every status frame. */
export const AGENT_AUTH_STATUS_EVENT = "agent_auth_status";

export interface AgentAuthStatusStreamOptions {
  baseUrl: string;
  authToken?: string;
  headers?: HeadersInit;
  /** One call per document: the connect snapshot, then one per change. */
  onEvent: (document: AgentAuthStatusDoc) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface AgentAuthStatusStreamHandle {
  close: (reason?: unknown) => void;
}

/**
 * Subscribe the runtime's per-harness status documents
 * (`GET /v1/agent-auth/status/stream`).
 *
 * Fetch-based SSE, the same shape as [`streamSession`] — there is no
 * `EventSource` in this SDK because the runtime's local API is bearer-authed
 * and `EventSource` cannot carry a header.
 *
 * Unlike the session stream, frames are dispatched by EVENT NAME: the status
 * stream is a per-harness multiplex (`id:` is the harness kind), so a future
 * second event kind on the same connection must not be misread as a status
 * document.
 */
export function streamAgentAuthStatus(
  options: AgentAuthStatusStreamOptions,
): AgentAuthStatusStreamHandle {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/v1/agent-auth/status/stream`;
  const controller = new AbortController();

  void (async () => {
    try {
      const headers = new Headers({ accept: "text/event-stream" });
      if (options.headers) {
        new Headers(options.headers).forEach((value, key) => {
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
        throw new Error(
          `Agent auth status stream failed with status ${response.status}`,
        );
      }

      options.onOpen?.();

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Agent auth status stream response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventName: string | null = null;
      let dataLines: string[] = [];

      const flushEvent = () => {
        const payload = dataLines.join("\n");
        const name = eventName;
        dataLines = [];
        eventName = null;
        if (!payload || name !== AGENT_AUTH_STATUS_EVENT) {
          return;
        }
        try {
          options.onEvent(JSON.parse(payload) as AgentAuthStatusDoc);
        } catch {
          // Ignore malformed payloads: a frame we cannot parse must not
          // withdraw a document the pane already holds.
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          flushEvent();
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
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
          // `id:` (the harness kind) and `:` comments carry no payload — the
          // document names its own harness.

          lineBreakIndex = buffer.indexOf("\n");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      options.onError?.(
        error instanceof Error
          ? error
          : new Error("Agent auth status stream failed"),
      );
    }
  })();

  return {
    close: (reason?: unknown) => controller.abort(reason),
  };
}
