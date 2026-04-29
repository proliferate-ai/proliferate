import { useCallback } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  useApprovePlanMutation,
  useMaterializePlanDocumentMutation,
  useRejectPlanMutation,
} from "@anyharness/sdk-react";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { resolveChatDraftWorkspaceId } from "@/lib/domain/chat/chat-input";
import {
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
} from "@/lib/domain/chat/file-mentions";
import { resolvePlanImplementationModeSwitch } from "@/lib/domain/plans/implementation-mode";
import { formatImplementPlanDraft } from "@/lib/domain/plans/implementation-prompt";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

interface ImplementPlanDraftInput {
  planId: string;
  sessionId: string;
}

export function useProposedPlanActions() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const appendDraftText = useChatInputStore((state) => state.appendDraftText);
  const showToast = useToastStore((state) => state.show);
  const approveMutation = useApprovePlanMutation({ workspaceId: selectedWorkspaceId });
  const rejectMutation = useRejectPlanMutation({ workspaceId: selectedWorkspaceId });
  const materializeDocumentMutation = useMaterializePlanDocumentMutation({
    workspaceId: selectedWorkspaceId,
  });
  const { setActiveSessionConfigOption } = useSessionActions();
  const approvePlanMutation = approveMutation.mutateAsync;
  const rejectPlanMutation = rejectMutation.mutateAsync;
  const materializeDocument = materializeDocumentMutation.mutateAsync;

  const approvePlan = useCallback((planId: string, expectedDecisionVersion: number) => {
    void approvePlanMutation({ planId, expectedDecisionVersion }).catch((error) => {
      if (isPlanDecisionVersionConflict(error)) {
        showToast("Plan decision was updated. Refreshing plan state.");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to approve plan: ${message}`);
    });
  }, [approvePlanMutation, showToast]);

  const rejectPlan = useCallback((planId: string, expectedDecisionVersion: number) => {
    void rejectPlanMutation({ planId, expectedDecisionVersion }).catch((error) => {
      if (isPlanDecisionVersionConflict(error)) {
        showToast("Plan decision was updated. Refreshing plan state.");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to reject plan: ${message}`);
    });
  }, [rejectPlanMutation, showToast]);

  const implementPlanHere = useCallback((plan: ImplementPlanDraftInput) => {
    void (async () => {
      const harnessState = useHarnessStore.getState();
      const planSessionSlot = harnessState.sessionSlots[plan.sessionId] ?? null;
      if (!planSessionSlot) {
        showToast("Plan session is not available.");
        return;
      }
      if (harnessState.activeSessionId !== plan.sessionId) {
        showToast("Select the plan's session before carrying it out.");
        return;
      }
      const draftWorkspaceId = resolveChatDraftWorkspaceId(
        selectedLogicalWorkspaceId,
        planSessionSlot.workspaceId ?? selectedWorkspaceId,
      );
      if (!draftWorkspaceId) {
        showToast("Select a workspace before implementing a plan.");
        return;
      }

      const modeSwitch = resolvePlanImplementationModeSwitch({
        collaborationMode:
          planSessionSlot.liveConfig?.normalizedControls.collaborationMode ?? null,
        mode: planSessionSlot.liveConfig?.normalizedControls.mode ?? null,
      });
      if (modeSwitch) {
        await setActiveSessionConfigOption(modeSwitch.rawConfigId, modeSwitch.value, {
          persistDefaultPreference: false,
        });
      }

      const document = await materializeDocument({ planId: plan.planId });
      const projectionPath = document.projectionPath?.trim();
      if (!projectionPath) {
        showToast("Plan document is not available yet.");
        return;
      }

      const implementationDraft = formatImplementPlanDraft(projectionPath);
      const currentDraft =
        useChatInputStore.getState().draftByWorkspaceId[draftWorkspaceId] ?? EMPTY_CHAT_DRAFT;
      appendDraftText(
        draftWorkspaceId,
        isChatDraftEmpty(currentDraft) ? implementationDraft : `\n\n${implementationDraft}`,
      );
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to prepare plan document: ${message}`);
    });
  }, [
    materializeDocument,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    appendDraftText,
    setActiveSessionConfigOption,
    showToast,
  ]);

  return {
    approvePlan,
    rejectPlan,
    implementPlanHere,
    isApprovingPlan: approveMutation.isPending,
    isRejectingPlan: rejectMutation.isPending,
    isMaterializingPlanDocument: materializeDocumentMutation.isPending,
  };
}

function isPlanDecisionVersionConflict(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.status === 409
    && error.problem.code === "PLAN_DECISION_VERSION_CONFLICT";
}
