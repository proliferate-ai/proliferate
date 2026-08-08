import type {
  DelegatedAgentIdentity,
  DelegatedWorkKind,
  DelegatedWorkStatusCategory,
  DelegatedWorkTabIdentity,
} from "#product/lib/domain/delegated-work/model";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

export function delegatedWorkKindLabel(kind: DelegatedWorkKind): string {
  switch (kind) {
    case "subagent":
      return "Subagent";
  }
}

export function delegatedWorkStatusCategoryFromLabel(input: {
  statusLabel?: string | null;
  wakeScheduled?: boolean | null;
}): DelegatedWorkStatusCategory {
  if (input.wakeScheduled) {
    return "wake_scheduled";
  }
  const normalized = normalizeStatus(input.statusLabel);
  if (
    normalized === "failed"
    || normalized === "timed out"
    || normalized === "retryable failed"
    || normalized === "system failed"
  ) {
    return "failed";
  }
  if (
    normalized === "needs attention"
    || normalized === "feedback ready"
    || normalized === "changes"
    || normalized === "changes requested"
    || normalized === "waiting for revision"
    || normalized === "needs retry"
  ) {
    return "needs_attention";
  }
  if (
    normalized === "working"
    || normalized === "running"
    || normalized === "reviewing"
    || normalized === "starting"
    || normalized === "parent revising"
  ) {
    return "running";
  }
  if (normalized === "queued" || normalized === "prompt queued") {
    return "queued";
  }
  if (normalized === "closed") {
    return "closed";
  }
  return "finished";
}

export function shouldShowDelegatedWorkInComposer(input: {
  statusCategory: DelegatedWorkStatusCategory;
  hasActionNeeded?: boolean;
}): boolean {
  if (input.statusCategory === "closed") {
    return false;
  }
  if (input.statusCategory === "finished") {
    return input.hasActionNeeded === true;
  }
  return true;
}

export interface DelegatedAgentTriggerCandidate {
  identity: DelegatedAgentIdentity;
  statusCategory: DelegatedWorkStatusCategory;
}

export function selectSingleDelegatedAgentTriggerIdentity(
  candidates: readonly DelegatedAgentTriggerCandidate[],
): DelegatedAgentIdentity | null {
  const activeOrAttentionAgents = candidates.filter((candidate) =>
    candidate.statusCategory !== "finished" && candidate.statusCategory !== "closed"
  );
  return activeOrAttentionAgents.length === 1
    ? activeOrAttentionAgents[0]?.identity ?? null
    : null;
}

export function buildDelegatedWorkTabIdentity(input: {
  id: string;
  title: string | null | undefined;
  statusLabel: string;
  wakeScheduled?: boolean | null;
  workspaceId?: string | null;
  sessionId: string;
  sessionLinkId?: string | null;
  parentTitle?: string | null;
}): DelegatedWorkTabIdentity {
  const kind: DelegatedWorkKind = "subagent";
  const originLabel = delegatedWorkKindLabel(kind);
  const statusCategory = delegatedWorkStatusCategoryFromLabel({
    statusLabel: input.statusLabel,
    wakeScheduled: input.wakeScheduled,
  });
  const identity = buildDelegatedAgentIdentity({
    id: input.id,
    title: input.title,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    sessionLinkId: input.sessionLinkId,
  });
  const hoverLines = [
    identity.displayName,
    originLabel,
    input.parentTitle ? `Parent: ${input.parentTitle}` : null,
    input.statusLabel,
  ].filter((value): value is string => !!value && value.trim().length > 0);
  return {
    identity,
    kind,
    originLabel,
    statusCategory,
    statusLabel: input.statusLabel,
    parentTitle: input.parentTitle?.trim() || null,
    hoverTitle: hoverLines.join("\n"),
  };
}

export function delegatedWorkSummaryPriority(
  category: DelegatedWorkStatusCategory,
): number {
  switch (category) {
    case "needs_attention":
      return 0;
    case "failed":
      return 1;
    case "running":
      return 2;
    case "queued":
      return 3;
    case "wake_scheduled":
      return 4;
    case "finished":
      return 5;
    case "closed":
      return 6;
  }
}

function normalizeStatus(status: string | null | undefined): string {
  return status
    ?.replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase() ?? "";
}
