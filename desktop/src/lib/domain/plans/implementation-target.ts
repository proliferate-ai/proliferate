import type { NormalizedSessionControl } from "@anyharness/sdk";

export interface PlanImplementationPlanTarget {
  sourceSessionId: string;
}

export type PlanImplementationSessionRecord = {
  workspaceId: string | null;
  agentKind?: string | null;
  liveConfig: {
    normalizedControls: {
      collaborationMode?: NormalizedSessionControl | null;
      mode?: NormalizedSessionControl | null;
    };
  } | null;
};

export interface PlanImplementationHarnessState {
  activeSessionId: string | null;
  sessionRecords: Record<string, PlanImplementationSessionRecord | undefined>;
}

export type PlanImplementationReadiness =
  | {
    status: "ready";
    session: PlanImplementationSessionRecord;
    workspaceId: string;
    agentKind: string;
  }
  | {
    status: "blocked";
    message: string;
  };

export type PlanImplementationTargetCheck =
  | { status: "ready" }
  | {
    status: "blocked";
    message: string;
  };

export function resolvePlanImplementationReadiness({
  chatDisabledReason,
  harnessState,
  isChatDisabled,
  plan,
}: {
  plan: PlanImplementationPlanTarget;
  harnessState: PlanImplementationHarnessState;
  isChatDisabled: boolean;
  chatDisabledReason: string | null;
}): PlanImplementationReadiness {
  const planSessionSlot = harnessState.sessionRecords[plan.sourceSessionId] ?? null;
  if (!planSessionSlot) {
    return { status: "blocked", message: "Plan session is not available." };
  }
  if (harnessState.activeSessionId !== plan.sourceSessionId) {
    return {
      status: "blocked",
      message: "Select the plan's session before carrying it out.",
    };
  }

  const workspaceId = planSessionSlot.workspaceId;
  if (!workspaceId) {
    return {
      status: "blocked",
      message: "Select a workspace before implementing a plan.",
    };
  }
  if (isChatDisabled) {
    return {
      status: "blocked",
      message: chatDisabledReason ?? "Chat is unavailable.",
    };
  }

  return {
    status: "ready",
    session: planSessionSlot,
    workspaceId,
    agentKind: planSessionSlot.agentKind ?? "unknown",
  };
}

export function resolvePlanImplementationTargetCheck({
  expectedWorkspaceId,
  harnessState,
  plan,
}: {
  plan: PlanImplementationPlanTarget;
  harnessState: PlanImplementationHarnessState;
  expectedWorkspaceId: string;
}): PlanImplementationTargetCheck {
  const planSessionSlot = harnessState.sessionRecords[plan.sourceSessionId] ?? null;
  if (
    harnessState.activeSessionId !== plan.sourceSessionId
    || planSessionSlot?.workspaceId !== expectedWorkspaceId
  ) {
    return {
      status: "blocked",
      message: "Select the plan's session before carrying it out.",
    };
  }

  return { status: "ready" };
}
