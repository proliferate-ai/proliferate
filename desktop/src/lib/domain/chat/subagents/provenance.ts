import type { PromptProvenance } from "@anyharness/sdk";

export type WakePromptProvenance =
  | Extract<PromptProvenance, { type: "subagentWake" }>
  | Extract<PromptProvenance, { type: "linkWake" }>;

export function isSubagentWakeProvenance(
  provenance: PromptProvenance | null | undefined,
): provenance is WakePromptProvenance {
  return provenance?.type === "subagentWake" || provenance?.type === "linkWake";
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
