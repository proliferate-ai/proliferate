import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

export type CloudPlanDecision = "approve" | "reject";

export interface ActivePlanDecision {
  planId: string;
  expectedDecisionVersion: number;
  decision: CloudPlanDecision;
  commandId: string | null;
}

export function activePlanDecisionMatches(
  activeDecision: ActivePlanDecision | null,
  planId: string,
  expectedDecisionVersion: number,
  decision: CloudPlanDecision,
): boolean {
  return activeDecision?.planId === planId
    && activeDecision.expectedDecisionVersion === expectedDecisionVersion
    && activeDecision.decision === decision;
}

export function planDecisionResolvedInRow(
  row: CloudChatTranscriptRowView,
  activeDecision: ActivePlanDecision,
): boolean {
  if (row.kind === "proposed_plan" && row.planId === activeDecision.planId) {
    const state = row.planDecisionState ?? null;
    const version = row.planDecisionVersion ?? null;
    if (
      state !== null
      && state !== "pending"
      && (version === null || version >= activeDecision.expectedDecisionVersion)
    ) {
      return true;
    }
  }
  return row.children?.some((child) => planDecisionResolvedInRow(child, activeDecision)) ?? false;
}
