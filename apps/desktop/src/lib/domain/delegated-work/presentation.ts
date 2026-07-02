import type {
  DelegatedAgentIdentity,
  DelegatedWorkKind,
  DelegatedWorkSource,
  DelegatedWorkStatusCategory,
  DelegatedWorkTabIdentity,
} from "@/lib/domain/delegated-work/model";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";

export function delegatedWorkKindLabel(kind: DelegatedWorkKind): string {
  switch (kind) {
    case "subagent":
      return "Subagent";
    case "cowork":
      return "Cowork";
    case "code_review":
      return "Code review";
    case "plan_review":
      return "Plan review";
  }
}

export function delegatedWorkKindFromSource(input: {
  source: DelegatedWorkSource;
  reviewKind?: string | null;
}): DelegatedWorkKind {
  if (input.source === "subagent") {
    return "subagent";
  }
  if (input.source === "cowork") {
    return "cowork";
  }
  return input.reviewKind === "code" ? "code_review" : "plan_review";
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

export function reviewRunStatusCategory(status: string): DelegatedWorkStatusCategory {
  switch (status) {
    case "feedback_ready":
    case "waiting_for_revision":
      return "needs_attention";
    case "system_failed":
      return "failed";
    case "reviewing":
    case "parent_revising":
      return "running";
    case "passed":
    case "stopped":
      return "finished";
    default:
      return "queued";
  }
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
  source: DelegatedWorkSource;
  reviewKind?: string | null;
  statusLabel: string;
  wakeScheduled?: boolean | null;
  workspaceId?: string | null;
  sessionId: string;
  sessionLinkId?: string | null;
  parentTitle?: string | null;
  colorIndex?: number;
  shapeSalt?: number;
}): DelegatedWorkTabIdentity {
  const kind = delegatedWorkKindFromSource({
    source: input.source,
    reviewKind: input.reviewKind,
  });
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
    colorIndex: input.colorIndex,
    shapeSalt: input.shapeSalt,
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
