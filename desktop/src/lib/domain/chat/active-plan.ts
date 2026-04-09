import {
  deriveCanonicalPlan,
  type CanonicalPlanSourceKind,
  type PlanEntry,
  type TranscriptState,
} from "@anyharness/sdk";

export interface ActivePlan {
  sourceKind: CanonicalPlanSourceKind;
  entries: PlanEntry[];
  body: string | null;
  isActive: boolean;
}

export function deriveActivePlan(transcript: TranscriptState): ActivePlan | null {
  const canonicalPlan = deriveCanonicalPlan(transcript);
  if (!canonicalPlan || !canonicalPlan.isActive) {
    return null;
  }

  return {
    sourceKind: canonicalPlan.sourceKind,
    entries: canonicalPlan.entries,
    body: canonicalPlan.body,
    isActive: canonicalPlan.isActive,
  };
}
