import type { WorkspaceArrivalViewModel } from "@/lib/domain/workspaces/creation/arrival";
import {
  buildCloudWorkspaceStatusScreenModel,
  type CloudWorkspaceStatusScreenModel,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import type { SelectedCloudRuntimeViewModel } from "@/lib/domain/workspaces/cloud/cloud-runtime-state";
import type {
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export const WORKSPACE_ARRIVAL_CREATED: WorkspaceArrivalViewModel = {
  workspaceId: "workspace-arrival-created",
  source: "worktree-created",
  kind: "worktree",
  workspacePath: "/Users/pablo/.proliferate/worktrees/proliferate/prism",
  workspaceKind: "worktree",
  workspaceName: "Prism",
  repoName: "proliferate",
  badgeLabel: "New worktree",
  eyebrow: "Ready to open",
  title: "Prism",
  subtitle: "Created in proliferate from main",
  setupTitle: "Repository setup",
  setupSummary: "No setup script configured yet",
  setupCommand: null,
  setupActionLabel: "Add setup script",
  setupStatusLabel: "Optional",
  setupTone: "default",
  setupDetail: null,
  setupTerminalId: null,
  branchName: "prism",
  baseBranchName: "main",
};

function cloudWorkspaceFixture(
  overrides: Partial<CloudWorkspaceSummary> = {},
): CloudWorkspaceSummary {
  return {
    id: "cloud-playground",
    displayName: "Cloud playground",
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
      generation: 1,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:01:00Z",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      baseBranch: "main",
      branch: "feature/cloud-status",
    },
    ...overrides,
  };
}

function cloudStatusFixture(
  overrides: Partial<CloudWorkspaceSummary> & { status?: CloudWorkspaceStatus } = {},
): CloudWorkspaceStatusScreenModel {
  return buildCloudWorkspaceStatusScreenModel(cloudWorkspaceFixture(overrides));
}

export const CLOUD_STATUS_PROVISIONING = cloudStatusFixture({
  status: "materializing",
});

export const CLOUD_STATUS_FIRST_RUNTIME = cloudStatusFixture({
  status: "materializing",
  runtime: {
    environmentId: "runtime-playground",
    status: "provisioning",
    generation: 0,
    actionBlockKind: null,
    actionBlockReason: null,
  },
});

export const CLOUD_STATUS_APPLYING_FILES = cloudStatusFixture({
  postReadyFilesApplied: 7,
  postReadyFilesTotal: 18,
  postReadyPhase: "applying_files",
  status: "ready",
});

export const CLOUD_STATUS_BLOCKED = cloudStatusFixture({
  actionBlockKind: "billing_quota",
  actionBlockReason: "Cloud usage is paused for this account.",
});

export const CLOUD_STATUS_ERROR = cloudStatusFixture({
  lastError: "Cloud setup could not finish. Check repo access, then retry.",
  status: "error",
});

export const CLOUD_RUNTIME_RECONNECTING: SelectedCloudRuntimeViewModel = {
  phase: "resuming",
  variant: "warm",
  tone: "pending",
  title: "Reconnecting cloud workspace",
  subtitle: "Runtime-backed actions are paused while the workspace reconnects.",
  actionBlockReason: "Cloud workspace is reconnecting. Runtime-backed actions are paused until it comes back.",
  preserveVisibleContent: true,
  showRetry: false,
};

export const CLOUD_RUNTIME_RECONNECT_ERROR: SelectedCloudRuntimeViewModel = {
  phase: "failed",
  variant: "warm",
  tone: "error",
  title: "Couldn't reconnect cloud workspace",
  subtitle: "Retry to restore chat, files, and terminals.",
  actionBlockReason: "Cloud workspace couldn't reconnect. Retry to restore chat, files, and terminals.",
  preserveVisibleContent: true,
  showRetry: true,
};
