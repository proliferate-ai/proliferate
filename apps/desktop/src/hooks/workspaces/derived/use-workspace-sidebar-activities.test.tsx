// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceSidebarActivityStates } from "./use-workspace-sidebar-activities";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

describe("useWorkspaceSidebarActivityStates", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
  });

  afterEach(() => {
    cleanup();
  });

  it("re-derives workspace activity when a starting session records a prompt attempt", () => {
    act(() => {
      useSessionDirectoryStore.getState().upsertEntry({
        sessionId: "session-a",
        workspaceId: "workspace-a",
        agentKind: "codex",
        status: "starting",
      });
    });

    const { result } = renderHook(() => useWorkspaceSidebarActivityStates());
    const neverPromptedStates = result.current;
    expect(neverPromptedStates["workspace-a"]).toBe("idle");

    act(() => {
      useSessionDirectoryStore.getState().upsertEntry({
        sessionId: "session-a",
        workspaceId: "workspace-a",
        agentKind: "codex",
        status: "starting",
        hasAttemptedPrompt: true,
      });
    });

    expect(result.current).not.toBe(neverPromptedStates);
    expect(result.current["workspace-a"]).toBe("iterating");
  });
});
