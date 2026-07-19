import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveVisibleChatSession } from "#product/lib/workflows/workspaces/chat-session-archive";
import type { ChatVisibilityCandidate } from "#product/lib/domain/workspaces/tabs/visibility";
import { uniqueIds } from "#product/lib/domain/workspaces/tabs/visibility";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const WORKSPACE_ID = "workspace-1";

describe("archiveVisibleChatSession", () => {
  beforeEach(() => {
    useWorkspaceUiStore.setState({
      archivingChatSessionIdsByWorkspace: {},
      recentlyHiddenChatSessionIdsByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {},
    });
  });

  it.each(["A-first", "B-first"])(
    "selects one surviving tab when concurrent archives complete $completionOrder",
    async (completionOrder) => {
      const harness = createArchiveHarness({
        activeSessionId: "A",
        liveSessions: candidates("A", "B", "C"),
        visibleSessionIds: ["A", "B", "C"],
      });

      const archiveA = harness.archive("A");
      const archiveB = harness.archive("B");
      expect(harness.visibleSessionIds()).toEqual(["C"]);

      if (completionOrder === "A-first") {
        harness.resolveDismiss("A");
        await archiveA;
        harness.resolveDismiss("B");
        await archiveB;
      } else {
        harness.resolveDismiss("B");
        await archiveB;
        harness.resolveDismiss("A");
        await archiveA;
      }

      expect(harness.activeSessionId()).toBe("C");
      expect(harness.activations).toEqual(["C"]);
      expect(harness.dismissSession.mock.calls.map(([sessionId]) => sessionId))
        .toEqual(["A", "B"]);
    },
  );

  it("blocks a concurrent second archive when it would remove the last survivor", async () => {
    const harness = createArchiveHarness({
      activeSessionId: "A",
      liveSessions: candidates("A", "B"),
      visibleSessionIds: ["A", "B"],
    });

    const archiveA = harness.archive("A");
    await expect(harness.archive("B")).resolves.toBe(false);
    expect(harness.visibleSessionIds()).toEqual(["B"]);
    expect(harness.dismissSession).toHaveBeenCalledTimes(1);

    harness.resolveDismiss("A");
    await expect(archiveA).resolves.toBe(true);
    expect(harness.activeSessionId()).toBe("B");
    expect(harness.activations).toEqual(["B"]);
  });

  it("preserves runtime-blocked dismiss semantics before reserving visibility", async () => {
    const harness = createArchiveHarness({
      activeSessionId: "A",
      liveSessions: candidates("A", "B"),
      runtimeBlockReason: "Workspace is unavailable.",
      visibleSessionIds: ["A", "B"],
    });

    await expect(harness.archive("A")).resolves.toBe(false);

    expect(harness.visibleSessionIds()).toEqual(["A", "B"]);
    expect(harness.dismissSession).not.toHaveBeenCalled();
    expect(harness.runtimeBlockNotifications).toEqual(["Workspace is unavailable."]);
  });

  it("selects the adjacent visible fallback instead of a hidden older record", async () => {
    const harness = createArchiveHarness({
      activeSessionId: "B",
      hiddenSessionIds: ["hidden-older"],
      liveSessions: candidates("hidden-older", "A", "B", "C"),
      visibleSessionIds: ["A", "B", "C"],
    });

    const archiveB = harness.archive("B");
    harness.resolveDismiss("B");
    await expect(archiveB).resolves.toBe(true);

    expect(harness.visibleSessionIds()).toEqual(["A", "C"]);
    expect(harness.activeSessionId()).toBe("C");
    expect(harness.activations).toEqual(["C"]);
  });

  it("reserves a parent and linked child while preserving target-only runtime dismissal", async () => {
    const harness = createArchiveHarness({
      activeSessionId: "child",
      liveSessions: [
        { sessionId: "parent" },
        { sessionId: "child", parentSessionId: "parent" },
        { sessionId: "survivor" },
      ],
      visibleSessionIds: ["parent", "child", "survivor"],
    });

    const archiveParent = harness.archive("parent");
    expect(harness.visibleSessionIds()).toEqual(["survivor"]);
    expect(harness.dismissSession.mock.calls[0]?.[0]).toBe("parent");
    expect(harness.dismissSession.mock.calls[0]?.[1].replacedActiveSessionIds)
      .toEqual(["parent", "child"]);

    harness.resolveDismiss("parent");
    await expect(archiveParent).resolves.toBe(true);
    expect(harness.activeSessionId()).toBe("survivor");
    expect(harness.removedFromGroups).toEqual([["parent", "child"]]);
    expect(harness.liveRecordIds()).toEqual(["child", "survivor"]);
  });
});

function candidates(...sessionIds: string[]): ChatVisibilityCandidate[] {
  return sessionIds.map((sessionId) => ({ sessionId }));
}

function createArchiveHarness(input: {
  activeSessionId: string;
  hiddenSessionIds?: string[];
  liveSessions: ChatVisibilityCandidate[];
  runtimeBlockReason?: string | null;
  visibleSessionIds: string[];
}) {
  let activeSessionId: string | null = input.activeSessionId;
  const records = new Set(input.liveSessions.map((session) => session.sessionId));
  const deferredDismissals = new Map<string, ReturnType<typeof deferred>>();
  const activations: string[] = [];
  const removedFromGroups: string[][] = [];
  const runtimeBlockNotifications: string[] = [];
  useWorkspaceUiStore.setState({
    archivingChatSessionIdsByWorkspace: {},
    recentlyHiddenChatSessionIdsByWorkspace: {
      [WORKSPACE_ID]: input.hiddenSessionIds ?? [],
    },
    visibleChatSessionIdsByWorkspace: {
      [WORKSPACE_ID]: input.visibleSessionIds,
    },
  });

  const dismissSession = vi.fn(async (
    sessionId: string,
    options: {
      replacedActiveSessionIds: readonly string[];
      resolveNextActiveSessionId?: () => string | null;
    },
  ) => {
    const pending = deferred<void>();
    deferredDismissals.set(sessionId, pending);
    await pending.promise;
    records.delete(sessionId);
    if (
      activeSessionId
      && options.replacedActiveSessionIds.includes(activeSessionId)
    ) {
      const nextActiveSessionId = options.resolveNextActiveSessionId?.() ?? null;
      activeSessionId = nextActiveSessionId;
      if (nextActiveSessionId) {
        activations.push(nextActiveSessionId);
      }
    }
  });

  return {
    activations,
    dismissSession,
    removedFromGroups,
    runtimeBlockNotifications,
    activeSessionId: () => activeSessionId,
    archive: (sessionId: string) => archiveVisibleChatSession(sessionId, {
      completeReservation: (sessionIds) =>
        useWorkspaceUiStore.getState().completeChatSessionArchiveForWorkspace(
          WORKSPACE_ID,
          sessionIds,
        ),
      dismissSession,
      getRuntimeBlockReason: () => input.runtimeBlockReason ?? null,
      notifyRuntimeBlocked: (reason) => {
        runtimeBlockNotifications.push(reason);
      },
      removeSessionsFromManualGroups: (sessionIds) => {
        removedFromGroups.push(sessionIds);
      },
      reserve: (targetSessionId) =>
        useWorkspaceUiStore.getState().reserveChatSessionArchiveForWorkspace({
          activeSessionId,
          liveSessions: input.liveSessions,
          sessionId: targetSessionId,
          workspaceId: WORKSPACE_ID,
        }),
      resolveReservedFallback: (capturedFallbackSessionId) => {
        const visibleSessionIds = useWorkspaceUiStore.getState()
          .visibleChatSessionIdsByWorkspace[WORKSPACE_ID] ?? [];
        return uniqueIds([
          capturedFallbackSessionId ?? "",
          ...visibleSessionIds,
        ]).find((sessionId) => (
          visibleSessionIds.includes(sessionId) && records.has(sessionId)
        )) ?? null;
      },
    }),
    liveRecordIds: () => [...records],
    resolveDismiss: (sessionId: string) => {
      const pending = deferredDismissals.get(sessionId);
      if (!pending) {
        throw new Error(`No pending dismissal for ${sessionId}.`);
      }
      pending.resolve();
    },
    visibleSessionIds: () => (
      useWorkspaceUiStore.getState().visibleChatSessionIdsByWorkspace[WORKSPACE_ID] ?? []
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
