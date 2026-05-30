import type {
  CloudWorkspaceDetail,
  CloudSessionProjection,
  CloudWorkspaceLastSessionSummary,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

export type CloudWorkSource = "chats" | "slack" | "automation" | "api";

export type CloudWorkOwnerFilter = "all" | "private" | "shared" | "claimed" | "unclaimed";

export type CloudWorkStatusFilter = "active" | "running" | "blocked" | "ready" | "archived" | "error";

export type CloudWorkSort = "recent" | "created" | "name" | "repo" | "status";

export type CloudWorkOwnerKind = "private" | "claimed" | "unclaimed" | "archived";

export type RecentWorkStatusIndicatorKind =
  | "needs_input"
  | "running"
  | "review_ready"
  | "ready"
  | "error"
  | "idle";

export type RecentWorkStatusIndicatorTone =
  | "attention"
  | "progress"
  | "success"
  | "danger"
  | "muted";

export interface RecentWorkStatusIndicatorView {
  kind: RecentWorkStatusIndicatorKind;
  tone: RecentWorkStatusIndicatorTone;
  label: string;
  hollow: boolean;
  live: boolean;
}

export interface CloudWorkFilters {
  ownership?: CloudWorkOwnerFilter;
  sources?: ReadonlySet<CloudWorkSource>;
  semanticSources?: ReadonlySet<RecentWorkSourceKind>;
  runtimeLocations?: ReadonlySet<RecentWorkRuntimeLocation>;
  statuses?: ReadonlySet<CloudWorkStatusFilter>;
  repoLabels?: ReadonlySet<string>;
  sort?: CloudWorkSort;
  needsAttention?: boolean;
  search?: string | null;
}

export interface CloudWorkOpenTarget {
  workspaceId: string;
  sessionId: string | null;
}

export interface CloudWorkItemView {
  id: string;
  title: string;
  subtitle: string;
  sourceAgentKind: string | null;
  source: CloudWorkSource;
  sourceLabel: string;
  sourceKind: RecentWorkSourceKind;
  semanticSourceLabel: string;
  runtimeLocation: RecentWorkRuntimeLocation;
  runtimeLocationLabel: string;
  cloudAccessState: RecentWorkCloudAccessState;
  cloudAccessLabel: string;
  commandability: RecentWorkCommandability;
  commandabilityLabel: string;
  ownerKind: CloudWorkOwnerKind;
  ownerLabel: string;
  status: CloudWorkStatusFilter;
  statusLabel: string;
  statusIndicator: RecentWorkStatusIndicatorView;
  activityPreview: string | null;
  branchLabel: string;
  repoLabel: string;
  runtimeLabel: string;
  lastActivityLabel: string;
  lastActivityMs: number;
  createdAtMs: number;
  unclaimed: boolean;
  defaultSessionId: string | null;
  sessionCount: number;
  currentSessionLabel: string;
  searchText: string;
  openTarget: CloudWorkOpenTarget;
}

export interface CloudWorkGroupView {
  id: CloudWorkSource;
  label: string;
  items: CloudWorkItemView[];
}

export type CloudWorkRecencyGroupId = "today" | "this_week" | "last_week" | "earlier";

export interface CloudWorkRecencyGroupView {
  id: CloudWorkRecencyGroupId;
  label: string;
  items: CloudWorkItemView[];
}

export type RecentWorkRowKind = "workspace" | "session" | "pending-session";

export type RecentWorkSourceKind =
  | "desktop_exposed"
  | "cloud_sandbox"
  | "web"
  | "mobile"
  | "personal_automation"
  | "team_automation"
  | "slack"
  | "api"
  | "unknown";

export type RecentWorkRuntimeLocation =
  | "local_desktop"
  | "cloud_sandbox"
  | "ssh_remote"
  | "offline"
  | "unknown";

export type RecentWorkCloudAccessState = "enabled" | "not_enabled" | "unknown";

export type RecentWorkCommandability =
  | "commandable"
  | "not_commandable"
  | "stale"
  | "unknown";

export type RecentWorkOwnership = "mine" | "team" | "unclaimed" | "unknown";

export type RecentWorkState =
  | "idle"
  | "running"
  | "review"
  | "blocked"
  | "done"
  | "pending"
  | "unknown";

export type RecentWorkOpenTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "session"; workspaceId: string; sessionId: string }
  | { kind: "pending-session"; workspaceId: string; pendingSessionKey: string };

export interface RecentWorkItemView {
  id: string;
  rowKind: RecentWorkRowKind;
  workspaceId: string;
  sessionId: string | null;
  pendingSessionKey?: string;
  openTarget: RecentWorkOpenTarget;
  title: string;
  subtitle?: string;
  repoLabel?: string;
  branchLabel?: string;
  sourceKind: RecentWorkSourceKind;
  sourceLabel: string;
  runtimeLocation: RecentWorkRuntimeLocation;
  runtimeLabel: string;
  cloudAccessState: RecentWorkCloudAccessState;
  cloudAccessLabel: string;
  commandability: RecentWorkCommandability;
  commandabilityLabel: string;
  ownership: RecentWorkOwnership;
  ownershipLabel: string;
  lastActivityAt: string | null;
  lastActivityMs: number;
  lastActivityLabel: string;
  state: RecentWorkState;
  stateLabel: string;
  statusIndicator: RecentWorkStatusIndicatorView;
  activityPreview: string | null;
  searchText: string;
}

export type CloudCommandReadinessState =
  | "ready"
  | "claim_required"
  | "workspace_not_ready"
  | "runtime_offline"
  | "runtime_unavailable"
  | "commandability_unknown";

export interface CloudCommandReadinessView {
  state: CloudCommandReadinessState;
  commandable: boolean;
  message: string | null;
}

export interface BuildCloudWorkInventoryOptions {
  nowMs?: number;
  filters?: CloudWorkFilters;
}

export interface BuildRecentWorkItemsOptions {
  activeWorkspaceId?: string | null;
  activeWorkspaceSessions?: readonly CloudSessionProjection[];
  nowMs?: number;
  limit?: number;
}

export const CLOUD_WORK_SOURCE_ORDER: readonly CloudWorkSource[] = [
  "chats",
  "slack",
  "automation",
  "api",
];

const SOURCE_LABELS: Record<CloudWorkSource, string> = {
  chats: "Chats",
  slack: "Slack",
  automation: "Automations",
  api: "API",
};

const STATUS_LABELS: Record<CloudWorkStatusFilter, string> = {
  active: "Active",
  running: "Running",
  blocked: "Blocked",
  ready: "Ready",
  archived: "Archived",
  error: "Error",
};

export function buildCloudWorkInventory(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildCloudWorkInventoryOptions = {},
): CloudWorkGroupView[] {
  const nowMs = options.nowMs ?? Date.now();
  const items = filterCloudWorkItems(
    dedupeCloudWorkspaces(workspaces).map((workspace) => cloudWorkItemForWorkspace(workspace, { nowMs })),
    options.filters,
  ).sort(compareCloudWorkItemsForSort(options.filters?.sort));
  return CLOUD_WORK_SOURCE_ORDER.flatMap((source) => {
    const sourceItems = items.filter((item) => item.source === source);
    if (sourceItems.length === 0) {
      return [];
    }
    return [{
      id: source,
      label: SOURCE_LABELS[source],
      items: sourceItems,
    }];
  });
}

export function buildCloudWorkRecencyInventory(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildCloudWorkInventoryOptions = {},
): CloudWorkRecencyGroupView[] {
  const nowMs = options.nowMs ?? Date.now();
  const items = filterCloudWorkItems(
    dedupeCloudWorkspaces(workspaces).map((workspace) => cloudWorkItemForWorkspace(workspace, { nowMs })),
    options.filters,
  ).sort(compareCloudWorkItemsForSort(options.filters?.sort));
  return groupCloudWorkItemsByRecency(items, { nowMs });
}

export function groupCloudWorkItemsByRecency(
  items: readonly CloudWorkItemView[],
  options: { nowMs?: number } = {},
): CloudWorkRecencyGroupView[] {
  const nowMs = options.nowMs ?? Date.now();
  const buckets: Record<CloudWorkRecencyGroupId, CloudWorkItemView[]> = {
    today: [],
    this_week: [],
    last_week: [],
    earlier: [],
  };
  for (const item of items) {
    buckets[recencyGroupForTime(item.lastActivityMs, nowMs)].push(item);
  }
  return RECENCY_GROUPS.flatMap((group) => {
    const groupItems = buckets[group.id];
    return groupItems.length > 0
      ? [{ id: group.id, label: group.label, items: groupItems }]
      : [];
  });
}

export function buildRecentWorkItems(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildRecentWorkItemsOptions = {},
): RecentWorkItemView[] {
  const nowMs = options.nowMs ?? Date.now();
  const activeWorkspaceId = options.activeWorkspaceId ?? null;
  const workspaceRows = dedupeCloudWorkspaces(workspaces);
  const workspaceById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]));
  const rows = new Map<string, RecentWorkItemView>();
  const workspacesWithSessionRows = new Set<string>();

  for (const workspace of workspaceRows) {
    const summary = workspace.lastSessionSummary;
    if (!summary?.sessionId) {
      continue;
    }
    rows.set(
      recentSessionRowId(workspace.id, summary.sessionId),
      recentWorkItemForSessionSummary(workspace, summary, { nowMs }),
    );
    workspacesWithSessionRows.add(workspace.id);
  }

  for (const session of options.activeWorkspaceSessions ?? []) {
    const workspaceId = session.cloudWorkspaceId ?? "";
    const workspace = workspaceById.get(workspaceId);
    if (!workspace) {
      continue;
    }
    rows.set(
      recentSessionRowId(workspace.id, session.sessionId),
      recentWorkItemForSessionProjection(workspace, session, { nowMs }),
    );
    workspacesWithSessionRows.add(workspace.id);
  }

  for (const workspace of workspaceRows) {
    if (workspacesWithSessionRows.has(workspace.id) && workspace.id !== activeWorkspaceId) {
      continue;
    }
    rows.set(recentWorkspaceRowId(workspace.id), recentWorkItemForWorkspace(workspace, { nowMs }));
  }

  const sorted = [...rows.values()].sort(compareRecentWorkItems);
  return typeof options.limit === "number" ? sorted.slice(0, options.limit) : sorted;
}

export function dedupeCloudWorkspaces(
  workspaces: readonly CloudWorkspaceSummary[],
): CloudWorkspaceSummary[] {
  const byId = new Map<string, CloudWorkspaceSummary>();
  for (const workspace of workspaces) {
    const existing = byId.get(workspace.id);
    if (existing) {
      byId.set(workspace.id, mergeCloudWorkspaceSummary(existing, workspace));
    } else {
      byId.set(workspace.id, workspace);
    }
  }
  return [...byId.values()];
}

export function cloudWorkItemForWorkspace(
  workspace: CloudWorkspaceSummary,
  options: { nowMs?: number } = {},
): CloudWorkItemView {
  const repoLabel = `${workspace.repo.owner}/${workspace.repo.name}`;
  const branchLabel = workspace.repo.branch ?? workspace.repo.baseBranch ?? "main";
  const title = workspace.displayName ?? workspace.lastSessionSummary?.title ?? workspace.repo.name;
  const sessionTitle = workspace.lastSessionSummary?.title ?? null;
  const sourceAgentKind = cloudWorkSourceAgentKind(workspace);
  const source = cloudWorkSourceForWorkspace(workspace);
  const sourceKind = recentWorkSourceForWorkspace(workspace);
  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  const cloudAccessState = recentWorkCloudAccessState(workspace);
  const commandability = recentWorkCommandability(workspace);
  const status = cloudWorkStatusForWorkspace(workspace);
  const statusIndicator = recentWorkStatusIndicatorForWorkspace(workspace);
  const ownerKind = cloudWorkOwnerKind(workspace);
  const lastActivityMs = cloudWorkLastActivityMs(workspace);
  const createdAtMs = parseTime(workspace.createdAt) || lastActivityMs;
  const defaultSessionId = selectDefaultCloudWorkSession(workspace);
  const activityPreview = cloudWorkActivityPreview(workspace);
  return {
    id: workspace.id,
    title,
    subtitle: [repoLabel, branchLabel].filter(Boolean).join(" - "),
    sourceAgentKind,
    source,
    sourceLabel: SOURCE_LABELS[source],
    sourceKind,
    semanticSourceLabel: recentWorkSourceLabel(sourceKind),
    runtimeLocation,
    runtimeLocationLabel: recentWorkRuntimeLabel(runtimeLocation),
    cloudAccessState,
    cloudAccessLabel: recentWorkCloudAccessLabel(cloudAccessState),
    commandability,
    commandabilityLabel: recentWorkCommandabilityLabel(commandability),
    ownerKind,
    ownerLabel: cloudWorkOwnerLabel(workspace),
    status,
    statusLabel: STATUS_LABELS[status],
    statusIndicator,
    activityPreview,
    branchLabel,
    repoLabel,
    runtimeLabel: cloudWorkRuntimeLabel(workspace),
    lastActivityLabel: relativeTimeLabel(lastActivityMs, options.nowMs ?? Date.now()),
    lastActivityMs,
    createdAtMs,
    unclaimed: workspace.visibility === "shared_unclaimed",
    defaultSessionId,
    sessionCount: workspace.lastSessionSummary ? 1 : 0,
    currentSessionLabel: defaultSessionId ? "latest session" : "no sessions",
    searchText: [
      title,
      sessionTitle,
      repoLabel,
      branchLabel,
      sourceAgentKind,
      SOURCE_LABELS[source],
      cloudWorkOwnerLabel(workspace),
      STATUS_LABELS[status],
      activityPreview,
    ].filter(Boolean).join(" "),
    openTarget: {
      workspaceId: workspace.id,
      sessionId: defaultSessionId,
    },
  };
}

export function cloudWorkActivityPreview(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "actionBlockReason"
    | "lastError"
    | "lastSessionSummary"
    | "statusDetail"
  >,
): string | null {
  return compactPreviewText(workspace.lastSessionSummary?.preview)
    ?? compactPreviewText(workspace.lastSessionSummary?.title)
    ?? compactPreviewText(workspace.lastError)
    ?? compactPreviewText(workspace.actionBlockReason)
    ?? commandStatusDetailMessage(workspace.statusDetail);
}

export function cloudWorkSourceAgentKind(
  workspace: Pick<CloudWorkspaceSummary, "lastSessionSummary">,
): string | null {
  const sourceAgentKind = workspace.lastSessionSummary?.sourceAgentKind?.trim();
  return sourceAgentKind || null;
}

export function cloudWorkSourceForWorkspace(
  workspace: Pick<CloudWorkspaceSummary, "origin" | "creatorContext">,
): CloudWorkSource {
  if (workspace.creatorContext?.kind === "automation") {
    return "automation";
  }
  if (workspace.origin?.entrypoint === "slack") {
    return "slack";
  }
  if (workspace.origin?.entrypoint === "api" || workspace.origin?.entrypoint === "cowork") {
    return "api";
  }
  return "chats";
}

export function recentWorkSourceForWorkspace(
  workspace: Pick<
    CloudWorkspaceSummary,
    "origin" | "creatorContext" | "sandboxType" | "visibility" | "claimSourceKind"
  >,
): RecentWorkSourceKind {
  if (workspace.claimSourceKind === "slack" || workspace.origin?.entrypoint === "slack") {
    return "slack";
  }
  if (workspace.claimSourceKind === "api" || workspace.origin?.entrypoint === "api" || workspace.origin?.kind === "api") {
    return "api";
  }
  if (workspace.creatorContext?.kind === "automation" || workspace.claimSourceKind === "automation") {
    return workspace.visibility === "shared_unclaimed" || workspace.visibility === "claimed" || workspace.sandboxType === "managed_shared"
      ? "team_automation"
      : "personal_automation";
  }
  if (workspace.origin?.entrypoint === "mobile") {
    return "mobile";
  }
  if (workspace.sandboxType === "local" || workspace.origin?.entrypoint === "desktop") {
    return "desktop_exposed";
  }
  if (workspace.origin?.entrypoint === "web" || workspace.origin?.entrypoint === "cowork") {
    return "web";
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    return "cloud_sandbox";
  }
  return "unknown";
}

export function recentWorkRuntimeLocationForWorkspace(
  workspace: Pick<CloudWorkspaceSummary, "sandboxType" | "runtime" | "exposureState">,
): RecentWorkRuntimeLocation {
  if (workspace.exposureState === "stale" || workspace.exposureState === "paused" || workspace.exposureState === "revoked") {
    return "offline";
  }
  if (workspace.runtime?.status === "disabled" || workspace.runtime?.status === "error") {
    return "offline";
  }
  switch (workspace.sandboxType) {
    case "local":
      return "local_desktop";
    case "managed_personal":
    case "managed_shared":
      return "cloud_sandbox";
    case "ssh":
    case "self_hosted":
      return "ssh_remote";
    case undefined:
      return "unknown";
  }
}

export function recentWorkCloudAccessState(
  workspace: Pick<CloudWorkspaceSummary, "exposure" | "exposureState" | "sandboxType">,
): RecentWorkCloudAccessState {
  if (workspace.exposure) {
    return "enabled";
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    return "enabled";
  }
  switch (workspace.exposureState) {
    case "live":
    case "tracked":
    case "paused":
    case "stale":
    case "revoked":
      return "enabled";
    case "untracked":
      return "not_enabled";
    case undefined:
      return "unknown";
  }
}

export function recentWorkCommandability(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "exposure"
    | "exposureState"
    | "runtime"
    | "sandboxType"
    | "targetId"
    | "visibility"
    | "workspaceStatus"
    | "status"
  >,
): RecentWorkCommandability {
  if (workspace.visibility === "shared_unclaimed") {
    return "not_commandable";
  }
  if (
    workspace.workspaceStatus === "error" ||
    workspace.status === "error" ||
    workspace.runtime?.status === "error" ||
    workspace.runtime?.status === "disabled"
  ) {
    return "not_commandable";
  }
  if (
    workspace.exposureState === "stale" ||
    workspace.exposureState === "paused" ||
    workspace.exposureState === "revoked"
  ) {
    return "stale";
  }
  if (
    workspace.exposure?.commandable === true &&
    workspace.exposure.status === "active" &&
    (workspace.exposureState === "live" || workspace.exposureState === "tracked")
  ) {
    return "commandable";
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    return workspace.targetId
      && workspace.runtime?.status === "running"
      && (workspace.workspaceStatus === "ready" || workspace.status === "ready")
      ? "commandable"
      : "not_commandable";
  }
  if (
    workspace.sandboxType === "local" ||
    workspace.sandboxType === "ssh" ||
    workspace.sandboxType === "self_hosted"
  ) {
    return "not_commandable";
  }
  return "unknown";
}

export function cloudCommandReadiness(
  workspace: CloudWorkspaceCommandFacts,
): CloudCommandReadinessView {
  const statusDetail = commandStatusDetailMessage(workspace.statusDetail);
  if (workspace.visibility === "shared_unclaimed") {
    return {
      state: "claim_required",
      commandable: false,
      message: "Claim this shared workspace before sending prompts or changing session settings.",
    };
  }
  if (
    workspace.workspaceStatus === "error" ||
    workspace.status === "error" ||
    workspace.runtime?.status === "error" ||
    workspace.runtime?.status === "disabled"
  ) {
    return {
      state: "runtime_unavailable",
      commandable: false,
      message: workspace.lastError
        ?? statusDetail
        ?? "This workspace cannot accept cloud commands right now.",
    };
  }
  if (workspace.workspaceStatus !== "ready" && workspace.status !== "ready") {
    return {
      state: "workspace_not_ready",
      commandable: false,
      message: statusDetail ?? "Workspace runtime is not ready yet. Try again when setup finishes.",
    };
  }
  const activeExposureCommandable =
    workspace.exposure?.commandable === true &&
    workspace.exposure.status === "active" &&
    (workspace.exposureState === "live" || workspace.exposureState === "tracked");
  const managedWorkspace =
    workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared";
  const routedManagedWorkspace =
    managedWorkspace && Boolean(workspace.targetId && workspace.anyharnessWorkspaceId);
  if (activeExposureCommandable && (routedManagedWorkspace || !managedWorkspace)) {
    return {
      state: "ready",
      commandable: true,
      message: null,
    };
  }
  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  if (runtimeLocation === "offline" || recentWorkCommandability(workspace) === "stale") {
    return {
      state: "runtime_offline",
      commandable: false,
      message: "This is the same workspace, but its Desktop/remote runtime is offline. Open Desktop and enable remote access before sending commands from Web or Mobile.",
    };
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    if (workspace.runtime?.status !== "running") {
      return {
        state: "workspace_not_ready",
        commandable: false,
        message: "Cloud runtime is still starting. Try again when it is running.",
      };
    }
    if (!workspace.targetId || !workspace.anyharnessWorkspaceId) {
      return {
        state: "runtime_unavailable",
        commandable: false,
        message: "Workspace is ready but missing runtime command routing.",
      };
    }
    return {
      state: "ready",
      commandable: true,
      message: null,
    };
  }
  if (recentWorkCommandability(workspace) === "unknown") {
    return {
      state: "commandability_unknown",
      commandable: false,
      message: "This workspace does not yet report a commandable runtime. Refresh after the target comes online.",
    };
  }
  return {
    state: "runtime_unavailable",
    commandable: false,
    message: "This workspace cannot accept cloud commands right now.",
  };
}

export function recentWorkStatusIndicatorForWorkspace(
  workspace: CloudWorkspaceStatusIndicatorFacts,
): RecentWorkStatusIndicatorView {
  return recentWorkStatusIndicatorForSession(workspace, workspace.lastSessionSummary?.status);
}

export function recentWorkStatusIndicatorForSession(
  workspace: CloudWorkspaceStatusIndicatorFacts,
  sessionStatus: string | null | undefined,
): RecentWorkStatusIndicatorView {
  if (workspaceHasErrorStatus(workspace)) {
    return STATUS_INDICATORS.error;
  }
  if (workspaceNeedsInput(workspace)) {
    return STATUS_INDICATORS.needs_input;
  }
  if (sessionIsReviewReady(sessionStatus)) {
    return STATUS_INDICATORS.review_ready;
  }
  if (sessionIsRunning(sessionStatus) || workspaceIsInProgress(workspace)) {
    return STATUS_INDICATORS.running;
  }
  if (workspaceIsCommandReady(workspace)) {
    return STATUS_INDICATORS.ready;
  }
  return STATUS_INDICATORS.idle;
}

function commandStatusDetailMessage(statusDetail: string | null | undefined): string | null {
  const trimmed = statusDetail?.trim();
  if (!trimmed || /^ready$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function compactPreviewText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/gu, " ").trim() ?? "";
  return text || null;
}

type CloudWorkspaceCommandFacts = Pick<
  CloudWorkspaceSummary,
    | "exposure"
    | "exposureState"
    | "runtime"
    | "sandboxType"
    | "targetId"
    | "visibility"
    | "workspaceStatus"
    | "status"
  > &
  Partial<Pick<CloudWorkspaceSummary, "lastError" | "statusDetail">> &
  Partial<Pick<CloudWorkspaceDetail, "anyharnessWorkspaceId">>;

type CloudWorkspaceStatusIndicatorFacts = Pick<
  CloudWorkspaceSummary,
  | "actionBlockKind"
  | "actionBlockReason"
  | "billing"
  | "exposure"
  | "exposureState"
  | "lastError"
  | "lastSessionSummary"
  | "runtime"
  | "sandboxType"
  | "status"
  | "targetId"
  | "visibility"
  | "workspaceStatus"
> &
  Partial<Pick<CloudWorkspaceDetail, "anyharnessWorkspaceId">>;

export function cloudWorkStatusForWorkspace(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "actionBlockKind"
    | "actionBlockReason"
    | "lastError"
    | "runtime"
    | "visibility"
    | "workspaceStatus"
    | "lastSessionSummary"
  >,
): CloudWorkStatusFilter {
  if (workspace.visibility === "archived" || workspace.workspaceStatus === "archived") {
    return "archived";
  }
  if (workspace.lastError || workspace.workspaceStatus === "error" || workspace.runtime?.status === "error") {
    return "error";
  }
  if (workspaceHasPendingSessionInput(workspace)) {
    return "blocked";
  }
  if (workspace.actionBlockKind || workspace.actionBlockReason) {
    return "blocked";
  }
  if (workspace.lastSessionSummary?.status === "running") {
    return "running";
  }
  if (
    workspace.workspaceStatus === "pending"
    || workspace.workspaceStatus === "materializing"
    || workspace.workspaceStatus === "needs_rematerialization"
    || workspace.runtime?.status === "pending"
    || workspace.runtime?.status === "provisioning"
  ) {
    return "active";
  }
  return "ready";
}

const STATUS_INDICATORS: Record<RecentWorkStatusIndicatorKind, RecentWorkStatusIndicatorView> = {
  needs_input: {
    kind: "needs_input",
    tone: "attention",
    label: "Needs input",
    hollow: false,
    live: false,
  },
  running: {
    kind: "running",
    tone: "progress",
    label: "In progress",
    hollow: false,
    live: true,
  },
  review_ready: {
    kind: "review_ready",
    tone: "success",
    label: "Ready for review",
    hollow: false,
    live: false,
  },
  ready: {
    kind: "ready",
    tone: "success",
    label: "Ready",
    hollow: false,
    live: false,
  },
  error: {
    kind: "error",
    tone: "danger",
    label: "Error",
    hollow: false,
    live: false,
  },
  idle: {
    kind: "idle",
    tone: "muted",
    label: "Idle",
    hollow: true,
    live: false,
  },
};

function workspaceHasErrorStatus(
  workspace: Pick<CloudWorkspaceSummary, "lastError" | "runtime" | "status" | "workspaceStatus">,
): boolean {
  return Boolean(workspace.lastError)
    || workspace.workspaceStatus === "error"
    || workspace.status === "error"
    || workspace.runtime?.status === "error"
    || workspace.runtime?.status === "disabled";
}

function workspaceNeedsInput(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "actionBlockKind"
    | "actionBlockReason"
    | "billing"
    | "lastSessionSummary"
    | "visibility"
  >,
): boolean {
  return workspace.visibility === "shared_unclaimed"
    || workspaceHasPendingSessionInput(workspace)
    || Boolean(workspace.actionBlockKind || workspace.actionBlockReason)
    || workspace.billing?.blockStatus === "blocked"
    || workspace.billing?.startBlocked === true
    || workspace.billing?.activeSpendHold === true;
}

function workspaceIsInProgress(
  workspace: Pick<CloudWorkspaceSummary, "runtime" | "status" | "workspaceStatus">,
): boolean {
  return workspace.workspaceStatus === "pending"
    || workspace.workspaceStatus === "materializing"
    || workspace.workspaceStatus === "needs_rematerialization"
    || workspace.status === "pending"
    || workspace.status === "materializing"
    || workspace.status === "needs_rematerialization"
    || workspace.runtime?.status === "pending"
    || workspace.runtime?.status === "provisioning";
}

function workspaceIsCommandReady(workspace: CloudWorkspaceStatusIndicatorFacts): boolean {
  return recentWorkCommandability(workspace) === "commandable";
}

function sessionIsRunning(status: string | null | undefined): boolean {
  const normalized = normalizedStatusToken(status);
  return normalized === "running" || normalized === "queued";
}

function sessionIsReviewReady(status: string | null | undefined): boolean {
  const normalized = normalizedStatusToken(status);
  return normalized === "review" || normalized === "ready_for_review";
}

function normalizedStatusToken(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
}

function workspaceHasPendingSessionInput(
  workspace: Pick<CloudWorkspaceSummary, "lastSessionSummary">,
): boolean {
  const summary = workspace.lastSessionSummary;
  if (!summary) {
    return false;
  }
  const phase = summary.phase?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  return (summary.pendingInteractionCount ?? 0) > 0
    || phase === "awaiting_interaction";
}

export function selectDefaultCloudWorkSession(
  workspace: Pick<CloudWorkspaceSummary, "lastSessionSummary">,
): string | null {
  return workspace.lastSessionSummary?.sessionId ?? null;
}

export function compareCloudWorkItems(left: CloudWorkItemView, right: CloudWorkItemView): number {
  const recencyDelta = right.lastActivityMs - left.lastActivityMs;
  if (recencyDelta !== 0) {
    return recencyDelta;
  }
  const statusDelta = statusRank(left.status) - statusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return left.title.localeCompare(right.title);
}

export function compareCloudWorkItemsForSort(sort: CloudWorkSort = "recent") {
  return (left: CloudWorkItemView, right: CloudWorkItemView): number => {
    switch (sort) {
      case "created":
        return right.createdAtMs - left.createdAtMs
          || compareCloudWorkItems(left, right);
      case "name":
        return left.title.localeCompare(right.title)
          || compareCloudWorkItems(left, right);
      case "repo":
        return left.repoLabel.localeCompare(right.repoLabel)
          || left.title.localeCompare(right.title)
          || compareCloudWorkItems(left, right);
      case "status":
        return statusRank(left.status) - statusRank(right.status)
          || compareCloudWorkItems(left, right);
      case "recent":
      default:
        return compareCloudWorkItems(left, right);
    }
  };
}

export function filterCloudWorkItems(
  items: readonly CloudWorkItemView[],
  filters?: CloudWorkFilters,
): CloudWorkItemView[] {
  if (!filters) {
    return [...items];
  }
  const query = filters.search?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (filters.ownership && filters.ownership !== "all" && !matchesOwnerFilter(item, filters.ownership)) {
      return false;
    }
    if (filters.sources?.size && !filters.sources.has(item.source)) {
      return false;
    }
    if (filters.semanticSources?.size && !filters.semanticSources.has(item.sourceKind)) {
      return false;
    }
    if (filters.runtimeLocations?.size && !filters.runtimeLocations.has(item.runtimeLocation)) {
      return false;
    }
    if (filters.statuses?.size && !filters.statuses.has(item.status)) {
      return false;
    }
    if (filters.repoLabels?.size && !filters.repoLabels.has(item.repoLabel)) {
      return false;
    }
    if (filters.needsAttention && item.status !== "blocked" && !item.unclaimed) {
      return false;
    }
    if (query && !matchesSearch(item, query)) {
      return false;
    }
    return true;
  });
}

const RECENCY_GROUPS = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "earlier", label: "Earlier" },
] as const satisfies readonly { id: CloudWorkRecencyGroupId; label: string }[];

function recencyGroupForTime(timeMs: number, nowMs: number): CloudWorkRecencyGroupId {
  const dayMs = 24 * 60 * 60 * 1000;
  const ageMs = Math.max(0, nowMs - timeMs);
  if (ageMs < dayMs) {
    return "today";
  }
  if (ageMs < 7 * dayMs) {
    return "this_week";
  }
  if (ageMs < 14 * dayMs) {
    return "last_week";
  }
  return "earlier";
}

function matchesOwnerFilter(item: CloudWorkItemView, filter: CloudWorkOwnerFilter): boolean {
  switch (filter) {
    case "private":
      return item.ownerKind === "private";
    case "shared":
      return item.ownerKind === "claimed" || item.ownerKind === "unclaimed";
    case "claimed":
      return item.ownerKind === "claimed";
    case "unclaimed":
      return item.ownerKind === "unclaimed";
    case "all":
      return true;
  }
}

function matchesSearch(item: CloudWorkItemView, query: string): boolean {
  return item.searchText.toLowerCase().includes(query)
    || item.subtitle.toLowerCase().includes(query);
}

function recentWorkItemForWorkspace(
  workspace: CloudWorkspaceSummary,
  options: { nowMs: number },
): RecentWorkItemView {
  const base = recentWorkBase(workspace, { nowMs: options.nowMs, rowActivityAt: cloudWorkLastActivityIso(workspace) });
  const state = workspaceState(workspace);
  return {
    ...base,
    id: recentWorkspaceRowId(workspace.id),
    rowKind: "workspace",
    workspaceId: workspace.id,
    sessionId: null,
    openTarget: { kind: "workspace", workspaceId: workspace.id },
    title: workspace.displayName ?? workspace.repo.name,
    subtitle: "Workspace",
    state,
    stateLabel: recentWorkStateLabel(state),
    statusIndicator: recentWorkStatusIndicatorForWorkspace(workspace),
    activityPreview: cloudWorkActivityPreview(workspace),
    searchText: recentSearchText(base, [workspace.displayName, workspace.repo.name, "workspace"]),
  };
}

function recentWorkItemForSessionSummary(
  workspace: CloudWorkspaceSummary,
  summary: CloudWorkspaceLastSessionSummary,
  options: { nowMs: number },
): RecentWorkItemView {
  const base = recentWorkBase(workspace, { nowMs: options.nowMs, rowActivityAt: summary.lastEventAt ?? cloudWorkLastActivityIso(workspace) });
  const state = sessionState(summary.status, workspace);
  const activityPreview = compactPreviewText(summary.preview);
  return {
    ...base,
    id: recentSessionRowId(workspace.id, summary.sessionId),
    rowKind: "session",
    workspaceId: workspace.id,
    sessionId: summary.sessionId,
    openTarget: { kind: "session", workspaceId: workspace.id, sessionId: summary.sessionId },
    title: summary.title ?? summary.preview ?? workspace.displayName ?? workspace.repo.name,
    subtitle: `${workspace.displayName ?? workspace.repo.name} session`,
    state,
    stateLabel: recentWorkStateLabel(state),
    statusIndicator: recentWorkStatusIndicatorForSession(workspace, summary.status),
    activityPreview,
    searchText: recentSearchText(base, [summary.title, activityPreview, workspace.displayName, workspace.repo.name, "session"]),
  };
}

function recentWorkItemForSessionProjection(
  workspace: CloudWorkspaceSummary,
  session: CloudSessionProjection,
  options: { nowMs: number },
): RecentWorkItemView {
  const base = recentWorkBase(workspace, { nowMs: options.nowMs, rowActivityAt: session.lastEventAt ?? session.startedAt ?? cloudWorkLastActivityIso(workspace) });
  const state = sessionState(session.status, workspace);
  return {
    ...base,
    id: recentSessionRowId(workspace.id, session.sessionId),
    rowKind: "session",
    workspaceId: workspace.id,
    sessionId: session.sessionId,
    openTarget: { kind: "session", workspaceId: workspace.id, sessionId: session.sessionId },
    title: session.title ?? workspace.displayName ?? workspace.repo.name,
    subtitle: `${workspace.displayName ?? workspace.repo.name} session`,
    state,
    stateLabel: recentWorkStateLabel(state),
    statusIndicator: recentWorkStatusIndicatorForSession(workspace, session.status),
    activityPreview: null,
    searchText: recentSearchText(base, [session.title, session.sourceAgentKind, workspace.displayName, workspace.repo.name, "session"]),
  };
}

function recentWorkBase(
  workspace: CloudWorkspaceSummary,
  options: { nowMs: number; rowActivityAt: string | null },
): Omit<
  RecentWorkItemView,
  | "id"
  | "rowKind"
  | "workspaceId"
  | "sessionId"
  | "pendingSessionKey"
  | "openTarget"
  | "title"
  | "subtitle"
  | "state"
  | "stateLabel"
  | "statusIndicator"
  | "activityPreview"
  | "searchText"
> {
  const sourceKind = recentWorkSourceForWorkspace(workspace);
  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  const cloudAccessState = recentWorkCloudAccessState(workspace);
  const commandability = recentWorkCommandability(workspace);
  const ownership = recentWorkOwnership(workspace);
  const lastActivityMs = parseTime(options.rowActivityAt);
  return {
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    sourceKind,
    sourceLabel: recentWorkSourceLabel(sourceKind),
    runtimeLocation,
    runtimeLabel: recentWorkRuntimeLabel(runtimeLocation),
    cloudAccessState,
    cloudAccessLabel: recentWorkCloudAccessLabel(cloudAccessState),
    commandability,
    commandabilityLabel: recentWorkCommandabilityLabel(commandability),
    ownership,
    ownershipLabel: recentWorkOwnershipLabel(ownership),
    lastActivityAt: options.rowActivityAt,
    lastActivityMs,
    lastActivityLabel: relativeTimeLabel(lastActivityMs, options.nowMs),
  };
}

function compareRecentWorkItems(left: RecentWorkItemView, right: RecentWorkItemView): number {
  const recencyDelta = right.lastActivityMs - left.lastActivityMs;
  if (recencyDelta !== 0) {
    return recencyDelta;
  }
  const kindDelta = recentRowKindRank(left.rowKind) - recentRowKindRank(right.rowKind);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  return left.title.localeCompare(right.title);
}

function recentRowKindRank(kind: RecentWorkRowKind): number {
  switch (kind) {
    case "pending-session":
      return 0;
    case "session":
      return 1;
    case "workspace":
      return 2;
  }
}

function recentSearchText(
  base: Pick<
    RecentWorkItemView,
    | "repoLabel"
    | "branchLabel"
    | "sourceLabel"
    | "runtimeLabel"
    | "cloudAccessLabel"
    | "commandabilityLabel"
    | "ownershipLabel"
  >,
  values: readonly (string | null | undefined)[],
): string {
  return [
    ...values,
    base.repoLabel,
    base.branchLabel,
    base.sourceLabel,
    base.runtimeLabel,
    base.cloudAccessLabel,
    base.commandabilityLabel,
    base.ownershipLabel,
  ].filter(Boolean).join(" ");
}

function recentWorkspaceRowId(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

function recentSessionRowId(workspaceId: string, sessionId: string): string {
  return `session:${workspaceId}:${sessionId}`;
}

export function recentWorkSourceLabel(source: RecentWorkSourceKind): string {
  switch (source) {
    case "desktop_exposed":
      return "Desktop";
    case "cloud_sandbox":
      return "Cloud sandbox";
    case "web":
      return "Web";
    case "mobile":
      return "Mobile";
    case "personal_automation":
      return "Personal automation";
    case "team_automation":
      return "Team automation";
    case "slack":
      return "Slack";
    case "api":
      return "API";
    case "unknown":
      return "Unknown";
  }
}

export function recentWorkRuntimeLabel(runtimeLocation: RecentWorkRuntimeLocation): string {
  switch (runtimeLocation) {
    case "local_desktop":
      return "Local Desktop";
    case "cloud_sandbox":
      return "Cloud runtime";
    case "ssh_remote":
      return "SSH remote";
    case "offline":
      return "Offline";
    case "unknown":
      return "Unknown runtime";
  }
}

export function recentWorkCloudAccessLabel(state: RecentWorkCloudAccessState): string {
  switch (state) {
    case "enabled":
      return "Cloud access enabled";
    case "not_enabled":
      return "Cloud access off";
    case "unknown":
      return "Cloud access unknown";
  }
}

export function recentWorkCommandabilityLabel(commandability: RecentWorkCommandability): string {
  switch (commandability) {
    case "commandable":
      return "Ready for commands";
    case "not_commandable":
      return "Commands unavailable";
    case "stale":
      return "Runtime offline";
    case "unknown":
      return "Command status unknown";
  }
}

function recentWorkOwnership(workspace: Pick<CloudWorkspaceSummary, "visibility" | "sandboxType">): RecentWorkOwnership {
  if (workspace.visibility === "shared_unclaimed") {
    return "unclaimed";
  }
  if (workspace.visibility === "claimed" || workspace.sandboxType === "managed_shared") {
    return "team";
  }
  if (workspace.visibility === "private") {
    return "mine";
  }
  return "unknown";
}

function recentWorkOwnershipLabel(ownership: RecentWorkOwnership): string {
  switch (ownership) {
    case "mine":
      return "Mine";
    case "team":
      return "Team";
    case "unclaimed":
      return "Unclaimed";
    case "unknown":
      return "Unknown owner";
  }
}

function workspaceState(workspace: CloudWorkspaceSummary): RecentWorkState {
  if (
    workspace.workspaceStatus === "error" ||
    workspace.status === "error" ||
    workspace.actionBlockKind ||
    workspace.actionBlockReason ||
    workspace.exposureState === "stale" ||
    workspaceHasPendingSessionInput(workspace)
  ) {
    return "blocked";
  }
  if (
    workspace.workspaceStatus === "pending" ||
    workspace.workspaceStatus === "materializing" ||
    workspace.workspaceStatus === "needs_rematerialization"
  ) {
    return "pending";
  }
  if (workspace.workspaceStatus === "archived" || workspace.status === "archived") {
    return "done";
  }
  return "idle";
}

function sessionState(status: string | null | undefined, workspace: CloudWorkspaceSummary): RecentWorkState {
  if (workspaceHasPendingSessionInput(workspace)) {
    return "blocked";
  }
  const normalized = status?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  switch (normalized) {
    case "running":
    case "queued":
      return "running";
    case "review":
    case "ready_for_review":
      return "review";
    case "ended":
    case "done":
    case "completed":
      return "done";
    case "error":
    case "failed":
      return "blocked";
    case "idle":
      return workspaceState(workspace) === "blocked" ? "blocked" : "idle";
    default:
      return workspaceState(workspace);
  }
}

function recentWorkStateLabel(state: RecentWorkState): string {
  switch (state) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "review":
      return "Review";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "pending":
      return "Pending";
    case "unknown":
      return "Unknown";
  }
}

function cloudWorkOwnerLabel(workspace: Pick<CloudWorkspaceSummary, "visibility">): string {
  switch (cloudWorkOwnerKind(workspace)) {
    case "private":
      return "Private";
    case "unclaimed":
      return "Unclaimed";
    case "claimed":
      return "Claimed";
    case "archived":
      return "Archived";
  }
}

function cloudWorkOwnerKind(
  workspace: Pick<CloudWorkspaceSummary, "visibility">,
): CloudWorkOwnerKind {
  switch (workspace.visibility) {
    case "shared_unclaimed":
      return "unclaimed";
    case "claimed":
      return "claimed";
    case "archived":
      return "archived";
    case "private":
    default:
      return "private";
  }
}

function cloudWorkRuntimeLabel(workspace: Pick<CloudWorkspaceSummary, "sandboxType" | "runtime">): string {
  if (workspace.sandboxType) {
    return workspace.sandboxType.replace(/_/g, " ");
  }
  return workspace.runtime?.status ?? "cloud";
}

function cloudWorkLastActivityMs(
  workspace: Pick<CloudWorkspaceSummary, "lastActivityAt" | "updatedAt" | "createdAt" | "lastSessionSummary">,
): number {
  return parseTime(cloudWorkLastActivityIso(workspace));
}

function cloudWorkLastActivityIso(
  workspace: Pick<CloudWorkspaceSummary, "lastActivityAt" | "updatedAt" | "createdAt" | "lastSessionSummary">,
): string | null {
  return workspace.lastSessionSummary?.lastEventAt
    ?? workspace.lastActivityAt
    ?? workspace.updatedAt
    ?? workspace.createdAt
    ?? null;
}

function parseTime(value?: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

function relativeTimeLabel(timeMs: number, nowMs: number): string {
  if (!timeMs) {
    return "unknown";
  }
  const deltaSeconds = Math.max(0, Math.floor((nowMs - timeMs) / 1000));
  if (deltaSeconds < 60) {
    return "now";
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }
  return `${Math.floor(deltaHours / 24)}d`;
}

function statusRank(status: CloudWorkStatusFilter): number {
  switch (status) {
    case "blocked":
      return 0;
    case "running":
      return 1;
    case "active":
      return 2;
    case "ready":
      return 3;
    case "error":
      return 4;
    case "archived":
      return 5;
  }
}

function workspaceCompletenessScore(workspace: CloudWorkspaceSummary): number {
  let score = 0;
  if (workspace.exposure) score += 4;
  if (workspace.lastSessionSummary) score += 3;
  if (workspace.lastActivityAt) score += 2;
  if (workspace.origin) score += 1;
  if (workspace.creatorContext) score += 1;
  return score;
}

function mergeCloudWorkspaceSummary(
  existing: CloudWorkspaceSummary,
  incoming: CloudWorkspaceSummary,
): CloudWorkspaceSummary {
  const primary = workspaceCompletenessScore(incoming) >= workspaceCompletenessScore(existing)
    ? incoming
    : existing;
  const secondary = primary === incoming ? existing : incoming;
  return {
    ...secondary,
    ...primary,
    origin: primary.origin ?? secondary.origin,
    creatorContext: primary.creatorContext ?? secondary.creatorContext,
    directTargetContext: primary.directTargetContext ?? secondary.directTargetContext,
    exposure: primary.exposure ?? secondary.exposure,
    exposureState: primary.exposureState ?? secondary.exposureState,
    lastActivityAt: latestIso(primary.lastActivityAt, secondary.lastActivityAt),
    lastError: primary.lastError ?? secondary.lastError,
    lastSessionSummary: primary.lastSessionSummary ?? secondary.lastSessionSummary,
    runtime: primary.runtime ?? secondary.runtime,
    statusDetail: primary.statusDetail ?? secondary.statusDetail,
  };
}

function latestIso(left?: string | null, right?: string | null): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export type { CloudWorkspaceLastSessionSummary };
