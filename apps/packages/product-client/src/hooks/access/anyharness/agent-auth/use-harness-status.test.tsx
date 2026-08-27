// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthStatusDoc } from "@anyharness/sdk";
import {
  useHarnessStatus,
  useMethods,
} from "#product/hooks/access/anyharness/agent-auth/use-harness-status";

const RUNTIME_URL = "http://runtime.test";

const mocks = vi.hoisted(() => ({
  getHarnessAuthStatus: vi.fn(),
  getHarnessAuthMethods: vi.fn(),
  openHarnessAuthStatusStream: vi.fn(),
  close: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/agent-auth", () => ({
  getHarnessAuthStatus: mocks.getHarnessAuthStatus,
  getHarnessAuthMethods: mocks.getHarnessAuthMethods,
  openHarnessAuthStatusStream: mocks.openHarnessAuthStatusStream,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({
    runtimeUrl: RUNTIME_URL,
    authToken: "token",
  }),
  resolveRuntimeCacheScopeKey: () => "account-1",
  resolveRuntimeConnection: () => ({
    runtimeUrl: RUNTIME_URL,
    authToken: "token",
  }),
  anyHarnessAgentAuthStatusKey: (
    runtimeUrl: string,
    harnessKind: string,
    scope: string,
  ) => ["anyharness", scope, "runtime", runtimeUrl, "agents", "status", harnessKind],
  anyHarnessAgentAuthMethodsKey: (
    runtimeUrl: string,
    harnessKind: string,
    scope: string,
  ) => ["anyharness", scope, "runtime", runtimeUrl, "agents", "methods", harnessKind],
}));

function documentFor(overrides: Partial<AgentAuthStatusDoc> = {}): AgentAuthStatusDoc {
  return {
    harness_kind: "claude",
    methods: [{ kind: "seat", applied: true, seat_id: "seat-1", available: true }],
    applied: { kind: "seat", seat_id: "seat-1" },
    next_seat_id: "seat-2",
    rotate: true,
    probe: { verdict: "verified", at: "2026-08-27T00:00:00Z", stale: false },
    cooling_until: null,
    ...overrides,
  };
}

/** The captured handlers of the most recent subscription. */
type StreamHandlers = Parameters<typeof mocks.openHarnessAuthStatusStream>[1] & {
  onEvent: (document: AgentAuthStatusDoc) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
};
let handlers: StreamHandlers;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHarnessAuthStatus.mockResolvedValue(null);
  mocks.getHarnessAuthMethods.mockResolvedValue([]);
  mocks.openHarnessAuthStatusStream.mockImplementation(
    (_connection: unknown, given: StreamHandlers) => {
      handlers = given;
      return { close: mocks.close };
    },
  );
});

afterEach(cleanup);

describe("useHarnessStatus", () => {
  it("subscribes on mount and renders a pushed document", async () => {
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    });
    // Nothing read yet: an absent document is UNKNOWN, not an invented state.
    await waitFor(() => expect(result.current.unknown).toBe(true));

    handlers.onEvent(documentFor());

    await waitFor(() => expect(result.current.unknown).toBe(false));
    expect(result.current.applied).toEqual({ kind: "seat", seat_id: "seat-1" });
    expect(result.current.nextSeatId).toBe("seat-2");
    expect(result.current.rotate).toBe(true);
    expect(result.current.probe).toEqual({
      verdict: "verified",
      at: "2026-08-27T00:00:00Z",
      stale: false,
    });
    expect(result.current.coolingUntil).toBeNull();
    expect(result.current.methods).toHaveLength(1);
  });

  it("renders a stale push as stale, and never as loading", async () => {
    mocks.getHarnessAuthStatus.mockResolvedValue(documentFor());
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => expect(result.current.probe?.stale).toBe(false));

    handlers.onEvent(
      documentFor({
        probe: { verdict: "verified", at: "2026-08-27T00:00:00Z", stale: true },
      }),
    );

    await waitFor(() => expect(result.current.probe?.stale).toBe(true));
    // The last observation survives the re-probe, and the read is not "loading".
    expect(result.current.probe?.at).toBe("2026-08-27T00:00:00Z");
    expect(result.current.loading).toBe(false);
    expect(result.current.unknown).toBe(false);
  });

  it("routes each pushed document to its OWN harness, never to a sibling", async () => {
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    });

    // grok's auth changing must not touch claude's entry (bug class (a)).
    handlers.onEvent(documentFor({ harness_kind: "grok" }));

    await waitFor(() => expect(result.current.unknown).toBe(true));
  });

  it("falls back to re-reading GET /status when the stream is unavailable", async () => {
    mocks.getHarnessAuthStatus.mockResolvedValue(null);
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });

    mocks.getHarnessAuthStatus.mockResolvedValue(documentFor());
    handlers.onError?.(new Error("stream refused"));

    // Exactly one re-read: the fallback is a read, not a retry loop.
    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => expect(result.current.unknown).toBe(false));
    expect(result.current.probe?.verdict).toBe("verified");
  });

  it("re-reads once when the stream ends", async () => {
    renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });

    handlers.onClose?.();

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("re-reads on refresh — the frontend re-reads, it never probes", async () => {
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });

    result.current.refresh();

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("closes the subscription on unmount", async () => {
    const { unmount } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("neither reads nor subscribes without a harness kind", async () => {
    const { result } = renderHook(() => useHarnessStatus(null), { wrapper });

    expect(mocks.getHarnessAuthStatus).not.toHaveBeenCalled();
    expect(mocks.openHarnessAuthStatusStream).not.toHaveBeenCalled();
    // A disabled read is not a pending one: nothing will ever resolve it.
    expect(result.current.loading).toBe(false);
    expect(result.current.unknown).toBe(true);
  });
});

describe("useMethods", () => {
  it("returns the rows the methods door serves, verbatim", async () => {
    mocks.getHarnessAuthMethods.mockResolvedValue([
      { kind: "seat", applied: true, seat_id: "seat-1", available: true },
      { kind: "native", applied: false, detected: true, offer: "mint_seat" },
    ]);
    const { result } = renderHook(() => useMethods("claude"), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[1]).toEqual({
      kind: "native",
      applied: false,
      detected: true,
      offer: "mint_seat",
    });
  });

  it("is an empty list, never a fabricated row, before the door answers", () => {
    const { result } = renderHook(() => useMethods("claude"), { wrapper });

    expect(result.current).toEqual([]);
  });
});
