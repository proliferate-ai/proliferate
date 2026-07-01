import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import {
  planDecisionFailureMessage,
  planDecisionProgressMessage,
} from "../../../lib/domain/chat/cloud-chat-command-presentation";
import {
  activePlanDecisionMatches,
  type ActivePlanDecision,
} from "../../../lib/domain/chat/cloud-chat-plan-decision";
import {
  getWebCloudSandboxAnyHarnessClient,
  isWebCloudSandboxWorkspace,
} from "../../../lib/access/anyharness/cloud-sandbox-runtime";

export function useWebCloudPlanDecisionActions(input: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  isUnclaimed: boolean;
  mountedRef: { current: boolean };
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  transcriptRefetch: () => Promise<unknown> | unknown;
  sessionEventsRefetch: () => Promise<unknown> | unknown;
}) {
  const {
    client,
    productToken,
    workspace,
    session,
    isUnclaimed,
    mountedRef,
    setPendingHomePromptStatus,
    transcriptRefetch,
    sessionEventsRefetch,
  } = input;
  const [activePlanDecision, setActivePlanDecision] = useState<ActivePlanDecision | null>(null);

  const submitPlanDecision = useCallback(async (
    planId: string,
    expectedDecisionVersion: number,
    decision: "approve" | "reject",
  ) => {
    if (!workspace || !session) {
      return;
    }
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before approving plans.");
      return;
    }
    if (!isWebCloudSandboxWorkspace(workspace)) {
      setPendingHomePromptStatus("Cloud workspace runtime is unavailable.");
      return;
    }
    setActivePlanDecision({
      planId,
      expectedDecisionVersion,
      decision,
      commandId: null,
    });
    setPendingHomePromptStatus(planDecisionProgressMessage(decision));
    try {
      const { connection, anyharness } = await getWebCloudSandboxAnyHarnessClient({
        workspace,
        productToken,
        client,
      });
      if (decision === "approve") {
        await anyharness.plans.approve(connection.anyharnessWorkspaceId, planId, {
          expectedDecisionVersion,
        });
      } else {
        await anyharness.plans.reject(connection.anyharnessWorkspaceId, planId, {
          expectedDecisionVersion,
        });
      }
      if (!mountedRef.current) {
        return;
      }
      setPendingHomePromptStatus(null);
      void transcriptRefetch();
      void sessionEventsRefetch();
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setActivePlanDecision((current) =>
        activePlanDecisionMatches(current, planId, expectedDecisionVersion, decision)
          ? null
          : current
      );
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : planDecisionFailureMessage(decision),
      );
    }
  }, [
    client,
    isUnclaimed,
    mountedRef,
    session,
    sessionEventsRefetch,
    setPendingHomePromptStatus,
    transcriptRefetch,
    workspace,
    productToken,
  ]);

  const transcriptPlanActions = useMemo(() => ({
    approvePlan: (planId: string, expectedDecisionVersion: number) =>
      void submitPlanDecision(planId, expectedDecisionVersion, "approve"),
    rejectPlan: (planId: string, expectedDecisionVersion: number) =>
      void submitPlanDecision(planId, expectedDecisionVersion, "reject"),
    isApprovingPlan: (planId: string, expectedDecisionVersion: number) =>
      activePlanDecisionMatches(activePlanDecision, planId, expectedDecisionVersion, "approve"),
    isRejectingPlan: (planId: string, expectedDecisionVersion: number) =>
      activePlanDecisionMatches(activePlanDecision, planId, expectedDecisionVersion, "reject"),
  }), [activePlanDecision, submitPlanDecision]);

  return {
    activePlanDecision,
    setActivePlanDecision,
    transcriptPlanActions,
  };
}
