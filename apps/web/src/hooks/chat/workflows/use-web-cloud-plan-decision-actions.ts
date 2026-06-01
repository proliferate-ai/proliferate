import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import {
  commandStatusFailureMessage,
  isRejectedCommandStatus,
  planDecisionFailureMessage,
  planDecisionProgressMessage,
} from "../../../lib/domain/chat/cloud-chat-command-presentation";
import {
  activePlanDecisionMatches,
  type ActivePlanDecision,
} from "../../../lib/domain/chat/cloud-chat-plan-decision";
import { prepareManagedWorkspaceForCloudCommands } from "../../../lib/access/cloud/pending-home-prompt-dispatch";

type DecidePlanPayload = {
  workspaceId: string;
  planId: string;
  decision: "approve" | "reject";
  expectedDecisionVersion: number;
};

export function useWebCloudPlanDecisionActions(input: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  isUnclaimed: boolean;
  resolvedAgentKind: string;
  sessionModelId: string | null;
  mountedRef: { current: boolean };
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  enqueuePlanDecision: (
    command: CloudCommandEnvelope<DecidePlanPayload>,
  ) => Promise<CloudCommandResponse>;
  transcriptRefetch: () => Promise<unknown> | unknown;
  sessionEventsRefetch: () => Promise<unknown> | unknown;
}) {
  const {
    client,
    workspace,
    session,
    isUnclaimed,
    resolvedAgentKind,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    setPendingHomePromptStatus,
    enqueuePlanDecision,
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
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingHomePromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    const commandWorkspaceId = session.workspaceId;
    if (!commandWorkspaceId) {
      setPendingHomePromptStatus("Session is not attached to a runtime workspace yet.");
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
      const commandWorkspace = await prepareManagedWorkspaceForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolvedAgentKind,
        modelId: sessionModelId,
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:plan:${planId}:${decision}:${expectedDecisionVersion}:target-config`,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      const command = await enqueuePlanDecision({
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:plan:${planId}:${decision}:${expectedDecisionVersion}`,
        targetId: session.targetId,
        workspaceId: commandWorkspaceId,
        cloudWorkspaceId: commandWorkspace.id,
        sessionId: session.sessionId,
        kind: "decide_plan",
        source: "web",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: {
          workspaceId: commandWorkspaceId,
          planId,
          decision,
          expectedDecisionVersion,
        },
      });
      if (!mountedRef.current) {
        return;
      }
      setLatestCommandId(command.commandId);
      setActivePlanDecision((current) => {
        if (
          !current
          || !activePlanDecisionMatches(current, planId, expectedDecisionVersion, decision)
        ) {
          return current;
        }
        return { ...current, commandId: command.commandId };
      });
      if (isRejectedCommandStatus(command.status)) {
        throw new Error(
          commandStatusFailureMessage(command, planDecisionFailureMessage(decision))
            ?? planDecisionFailureMessage(decision),
        );
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
    enqueuePlanDecision,
    isUnclaimed,
    mountedRef,
    resolvedAgentKind,
    session,
    sessionEventsRefetch,
    sessionModelId,
    setLatestCommandId,
    setPendingHomePromptStatus,
    transcriptRefetch,
    workspace,
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
