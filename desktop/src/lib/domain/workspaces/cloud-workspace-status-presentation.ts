import type { CloudWorkspaceStatus } from "@/lib/access/cloud/client";
import type { CloudWorkspaceSummary } from "@/lib/access/cloud/client";
import {
  CLOUD_STATUS_ACTION_COPY,
  CLOUD_STATUS_COMPACT_COPY,
} from "@/copy/cloud/cloud-status-copy";
import {
  isCloudStartBlockReason,
  isCloudWorkspacePending,
  isCloudWorkspacePostReadyPending,
  type CloudStartBlockReason,
} from "@/lib/domain/workspaces/cloud-workspace-status";

export interface CloudWorkspaceStepDefinition {
  status: CloudWorkspaceStatus;
  label: string;
  description: string;
}

export const CLOUD_WORKSPACE_PROVISIONING_STEPS: CloudWorkspaceStepDefinition[] = [
  {
    status: "pending",
    label: "Queued",
    description: "Waiting to prepare the cloud workspace.",
  },
  {
    status: "materializing",
    label: "Preparing runtime",
    description: "Preparing the repo runtime and materializing the cloud worktree.",
  },
  {
    status: "ready",
    label: "Ready",
    description: "The workspace is ready for chat, terminals, and file operations.",
  },
];

const GENERIC_PREPARING_DESCRIPTION = "Preparing the cloud workspace.";
const GENERIC_FAILURE_DESCRIPTION = "Provisioning hit an error before the workspace became ready.";
const GENERIC_ARCHIVED_DESCRIPTION = "This cloud workspace has been archived.";
const GENERIC_BLOCKED_DESCRIPTION = "Cloud usage is unavailable for this workspace right now.";
const CONCURRENCY_BLOCK_DESCRIPTION = "Archive or delete another cloud workspace before starting this one.";
const CREDITS_EXHAUSTED_DESCRIPTION = "Cloud usage is paused because your included sandbox hours are exhausted.";
const OVERAGE_DISABLED_DESCRIPTION = "Cloud usage is paused because managed cloud overage is disabled.";
const CAP_EXHAUSTED_DESCRIPTION = "Cloud usage is paused because the managed cloud overage cap is exhausted.";
const PAYMENT_HOLD_DESCRIPTION = "Cloud usage is paused because billing needs attention.";
const ADMIN_HOLD_DESCRIPTION = "Cloud usage is paused for this account.";
const AUTO_REFRESH_MESSAGE = "This view refreshes automatically and will switch into the workspace once the runtime is ready.";
const READY_MESSAGE = "The workspace is ready.";
const REPO_CONFIG_MESSAGE = "The runtime is ready. Applying repo files and cloud setup now.";
const RETRY_HELPER_TEXT = "The workspace record is kept and we will retry setup from there.";

export type CloudWorkspaceStatusScreenMode = "pending" | "error" | "archived" | "blocked";

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
    | { kind: "action"; action: "retry"; label: string; helperText: string }
    | { kind: "status"; message: string };
}

export type CloudWorkspaceCompactStatusTone = "info" | "warning" | "destructive";

export interface CloudWorkspaceCompactStatusView {
  title: string;
  phaseLabel: string;
  tone: CloudWorkspaceCompactStatusTone;
  primaryAction: { action: "retry" | "start"; label: string } | null;
}

function normalizeStartBlockReason(
  reason: CloudStartBlockReason | string | null | undefined,
): CloudStartBlockReason | null {
  return isCloudStartBlockReason(reason) ? reason : null;
}

export function titleForStartBlockReason(
  reason: CloudStartBlockReason | string | null | undefined,
): string {
  const blockReason = normalizeStartBlockReason(reason);
  if (blockReason === "concurrency_limit") {
    return "Sandbox limit reached";
  }
  return "Cloud usage is paused";
}

export function descriptionForStartBlockReason(
  reason: CloudStartBlockReason | string | null | undefined,
): string {
  switch (normalizeStartBlockReason(reason)) {
    case "concurrency_limit":
      return CONCURRENCY_BLOCK_DESCRIPTION;
    case "credits_exhausted":
      return CREDITS_EXHAUSTED_DESCRIPTION;
    case "overage_disabled":
      return OVERAGE_DISABLED_DESCRIPTION;
    case "cap_exhausted":
      return CAP_EXHAUSTED_DESCRIPTION;
    case "payment_failed":
    case "external_billing_hold":
      return PAYMENT_HOLD_DESCRIPTION;
    case "admin_hold":
      return ADMIN_HOLD_DESCRIPTION;
    default:
      return GENERIC_BLOCKED_DESCRIPTION;
  }
}

export function buildCloudWorkspaceStatusScreenModel(
  workspace: CloudWorkspaceSummary,
): CloudWorkspaceStatusScreenModel {
  const repoLabel = `${workspace.repo.owner}/${workspace.repo.name}`;
  const branchLabel = `${workspace.repo.baseBranch} -> ${workspace.repo.branch}`;

  if (workspace.actionBlockKind) {
    const description = workspace.actionBlockReason
      ?? descriptionForStartBlockReason(workspace.actionBlockKind);
    return {
      mode: "blocked",
      pendingStage: null,
      eyebrowTone: "pending",
      title: titleForStartBlockReason(workspace.actionBlockKind),
      description,
      repoLabel,
      branchLabel,
      footer: {
        kind: "status",
        message: description,
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

  if (workspace.status === "archived") {
    return {
      mode: "archived",
      pendingStage: null,
      eyebrowTone: "pending",
      title: "Workspace archived",
      description: workspace.statusDetail || GENERIC_ARCHIVED_DESCRIPTION,
      repoLabel,
      branchLabel,
      footer: {
        kind: "status",
        message: GENERIC_ARCHIVED_DESCRIPTION,
      },
    };
  }

  if (isCloudWorkspacePostReadyPending(workspace)) {
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
      message: isReady
        ? READY_MESSAGE
        : isFirstRuntimeSetupPending(workspace)
          ? CLOUD_STATUS_COMPACT_COPY.firstRuntimeFooterMessage
          : AUTO_REFRESH_MESSAGE,
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
    case "archived":
      return {
        title: CLOUD_STATUS_COMPACT_COPY.attentionTitle,
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

function isFirstRuntimeSetupPending(workspace: CloudWorkspaceSummary): boolean {
  return isCloudWorkspacePending(workspace.status) && workspace.runtime?.generation === 0;
}

function getProvisioningStepIndex(status: string): number {
  return CLOUD_WORKSPACE_PROVISIONING_STEPS.findIndex((step) => step.status === status);
}
