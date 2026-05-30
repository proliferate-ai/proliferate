import { describe, expect, it } from "vitest";
import {
  resolveActiveWorkspaceShellTab,
  resolveStoredWorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/active-shell-tab";
import { chatWorkspaceShellTabKey, type WorkspaceShellTab } from "@/lib/domain/workspaces/tabs/shell-tabs";

const tabs: WorkspaceShellTab[] = [
  { kind: "chat", sessionId: "a" },
  { kind: "chat", sessionId: "b" },
  { kind: "chat", sessionId: "c" },
];

describe("active workspace shell tab resolution", () => {
  it("uses the durable shell key when the active tab has not settled", () => {
    expect(resolveStoredWorkspaceShellTab({
      activeShellTabKey: null,
      materializedWorkspaceId: "materialized-workspace",
      orderedTabs: tabs,
      state: {
        activeShellTabKeyByWorkspace: {
          "logical-workspace": chatWorkspaceShellTabKey("b"),
        },
        urgentHighlightedChatSessionByWorkspace: {},
      },
      workspaceUiKey: "logical-workspace",
    })).toEqual({ kind: "chat", sessionId: "b" });
  });

  it("falls back to the materialized workspace durable shell key", () => {
    expect(resolveStoredWorkspaceShellTab({
      activeShellTabKey: null,
      materializedWorkspaceId: "materialized-workspace",
      orderedTabs: tabs,
      state: {
        activeShellTabKeyByWorkspace: {
          "materialized-workspace": chatWorkspaceShellTabKey("c"),
        },
        urgentHighlightedChatSessionByWorkspace: {},
      },
      workspaceUiKey: "logical-workspace",
    })).toEqual({ kind: "chat", sessionId: "c" });
  });

  it("prefers an urgent highlighted tab over rendered or durable active tabs", () => {
    expect(resolveActiveWorkspaceShellTab({
      activeShellTab: { kind: "chat", sessionId: "a" },
      activeShellTabKey: chatWorkspaceShellTabKey("a"),
      materializedWorkspaceId: "materialized-workspace",
      orderedTabs: tabs,
      renderedActiveChatSessionId: "a",
      state: {
        activeShellTabKeyByWorkspace: {
          "logical-workspace": chatWorkspaceShellTabKey("a"),
        },
        urgentHighlightedChatSessionByWorkspace: {
          "logical-workspace": "b",
        },
      },
      workspaceUiKey: "logical-workspace",
    })).toEqual({ kind: "chat", sessionId: "b" });
  });
});
