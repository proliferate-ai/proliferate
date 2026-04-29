import { describe, expect, it } from "vitest";
import {
  buildCloudWorkspaceCompactStatusView,
  buildCloudWorkspaceStatusScreenModel,
  shouldShowCloudWorkspaceStatusScreen,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import type { CloudWorkspaceStatus, CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";

function makeCloudWorkspace(
  overrides: Partial<CloudWorkspaceSummary> = {},
): CloudWorkspaceSummary {
  return {
    id: "cloud-1",
    displayName: null,
    actionBlockKind: null,
    actionBlockReason: null,
    postReadyPhase: "idle",
    postReadyFilesApplied: 0,
    postReadyFilesTotal: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    status: "queued",
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    runtimeGeneration: 0,
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    repo: {
      provider: "github",
      owner: "openai",
      name: "proliferate",
      baseBranch: "main",
      branch: "feature/support-cleanup",
    },
    ...overrides,
  };
}

describe("buildCloudWorkspaceStatusScreenModel", () => {
  it("returns a passive status footer for billing blocks", () => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      actionBlockKind: "billing_quota",
      actionBlockReason: "Cloud usage is paused.",
    }));

    expect(model.footer).toEqual({
      kind: "status",
      message: "Cloud usage is unavailable for this workspace right now.",
    });
    expect(model.description).toBe(
      "Cloud usage is unavailable for this workspace right now.",
    );
  });
});

describe("shouldShowCloudWorkspaceStatusScreen", () => {
  it("does not show the full status screen when optional block fields are omitted", () => {
    const { actionBlockKind: _actionBlockKind, actionBlockReason: _actionBlockReason, ...workspace } =
      makeCloudWorkspace({ status: "ready" });

    expect(shouldShowCloudWorkspaceStatusScreen(workspace)).toBe(false);
  });
});

describe("buildCloudWorkspaceCompactStatusView", () => {
  it.each<{
    expectedPhaseLabel: string;
    expectedTitle: string;
    status: CloudWorkspaceStatus;
  }>([
    { status: "queued", expectedTitle: "Preparing cloud workspace", expectedPhaseLabel: "Queued" },
    { status: "provisioning", expectedTitle: "Preparing cloud workspace", expectedPhaseLabel: "Preparing workspace" },
    { status: "syncing_credentials", expectedTitle: "Preparing cloud workspace", expectedPhaseLabel: "Syncing credentials" },
    { status: "cloning_repo", expectedTitle: "Preparing cloud workspace", expectedPhaseLabel: "Cloning repository" },
    { status: "starting_runtime", expectedTitle: "Preparing cloud workspace", expectedPhaseLabel: "Starting runtime" },
  ])("maps $status to a compact pending view", ({ expectedPhaseLabel, expectedTitle, status }) => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({ status }));
    const compact = buildCloudWorkspaceCompactStatusView(model);

    expect(compact).toMatchObject({
      phaseLabel: expectedPhaseLabel,
      primaryAction: null,
      title: expectedTitle,
      tone: "info",
    });
  });

  it.each([
    {
      expectedAction: { action: "retry", label: "Retry" },
      expectedTitle: "Cloud workspace needs attention",
      status: "error" as const,
      tone: "destructive" as const,
    },
    {
      expectedAction: { action: "start", label: "Start" },
      expectedTitle: "Cloud workspace stopped",
      status: "stopped" as const,
      tone: "warning" as const,
    },
  ])("maps $status to a compact action view", ({ expectedAction, expectedTitle, status, tone }) => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({ status }));
    const compact = buildCloudWorkspaceCompactStatusView(model);

    expect(compact).toMatchObject({
      primaryAction: expectedAction,
      title: expectedTitle,
      tone,
    });
  });

  it("maps post-ready file application to workspace syncing copy", () => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      postReadyFilesApplied: 2,
      postReadyFilesTotal: 4,
      postReadyPhase: "applying_files",
      status: "ready",
    }));

    expect(buildCloudWorkspaceCompactStatusView(model)).toMatchObject({
      phaseLabel: "Applying tracked files",
      title: "Syncing workspace",
      tone: "info",
    });
  });

  it("keeps compact tones constrained to non-green semantic states", () => {
    const models = [
      makeCloudWorkspace({ status: "queued" }),
      makeCloudWorkspace({ status: "provisioning" }),
      makeCloudWorkspace({ status: "syncing_credentials" }),
      makeCloudWorkspace({ status: "cloning_repo" }),
      makeCloudWorkspace({ status: "starting_runtime" }),
      makeCloudWorkspace({ status: "ready", postReadyPhase: "applying_files" }),
      makeCloudWorkspace({ status: "stopped" }),
      makeCloudWorkspace({ status: "error" }),
      makeCloudWorkspace({ actionBlockKind: "billing_quota" }),
    ].map((workspace) => buildCloudWorkspaceStatusScreenModel(workspace));

    expect(models.map((model) => buildCloudWorkspaceCompactStatusView(model).tone))
      .toEqual(expect.arrayContaining(["info", "warning", "destructive"]));
    for (const model of models) {
      expect(["info", "warning", "destructive"]).toContain(
        buildCloudWorkspaceCompactStatusView(model).tone,
      );
    }
  });
});
