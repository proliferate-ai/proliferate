import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import type { CloudWorkItemView, CloudWorkSource, RecentWorkSourceKind } from "./cloud-work-inventory-types";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
} from "./cloud-work-inventory-types";
import {
  cloudWorkOwnerKind,
  cloudWorkOwnerLabel,
  cloudWorkRuntimeLabel,
  recentWorkCloudAccessLabel,
  recentWorkCommandabilityLabel,
  recentWorkRuntimeLabel,
  recentWorkSourceLabel,
} from "./cloud-work-labels";
import {
  recentWorkCloudAccessState,
  recentWorkCommandability,
  recentWorkRuntimeLocationForWorkspace,
} from "./cloud-work-runtime";
import {
  cloudWorkStatusForWorkspace,
  recentWorkStatusIndicatorForWorkspace,
  selectDefaultCloudWorkSession,
} from "./cloud-work-status";
import { cloudWorkLastActivityMs, parseTime, relativeTimeLabel } from "./cloud-work-time";
import { commandStatusDetailMessage, compactPreviewText } from "./cloud-work-text";

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
