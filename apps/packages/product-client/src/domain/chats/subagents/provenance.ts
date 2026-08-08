import type { PromptProvenance, TranscriptState } from "@anyharness/sdk";

type LinkCompletionMetadata = TranscriptState["linkCompletionsByCompletionId"][string];

export type WakePromptProvenance =
  | Extract<PromptProvenance, { type: "subagentWake" }>
  | Extract<PromptProvenance, { type: "linkWake" }>;

/**
 * A session-scoped wake pointer. Armed on a session PAIR rather than on a
 * delegation link, so unlike `subagentWake` it carries no link id and no
 * completion id — the target session id and its label are all there is, and
 * the outcome the badge would otherwise report is not available here.
 */
export type AgentWakePromptProvenance = Extract<
  PromptProvenance,
  { type: "agentWake" }
>;

export function isSubagentWakeProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is WakePromptProvenance {
  return provenance?.type === "subagentWake" || provenance?.type === "linkWake";
}

export function formatWakePromptQueueText(
  provenance: WakePromptProvenance,
): string {
  const label = provenance.label?.trim();
  if (label && label.length > 0) {
    return `${label} finished`;
  }
  return "Subagent finished";
}

export function formatWakePromptTranscriptText(
  provenance: WakePromptProvenance,
  completion: LinkCompletionMetadata | null | undefined,
): string {
  const title = provenance.label?.trim()
    || completion?.label?.trim()
    || "Subagent";
  return formatWakeTitle(title, completion?.outcome ?? null);
}

export function isAgentWakeProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is AgentWakePromptProvenance {
  return provenance?.type === "agentWake";
}

/**
 * A pointer says only that the target finished a turn — never how it went.
 * The link-scoped wake can read an outcome off its completion row; this one has
 * no row to read, so the copy stops at "finished".
 */
export function formatAgentWakePromptQueueText(
  provenance: AgentWakePromptProvenance,
): string {
  const label = provenance.label?.trim();
  return label && label.length > 0 ? `${label} finished` : "Agent finished";
}

export function formatAgentWakePromptTranscriptText(
  provenance: AgentWakePromptProvenance,
): string {
  return formatAgentWakePromptQueueText(provenance);
}

export function isAgentSessionProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is Extract<PromptProvenance, { type: "agentSession" }> {
  return provenance?.type === "agentSession";
}

export function formatSubagentLabel(
  label: string | null | undefined,
  ordinal: number,
): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Subagent ${ordinal}`;
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

function formatWakeTitle(title: string, outcome: string | null | undefined): string {
  const normalized = normalizeOutcome(outcome);
  if (!normalized || normalized === "completed") {
    return `${title} finished`;
  }
  if (normalized === "failed") {
    return `${title} failed`;
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return `${title} cancelled`;
  }
  return `${title} ${normalized}`;
}

function normalizeOutcome(outcome: string | null | undefined): string | null {
  const normalized = outcome
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}
