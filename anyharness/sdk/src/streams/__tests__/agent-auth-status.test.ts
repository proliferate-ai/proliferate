import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAgentAuthStatus } from "../agent-auth-status.js";

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

function streamOf(...chunks: string[]): typeof fetch {
  return vi.fn(async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
      { status: 200 },
    )) as typeof fetch;
}

const SNAPSHOT = JSON.stringify({
  harness_kind: "claude",
  methods: [],
  applied: { kind: "seat", seat_id: "seat-1" },
  next_seat_id: null,
  rotate: true,
  probe: { verdict: "verified", at: "2026-08-27T00:00:00Z", stale: false },
  cooling_until: null,
});

describe("streamAgentAuthStatus", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatches one document per agent_auth_status frame, keyed by harness", async () => {
    globalThis.fetch = streamOf(
      `event: agent_auth_status\nid: claude\ndata: ${SNAPSHOT}\n\n`,
      `event: agent_auth_status\nid: grok\ndata: {"harness_kind":"grok","methods":[],\n`,
      `data: "applied":null,"rotate":true,\n`,
      `data: "probe":{"verdict":"failed","at":null,"stale":true}}\n\n`,
    );
    const documents: Array<{ harness_kind: string }> = [];
    const opened = vi.fn();

    await new Promise<void>((resolve, reject) => {
      streamAgentAuthStatus({
        baseUrl: "http://runtime.test/",
        authToken: "token",
        onEvent: (document) => documents.push(document),
        onOpen: opened,
        onClose: resolve,
        onError: reject,
      });
    });

    expect(opened).toHaveBeenCalledOnce();
    // Multi-line `data:` frames reassemble into one document, and each names
    // its own harness — `id:` is a routing hint, never the payload.
    expect(documents.map((document) => document.harness_kind)).toEqual([
      "claude",
      "grok",
    ]);
    const [claude] = documents as Array<Record<string, unknown>>;
    expect(claude?.probe).toEqual({
      verdict: "verified",
      at: "2026-08-27T00:00:00Z",
      stale: false,
    });
  });

  it("sends the bearer token and asks for an event stream", async () => {
    const fetchMock = streamOf("");
    globalThis.fetch = fetchMock;

    await new Promise<void>((resolve, reject) => {
      streamAgentAuthStatus({
        baseUrl: "http://runtime.test",
        authToken: "token",
        onEvent: () => {},
        onClose: resolve,
        onError: reject,
      });
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Headers },
    ];
    expect(url).toBe("http://runtime.test/v1/agent-auth/status/stream");
    expect(init.headers.get("accept")).toBe("text/event-stream");
    expect(init.headers.get("authorization")).toBe("Bearer token");
  });

  it("ignores frames of any other event name", async () => {
    globalThis.fetch = streamOf(
      `event: heartbeat\ndata: {"harness_kind":"claude"}\n\n`,
      `data: {"harness_kind":"claude"}\n\n`,
    );
    const documents: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      streamAgentAuthStatus({
        baseUrl: "http://runtime.test",
        onEvent: (document) => documents.push(document),
        onClose: resolve,
        onError: reject,
      });
    });

    expect(documents).toEqual([]);
  });

  it("drops a malformed frame rather than withdrawing a held document", async () => {
    globalThis.fetch = streamOf(
      `event: agent_auth_status\ndata: {not json\n\n`,
      `event: agent_auth_status\ndata: ${SNAPSHOT}\n\n`,
    );
    const documents: Array<{ harness_kind: string }> = [];
    const errored = vi.fn();

    await new Promise<void>((resolve) => {
      streamAgentAuthStatus({
        baseUrl: "http://runtime.test",
        onEvent: (document) => documents.push(document),
        onError: errored,
        onClose: resolve,
      });
    });

    expect(errored).not.toHaveBeenCalled();
    expect(documents.map((document) => document.harness_kind)).toEqual(["claude"]);
  });

  it("reports a refused connection so the caller can fall back to a read", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as typeof fetch;

    const error = await new Promise<Error>((resolve) => {
      streamAgentAuthStatus({
        baseUrl: "http://runtime.test",
        onEvent: () => {},
        onError: resolve,
      });
    });

    expect(error.message).toContain("503");
  });

  it("stays silent once closed by the caller", async () => {
    globalThis.fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const errored = vi.fn();

    const handle = streamAgentAuthStatus({
      baseUrl: "http://runtime.test",
      onEvent: () => {},
      onError: errored,
    });
    handle.close();
    await new Promise((resolve) => setTimeout(resolve, 80));

    // An aborted subscription is not a failure: unmounting a pane must not
    // report a stream error and trigger a fallback re-read.
    expect(errored).not.toHaveBeenCalled();
  });
});
