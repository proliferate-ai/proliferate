import { describe, expect, it } from "vitest";
import {
  buildCloudWorkspaceCompactStatusView,
  buildCloudWorkspaceStatusScreenModel,
  descriptionForStartBlockReason,
  shouldShowCloudWorkspaceStatusScreen,
  type CloudWorkspaceStatusScreenModel,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import { CLOUD_STATUS_COMPACT_COPY } from "@/config/cloud-status-copy";
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
    status: "pending",
    workspaceStatus: "pending",
    runtime: {
      environmentId: null,
      status: "pending",
      generation: 0,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
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

function footerMessage(model: CloudWorkspaceStatusScreenModel): string | null {
  return "message" in model.footer ? model.footer.message : null;
}

describe("buildCloudWorkspaceStatusScreenModel", () => {
  it("keeps provisioning progress to the current phase instead of row steps", () => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      status: "materializing",
    }));

    expect(model.title).toBe("Preparing cloud workspace");
    expect(model.pendingStage).toBe("preparing");
    expect("stepCounter" in model).toBe(false);
    expect("steps" in model).toBe(false);
  });

  it("returns a passive status footer for billing blocks", () => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      actionBlockKind: "credits_exhausted",
      actionBlockReason: "Cloud usage is paused because your included sandbox hours are exhausted.",
    }));

    expect(model.footer).toEqual({
      kind: "status",
      message: "Cloud usage is paused because your included sandbox hours are exhausted.",
    });
    expect(model.description).toBe(
      "Cloud usage is paused because your included sandbox hours are exhausted.",
    );
  });

  it.each<CloudWorkspaceStatus>(["pending", "materializing"])(
    "shows first-runtime setup copy for %s with generation zero",
    (status) => {
      const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
        status,
        runtime: {
          environmentId: "runtime-1",
          status: "provisioning",
          generation: 0,
          actionBlockKind: null,
          actionBlockReason: null,
        },
      }));

      expect(model.footer).toMatchObject({
        kind: "auto-refresh",
        message: CLOUD_STATUS_COMPACT_COPY.firstRuntimeFooterMessage,
      });
    },
  );

  it("keeps generic provisioning copy when runtime generation is non-zero", () => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      status: "materializing",
      runtime: {
        environmentId: "runtime-1",
        status: "running",
        generation: 2,
        actionBlockKind: null,
        actionBlockReason: null,
      },
    }));

    expect(model.footer.kind).toBe("auto-refresh");
    expect(footerMessage(model)).not.toBe(CLOUD_STATUS_COMPACT_COPY.firstRuntimeFooterMessage);
  });

  it("keeps generic provisioning copy when runtime summary is missing", () => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      runtime: undefined,
      status: "materializing",
    }));

    expect(model.footer.kind).toBe("auto-refresh");
    expect(footerMessage(model)).not.toBe(CLOUD_STATUS_COMPACT_COPY.firstRuntimeFooterMessage);
  });

  it.each<"applying_files" | "starting_setup">([
    "applying_files",
    "starting_setup",
  ])("keeps repo-config copy during post-ready %s", (postReadyPhase) => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      postReadyFilesApplied: 2,
      postReadyFilesTotal: 4,
      postReadyPhase,
      status: "ready",
      runtime: {
        environmentId: "runtime-1",
        status: "running",
        generation: 0,
        actionBlockKind: null,
        actionBlockReason: null,
      },
    }));

    expect(model.footer.kind).toBe("auto-refresh");
    expect(footerMessage(model)).not.toBe(CLOUD_STATUS_COMPACT_COPY.firstRuntimeFooterMessage);
    expect(footerMessage(model)).toContain("runtime is ready");
    if (postReadyPhase === "applying_files") {
      expect(model.description).toContain("Applying 2/4 tracked files");
    } else {
      expect(model.description).toContain("runtime is ready");
    }
  });

  it.each<Partial<CloudWorkspaceSummary>>([
    { status: "error" },
    { status: "archived" },
    { actionBlockKind: "credits_exhausted" },
  ])("does not show first-runtime copy for non-provisioning states", (overrides) => {
    const model = buildCloudWorkspaceStatusScreenModel(makeCloudWorkspace({
      ...overrides,
      runtime: {
        environmentId: "runtime-1",
        status: "provisioning",
        generation: 0,
        actionBlockKind: null,
        actionBlockReason: null,
      },
    }));

    expect(JSON.stringify(model.footer)).not.toContain(
      CLOUD_STATUS_COMPACT_COPY.firstRuntimeFooterMessage,
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
    {
      status: "pending",
      expectedTitle: "Preparing cloud workspace",
      expectedPhaseLabel: "Opening automatically when ready",
    },
    {
      status: "materializing",
      expectedTitle: "Preparing cloud workspace",
      expectedPhaseLabel: "Opening automatically when ready",
    },
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
      makeCloudWorkspace({ status: "pending" }),
      makeCloudWorkspace({ status: "materializing" }),
      makeCloudWorkspace({ status: "ready", postReadyPhase: "applying_files" }),
      makeCloudWorkspace({ status: "archived" }),
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

describe("descriptionForStartBlockReason", () => {
  it.each([
    {
      reason: "concurrency_limit",
      description: "Archive or delete another cloud workspace before starting this one.",
    },
    {
      reason: "credits_exhausted",
      description: "Cloud usage is paused because your included sandbox hours are exhausted.",
    },
    {
      reason: "payment_failed",
      description: "Cloud usage is paused because billing needs attention.",
    },
    {
      reason: "admin_hold",
      description: "Cloud usage is paused for this account.",
    },
    {
      reason: "external_billing_hold",
      description: "Cloud usage is paused because billing needs attention.",
    },
  ])("maps $reason to actionable copy", ({ description, reason }) => {
    expect(descriptionForStartBlockReason(reason)).toBe(description);
  });
});
