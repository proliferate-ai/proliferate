import { describe, expect, it } from "vitest";
import type {
  CloudPendingInteraction,
  CloudSessionProjection,
  CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import type { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import {
  buildCloudChatHeaderDiagnosticsText,
  buildCloudChatHeaderStatus,
  cloudChatSessionStatusLabel,
} from "./cloud-chat-header-presentation";

type HeaderWorkspace = NonNullable<CloudWorkspaceSnapshot["workspace"]>;
type HeaderSession = Pick<
  CloudSessionProjection,
  "phase" | "pendingInteractionCount" | "status"
>;

const READY_COMMAND: ReturnType<typeof cloudCommandReadiness> = {
  state: "ready",
  commandable: true,
  message: null,
};

function workspace(overrides: Partial<HeaderWorkspace> = {}): HeaderWorkspace {
  return {
    id: "workspace-1",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "main",
      baseBranch: "main",
    },
    workspaceStatus: "ready",
    status: "ready",
    runtime: {
      environmentId: "runtime-1",
      status: "running",
      generation: 1,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    targetId: "target-1",
    anyharnessWorkspaceId: "anyharness-workspace-1",
    exposureState: "live",
    lastError: null,
    statusDetail: null,
    ...overrides,
  } as HeaderWorkspace;
}

function session(overrides: Partial<HeaderSession> = {}): HeaderSession {
  return {
    phase: "idle",
    pendingInteractionCount: 0,
    status: "idle",
    ...overrides,
  };
}

function status(
  overrides: Partial<Parameters<typeof buildCloudChatHeaderStatus>[0]> = {},
) {
  return buildCloudChatHeaderStatus({
    workspace: workspace(),
    session: null,
    pendingInteractions: [],
    workspaceCommandReady: true,
    commandReadiness: READY_COMMAND,
    workspacePreparationMessage: false,
    promptSubmitting: false,
    ...overrides,
  });
}

describe("buildCloudChatHeaderStatus", () => {
  it("prioritizes workspace errors", () => {
    expect(status({
      workspace: workspace({ workspaceStatus: "error", lastError: "Launch failed" }),
    })).toEqual({ label: "Error", tone: "destructive" });
  });

  it("surfaces failed sessions as errors", () => {
    expect(status({
      session: session({ status: "failed", pendingInteractionCount: 1 }),
    })).toEqual({ label: "Error", tone: "destructive" });
  });

  it("shows setup as live starting", () => {
    expect(status({
      workspace: workspace({ workspaceStatus: "materializing" }),
      workspaceCommandReady: false,
      commandReadiness: {
        state: "workspace_not_ready",
        commandable: false,
        message: "Workspace is not ready yet.",
      },
    })).toEqual({ label: "Starting", tone: "info", live: true });
  });

  it("shows unresolved non-prompt interactions as needs input", () => {
    expect(status({
      pendingInteractions: [{
        kind: "ask_user",
        status: "pending",
      } as CloudPendingInteraction],
    })).toEqual({ label: "Needs input", tone: "warning" });
  });

  it("shows prompt submission and running sessions as in progress", () => {
    expect(status({ promptSubmitting: true })).toEqual({
      label: "In progress",
      tone: "info",
      live: true,
    });
    expect(status({
      session: session({ phase: "running", status: "running" }),
    })).toEqual({ label: "In progress", tone: "info", live: true });
  });

  it("shows review-ready sessions before generic ready", () => {
    expect(status({
      session: session({ phase: "review", status: "completed" }),
    })).toEqual({ label: "Ready for review", tone: "success" });
  });

  it("keeps a ready workspace ready when no command is running", () => {
    expect(status()).toEqual({ label: "Ready", tone: "success" });
  });

  it("does not treat local routed workspaces with no runtime environment as starting", () => {
    expect(status({
      workspace: workspace({
        sandboxType: "local",
        runtime: {
          environmentId: null,
          status: "pending",
          generation: 1,
          actionBlockKind: null,
          actionBlockReason: null,
        },
      }),
    })).toEqual({ label: "Ready", tone: "success" });
  });

  it("keeps managed no-env pending runtime states in setup", () => {
    expect(status({
      workspace: workspace({
        sandboxType: "managed_personal",
        runtime: {
          environmentId: null,
          status: "pending",
          generation: 1,
          actionBlockKind: null,
          actionBlockReason: null,
        },
      }),
      workspaceCommandReady: false,
      commandReadiness: {
        state: "workspace_not_ready",
        commandable: false,
        message: "Cloud runtime is still starting.",
      },
    })).toEqual({ label: "Starting", tone: "info", live: true });
  });

  it("falls back to idle when commands are unavailable and nothing is active", () => {
    expect(status({
      workspaceCommandReady: false,
      commandReadiness: {
        state: "runtime_unavailable",
        commandable: false,
        message: "Runtime unavailable.",
      },
    })).toEqual({ label: "Idle", tone: "neutral" });
  });
});

describe("cloudChatSessionStatusLabel", () => {
  it("prioritizes error over stale pending input", () => {
    expect(cloudChatSessionStatusLabel(
      session({ status: "failed", pendingInteractionCount: 1 }),
    )).toBe("Error");
  });

  it("labels pending interactions as needs input", () => {
    expect(cloudChatSessionStatusLabel(
      session({ phase: "awaiting_interaction", status: "running" }),
    )).toBe("Needs input");
  });
});

describe("buildCloudChatHeaderDiagnosticsText", () => {
  it("includes present diagnostics and skips null values", () => {
    expect(buildCloudChatHeaderDiagnosticsText({
      workspace: workspace({ statusDetail: null }),
      session: null,
      commandReadiness: READY_COMMAND,
      commandabilityLabel: "Commands ready",
      sessionLiveConnected: true,
      transcriptSource: "events",
    })).toContain("workspace=workspace-1");
  });
});
