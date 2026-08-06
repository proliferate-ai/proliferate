import type {
  AutomationClientSurface,
  AutomationInventoryGroupView,
  AutomationInventoryItemView,
  AutomationInventoryRecord,
  BuildAutomationInventoryOptions,
} from "./inventory";
import { formatNextRunLabel, normalizeDate } from "./inventory-dates";
import {
  automationTargetAvailability,
  automationTargetLabel,
  AUTOMATION_DESKTOP_REQUIRED_MESSAGE,
} from "./inventory-targets";

export function buildAutomationInventoryItemViews(
  automations: readonly AutomationInventoryRecord[],
  options: BuildAutomationInventoryOptions = {},
): AutomationInventoryItemView[] {
  const now = normalizeDate(options.now);
  const clientSurface = options.clientSurface ?? "desktop";
  return automations.map((automation) =>
    automationInventoryItem(automation, now, clientSurface)
  );
}

export function groupAutomationInventoryItemViews(
  items: readonly AutomationInventoryItemView[],
): AutomationInventoryGroupView[] {
  const active = items.filter((item) => item.enabled);
  const paused = items.filter((item) => !item.enabled);
  const groups: AutomationInventoryGroupView[] = [
    { id: "active", label: "Active", count: active.length, items: active },
    { id: "paused", label: "Paused", count: paused.length, items: paused },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function automationInventoryItem(
  automation: AutomationInventoryRecord,
  now: Date,
  clientSurface: AutomationClientSurface,
): AutomationInventoryItemView {
  const repoLabel = `${automation.gitOwner}/${automation.gitRepoName}`;
  const scopeLabel = automation.ownerScope === "organization" ? "Team" : "Personal";
  const targetLabel = automationTargetLabel(
    automation.targetMode,
    automation.executionTarget,
    automation.targetKind,
  );
  const targetAvailability = automationTargetAvailability(
    automation.targetMode,
    automation.executionTarget,
    automation.targetKind,
  );
  const runNowDisabledReason = clientSurface === "web" && targetAvailability === "desktop_required"
    ? AUTOMATION_DESKTOP_REQUIRED_MESSAGE
    : null;
  const nextRunLabel = automation.enabled
    ? formatNextRunLabel(automation.schedule.nextRunAt, automation.schedule.timezone, now)
    : "Paused";
  const statusLabel = automation.enabled ? "Enabled" : "Paused";
  return {
    id: automation.id,
    title: automation.title,
    repoLabel,
    scheduleLabel: automation.schedule.summary,
    nextRunLabel,
    scopeLabel,
    targetLabel,
    targetAvailability,
    statusKind: "waiting",
    statusLabel,
    enabled: automation.enabled,
    runNowDisabledReason,
    updatedAt: automation.updatedAt ?? null,
    searchText: [
      automation.title,
      repoLabel,
      automation.schedule.summary,
      nextRunLabel,
      scopeLabel,
      targetLabel,
      statusLabel,
    ].join(" "),
  };
}
