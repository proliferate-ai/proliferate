import type {
  CloudCommandResponse,
  CloudCommandStatus,
  CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import {
  cloudWorkspaceRuntimeIsInProgress,
  type recentWorkCommandability,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import type { CloudChatHeaderNoticeView } from "@proliferate/product-ui/chat/CloudChatSurface";

export function friendlyCommandStatusMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }
  if (isManagedCloudWorkerBaseUrlMessage(message)) {
    return "Cloud sandbox setup cannot reach this local dev server. Configure a public HTTPS tunnel for CLOUD_WORKER_BASE_URL, then retry the workspace.";
  }
  if (isManagedTargetConfigMessage(message)) {
    return "Workspace accepted. Preparing the selected runtime so this session can start.";
  }
  if (isCloudRuntimeProfileMessage(message)) {
    return "Workspace accepted. Preparing cloud runtime access for this target.";
  }
  return message;
}

export function isWorkspacePreparationStatus(message: string | null | undefined): boolean {
  return friendlyCommandStatusMessage(message)?.startsWith("Workspace accepted.") ?? false;
}

export function workspaceNoticeForStatus(input: {
  workspace: CloudWorkspaceSnapshot["workspace"];
  workspaceStatus: string | null;
  message: string | null;
  workspaceCommandReady: boolean;
}): Omit<CloudChatHeaderNoticeView, "action" | "diagnostics"> | null {
  const message = input.message?.trim() ?? null;
  const normalizedWorkspaceStatus = input.workspaceStatus?.toLowerCase() ?? null;
  const runtimeStatus = input.workspace.runtime?.status?.toLowerCase() ?? null;
  const runtimeIsProvisioning =
    !input.workspaceCommandReady && cloudWorkspaceRuntimeIsInProgress(input.workspace);
  const isProvisioning =
    normalizedWorkspaceStatus === "pending"
    || normalizedWorkspaceStatus === "materializing"
    || normalizedWorkspaceStatus === "needs_rematerialization"
    || normalizedWorkspaceStatus === "provisioning"
    || runtimeIsProvisioning;
  const isFailed =
    normalizedWorkspaceStatus === "error"
    || runtimeStatus === "error"
    || runtimeStatus === "disabled";

  if (message?.startsWith("Cloud sandbox setup cannot reach")) {
    return {
      title: "Workspace setup failed.",
      description: message,
      tone: "destructive",
    };
  }
  if (isFailed) {
    return {
      title: "Workspace setup needs attention.",
      description: message ?? workspaceFailureStatusMessage(input.workspace) ?? "The runtime is not ready.",
      tone: "destructive",
    };
  }
  if (message?.startsWith("Workspace accepted.")) {
    return {
      title: "Preparing workspace.",
      description: message.replace(/^Workspace accepted\.\s*/u, "") || "Preparing the selected runtime so this session can start.",
      tone: "info",
    };
  }
  if (isProvisioning) {
    return {
      title: "Starting workspace.",
      description: message ?? "Preparing the cloud runtime so this session can start.",
      tone: "info",
    };
  }
  return null;
}

export function commandStatusMessageForNotice(
  command: CloudCommandResponse | undefined,
): string | null {
  if (!command) {
    return null;
  }
  const failureMessage = commandStatusFailureMessage(command, null);
  if (failureMessage) {
    return failureMessage;
  }
  switch (command.status) {
    case "queued":
      return "Loading...";
    case "leased":
      return "Cloud runtime is picking up the command.";
    case "delivered":
      return "Command delivered; waiting for runtime acknowledgement.";
    case "rejected":
    case "expired":
    case "superseded":
    case "failed_delivery":
      return promptCommandFailureMessage(command.status);
    case "accepted":
    case "accepted_but_queued":
    default:
      return null;
  }
}

export function isPromptProgressStatus(message: string | null): boolean {
  return /^(approving|preparing|rejecting|starting|sending|waiting|queued|loading|using selected cloud agent credential|workspace is provisioning|cloud runtime is picking up|command delivered)/i
    .test(message ?? "");
}

export function commandStatusFailureMessage(
  command: Pick<CloudCommandResponse, "errorCode" | "errorMessage" | "status">,
  fallback: string | null,
): string | null {
  const codeMessage = friendlyCommandErrorCodeMessage(command.errorCode);
  if (codeMessage) {
    return codeMessage;
  }
  const errorMessage = friendlyCommandStatusMessage(command.errorMessage);
  if (errorMessage) {
    return errorMessage;
  }
  return fallback;
}

export function workspaceFailureStatusMessage(
  workspace: { lastError?: string | null; statusDetail?: string | null },
): string | null {
  return friendlyCommandStatusMessage(workspace.lastError)
    ?? friendlyWorkspaceStatusDetailMessage(workspace.statusDetail)
    ?? null;
}

export function workspaceCommandabilityLabel(
  commandability: ReturnType<typeof recentWorkCommandability>,
): string {
  switch (commandability) {
    case "commandable":
      return "Commands ready";
    case "not_commandable":
      return "Commands unavailable";
    case "stale":
      return "Runtime offline";
    case "unknown":
      return "Command status unknown";
  }
}

export function isRejectedCommandStatus(status: CloudCommandStatus): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

export function isTerminalCommandStatus(status: CloudCommandStatus): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || isRejectedCommandStatus(status);
}

export function sessionConfigCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Session configuration update expired before it was applied.";
    case "superseded":
      return "Session configuration update was superseded.";
    case "failed_delivery":
      return "Session configuration update could not be delivered.";
    case "rejected":
    default:
      return "Session configuration update was rejected.";
  }
}

export function promptCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Prompt expired before it was delivered.";
    case "superseded":
      return "Prompt was superseded before it was delivered.";
    case "failed_delivery":
      return "Prompt could not be delivered to the cloud runtime.";
    case "rejected":
    default:
      return "Prompt was rejected by the cloud runtime.";
  }
}

export function planDecisionProgressMessage(decision: "approve" | "reject"): string {
  return decision === "approve" ? "Approving plan." : "Rejecting plan.";
}

export function planDecisionFailureMessage(decision: "approve" | "reject"): string {
  return decision === "approve"
    ? "Plan could not be approved."
    : "Plan could not be rejected.";
}

function friendlyCommandErrorCodeMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "cloud_command_exposure_not_active":
    case "cloud_exposure_not_active":
      return "Workspace access is no longer active. Refresh the workspace, then retry.";
    case "cloud_command_exposure_not_commandable":
    case "cloud_exposure_not_commandable":
      return "This workspace is read-only from Cloud right now.";
    case "cloud_command_workspace_not_found":
      return "Workspace no longer exists.";
    case "cloud_command_workspace_target_mismatch":
    case "cloud_command_agent_auth_target_mismatch":
      return "Workspace is attached to a different runtime target. Refresh the workspace, then retry.";
    case "cloud_command_cloud_workspace_required":
    case "cloud_workspace_required":
      return "Workspace accepted. Preparing the selected runtime so this session can start.";
    case "runtime_config_not_ready":
      return "Workspace accepted. Preparing cloud runtime access for this target.";
    case "web_command_queue_timeout":
    case "client_command_queue_timeout":
      return "Cloud runtime did not pick up the command in time. Check that the runtime is online, then retry.";
    case "sandbox_wake_blocked":
      return "Cloud runtime needs billing or quota attention before it can wake.";
    case "sandbox_wake_failed":
      return "Cloud runtime wake failed. Retry after the runtime is healthy.";
    case "sandbox_wake_timeout":
      return "Cloud runtime did not wake in time. Retry shortly.";
    case "quota_exceeded":
    case "cloud_repo_limit_reached":
      return "Cloud limit reached. Disable another cloud repo or upgrade before creating this workspace.";
    case "missing_supported_credentials":
    case "agent_auth_credentials_missing":
      return "Add credentials for the selected agent before starting this session.";
    default:
      return null;
  }
}

function friendlyWorkspaceStatusDetailMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim();
  if (!trimmed || /^ready$/i.test(trimmed) || /^synced from target\.?$/i.test(trimmed)) {
    return null;
  }
  return friendlyCommandStatusMessage(trimmed);
}

function isManagedCloudWorkerBaseUrlMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("cloud_worker_base_url")
    && normalized.includes("public url")
    && normalized.includes("reachable from the sandbox");
}

function isManagedTargetConfigMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("managed targets require")
    && normalized.includes("materialized target config");
}

function isCloudRuntimeProfileMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (normalized.includes("agent auth sandbox profile")
    || normalized.includes("runtime config sandbox profile"))
    && (normalized.includes("not attached")
      || normalized.includes("does not match")
      || normalized.includes("target mismatch")
      || normalized.includes("target_mismatch"));
}
