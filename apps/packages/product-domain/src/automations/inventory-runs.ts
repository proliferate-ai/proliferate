import type {
  AutomationInventoryStatusKind,
  AutomationRunInventoryItemView,
  AutomationRunInventoryRecord,
  BuildAutomationRunInventoryOptions,
} from "./inventory";
import { compactMessage, formatTimestamp } from "./inventory-dates";
import {
  automationTargetAvailability,
  automationTargetLabel,
  AUTOMATION_DESKTOP_REQUIRED_MESSAGE,
} from "./inventory-targets";

export function buildAutomationRunInventoryItemViews(
  runs: readonly AutomationRunInventoryRecord[],
  options: BuildAutomationRunInventoryOptions = {},
): AutomationRunInventoryItemView[] {
  const clientSurface = options.clientSurface ?? "desktop";
  return runs.map((run) => {
    const targetKind = run.targetKindSnapshot ?? run.cloudTargetKindSnapshot;
    const managedCloud = automationTargetAvailability(
      run.targetMode,
      run.executionTarget,
      targetKind,
    ) === "managed_cloud";
    const openable = clientSurface === "web"
      ? Boolean(managedCloud && run.cloudWorkspaceId)
      : Boolean(run.cloudWorkspaceId || run.anyharnessWorkspaceId);
    const opening = Boolean(
      run.cloudWorkspaceId
      && options.pendingCloudWorkspaceId
      && run.cloudWorkspaceId === options.pendingCloudWorkspaceId,
    );
    const hasDesktopOpenTarget = Boolean(run.anyharnessWorkspaceId);
    const desktopRequired = clientSurface === "web" && !managedCloud && hasDesktopOpenTarget;
    return {
      id: run.id,
      title: automationRunTitle(run),
      statusKind: automationRunStatusKind(run.status),
      statusLabel: automationRunStatusLabel(run),
      timestampLabel: automationRunTimestampLabel(run),
      triggerLabel: run.triggerKind === "manual" ? "Manual" : "Scheduled",
      targetLabel: automationTargetLabel(
        run.targetMode,
        run.executionTarget,
        targetKind,
      ),
      errorLabel: run.status === "failed" ? run.lastErrorMessage ?? null : null,
      openState: desktopRequired ? "desktop_required" : opening ? "opening" : openable ? "openable" : "none",
      openLabel: desktopRequired ? AUTOMATION_DESKTOP_REQUIRED_MESSAGE : "Open workspace",
      openDisabledReason: desktopRequired ? AUTOMATION_DESKTOP_REQUIRED_MESSAGE : null,
    };
  });
}

function automationRunTitle(run: AutomationRunInventoryRecord): string {
  if (run.status === "failed" && run.lastErrorMessage) {
    return compactMessage(run.lastErrorMessage);
  }
  return automationRunStatusLabel(run);
}

function automationRunStatusKind(status: string): AutomationInventoryStatusKind {
  switch (status) {
    case "queued":
    case "claimed":
      return "waiting";
    case "creating_workspace":
    case "provisioning_workspace":
    case "creating_session":
    case "dispatching":
      return "working";
    case "failed":
      return "blocked";
    case "dispatched":
    case "cancelled":
      return "done";
    default:
      return "waiting";
  }
}

function automationRunStatusLabel(run: AutomationRunInventoryRecord): string {
  const local = isLocalRun(run);
  switch (run.status) {
    case "queued":
      return local ? "Queued, local executor not available yet" : "Queued";
    case "claimed":
      return "Claimed by executor";
    case "creating_workspace":
      return local ? "Creating local worktree" : "Creating cloud workspace";
    case "provisioning_workspace":
      return local ? "Preparing worktree" : "Preparing runtime";
    case "creating_session":
      return "Creating session";
    case "dispatching":
      return "Sending prompt";
    case "dispatched":
      return "Session started";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Status unavailable";
  }
}

function isLocalRun(run: AutomationRunInventoryRecord): boolean {
  return run.targetMode === "local" || run.executionTarget === "local";
}

function automationRunTimestampLabel(run: AutomationRunInventoryRecord): string {
  if (run.triggerKind === "manual") {
    return `Requested ${formatTimestamp(run.createdAt)}`;
  }
  return `Scheduled ${formatTimestamp(run.scheduledFor ?? run.createdAt)}`;
}
