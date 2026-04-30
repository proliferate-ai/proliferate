import { AUTOMATION_RUN_COPY } from "@/config/automations";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "@/lib/integrations/cloud/client";
import { formatAutomationTimestamp } from "./schedule";

export interface AutomationRowViewModel {
  id: string;
  title: string;
  repoLabel: string;
  statusLabel: string;
  scheduleLabel: string;
  nextRunLabel: string;
  executionLabel: string;
}

const MAX_STATUS_MESSAGE_LENGTH = 140;

function compactStatusMessage(message: string): string {
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= MAX_STATUS_MESSAGE_LENGTH) {
    return firstLine;
  }
  return `${firstLine.slice(0, MAX_STATUS_MESSAGE_LENGTH - 3)}...`;
}

export function buildAutomationRowViewModel(
  automation: AutomationResponse,
): AutomationRowViewModel {
  const paused = !automation.enabled;
  return {
    id: automation.id,
    title: automation.title,
    repoLabel: `${automation.gitOwner}/${automation.gitRepoName}`,
    statusLabel: paused ? "Paused" : "Enabled",
    scheduleLabel: automation.schedule.summary,
    nextRunLabel: paused
      ? "Paused"
      : formatAutomationTimestamp(
        automation.schedule.nextRunAt,
        automation.schedule.timezone,
      ),
    executionLabel: automation.executionTarget === "cloud" ? "Cloud" : "Local",
  };
}

export function automationRunStatusLabel(run: AutomationRunResponse): string {
  switch (run.status) {
    case "queued":
      return run.executionTarget === "local"
        ? AUTOMATION_RUN_COPY.localQueued
        : AUTOMATION_RUN_COPY.queued;
    case "claimed":
      return AUTOMATION_RUN_COPY.claimed;
    case "creating_workspace":
      return run.executionTarget === "local"
        ? AUTOMATION_RUN_COPY.creatingLocalWorkspace
        : AUTOMATION_RUN_COPY.creatingWorkspace;
    case "provisioning_workspace":
      return run.executionTarget === "local"
        ? AUTOMATION_RUN_COPY.provisioningLocalWorkspace
        : AUTOMATION_RUN_COPY.provisioningWorkspace;
    case "creating_session":
      return AUTOMATION_RUN_COPY.creatingSession;
    case "dispatching":
      return AUTOMATION_RUN_COPY.dispatching;
    case "dispatched":
      return AUTOMATION_RUN_COPY.dispatched;
    case "failed":
      return run.lastErrorMessage
        ? compactStatusMessage(run.lastErrorMessage)
        : AUTOMATION_RUN_COPY.failed;
    case "cancelled":
      return AUTOMATION_RUN_COPY.cancelled;
    default:
      return `Unknown status: ${run.status}`;
  }
}

export function automationRunTimestampLabel(run: AutomationRunResponse): string {
  if (run.triggerKind === "manual") {
    return `Requested ${formatAutomationTimestamp(run.createdAt)}`;
  }
  return `Scheduled ${formatAutomationTimestamp(run.scheduledFor)}`;
}
