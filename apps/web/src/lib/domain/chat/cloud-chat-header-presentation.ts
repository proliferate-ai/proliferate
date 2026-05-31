import type {
  CloudCommandResponse,
  CloudPendingInteraction,
  CloudSessionProjection,
  CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import {
  cloudWorkspaceRuntimeIsInProgress,
  type cloudCommandReadiness,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

type HeaderWorkspace = NonNullable<CloudWorkspaceSnapshot["workspace"]>;
type CloudChatHeaderTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive";

export interface CloudChatHeaderStatusPresentation {
  label: string;
  tone: CloudChatHeaderTone;
  live?: boolean;
}

type HeaderSessionStatus = Pick<
  CloudSessionProjection,
  "phase" | "pendingInteractionCount" | "status"
>;

export function buildCloudChatHeaderStatus(input: {
  workspace: HeaderWorkspace;
  session: HeaderSessionStatus | null;
  pendingInteractions: readonly CloudPendingInteraction[];
  workspaceCommandReady: boolean;
  commandReadiness: ReturnType<typeof cloudCommandReadiness>;
  workspacePreparationMessage: boolean;
  promptSubmitting: boolean;
}): CloudChatHeaderStatusPresentation {
  if (workspaceHasError(input.workspace)) {
    return { label: "Error", tone: "destructive" };
  }
  if (
    input.workspacePreparationMessage
    || (workspaceIsPreparing(input.workspace) && input.commandReadiness.state !== "ready")
  ) {
    return { label: "Starting", tone: "info", live: true };
  }
  if (sessionHasError(input.session)) {
    return { label: "Error", tone: "destructive" };
  }
  if (sessionPhaseNeedsInput(input.session) || pendingInteractionsNeedInput(input.pendingInteractions)) {
    return { label: "Needs input", tone: "warning" };
  }
  if (
    input.promptSubmitting
    || sessionIsRunning(input.session)
  ) {
    return { label: "In progress", tone: "info", live: true };
  }
  if (sessionIsReviewReady(input.session)) {
    return { label: "Ready for review", tone: "success" };
  }
  if (input.workspaceCommandReady || input.commandReadiness.state === "ready") {
    return { label: "Ready", tone: "success" };
  }
  return { label: "Idle", tone: "neutral" };
}

export function cloudChatSessionStatusLabel(
  session: HeaderSessionStatus,
): string {
  if (sessionHasError(session)) {
    return "Error";
  }
  if (sessionHasPendingInput(session)) {
    return "Needs input";
  }
  const normalized = normalizeStatusToken(session.phase) || normalizeStatusToken(session.status);
  switch (normalized) {
    case "starting":
      return "Starting";
    case "running":
    case "queued":
      return "In progress";
    case "review":
    case "ready_for_review":
      return "Ready for review";
    case "ended":
    case "done":
    case "completed":
      return "Ready";
    case "error":
    case "errored":
    case "failed":
      return "Error";
    case "idle":
      return "Idle";
    default:
      return titleizeStatus(session.status);
  }
}

export function buildCloudChatHeaderDiagnosticsText(input: {
  workspace: HeaderWorkspace;
  session: CloudSessionProjection | null;
  commandReadiness: ReturnType<typeof cloudCommandReadiness>;
  commandabilityLabel: string;
  commandStatus?: CloudCommandResponse;
  sessionLiveConnected: boolean;
  transcriptSource: string;
}): string {
  return [
    diagnosticPart("workspace", input.workspace.id),
    diagnosticPart("workspace_status", input.workspace.workspaceStatus ?? input.workspace.status),
    diagnosticPart("runtime_status", input.workspace.runtime?.status),
    diagnosticPart("target", input.workspace.targetId),
    diagnosticPart("anyharness_workspace", input.workspace.anyharnessWorkspaceId),
    diagnosticPart("exposure", input.workspace.exposureState),
    diagnosticPart("command_readiness", input.commandReadiness.state),
    diagnosticPart("commandability", input.commandabilityLabel),
    diagnosticPart("last_error", input.workspace.lastError),
    diagnosticPart("status_detail", input.workspace.statusDetail),
    diagnosticPart("session", input.session?.sessionId),
    diagnosticPart("session_status", input.session?.status),
    diagnosticPart("session_phase", input.session?.phase),
    diagnosticPart("pending_interactions", input.session?.pendingInteractionCount),
    diagnosticPart("live_stream", input.sessionLiveConnected ? "connected" : "snapshot"),
    diagnosticPart("transcript_source", input.transcriptSource),
    diagnosticPart("command", input.commandStatus?.commandId),
    diagnosticPart("command_status", input.commandStatus?.status),
    diagnosticPart("command_error_code", input.commandStatus?.errorCode),
    diagnosticPart("command_error", input.commandStatus?.errorMessage),
  ].filter(Boolean).join(" · ");
}

function titleizeStatus(status: string | null | undefined): string {
  return (status ?? "")
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Session";
}

function diagnosticPart(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return `${label}=${String(value)}`;
}

function workspaceHasError(workspace: HeaderWorkspace): boolean {
  return Boolean(
    workspace.lastError
      || workspace.workspaceStatus === "error"
      || workspace.status === "error"
      || workspace.runtime?.status === "error",
  );
}

function workspaceIsPreparing(workspace: HeaderWorkspace): boolean {
  return workspace.workspaceStatus === "pending"
    || workspace.workspaceStatus === "materializing"
    || workspace.workspaceStatus === "needs_rematerialization"
    || cloudWorkspaceRuntimeIsInProgress(workspace);
}

function sessionHasPendingInput(
  session: Pick<CloudSessionProjection, "phase" | "pendingInteractionCount"> | null,
): boolean {
  return Boolean(
    session
      && ((session.pendingInteractionCount ?? 0) > 0
        || normalizeStatusToken(session.phase) === "awaiting_interaction"),
  );
}

function sessionHasError(
  session: Pick<CloudSessionProjection, "phase" | "status"> | null,
): boolean {
  if (!session) {
    return false;
  }
  const values = [
    normalizeStatusToken(session.phase),
    normalizeStatusToken(session.status),
  ];
  return values.some((value) =>
    value === "error"
      || value === "errored"
      || value === "failed"
      || value === "failure"
  );
}

function sessionPhaseNeedsInput(
  session: Pick<CloudSessionProjection, "phase"> | null,
): boolean {
  return normalizeStatusToken(session?.phase) === "awaiting_interaction";
}

function pendingInteractionsNeedInput(
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.status !== "resolved"
      && interaction.status !== "completed"
      && interaction.kind !== "send_prompt"
  );
}

function sessionIsRunning(
  session: Pick<CloudSessionProjection, "phase" | "status"> | null,
): boolean {
  if (!session) {
    return false;
  }
  const values = [
    normalizeStatusToken(session.phase),
    normalizeStatusToken(session.status),
  ];
  return values.some((value) =>
    value === "starting"
      || value === "running"
      || value === "queued"
      || value === "leased"
      || value === "delivered"
  );
}

function sessionIsReviewReady(
  session: Pick<CloudSessionProjection, "phase" | "status"> | null,
): boolean {
  if (!session) {
    return false;
  }
  const values = [
    normalizeStatusToken(session.phase),
    normalizeStatusToken(session.status),
  ];
  return values.some((value) => value === "review" || value === "ready_for_review");
}

function normalizeStatusToken(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[\s-]+/gu, "_").trim() ?? "";
}
