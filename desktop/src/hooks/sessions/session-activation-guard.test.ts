import { beforeEach, describe, expect, it } from "vitest";
import { createEmptySessionSlot } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  useWorkspaceUiStore,
  WORKSPACE_UI_DEFAULTS,
} from "@/stores/preferences/workspace-ui-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { selectSessionWithShellIntentRollback } from "@/hooks/sessions/session-shell-selection";
import {
  beginSessionActivationIntent,
  commitActiveSession,
  invalidateSessionActivationIntent,
  isSessionActivationCurrent,
} from "./session-activation-guard";

describe("session activation guard", () => {
  beforeEach(() => {
    useHarnessStore.getState().clearSelection();
    useLogicalWorkspaceStore.setState({
      _hydrated: true,
      selectedLogicalWorkspaceId: null,
    });
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
    });
  });

  it("commits a session only while the workspace nonce and guard token match", () => {
    useHarnessStore.getState().setSelectedWorkspace("workspace-1");
    useHarnessStore.getState().putSessionSlot(
      "session-1",
      createEmptySessionSlot("session-1", "assistant", {
        workspaceId: "workspace-1",
      }),
    );

    const guard = beginSessionActivationIntent("workspace-1");
    expect(isSessionActivationCurrent(guard)).toBe(true);

    const outcome = commitActiveSession("session-1", guard);

    expect(outcome.result).toBe("completed");
    expect(useHarnessStore.getState().activeSessionId).toBe("session-1");
    expect(useHarnessStore.getState().activeSessionVersion).toBeGreaterThan(0);
  });

  it("returns stale when a newer activation intent replaces the guard", () => {
    useHarnessStore.getState().setSelectedWorkspace("workspace-1");
    useHarnessStore.getState().putSessionSlot(
      "session-1",
      createEmptySessionSlot("session-1", "assistant", {
        workspaceId: "workspace-1",
      }),
    );

    const guard = beginSessionActivationIntent("workspace-1");
    invalidateSessionActivationIntent("workspace-1");

    const outcome = commitActiveSession("session-1", guard);

    expect(outcome).toEqual({
      result: "stale",
      sessionId: "session-1",
      guard,
      reason: "intent-replaced",
    });
    expect(useHarnessStore.getState().activeSessionId).toBeNull();
  });

  it("direct chat shell intent writes invalidate older guarded activations", () => {
    useHarnessStore.getState().setSelectedWorkspace("workspace-1");
    useHarnessStore.getState().putSessionSlot(
      "session-1",
      createEmptySessionSlot("session-1", "assistant", {
        workspaceId: "workspace-1",
      }),
    );
    useHarnessStore.getState().putSessionSlot(
      "session-2",
      createEmptySessionSlot("session-2", "assistant", {
        workspaceId: "workspace-1",
      }),
    );

    const guard = beginSessionActivationIntent("workspace-1");
    useWorkspaceUiStore.getState().setPendingChatActivation({
      workspaceId: "workspace-1",
      pending: {
        attemptId: "attempt-1",
        sessionId: "session-1",
        intent: "chat:session-1",
        guardToken: guard.token,
        workspaceSelectionNonce: guard.workspaceSelectionNonce,
        shellEpochAtWrite: 0,
        sessionActivationEpochAtWrite: guard.token,
      },
    });
    useHarnessStore.getState().setActiveSessionId("session-2");
    writeChatShellIntentForSession({
      workspaceId: "workspace-1",
      sessionId: "session-2",
    });

    const outcome = commitActiveSession("session-1", guard);

    expect(outcome).toEqual({
      result: "stale",
      sessionId: "session-1",
      guard,
      reason: "intent-replaced",
    });
    expect(useHarnessStore.getState().activeSessionId).toBe("session-2");
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe("chat:session-2");
    expect(useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["workspace-1"])
      .toBeNull();
  });

  it("writes direct chat shell intent to the selected logical workspace key", () => {
    useHarnessStore.getState().setSelectedWorkspace("materialized-workspace");
    useLogicalWorkspaceStore.setState({
      _hydrated: true,
      selectedLogicalWorkspaceId: "logical-workspace",
    });
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "logical-workspace",
      intent: "chat:old-session",
    });

    writeChatShellIntentForSession({
      workspaceId: "materialized-workspace",
      sessionId: "new-session",
    });

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["logical-workspace"])
      .toBe("chat:new-session");
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["materialized-workspace"])
      .toBeUndefined();
  });

  it("uses the resolved logical shell key for owned pending replacement", () => {
    useHarnessStore.getState().setSelectedWorkspace("materialized-workspace");
    useLogicalWorkspaceStore.setState({
      _hydrated: true,
      selectedLogicalWorkspaceId: "logical-workspace",
    });
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "logical-workspace",
      intent: "chat:old-session",
    });

    const write = writeChatShellIntentForSession({
      workspaceId: "materialized-workspace",
      sessionId: "pending-session",
    });
    expect(write?.shellWorkspaceId).toBe("logical-workspace");

    const replace = useWorkspaceUiStore.getState().replaceShellIntent({
      workspaceId: write!.shellWorkspaceId,
      expectedIntent: write!.currentIntent,
      expectedEpoch: write!.epoch,
      nextIntent: "chat:real-session",
    });

    expect(replace.replaced).toBe(true);
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["logical-workspace"])
      .toBe("chat:real-session");
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["materialized-workspace"])
      .toBeUndefined();
  });

  it("remembers guarded session commits under the selected logical workspace key", () => {
    useHarnessStore.getState().setSelectedWorkspace("materialized-workspace");
    useLogicalWorkspaceStore.setState({
      _hydrated: true,
      selectedLogicalWorkspaceId: "logical-workspace",
    });
    useHarnessStore.getState().putSessionSlot(
      "session-1",
      createEmptySessionSlot("session-1", "assistant", {
        workspaceId: "materialized-workspace",
      }),
    );

    const guard = beginSessionActivationIntent("materialized-workspace");
    const outcome = commitActiveSession("session-1", guard);

    expect(outcome.result).toBe("completed");
    expect(useWorkspaceUiStore.getState().lastViewedSessionByWorkspace["logical-workspace"])
      .toBe("session-1");
    expect(useWorkspaceUiStore.getState().lastViewedSessionByWorkspace["materialized-workspace"])
      .toBeUndefined();
  });

  it("guards backend reuse shell selection and rolls back logical shell intent on stale", async () => {
    useHarnessStore.getState().setSelectedWorkspace("materialized-workspace");
    useLogicalWorkspaceStore.setState({
      _hydrated: true,
      selectedLogicalWorkspaceId: "logical-workspace",
    });
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "logical-workspace",
      intent: "chat:old-session",
    });

    const outcome = await selectSessionWithShellIntentRollback({
      workspaceId: "materialized-workspace",
      sessionId: "new-session",
      selectSession: async (sessionId, options) => {
        expect(options?.guard).toBeDefined();
        invalidateSessionActivationIntent("materialized-workspace");
        return {
          result: "stale",
          sessionId,
          guard: options!.guard!,
          reason: "intent-replaced",
        };
      },
    });

    expect(outcome?.result).toBe("stale");
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["logical-workspace"])
      .toBe("chat:old-session");
    expect(useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["logical-workspace"])
      .toBeNull();
  });
});
