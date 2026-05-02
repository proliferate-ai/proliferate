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
      storedIntent: "chat:b",
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
