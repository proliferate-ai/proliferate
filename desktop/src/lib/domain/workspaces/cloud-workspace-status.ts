import type {
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import {
  CLOUD_WORKSPACE_PROVISIONING_STEPS,
} from "@/config/cloud-workspaces";
import {
  CLOUD_STATUS_ACTION_COPY,
  CLOUD_STATUS_COMPACT_COPY,
} from "@/config/cloud-status-copy";

const PENDING_STATUSES = new Set<CloudWorkspaceStatus>([
  "queued",
  "provisioning",
  "syncing_credentials",
  "cloning_repo",
  "starting_runtime",
]);

const GENERIC_PREPARING_DESCRIPTION = "Preparing the cloud workspace.";
const GENERIC_FAILURE_DESCRIPTION = "Provisioning hit an error before the workspace became ready.";
const GENERIC_STOPPED_DESCRIPTION = "This cloud workspace is currently stopped. Start it to resume work.";
const GENERIC_BLOCKED_DESCRIPTION = "Cloud usage is unavailable for this workspace right now.";
const AUTO_REFRESH_MESSAGE = "This view refreshes automatically and will switch into the workspace once the runtime is ready.";
const READY_MESSAGE = "The workspace is ready.";
const REPO_CONFIG_MESSAGE = "The runtime is ready. Applying repo files and cloud setup now.";
const RETRY_HELPER_TEXT = "The workspace record is kept and we will retry setup from there.";
const START_HELPER_TEXT = "The workspace record is kept and we will start the runtime again from there.";

export type CloudWorkspaceStatusScreenMode = "pending" | "error" | "stopped" | "blocked";

export interface CloudWorkspaceStatusScreenModel {
  mode: CloudWorkspaceStatusScreenMode;
  pendingStage: "preparing" | "syncing" | null;
  eyebrowTone: "pending" | "error";
  title: string;
  description: string;
  repoLabel: string;
  branchLabel: string;
  footer:
    | { kind: "auto-refresh"; message: string }
    | { kind: "action"; action: "retry" | "start"; label: string; helperText: string }
    | { kind: "status"; message: string };
}

export type CloudWorkspaceCompactStatusTone = "info" | "warning" | "destructive";

export interface CloudWorkspaceCompactStatusView {
  title: string;
  phaseLabel: string;
  tone: CloudWorkspaceCompactStatusTone;
  primaryAction: { action: "retry" | "start"; label: string } | null;
}

export function isCloudWorkspacePending(status: string): boolean {
  return PENDING_STATUSES.has(status as CloudWorkspaceStatus);
}

function isPostReadyPending(phase: string | null | undefined): boolean {
  return phase === "applying_files" || phase === "starting_setup";
}

export function shouldShowCloudWorkspaceStatusScreen(
  workspace: CloudWorkspaceSummary,
): boolean {
  return (
    workspace.actionBlockKind === "billing_quota"
    || isCloudWorkspacePending(workspace.status)
    || workspace.status === "error"
    || workspace.status === "stopped"
    || (workspace.status === "ready" && isPostReadyPending(workspace.postReadyPhase))
  );
}

export function buildCloudWorkspaceStatusScreenModel(
  workspace: CloudWorkspaceSummary,
): CloudWorkspaceStatusScreenModel {
  const repoLabel = `${workspace.repo.owner}/${workspace.repo.name}`;
  const branchLabel = `${workspace.repo.baseBranch} -> ${workspace.repo.branch}`;

  if (workspace.actionBlockKind === "billing_quota") {
    return {
      mode: "blocked",
      pendingStage: null,
      eyebrowTone: "pending",
      title: "Cloud usage is paused",
      description: GENERIC_BLOCKED_DESCRIPTION,
      repoLabel,
      branchLabel,
      footer: {
        kind: "status",
        message: GENERIC_BLOCKED_DESCRIPTION,
      },
    };
  }

  if (workspace.status === "error") {
    return {
      mode: "error",
      pendingStage: null,
      eyebrowTone: "error",
      title: "Provisioning failed",
      description:
        workspace.lastError
        || workspace.statusDetail
        || GENERIC_FAILURE_DESCRIPTION,
      repoLabel,
      branchLabel,
      footer: {
        kind: "action",
        action: "retry",
        label: "Retry provisioning",
        helperText: RETRY_HELPER_TEXT,
      },
    };
  }

  if (workspace.status === "stopped") {
    return {
      mode: "stopped",
      pendingStage: null,
      eyebrowTone: "pending",
      title: "Workspace stopped",
      description: workspace.statusDetail || GENERIC_STOPPED_DESCRIPTION,
      repoLabel,
      branchLabel,
      footer: {
        kind: "action",
        action: "start",
        label: "Start workspace",
        helperText: START_HELPER_TEXT,
      },
    };
  }

  if (workspace.status === "ready" && isPostReadyPending(workspace.postReadyPhase)) {
    const title = workspace.postReadyPhase === "applying_files"
      ? "Applying tracked files"
      : "Starting cloud setup";
    const description = workspace.postReadyPhase === "applying_files"
      ? `Applying ${workspace.postReadyFilesApplied}/${workspace.postReadyFilesTotal} tracked files from the saved repo config.`
      : REPO_CONFIG_MESSAGE;

    return {
      mode: "pending",
      pendingStage: "syncing",
      eyebrowTone: "pending",
      title,
      description,
      repoLabel,
      branchLabel,
      footer: {
        kind: "auto-refresh",
        message: REPO_CONFIG_MESSAGE,
      },
    };
  }

  const activeStepIndex = getProvisioningStepIndex(workspace.status);
  const normalizedStepIndex = activeStepIndex >= 0
    ? activeStepIndex
    : CLOUD_WORKSPACE_PROVISIONING_STEPS.length - 1;
  const activeStep =
    CLOUD_WORKSPACE_PROVISIONING_STEPS[normalizedStepIndex] ?? null;
  const isReady = workspace.status === "ready";

  return {
    mode: "pending",
    pendingStage: "preparing",
    eyebrowTone: "pending",
    title: CLOUD_STATUS_COMPACT_COPY.preparingTitle,
    description:
      workspace.statusDetail
      || activeStep?.description
      || GENERIC_PREPARING_DESCRIPTION,
    repoLabel,
    branchLabel,
    footer: {
      kind: "auto-refresh",
      message: isReady ? READY_MESSAGE : AUTO_REFRESH_MESSAGE,
    },
  };
}

export function buildCloudWorkspaceCompactStatusView(
  model: CloudWorkspaceStatusScreenModel,
): CloudWorkspaceCompactStatusView {
  const primaryAction = model.footer.kind === "action"
    ? {
      action: model.footer.action,
      label: CLOUD_STATUS_ACTION_COPY[model.footer.action],
    }
    : null;

  switch (model.mode) {
    case "error":
      return {
        title: CLOUD_STATUS_COMPACT_COPY.attentionTitle,
        phaseLabel: model.title,
        tone: "destructive",
        primaryAction,
      };
    case "blocked":
      return {
        title: CLOUD_STATUS_COMPACT_COPY.attentionTitle,
        phaseLabel: model.title,
        tone: "warning",
        primaryAction,
      };
    case "stopped":
      return {
        title: CLOUD_STATUS_COMPACT_COPY.stoppedTitle,
        phaseLabel: model.title,
        tone: "warning",
        primaryAction,
      };
    case "pending": {
      const title = model.pendingStage === "preparing"
        ? CLOUD_STATUS_COMPACT_COPY.preparingTitle
        : CLOUD_STATUS_COMPACT_COPY.syncingTitle;
      const phaseLabel = model.pendingStage === "preparing"
        ? CLOUD_STATUS_COMPACT_COPY.preparingPhaseLabel
        : model.title;
      return {
        title,
        phaseLabel,
        tone: "info",
        primaryAction,
      };
    }
  }
}

function getProvisioningStepIndex(status: string): number {
  return CLOUD_WORKSPACE_PROVISIONING_STEPS.findIndex((step) => step.status === status);
}
