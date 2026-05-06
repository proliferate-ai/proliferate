import { describe, expect, it } from "vitest";
import {
  resolveNextShellTabAfterClose,
  resolveWorkspaceShellActivation,
  type WorkspaceShellActivationInput,
} from "@/lib/domain/workspaces/tabs/shell-activation";
import { fileWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { ViewerTargetKey } from "@/lib/domain/workspaces/viewer-target";

const APP_KEY = fileWorkspaceShellTabKey("src/App.tsx") as ViewerTargetKey;

const BASE_INPUT: WorkspaceShellActivationInput = {
  workspaceId: "workspace-1",
  storedIntent: null,
  orderedTabs: ["chat:a", "chat:b", APP_KEY],
  activeSessionId: null,
  activeViewerTargetKey: null,
  liveChatSessionIds: new Set(["a", "b"]),
  openViewerTargetKeys: new Set([APP_KEY]),
  pendingChatActivation: null,
  currentShellActivationEpoch: 0,
  currentSessionActivationEpoch: 0,
  currentWorkspaceSelectionNonce: 0,
};

describe("resolveWorkspaceShellActivation", () => {
  it("renders stored chat only when it is the active live tab", () => {
    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      storedIntent: "chat:b",
      activeSessionId: "b",
    })).toEqual({
      renderSurface: { kind: "chat-session", sessionId: "b" },
      highlightedTabKey: "chat:b",
    });
  });

  it("renders chat-shell for stale stored chat intent", () => {
    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      storedIntent: "chat:b",
      activeSessionId: "a",
    })).toEqual({
      renderSurface: { kind: "chat-shell" },
      highlightedTabKey: null,
    });
  });

  it("renders pending chat only while every pending currentness field matches", () => {
    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      storedIntent: "chat:a",
      currentShellActivationEpoch: 3,
      currentSessionActivationEpoch: 9,
      currentWorkspaceSelectionNonce: 4,
      pendingChatActivation: {
        attemptId: "attempt-1",
        sessionId: "b",
        intent: "chat:b",
        guardToken: 9,
        workspaceSelectionNonce: 4,
        shellEpochAtWrite: 3,
        sessionActivationEpochAtWrite: 9,
      },
    })).toEqual({
      renderSurface: { kind: "chat-session-pending", sessionId: "b" },
      highlightedTabKey: "chat:b",
    });
  });

  it("renders pending chat over null and viewer durable intent", () => {
    const pendingChat = {
      attemptId: "attempt-1",
      sessionId: "b",
      intent: "chat:b" as const,
      guardToken: 9,
      workspaceSelectionNonce: 4,
      shellEpochAtWrite: 3,
      sessionActivationEpochAtWrite: 9,
    };

    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      storedIntent: null,
      currentShellActivationEpoch: 3,
      currentSessionActivationEpoch: 9,
      currentWorkspaceSelectionNonce: 4,
      pendingChatActivation: pendingChat,
    })).toEqual({
      renderSurface: { kind: "chat-session-pending", sessionId: "b" },
      highlightedTabKey: "chat:b",
    });

    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      storedIntent: APP_KEY,
      activeViewerTargetKey: APP_KEY,
      currentShellActivationEpoch: 3,
      currentSessionActivationEpoch: 9,
      currentWorkspaceSelectionNonce: 4,
      pendingChatActivation: pendingChat,
    })).toEqual({
      renderSurface: { kind: "chat-session-pending", sessionId: "b" },
      highlightedTabKey: "chat:b",
    });
  });

  it("keeps pending chat current after the durable intent write advances shell epoch", () => {
    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      storedIntent: "chat:b",
      activeSessionId: "a",
      currentShellActivationEpoch: 4,
      currentSessionActivationEpoch: 9,
      currentWorkspaceSelectionNonce: 4,
      pendingChatActivation: {
        attemptId: "attempt-1",
        sessionId: "b",
        intent: "chat:b",
        guardToken: 9,
        workspaceSelectionNonce: 4,
        shellEpochAtWrite: 3,
        sessionActivationEpochAtWrite: 9,
      },
    })).toEqual({
      renderSurface: { kind: "chat-session-pending", sessionId: "b" },
      highlightedTabKey: "chat:b",
    });
  });

  it("does not render pending chat when the pending tab is not ordered", () => {
    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      orderedTabs: ["chat:a", APP_KEY],
      storedIntent: "chat:a",
      activeSessionId: "a",
      currentShellActivationEpoch: 3,
      currentSessionActivationEpoch: 9,
      currentWorkspaceSelectionNonce: 4,
      pendingChatActivation: {
        attemptId: "attempt-1",
        sessionId: "b",
        intent: "chat:b",
        guardToken: 9,
        workspaceSelectionNonce: 4,
        shellEpochAtWrite: 3,
        sessionActivationEpochAtWrite: 9,
      },
    })).toEqual({
      renderSurface: { kind: "chat-session", sessionId: "a" },
      highlightedTabKey: "chat:a",
    });
  });

  it("ignores stale pending chat on shell epoch, guard token, or workspace nonce mismatch", () => {
    const pendingChat = {
      attemptId: "attempt-1",
      sessionId: "b",
      intent: "chat:b" as const,
      guardToken: 9,
      workspaceSelectionNonce: 4,
      shellEpochAtWrite: 3,
      sessionActivationEpochAtWrite: 9,
    };
    const currentInput = {
      ...BASE_INPUT,
      storedIntent: "chat:a" as const,
      activeSessionId: "a",
      currentShellActivationEpoch: 3,
      currentSessionActivationEpoch: 9,
      currentWorkspaceSelectionNonce: 4,
      pendingChatActivation: pendingChat,
    };
    const durableChat = {
      renderSurface: { kind: "chat-session" as const, sessionId: "a" },
      highlightedTabKey: "chat:a" as const,
    };

    expect(resolveWorkspaceShellActivation({
      ...currentInput,
      currentShellActivationEpoch: 4,
    })).toEqual(durableChat);
    expect(resolveWorkspaceShellActivation({
      ...currentInput,
      currentSessionActivationEpoch: 10,
    })).toEqual(durableChat);
    expect(resolveWorkspaceShellActivation({
      ...currentInput,
      currentWorkspaceSelectionNonce: 5,
    })).toEqual(durableChat);
  });

  it("renders chat-shell for ambiguous null intent", () => {
    expect(resolveWorkspaceShellActivation({
      ...BASE_INPUT,
      activeSessionId: "a",
      activeViewerTargetKey: APP_KEY,
    })).toEqual({
      renderSurface: { kind: "chat-shell" },
      highlightedTabKey: null,
    });
  });
});

describe("resolveNextShellTabAfterClose", () => {
  it("chooses the nearest tab after the closed tab, then before", () => {
    expect(resolveNextShellTabAfterClose({
      orderedTabs: ["chat:a", "chat:b", APP_KEY],
      closingTabKeys: ["chat:b"],
      currentTabKey: "chat:b",
    })).toBe(APP_KEY);

    expect(resolveNextShellTabAfterClose({
      orderedTabs: ["chat:a", "chat:b", APP_KEY],
      closingTabKeys: [APP_KEY],
      currentTabKey: APP_KEY,
    })).toBe("chat:b");
  });
});
