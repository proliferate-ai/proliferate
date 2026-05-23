import type {
  CloudWorkspaceLastSessionSummary,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

export type CloudWorkSource = "chats" | "slack" | "automation" | "api";

export type CloudWorkOwnerFilter = "all" | "private" | "shared" | "claimed" | "unclaimed";

export type CloudWorkStatusFilter = "active" | "blocked" | "ready" | "archived" | "error";

export type CloudWorkOwnerKind = "private" | "claimed" | "unclaimed" | "archived";

export interface CloudWorkFilters {
  ownership?: CloudWorkOwnerFilter;
  sources?: ReadonlySet<CloudWorkSource>;
  statuses?: ReadonlySet<CloudWorkStatusFilter>;
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
  source: CloudWorkSource;
  sourceLabel: string;
  ownerKind: CloudWorkOwnerKind;
  ownerLabel: string;
  status: CloudWorkStatusFilter;
  statusLabel: string;
  branchLabel: string;
  repoLabel: string;
  runtimeLabel: string;
  lastActivityLabel: string;
  lastActivityMs: number;
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

export interface BuildCloudWorkInventoryOptions {
  nowMs?: number;
  filters?: CloudWorkFilters;
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
  ).sort(compareCloudWorkItems);
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
  const source = cloudWorkSourceForWorkspace(workspace);
  const status = cloudWorkStatusForWorkspace(workspace);
  const ownerKind = cloudWorkOwnerKind(workspace);
  const lastActivityMs = cloudWorkLastActivityMs(workspace);
  const defaultSessionId = selectDefaultCloudWorkSession(workspace);
  return {
    id: workspace.id,
    title,
    subtitle: [repoLabel, branchLabel].filter(Boolean).join(" - "),
    source,
    sourceLabel: SOURCE_LABELS[source],
    ownerKind,
    ownerLabel: cloudWorkOwnerLabel(workspace),
    status,
    statusLabel: STATUS_LABELS[status],
    branchLabel,
    repoLabel,
    runtimeLabel: cloudWorkRuntimeLabel(workspace),
    lastActivityLabel: relativeTimeLabel(lastActivityMs, options.nowMs ?? Date.now()),
    lastActivityMs,
    unclaimed: workspace.visibility === "shared_unclaimed",
    defaultSessionId,
    sessionCount: workspace.lastSessionSummary ? 1 : 0,
    currentSessionLabel: defaultSessionId ? "latest session" : "no sessions",
    searchText: [
      title,
      sessionTitle,
      repoLabel,
      branchLabel,
      SOURCE_LABELS[source],
      cloudWorkOwnerLabel(workspace),
      STATUS_LABELS[status],
    ].filter(Boolean).join(" "),
    openTarget: {
      workspaceId: workspace.id,
      sessionId: defaultSessionId,
    },
  };
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
  if (workspace.actionBlockKind || workspace.actionBlockReason) {
    return "blocked";
  }
  if (
    workspace.workspaceStatus === "pending"
    || workspace.workspaceStatus === "materializing"
    || workspace.workspaceStatus === "needs_rematerialization"
    || workspace.runtime?.status === "pending"
    || workspace.runtime?.status === "provisioning"
    || workspace.lastSessionSummary?.status === "running"
  ) {
    return "active";
  }
  return "ready";
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
    if (filters.statuses?.size && !filters.statuses.has(item.status)) {
      return false;
    }
    if (query && !matchesSearch(item, query)) {
      return false;
    }
    return true;
  });
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
  return parseTime(workspace.lastSessionSummary?.lastEventAt)
    || parseTime(workspace.lastActivityAt)
    || parseTime(workspace.updatedAt)
    || parseTime(workspace.createdAt);
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
    case "active":
      return 1;
    case "ready":
      return 2;
    case "error":
      return 3;
    case "archived":
      return 4;
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
