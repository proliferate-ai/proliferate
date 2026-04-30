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
  if (run.status === "cancelled") return AUTOMATION_RUN_COPY.cancelled;
  return run.executionTarget === "cloud"
    ? AUTOMATION_RUN_COPY.cloudQueued
    : AUTOMATION_RUN_COPY.localQueued;
}

export function automationRunTimestampLabel(run: AutomationRunResponse): string {
  if (run.triggerKind === "manual") {
    return `Requested ${formatAutomationTimestamp(run.createdAt)}`;
  }
  return `Scheduled ${formatAutomationTimestamp(run.scheduledFor)}`;
}
