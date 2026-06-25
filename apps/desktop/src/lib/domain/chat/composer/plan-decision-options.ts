import type { PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";

export type PlanDecisionEntry =
  | { type: "option"; action: PermissionOptionAction }
  | { type: "feedback"; action: PermissionOptionAction };

export function buildPlanDecisionEntries(
  actions: readonly PermissionOptionAction[],
): PlanDecisionEntry[] {
  return actions.map((action) => (
    isFeedbackOption(action)
      ? { type: "feedback", action }
      : { type: "option", action }
  ));
}

export function isFeedbackOption(action: PermissionOptionAction): boolean {
  return action.presentation?.kind === "feedback_text_input";
}
