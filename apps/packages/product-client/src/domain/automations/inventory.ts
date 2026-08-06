import { buildAutomationCalendarWeekView } from "./inventory-calendar";
import {
  buildAutomationInventoryItemViews,
  groupAutomationInventoryItemViews,
} from "./inventory-list";
import { buildAutomationRunInventoryItemViews } from "./inventory-runs";

export type AutomationSurfaceViewMode = "list" | "calendar";
export type AutomationClientSurface = "desktop" | "web";

export type AutomationInventoryStatusKind =
  | "waiting"
  | "working"
  | "review"
  | "blocked"
  | "done";

export type AutomationTargetAvailability =
  | "managed_cloud"
  | "desktop_required";

export type AutomationTargetMode =
  | "local"
  | "personal_cloud"
  | "shared_cloud"
  | string;

export interface AutomationInventorySchedule {
  rrule?: string | null;
  summary: string;
  nextRunAt: string | null;
  timezone?: string | null;
}

export interface AutomationInventoryRecord {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  title: string;
  schedule: AutomationInventorySchedule;
  ownerScope?: "personal" | "organization" | string | null;
  targetMode?: AutomationTargetMode | null;
  executionTarget?: string | null;
  targetKind?: string | null;
  enabled: boolean;
  updatedAt?: string | null;
}

export interface AutomationInventoryItemView {
  id: string;
  title: string;
  repoLabel: string;
  scheduleLabel: string;
  nextRunLabel: string;
  scopeLabel: string;
  targetLabel: string;
  targetAvailability: AutomationTargetAvailability;
  statusKind: AutomationInventoryStatusKind;
  statusLabel: string;
  enabled: boolean;
  runNowDisabledReason: string | null;
  updatedAt: string | null;
  searchText: string;
}

export interface AutomationInventoryGroupView {
  id: "active" | "paused";
  label: string;
  count: number;
  items: AutomationInventoryItemView[];
}

export interface AutomationCalendarOccurrenceView {
  id: string;
  automationId: string;
  title: string;
  timeLabel: string;
  scopeLabel: string;
  targetLabel: string;
  scheduleLabel: string;
  statusKind: AutomationInventoryStatusKind;
  statusLabel: string;
  overflowCount?: number;
  sortTimeMs?: number;
}

export interface AutomationCalendarDayView {
  id: string;
  date: string;
  weekdayLabel: string;
  dayNumberLabel: string;
  sectionLabel: string;
  isToday: boolean;
  hasOccurrences: boolean;
  occurrences: AutomationCalendarOccurrenceView[];
}

export interface AutomationRunInventoryRecord {
  id: string;
  triggerKind: "scheduled" | "manual" | string;
  scheduledFor: string | null;
  targetMode?: AutomationTargetMode | null;
  executionTarget?: string | null;
  status:
    | "queued"
    | "claimed"
    | "creating_workspace"
    | "provisioning_workspace"
    | "creating_session"
    | "dispatching"
    | "dispatched"
    | "failed"
    | "cancelled"
    | string;
  titleSnapshot?: string | null;
  cloudWorkspaceId?: string | null;
  anyharnessWorkspaceId?: string | null;
  cloudTargetKindSnapshot?: string | null;
  targetKindSnapshot?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunOpenState = "none" | "openable" | "opening" | "desktop_required";

export interface AutomationRunInventoryItemView {
  id: string;
  title: string;
  statusKind: AutomationInventoryStatusKind;
  statusLabel: string;
  timestampLabel: string;
  triggerLabel: string;
  targetLabel: string;
  errorLabel: string | null;
  openState: AutomationRunOpenState;
  openLabel: string;
  openDisabledReason: string | null;
}

export interface BuildAutomationInventoryOptions {
  now?: Date | number;
  clientSurface?: AutomationClientSurface;
}

export interface BuildAutomationCalendarWeekOptions extends BuildAutomationInventoryOptions {
  anchorDate?: Date | number;
  includePaused?: boolean;
}

export interface BuildAutomationRunInventoryOptions {
  pendingCloudWorkspaceId?: string | null;
  clientSurface?: AutomationClientSurface;
}

export { AUTOMATION_DESKTOP_REQUIRED_MESSAGE } from "./inventory-targets";

export function buildAutomationInventoryItems(
  automations: readonly AutomationInventoryRecord[],
  options: BuildAutomationInventoryOptions = {},
): AutomationInventoryItemView[] {
  return buildAutomationInventoryItemViews(automations, options);
}

export function groupAutomationInventoryItems(
  items: readonly AutomationInventoryItemView[],
): AutomationInventoryGroupView[] {
  return groupAutomationInventoryItemViews(items);
}

export function buildAutomationCalendarWeek(
  automations: readonly AutomationInventoryRecord[],
  options: BuildAutomationCalendarWeekOptions = {},
): AutomationCalendarDayView[] {
  return buildAutomationCalendarWeekView(automations, options);
}

export function buildAutomationRunInventoryItems(
  runs: readonly AutomationRunInventoryRecord[],
  options: BuildAutomationRunInventoryOptions = {},
): AutomationRunInventoryItemView[] {
  return buildAutomationRunInventoryItemViews(runs, options);
}
