import { describe, expect, it } from "vitest";
import {
  resolveNextShellTabAfterClose,
  resolveWorkspaceShellActivation,
  type WorkspaceShellActivationInput,
} from "@/lib/domain/workspaces/tabs/shell-activation";

const BASE_INPUT: WorkspaceShellActivationInput = {
  workspaceId: "workspace-1",
  storedIntent: null,
  orderedTabs: ["chat:a", "chat:b", "file:src/App.tsx"],
  activeSessionId: null,
  activeFilePath: null,
  liveChatSessionIds: new Set(["a", "b"]),
  openFilePaths: new Set(["src/App.tsx"]),
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
      activeFilePath: "src/App.tsx",
    })).toEqual({
      renderSurface: { kind: "chat-shell" },
      highlightedTabKey: null,
    });
  });
});

describe("resolveNextShellTabAfterClose", () => {
  it("chooses the nearest tab after the closed tab, then before", () => {
    expect(resolveNextShellTabAfterClose({
      orderedTabs: ["chat:a", "chat:b", "file:src/App.tsx"],
      closingTabKeys: ["chat:b"],
      currentTabKey: "chat:b",
    })).toBe("file:src/App.tsx");

    expect(resolveNextShellTabAfterClose({
      orderedTabs: ["chat:a", "chat:b", "file:src/App.tsx"],
      closingTabKeys: ["file:src/App.tsx"],
      currentTabKey: "file:src/App.tsx",
    })).toBe("chat:b");
  });
});
