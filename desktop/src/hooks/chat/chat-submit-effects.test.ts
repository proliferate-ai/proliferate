import { describe, expect, it, vi } from "vitest";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import {
  completeChatPromptSubmitSideEffects,
  isWorkspaceSetupActive,
} from "./chat-submit-effects";

vi.mock("@/lib/integrations/telemetry/client", () => ({
  trackProductEvent: vi.fn(),
}));

function arrival(
  overrides: Partial<WorkspaceArrivalEvent> = {},
): WorkspaceArrivalEvent {
  return {
    workspaceId: "workspace-1",
    source: "local-created",
    setupScript: null,
    createdAt: 1,
    ...overrides,
  };
}

describe("isWorkspaceSetupActive", () => {
  it("uses cached running setup status", () => {
    expect(isWorkspaceSetupActive({
      workspaceArrivalEvent: arrival(),
      workspaceId: "workspace-1",
      cachedSetupStatus: "running",
    })).toBe(true);
  });

  it("uses arrival setup status when cache is empty", () => {
    expect(isWorkspaceSetupActive({
      workspaceArrivalEvent: arrival({
        setupScript: {
          status: "queued",
        } as WorkspaceArrivalEvent["setupScript"],
      }),
      workspaceId: "workspace-1",
      cachedSetupStatus: null,
    })).toBe(true);
  });

  it("keeps async local arrivals active until the first cached setup status", () => {
    expect(isWorkspaceSetupActive({
      workspaceArrivalEvent: arrival({
        source: "worktree-created",
        setupScript: null,
      }),
      workspaceId: "workspace-1",
      cachedSetupStatus: null,
    })).toBe(true);
  });

  it("does not keep unrelated or completed arrivals active", () => {
    expect(isWorkspaceSetupActive({
      workspaceArrivalEvent: arrival({ workspaceId: "workspace-2" }),
      workspaceId: "workspace-1",
      cachedSetupStatus: "running",
    })).toBe(false);

    expect(isWorkspaceSetupActive({
      workspaceArrivalEvent: arrival({ source: "cloud-created" }),
      workspaceId: "workspace-1",
      cachedSetupStatus: null,
    })).toBe(false);

    expect(isWorkspaceSetupActive({
      workspaceArrivalEvent: arrival(),
      workspaceId: "workspace-1",
      cachedSetupStatus: "succeeded",
    })).toBe(false);
  });
});

describe("completeChatPromptSubmitSideEffects", () => {
  it("reads the current workspace arrival event when completion runs", () => {
    let currentArrival: WorkspaceArrivalEvent | null = arrival({
      setupScript: {
        status: "running",
      } as WorkspaceArrivalEvent["setupScript"],
    });
    const setWorkspaceArrivalEvent = vi.fn();

    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      getWorkspaceArrivalEvent: () => currentArrival,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent,
    });
    expect(setWorkspaceArrivalEvent).not.toHaveBeenCalled();

    currentArrival = null;
    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      getWorkspaceArrivalEvent: () => currentArrival,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent,
    });
    expect(setWorkspaceArrivalEvent).toHaveBeenCalledWith(null);
  });
});
