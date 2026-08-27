// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
  /** The host's transport override, as a cloud provider supplies it. */
  runtimeFetch: { current: undefined as typeof globalThis.fetch | undefined },
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
    fetch: mocks.runtimeFetch.current,
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
  onOpen?: () => void;
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
  mocks.runtimeFetch.current = undefined;
  mocks.getHarnessAuthStatus.mockResolvedValue(null);
  mocks.getHarnessAuthMethods.mockResolvedValue([]);
  mocks.openHarnessAuthStatusStream.mockImplementation(
    (_connection: unknown, given: StreamHandlers) => {
      handlers = given;
      return { close: mocks.close };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useHarnessStatus", () => {
  it("subscribes on mount and renders a pushed document", async () => {
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    });
    // Nothing read yet: an absent document is a NULL probe, not an invented
    // state — the one fact that says "the runtime holds no document".
    await waitFor(() => expect(result.current.probe).toBeNull());

    handlers.onEvent(documentFor());

    await waitFor(() => expect(result.current.probe).not.toBeNull());
    expect(result.current.applied).toEqual({ kind: "seat", seat_id: "seat-1" });
    expect(result.current.nextSeatId).toBe("seat-2");
    expect(result.current.probe).toEqual({
      verdict: "verified",
      at: "2026-08-27T00:00:00Z",
      stale: false,
    });
    expect(result.current.coolingUntil).toBeNull();
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
    // The last observation survives the re-probe, and no read is in flight —
    // stale renders as stale, never as loading.
    expect(result.current.probe?.at).toBe("2026-08-27T00:00:00Z");
    expect(result.current.refreshing).toBe(false);
  });

  it("routes each pushed document to its OWN harness, never to a sibling", async () => {
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    });

    // grok's auth changing must not touch claude's entry (bug class (a)).
    handlers.onEvent(documentFor({ harness_kind: "grok" }));

    await waitFor(() => expect(result.current.probe).toBeNull());
  });

  it("falls back to re-reading GET /status when the stream is unavailable", async () => {
    mocks.getHarnessAuthStatus.mockResolvedValue(null);
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });

    mocks.getHarnessAuthStatus.mockResolvedValue(documentFor());
    handlers.onError?.(new Error("stream refused"));

    // ONE re-read per end: the read covers the gap; recovering the pushes is
    // the scheduled re-subscribe's job (pinned below), never a read loop.
    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => expect(result.current.probe?.verdict).toBe("verified"));
  });

  it("re-reads once per stream end, and re-subscribes after the backoff", async () => {
    vi.useFakeTimers();
    renderHook(() => useHarnessStatus("claude"), { wrapper });

    await act(async () => {});
    expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);

    // The runtime ends a lagged subscriber's stream ON PURPOSE. The end costs
    // one re-read (gap coverage)...
    await act(async () => {
      handlers.onClose?.();
    });
    expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);

    // ...and one scheduled re-open. Nothing before the first delay elapses —
    // and the re-open is a SUBSCRIPTION, not another read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(2);
    expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially to a 30s cap — a dead runtime is never hammered", async () => {
    vi.useFakeTimers();
    renderHook(() => useHarnessStatus("claude"), { wrapper });

    await act(async () => {});
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);

    // No attempt ever fires onOpen, so every end is consecutive: the delay
    // doubles from 1s and pins at the 30s cap. Each cycle costs exactly one
    // open and one gap re-read — a runtime that stays down costs one request
    // per 30s, not a busy-loop.
    const schedule = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [index, delayMs] of schedule.entries()) {
      const opensBefore = index + 1;
      await act(async () => {
        handlers.onClose?.();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delayMs - 1);
      });
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(opensBefore);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(opensBefore + 1);
    }

    // One read on mount, then exactly one re-read per end: the re-reads track
    // the ends, never a timer.
    expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1 + schedule.length);
  });

  it("a successful re-open resets the backoff and resumes rendering pushes", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await act(async () => {});
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);

    // Two failed cycles walk the delay up: 1s, then 2s.
    await act(async () => {
      handlers.onClose?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(2);
    await act(async () => {
      handlers.onClose?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(3);

    // The third attempt OPENS: the pane is subscribed again, and a pushed
    // frame lands in the cache and renders — the pane is not a snapshot.
    // (react-query notifies observers on a setTimeout(0), hence the advance.)
    await act(async () => {
      handlers.onOpen?.();
      handlers.onEvent(documentFor());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.probe?.verdict).toBe("verified");

    // And the open RESET the schedule: the next end waits 1s, not 4s.
    await act(async () => {
      handlers.onClose?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(4);
  });

  it("unmount during the backoff window cancels the pending re-open", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useHarnessStatus("claude"), { wrapper });

    await act(async () => {});
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers.onClose?.();
    });
    expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);

    unmount();
    expect(mocks.close).toHaveBeenCalledTimes(1);

    // The pending re-open died with the pane: no timer leaks past cleanup, so
    // nothing re-subscribes and nothing re-reads, ever again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(2);
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

  it("re-reads the METHODS door on refresh too, so the two cannot drift", async () => {
    // Spec §4 cell 4: the pane-open and manual-refresh boundaries re-read status
    // AND methods. They are one runtime pass; refreshing one and leaving the
    // other on a stale row is how two views of the same harness disagree.
    const { result } = renderHook(
      () => ({ status: useHarnessStatus("claude"), methods: useMethods("claude") }),
      { wrapper },
    );

    await waitFor(() => {
      expect(mocks.getHarnessAuthMethods).toHaveBeenCalledTimes(1);
    });

    result.current.status.refresh();

    await waitFor(() => {
      expect(mocks.getHarnessAuthMethods).toHaveBeenCalledTimes(2);
    });
  });

  it("opens the stream on the CONNECTION's fetch, not the global one", async () => {
    // The cloud provider passes `fetch` and NO authToken: that override is the
    // only thing attaching the sandbox gateway's authorization header. Dropping
    // it 401s the stream, and this hook has no polling fallback — the badge
    // would freeze at the first read until a mutation or a remount.
    const hostFetch = vi.fn() as unknown as typeof globalThis.fetch;
    mocks.runtimeFetch.current = hostFetch;

    renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.openHarnessAuthStatusStream).toHaveBeenCalledTimes(1);
    });
    const [connection] = mocks.openHarnessAuthStatusStream.mock.calls[0] as [
      { runtimeUrl: string; fetch?: typeof globalThis.fetch },
    ];
    expect(connection.fetch).toBe(hostFetch);
    expect(connection.runtimeUrl).toBe(RUNTIME_URL);
  });

  it("reads GET /status on that same connection's fetch", async () => {
    const hostFetch = vi.fn() as unknown as typeof globalThis.fetch;
    mocks.runtimeFetch.current = hostFetch;

    renderHook(() => useHarnessStatus("claude"), { wrapper });

    await waitFor(() => {
      expect(mocks.getHarnessAuthStatus).toHaveBeenCalledTimes(1);
    });
    const [connection] = mocks.getHarnessAuthStatus.mock.calls[0] as [
      { fetch?: typeof globalThis.fetch },
    ];
    expect(connection.fetch).toBe(hostFetch);
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
    // A disabled read is not a running one: nothing will ever resolve it, so the
    // refresh affordance must not spin forever.
    expect(result.current.refreshing).toBe(false);
    expect(result.current.probe).toBeNull();
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
