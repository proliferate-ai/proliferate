import type {
  ContentPart,
  ProposedPlanDetail,
} from "@anyharness/sdk";

export interface PromptPlanAttachmentDescriptor {
  id: string;
  kind: "plan_reference";
  planId: string;
  title: string;
  bodyMarkdown: string;
  snapshotHash: string;
  sourceSessionId: string;
  sourceTurnId?: string | null;
  sourceItemId?: string | null;
  sourceKind: string;
  sourceToolCallId?: string | null;
  resolutionState?: "ready" | "loading" | "error" | "stale";
  resolutionMessage?: string;
}

export interface PromptPlanAttachmentPointer {
  id: string;
  kind: "plan_reference";
  planId: string;
  snapshotHash: string;
}

export function planAttachmentId(planId: string, snapshotHash: string): string {
  return `plan:${planId}:${snapshotHash}`;
}

export function planAttachmentPointerFromDescriptor(
  plan: PromptPlanAttachmentDescriptor,
): PromptPlanAttachmentPointer {
  return {
    id: plan.id,
    kind: "plan_reference",
    planId: plan.planId,
    snapshotHash: plan.snapshotHash,
  };
}

export function planAttachmentDescriptorFromDetail(
  plan: ProposedPlanDetail,
): PromptPlanAttachmentDescriptor {
  return {
    id: planAttachmentId(plan.id, plan.snapshotHash),
    kind: "plan_reference",
    planId: plan.id,
    title: plan.title,
    bodyMarkdown: plan.bodyMarkdown,
    snapshotHash: plan.snapshotHash,
    sourceSessionId: plan.sourceSessionId,
    sourceTurnId: plan.sourceTurnId ?? null,
    sourceItemId: plan.sourceItemId ?? null,
    sourceKind: plan.sourceKind,
    sourceToolCallId: plan.sourceToolCallId ?? null,
    resolutionState: "ready",
  };
}

export function planAttachmentPlaceholderFromPointer(
  pointer: PromptPlanAttachmentPointer,
  resolutionState: "loading" | "error" | "stale",
  resolutionMessage?: string,
): PromptPlanAttachmentDescriptor {
  return {
    id: pointer.id,
    kind: "plan_reference",
    planId: pointer.planId,
    title: placeholderTitleForPlanState(resolutionState),
    bodyMarkdown: resolutionMessage ?? placeholderMessageForPlanState(resolutionState),
    snapshotHash: pointer.snapshotHash,
    sourceSessionId: "",
    sourceTurnId: null,
    sourceItemId: null,
    sourceKind: "unknown",
    sourceToolCallId: null,
    resolutionState,
    resolutionMessage,
  };
}

export function isResolvedPlanAttachment(
  plan: PromptPlanAttachmentDescriptor,
): boolean {
  return (plan.resolutionState ?? "ready") === "ready";
}

export function planReferenceContentPartFromDescriptor(
  plan: PromptPlanAttachmentDescriptor,
): Extract<ContentPart, { type: "plan_reference" }> {
  return {
    type: "plan_reference",
    planId: plan.planId,
    title: plan.title,
    bodyMarkdown: plan.bodyMarkdown,
    snapshotHash: plan.snapshotHash,
    sourceSessionId: plan.sourceSessionId,
    sourceTurnId: plan.sourceTurnId ?? null,
    sourceItemId: plan.sourceItemId ?? null,
    sourceKind: plan.sourceKind,
    sourceToolCallId: plan.sourceToolCallId ?? null,
  };
}

function placeholderTitleForPlanState(
  resolutionState: "loading" | "error" | "stale",
): string {
  switch (resolutionState) {
    case "loading":
      return "Loading plan";
    case "error":
      return "Plan unavailable";
    case "stale":
      return "Plan snapshot changed";
  }
}

function placeholderMessageForPlanState(
  resolutionState: "loading" | "error" | "stale",
): string {
  switch (resolutionState) {
    case "loading":
      return "The attached plan is still loading.";
    case "error":
      return "The attached plan could not be loaded. Remove it and attach the plan again.";
    case "stale":
      return "This attached plan snapshot no longer matches the stored plan. Remove it and attach the latest plan.";
  }
}
