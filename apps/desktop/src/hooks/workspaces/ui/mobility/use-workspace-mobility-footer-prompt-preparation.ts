import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useMobilityPromptState } from "@/hooks/workspaces/derived/mobility/use-mobility-prompt-state";
import { useWorkspaceMobilityHandoffActions } from "@/hooks/workspaces/workflows/mobility/use-workspace-mobility-handoff-actions";
import type { WorkspaceMobilityState } from "@/hooks/workspaces/derived/mobility/use-workspace-mobility-state";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { isWorkspaceMobilityConfirmSnapshotReadyToMove } from "@/lib/domain/workspaces/mobility/mobility-handoff-eligibility";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import type { WorkspaceMobilityDestinationId } from "@/lib/domain/workspaces/mobility/mobility-destinations";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";

export function useWorkspaceMobilityFooterPromptPreparation({
  mobilityState,
  popoverOpen,
  selectedDestinationId,
  setPopoverOpen,
  setSelectedDestinationId,
  setOptimisticProgressDirection,
}: {
  mobilityState: WorkspaceMobilityState;
  popoverOpen: boolean;
  selectedDestinationId: WorkspaceMobilityDestinationId | null;
  setPopoverOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedDestinationId: Dispatch<SetStateAction<WorkspaceMobilityDestinationId | null>>;
  setOptimisticProgressDirection: Dispatch<SetStateAction<WorkspaceMobilityDirection | null>>;
}) {
  const {
    activatePromptRequest,
    clearPrompt,
    clearPromptRequest,
    confirmMove,
    isSyncingBranch,
    preparePrompt,
    syncBranchForSelectedMove,
  } = useWorkspaceMobilityHandoffActions(mobilityState);
  const [isPreparing, setIsPreparing] = useState(false);
  const [hasResolvedPrompt, setHasResolvedPrompt] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const prepareRequestTokenRef = useRef(0);
  const rawPrompt = useMobilityPromptState(
    isPreparing,
    hasResolvedPrompt,
    popoverOpen
      && selectedDestinationId !== null
      && !mobilityState.selectionLocked,
    preparationError,
  );
  const prompt = mobilityState.selectionLocked ? null : rawPrompt;

  const resetPromptState = useCallback(() => {
    prepareRequestTokenRef.current += 1;
    setIsPreparing(false);
    setHasResolvedPrompt(false);
    setPreparationError(null);
  }, []);

  const setPreparationFailure = useCallback((message: string) => {
    setPreparationError(message);
    setHasResolvedPrompt(true);
  }, []);

  const resolvePromptWithoutPreparation = useCallback(() => {
    setIsPreparing(false);
    setHasResolvedPrompt(true);
    setPreparationError(null);
  }, []);

  const readFreshConfirmSnapshot = useCallback(() => {
    const logicalWorkspaceId = mobilityState.selectedLogicalWorkspaceId;
    if (!logicalWorkspaceId) {
      return null;
    }
    return useWorkspaceMobilityUiStore.getState().confirmSnapshotByLogicalWorkspaceId[
      logicalWorkspaceId
    ] ?? null;
  }, [mobilityState.selectedLogicalWorkspaceId]);

  const runPromptPreparation = useCallback(async () => {
    const requestToken = prepareRequestTokenRef.current + 1;
    prepareRequestTokenRef.current = requestToken;
    const startedAt = startLatencyTimer();
    logLatency("mobility.footer.prepare.start", {
      requestId: requestToken,
      logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
      selectionLocked: mobilityState.selectionLocked,
      canMoveToCloud: mobilityState.canMoveToCloud,
      canBringBackLocal: mobilityState.canBringBackLocal,
    });
    activatePromptRequest(requestToken);
    clearPrompt();
    setPreparationError(null);
    setIsPreparing(true);
    setHasResolvedPrompt(false);
    try {
      await preparePrompt(requestToken);
    } catch (error) {
      if (prepareRequestTokenRef.current !== requestToken) {
        return;
      }
      setIsPreparing(false);
      setHasResolvedPrompt(true);
      setPreparationError(error instanceof Error ? error.message : "Failed to load workspace mobility details.");
      return;
    }
    const activeRequestId = mobilityState.selectedLogicalWorkspaceId
      ? useWorkspaceMobilityUiStore.getState().activePromptRequestIdByLogicalWorkspaceId[
        mobilityState.selectedLogicalWorkspaceId
      ] ?? null
      : null;
    if (
      prepareRequestTokenRef.current !== requestToken
      || activeRequestId !== requestToken
    ) {
      logLatency("mobility.footer.prepare.stale", {
        requestId: requestToken,
        logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
        activeRequestId,
        elapsedMs: elapsedMs(startedAt),
      });
      return;
    }
    setIsPreparing(false);
    setHasResolvedPrompt(true);
    const confirmSnapshot = mobilityState.selectedLogicalWorkspaceId
      ? useWorkspaceMobilityUiStore.getState().confirmSnapshotByLogicalWorkspaceId[
        mobilityState.selectedLogicalWorkspaceId
      ] ?? null
      : null;
    logLatency("mobility.footer.prepare.complete", {
      requestId: requestToken,
      logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
      hasConfirmSnapshot: Boolean(confirmSnapshot),
      elapsedMs: elapsedMs(startedAt),
    });
  }, [
    activatePromptRequest,
    mobilityState.canBringBackLocal,
    mobilityState.canMoveToCloud,
    mobilityState.selectedLogicalWorkspaceId,
    mobilityState.selectionLocked,
    clearPrompt,
    preparePrompt,
  ]);

  const rerunPreparationAndAutoMove = useCallback(async () => {
    const requestToken = prepareRequestTokenRef.current + 1;
    prepareRequestTokenRef.current = requestToken;
    activatePromptRequest(requestToken);
    clearPrompt();
    setPreparationError(null);
    setIsPreparing(true);
    setHasResolvedPrompt(false);
    try {
      await preparePrompt(requestToken);
    } catch (error) {
      if (prepareRequestTokenRef.current === requestToken) {
        setPreparationError(error instanceof Error ? error.message : "Failed to load workspace mobility details.");
        setHasResolvedPrompt(true);
        setIsPreparing(false);
      }
      return false;
    }

    if (prepareRequestTokenRef.current !== requestToken) {
      return false;
    }

    setIsPreparing(false);
    setHasResolvedPrompt(true);
    const freshSnapshot = readFreshConfirmSnapshot();
    if (!isWorkspaceMobilityConfirmSnapshotReadyToMove(freshSnapshot)) {
      setPopoverOpen(true);
      return false;
    }

    setOptimisticProgressDirection(freshSnapshot.direction);
    setPopoverOpen(false);
    setSelectedDestinationId(null);
    clearPromptRequest();
    try {
      await confirmMove(freshSnapshot);
      return true;
    } catch {
      setOptimisticProgressDirection(null);
      return false;
    } finally {
      clearPrompt();
    }
  }, [
    activatePromptRequest,
    clearPrompt,
    clearPromptRequest,
    confirmMove,
    preparePrompt,
    readFreshConfirmSnapshot,
    setOptimisticProgressDirection,
    setPopoverOpen,
    setSelectedDestinationId,
  ]);

  return {
    prompt,
    isPreparing,
    hasResolvedPrompt,
    preparationError,
    isSyncingBranch,
    resetPromptState,
    setPreparationFailure,
    resolvePromptWithoutPreparation,
    runPromptPreparation,
    rerunPreparationAndAutoMove,
    clearPrompt,
    clearPromptRequest,
    syncBranchForSelectedMove,
  };
}
