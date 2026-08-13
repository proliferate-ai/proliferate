// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSessionStreamHandle,
  resetSessionStreamHandlesForTest,
  setSessionStreamHandle,
  type ManagedSessionStreamHandle,
} from "#product/lib/access/anyharness/session-stream-handles";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  useAgentsPaneSessionLifecycle,
  type AgentsPaneSessionLifecycleInput,
} from "#product/hooks/agents/lifecycle/use-agents-pane-session-lifecycle";

const mocks = vi.hoisted(() => ({
  ensureSessionStreamConnected: vi.fn(),
  hotSessionIds: new Set<string>(),
  mountSubagentChildSession: vi.fn(),
  rehydrateSessionSlotFromHistory: vi.fn(),
}));

vi.mock("#product/hooks/chat/workflows/subagents/use-linked-session-mounting", () => ({
  useLinkedSessionMounting: () => ({
    mountSubagentChildSession: mocks.mountSubagentChildSession,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-runtime-actions", () => ({
  useSessionRuntimeActions: () => ({
    ensureSessionStreamConnected: mocks.ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory: mocks.rehydrateSessionSlotFromHistory,
  }),
}));

vi.mock("#product/lib/workflows/sessions/hot-session-ingest-manager", () => ({
  isHotSessionClientId: (sessionId: string) => mocks.hotSessionIds.has(sessionId),
}));

const handles = new Map<string, ManagedSessionStreamHandle>();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hotSessionIds.clear();
  handles.clear();
  resetSessionStreamHandlesForTest();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  mocks.mountSubagentChildSession.mockResolvedValue(undefined);
  mocks.rehydrateSessionSlotFromHistory.mockResolvedValue(true);
  mocks.ensureSessionStreamConnected.mockImplementation(async (sessionId: string) => {
    const record = getSessionRecord(sessionId);
    if (!record || record.streamConnectionState === "open") {
      return;
    }
    const handle = handles.get(sessionId);
    if (!handle || !record.materializedSessionId) {
      return;
    }
    setSessionStreamHandle({
      sessionId: record.materializedSessionId,
      workspaceId: record.workspaceId,
      handle,
    });
    patchSessionRecord(sessionId, { streamConnectionState: "open" });
  });
});

afterEach(() => {
  cleanup();
  resetSessionStreamHandlesForTest();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
});

describe("useAgentsPaneSessionLifecycle stream ownership", () => {
  it("keeps identical rerenders stable and swaps one pane-owned stream per child", async () => {
    const handleA = installChild("client-a", "child-a");
    const handleB = installChild("client-b", "child-b");
    const inputA = createInput("client-a", "child-a");
    const inputB = createInput("client-b", "child-b");
    const rendered = renderHook(
      ({ input }: { input: AgentsPaneSessionLifecycleInput }) =>
        useAgentsPaneSessionLifecycle(input),
      { initialProps: { input: inputA } },
    );

    await waitFor(() => {
      expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    });
    expect(mocks.rehydrateSessionSlotFromHistory).toHaveBeenCalledTimes(1);

    rendered.rerender({ input: inputA });
    await act(async () => Promise.resolve());
    expect(mocks.rehydrateSessionSlotFromHistory).toHaveBeenCalledTimes(1);
    expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);

    rendered.rerender({ input: inputB });
    await waitFor(() => {
      expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(2);
    });
    expect(handleA.close).toHaveBeenCalledTimes(1);
    expect(mocks.rehydrateSessionSlotFromHistory).toHaveBeenCalledTimes(2);

    rendered.unmount();
    expect(handleB.close).toHaveBeenCalledTimes(1);
  });

  it("hands a pane-opened stream to hot-session ingestion without closing it", async () => {
    const handle = installChild("client-a", "child-a");
    const rendered = renderHook(() =>
      useAgentsPaneSessionLifecycle(createInput("client-a", "child-a"))
    );
    await waitFor(() => {
      expect(getSessionStreamHandle("child-a")).toBe(handle);
    });

    mocks.hotSessionIds.add("client-a");
    rendered.unmount();

    expect(handle.close).not.toHaveBeenCalled();
    expect(getSessionStreamHandle("child-a")).toBe(handle);
  });

  it("releases only its own stream lease when accepted Close makes the child read-only", async () => {
    const handle = installChild("client-a", "child-a");
    const rendered = renderHook(
      ({ isClosed }: { isClosed: boolean }) => useAgentsPaneSessionLifecycle({
        ...createInput("client-a", "child-a"),
        isClosed,
      }),
      { initialProps: { isClosed: false } },
    );
    await waitFor(() => {
      expect(getSessionStreamHandle("child-a")).toBe(handle);
    });

    rendered.rerender({ isClosed: true });

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(getSessionStreamHandle("child-a")).toBeNull();
    expect(rendered.result.current.streamConnectionState).toBeNull();
  });

  it("closes a pane-owned handle registered by an in-flight connect", async () => {
    const handle = installChild("client-a", "child-a");
    let finishConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      finishConnect = resolve;
    });
    mocks.ensureSessionStreamConnected.mockImplementation(async (sessionId: string) => {
      setSessionStreamHandle({ sessionId: "child-a", handle });
      patchSessionRecord(sessionId, { streamConnectionState: "connecting" });
      await connectGate;
    });
    const rendered = renderHook(() =>
      useAgentsPaneSessionLifecycle(createInput("client-a", "child-a"))
    );
    await waitFor(() => {
      expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    });

    rendered.unmount();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(getSessionStreamHandle("child-a")).toBeNull();

    await act(async () => {
      finishConnect();
      await connectGate;
    });
  });

  it("settles a rejected stream request as disconnected without leaking a rejection", async () => {
    installChild("client-a", "child-a");
    mocks.ensureSessionStreamConnected.mockImplementation(async (sessionId: string) => {
      patchSessionRecord(sessionId, { streamConnectionState: "connecting" });
      throw new Error("stream unavailable");
    });

    const rendered = renderHook(() =>
      useAgentsPaneSessionLifecycle(createInput("client-a", "child-a"))
    );

    await waitFor(() => {
      expect(rendered.result.current.streamRequestPending).toBe(false);
      expect(rendered.result.current.streamConnectionState).toBe("disconnected");
    });
  });
});

describe("useAgentsPaneSessionLifecycle pane-owned reconnect", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-invokes the stream connect when the stream's onReconnectNeeded signal fires while the child stays current and open", async () => {
    const handle = installChild("client-a", "child-a");
    let capturedOnReconnectNeeded: (() => void) | undefined;
    mocks.ensureSessionStreamConnected.mockImplementation(async (
      sessionId: string,
      options?: { onReconnectNeeded?: () => void },
    ) => {
      capturedOnReconnectNeeded = options?.onReconnectNeeded;
      const record = getSessionRecord(sessionId);
      if (record?.materializedSessionId) {
        setSessionStreamHandle({
          sessionId: record.materializedSessionId,
          workspaceId: record.workspaceId,
          handle,
        });
      }
      patchSessionRecord(sessionId, { streamConnectionState: "open" });
    });

    renderHook(() =>
      useAgentsPaneSessionLifecycle(createInput("client-a", "child-a"))
    );

    await waitFor(() => {
      expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    });
    expect(capturedOnReconnectNeeded).toBeTypeOf("function");

    // Simulate the server ending this idle child's stream (30s live-handle
    // wait, or an actor swap) — this is exactly the signal an idle child
    // waiting on a parent-sent message needs to reconnect on its own.
    vi.useFakeTimers();
    act(() => {
      capturedOnReconnectNeeded?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    vi.useRealTimers();

    expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(2);
  });

  it("does not retry once the child becomes closed before the reconnect timer fires", async () => {
    const handle = installChild("client-a", "child-a");
    let capturedOnReconnectNeeded: (() => void) | undefined;
    mocks.ensureSessionStreamConnected.mockImplementation(async (
      sessionId: string,
      options?: { onReconnectNeeded?: () => void },
    ) => {
      capturedOnReconnectNeeded = options?.onReconnectNeeded;
      const record = getSessionRecord(sessionId);
      if (record?.materializedSessionId) {
        setSessionStreamHandle({
          sessionId: record.materializedSessionId,
          workspaceId: record.workspaceId,
          handle,
        });
      }
      patchSessionRecord(sessionId, { streamConnectionState: "open" });
    });

    const rendered = renderHook(
      ({ isClosed }: { isClosed: boolean }) => useAgentsPaneSessionLifecycle({
        ...createInput("client-a", "child-a"),
        isClosed,
      }),
      { initialProps: { isClosed: false } },
    );

    await waitFor(() => {
      expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    });
    expect(capturedOnReconnectNeeded).toBeTypeOf("function");

    rendered.rerender({ isClosed: true });
    expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    act(() => {
      capturedOnReconnectNeeded?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    vi.useRealTimers();

    expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the pane unmounts before the reconnect timer fires", async () => {
    const handle = installChild("client-a", "child-a");
    let capturedOnReconnectNeeded: (() => void) | undefined;
    mocks.ensureSessionStreamConnected.mockImplementation(async (
      sessionId: string,
      options?: { onReconnectNeeded?: () => void },
    ) => {
      capturedOnReconnectNeeded = options?.onReconnectNeeded;
      const record = getSessionRecord(sessionId);
      if (record?.materializedSessionId) {
        setSessionStreamHandle({
          sessionId: record.materializedSessionId,
          workspaceId: record.workspaceId,
          handle,
        });
      }
      patchSessionRecord(sessionId, { streamConnectionState: "open" });
    });

    const rendered = renderHook(() =>
      useAgentsPaneSessionLifecycle(createInput("client-a", "child-a"))
    );

    await waitFor(() => {
      expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    });
    expect(capturedOnReconnectNeeded).toBeTypeOf("function");

    rendered.unmount();

    vi.useFakeTimers();
    act(() => {
      capturedOnReconnectNeeded?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    vi.useRealTimers();

    expect(mocks.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
  });
});

function installChild(clientSessionId: string, childSessionId: string) {
  const handle = { close: vi.fn() } satisfies ManagedSessionStreamHandle;
  handles.set(clientSessionId, handle);
  putSessionRecord(createEmptySessionRecord(clientSessionId, "claude", {
    materializedSessionId: childSessionId,
    workspaceId: "workspace-1",
  }));
  patchSessionRecord(clientSessionId, { streamConnectionState: "disconnected" });
  return handle;
}

function createInput(
  clientSessionId: string,
  childSessionId: string,
): AgentsPaneSessionLifecycleInput {
  return {
    workspaceId: "workspace-1",
    parentSessionId: "parent-1",
    childSessionId,
    clientSessionId,
    sessionLinkId: null,
    label: "Worker",
    isClosed: false,
    isPaneRouteActive: true,
  };
}
