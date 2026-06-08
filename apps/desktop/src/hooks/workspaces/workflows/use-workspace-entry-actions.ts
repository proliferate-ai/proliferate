import { useCallback, useMemo } from "react";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import type {
  PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  buildSubmittingPendingWorkspaceEntry as buildSubmittingPendingEntry,
  createPendingWorkspaceAttemptId as createAttemptId,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  type CreateWorktreeWorkspaceInput,
} from "@/lib/domain/workspaces/creation/workspace-creation";
import { sidebarRepoGroupKeyForWorkspace } from "@/lib/domain/workspaces/sidebar/sidebar-group-key";
import {
  ensureRepoGroupExpanded,
} from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useWorkspaceEntryFlow } from "./use-workspace-entry-flow";
import { useWorkspaceSelection } from "./selection/use-workspace-selection";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  annotateLatencyFlow,
  failLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import {
  usePendingWorkspaceSessionMaterialization,
} from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import { getSessionRecord } from "@/stores/sessions/session-records";
import {
  normalizeWorktreeInput,
  resolveDisplayNameFromPath,
  resolveErrorMessage,
} from "@/hooks/workspaces/workflows/workspace-entry-action-helpers";
import {
  failPendingWorkspaceEntry,
  finalizePendingWorkspaceSelection,
} from "@/hooks/workspaces/workflows/workspace-entry-finalization";
import {
  runLightweightLocalWorkspaceEntry,
  runLightweightWorktreeWorkspaceEntry,
} from "@/hooks/workspaces/workflows/workspace-entry-lightweight";
import type {
  WorkspaceEntryInternalOptions,
  WorkspaceEntryOptions,
  WorkspaceEntryResult,
} from "@/hooks/workspaces/workflows/workspace-entry-types";

const EMPTY_REPO_ROOTS: RepoRoot[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];

function isAttemptCurrent(attemptId: string): boolean {
  return useSessionSelectionStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function requestChatInputFocus(): void { useChatInputStore.getState().requestFocus(); }

export function useWorkspaceEntryActions() {
  const { data: workspaceCollections } = useWorkspaces();
  const repoRoots = workspaceCollections?.repoRoots ?? EMPTY_REPO_ROOTS;
  const {
    resolveWorktreeCreationInput,
    createLocalWorkspace,
    isCreatingLocalWorkspace,
    createWorktreeWorkspace,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceActions();
  const { beginPendingWorkspace, selectWorkspaceWithArrival } = useWorkspaceEntryFlow();
  const { selectWorkspace } = useWorkspaceSelection();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );
  const entrySelectionDeps = useMemo(() => ({
    expandRepoGroup: ensureRepoGroupExpanded,
    getSelectionState: useSessionSelectionStore.getState,
    getSessionRecord,
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
  }), [
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
  ]);

  const finalizeSelection = useCallback(async (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: { latencyFlowId?: string | null; repoGroupKeyToExpand?: string | null },
  ): Promise<boolean> => {
    return finalizePendingWorkspaceSelection({
      entry,
      workspaceId,
      options,
    }, entrySelectionDeps);
  }, [entrySelectionDeps]);

  const failPendingEntry = useCallback((
    entry: PendingWorkspaceEntry,
    errorMessage: string,
    overrides?: Partial<Pick<PendingWorkspaceEntry, "workspaceId" | "request" | "setupScript">>,
  ) => {
    failPendingWorkspaceEntry({
      entry,
      errorMessage,
      overrides,
    }, entrySelectionDeps);
  }, [entrySelectionDeps]);

  const createLocalWorkspaceAndEnterInternal = useCallback(async (
    sourceRoot: string,
    options?: WorkspaceEntryInternalOptions,
  ): Promise<WorkspaceEntryResult | null> => {
    const startedAt = startLatencyTimer();
    const sourceRepoGroupKey = options?.repoGroupKeyToExpand ?? sourceRoot;
    // Open immediately for feedback; success reopens using the returned workspace.
    ensureRepoGroupExpanded(sourceRepoGroupKey);

    if (options?.lightweight) {
      return runLightweightLocalWorkspaceEntry({
        repoRoots,
        sourceRoot,
      }, {
        createLocalWorkspace,
        requestChatInputFocus,
        selectWorkspaceWithArrival,
      });
    }

    const entry = buildSubmittingPendingEntry({
      attemptId: createAttemptId(),
      selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
      source: "local-created",
      displayName: resolveDisplayNameFromPath(sourceRoot),
      request: { kind: "local", sourceRoot },
    });

    const projectedSessionId = beginPendingWorkspace(entry, { initialSession: options?.initialSession });

    try {
      logLatency("workspace.local_create.request.start", {
        attemptId: entry.attemptId,
        sourceRoot,
      });
      const workspace = await createLocalWorkspace(sourceRoot);
      logLatency("workspace.local_create.request.success", {
        attemptId: entry.attemptId,
        workspaceId: workspace.id,
        requestElapsedMs: elapsedMs(startedAt),
      });
      if (!isAttemptCurrent(entry.attemptId)) {
        return null;
      }
      const selectionEntry: PendingWorkspaceEntry = {
        ...entry,
        workspaceId: workspace.id,
      };
      const selectionFinalized = await finalizeSelection(selectionEntry, workspace.id, {
        repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(workspace, repoRoots),
      });
      return selectionFinalized ? { workspaceId: workspace.id, projectedSessionId } : null;
    } catch (error) {
      const currentPending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
      const workspaceId = currentPending?.attemptId === entry.attemptId
        ? currentPending.workspaceId
        : null;
      failPendingEntry(
        workspaceId
          ? {
            ...entry,
            workspaceId,
            request: { kind: "select-existing", workspaceId },
          }
          : entry,
        resolveErrorMessage(error, "Failed to create workspace."),
      );
      if (options?.throwOnFailure) {
        throw error;
      }
      return null;
    }
  }, [
    beginPendingWorkspace,
    createLocalWorkspace,
    failPendingEntry,
    finalizeSelection,
    repoRoots,
    selectWorkspaceWithArrival,
  ]);

  const createLocalWorkspaceAndEnter = useCallback(async (
    sourceRoot: string,
    options?: WorkspaceEntryOptions,
  ) => {
    await createLocalWorkspaceAndEnterInternal(sourceRoot, options);
  }, [createLocalWorkspaceAndEnterInternal]);

  const createLocalWorkspaceAndEnterWithResult = useCallback(async (
    sourceRoot: string,
    options?: WorkspaceEntryOptions,
  ): Promise<WorkspaceEntryResult> => {
    const result = await createLocalWorkspaceAndEnterInternal(sourceRoot, {
      ...options,
      throwOnFailure: true,
    });
    if (!result) {
      throw new Error("Workspace creation was interrupted.");
    }
    return result;
  }, [createLocalWorkspaceAndEnterInternal]);

  const createWorktreeAndEnterInternal = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: WorkspaceEntryInternalOptions,
  ): Promise<WorkspaceEntryResult | null> => {
    const startedAt = startLatencyTimer();
    const allWorkspaces = workspaceCollections?.localWorkspaces ?? EMPTY_WORKSPACES;
    const repoRootId = typeof input === "string" ? input : input.repoRootId;
    const sourceRepoGroupKey = options?.repoGroupKeyToExpand
      ?? repoRoots.find((repoRoot) => repoRoot.id === repoRootId)?.path
      ?? null;
    if (sourceRepoGroupKey) {
      // Open immediately for feedback; success reopens using the returned workspace.
      ensureRepoGroupExpanded(sourceRepoGroupKey);
    }
    const sourceWorkspaceId = typeof input === "string" ? null : input.sourceWorkspaceId ?? null;
    const source = sourceWorkspaceId
      ? allWorkspaces.find((workspace) => workspace.id === sourceWorkspaceId) ?? null
      : allWorkspaces.find((workspace) => workspace.repoRootId === repoRootId && workspace.kind === "local")
        ?? allWorkspaces.find((workspace) => workspace.repoRootId === repoRootId) ?? null;
    const normalizedInput = normalizeWorktreeInput(input, source, allWorkspaces);

    if (options?.lightweight) {
      return runLightweightWorktreeWorkspaceEntry({
        latencyFlowId: options.latencyFlowId,
        normalizedInput,
        repoRoots,
      }, {
        createWorktreeWorkspace,
        requestChatInputFocus,
        resolveWorktreeCreationInput,
        selectWorkspaceWithArrival,
      });
    }

    const attemptId = createAttemptId();
    let entry: PendingWorkspaceEntry | null = null;
    let projectedSessionId: string | null = null;

    try {
      const resolveStartedAt = startLatencyTimer();
      logLatency("workspace.worktree.resolve.start", {
        attemptId,
        repoRootId: normalizedInput.repoRootId,
        sourceWorkspaceId: normalizedInput.sourceWorkspaceId ?? null,
      });
      const resolved = await resolveWorktreeCreationInput(normalizedInput);
      const resolvedInput: CreateWorktreeWorkspaceInput = {
        ...normalizedInput,
        workspaceName: resolved.params.workspaceName,
        branchName: resolved.params.branchName,
        baseBranch: resolved.params.baseRef,
        targetPath: resolved.params.targetPath,
      };
      entry = buildSubmittingPendingEntry({
        attemptId,
        selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
        source: "worktree-created",
        displayName: resolved.params.workspaceName,
        repoLabel: resolved.repoName,
        baseBranchName: resolved.params.baseRef,
        request: { kind: "worktree", input: resolvedInput },
      });
      projectedSessionId = beginPendingWorkspace(entry, {
        initialSession: options?.initialSession,
      });
      annotateLatencyFlow(options?.latencyFlowId, {
        attemptId: entry.attemptId,
      });
      logLatency("workspace.worktree.resolve.success", {
        attemptId: entry.attemptId,
        repoRootId: normalizedInput.repoRootId,
        sourceWorkspaceId: normalizedInput.sourceWorkspaceId ?? null,
        repoLabel: resolved.repoName,
        branchName: resolved.params.branchName,
        baseRef: resolved.params.baseRef,
        checkoutMode: resolved.params.checkoutMode,
        resolveElapsedMs: elapsedMs(resolveStartedAt),
      });

      const createStartedAt = startLatencyTimer();
      logLatency("workspace.worktree.create.request.start", {
        attemptId: entry.attemptId,
        repoRootId: normalizedInput.repoRootId,
        sourceWorkspaceId: normalizedInput.sourceWorkspaceId ?? null,
        targetPath: resolved.params.targetPath,
        branchName: resolved.params.branchName,
        baseRef: resolved.params.baseRef,
        checkoutMode: resolved.params.checkoutMode,
        elapsedSincePendingMs: elapsedSince(entry.createdAt),
      });
      const result = await createWorktreeWorkspace(resolved.params, {
        latencyFlowId: options?.latencyFlowId,
      });
      annotateLatencyFlow(options?.latencyFlowId, {
        targetWorkspaceId: result.workspace.id,
      });
      logLatency("workspace.worktree.create.success", {
        attemptId: entry.attemptId,
        workspaceId: result.workspace.id,
        createElapsedMs: elapsedMs(createStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      if (!isAttemptCurrent(entry.attemptId)) {
        return null;
      }

      const selectionEntry: PendingWorkspaceEntry = {
        ...entry,
        workspaceId: result.workspace.id,
        baseBranchName: resolved.params.baseRef,
        setupScript: result.setupScript ?? null,
      };

      const selectionFinalized = await finalizeSelection(selectionEntry, result.workspace.id, {
        latencyFlowId: options?.latencyFlowId,
        repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(result.workspace, repoRoots),
      });
      if (!selectionFinalized) {
        return null;
      }
      return { workspaceId: result.workspace.id, projectedSessionId };
    } catch (error) {
      const currentPending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
      failLatencyFlow(options?.latencyFlowId, "worktree_enter_failed");
      if (entry && currentPending?.attemptId === attemptId) {
        failPendingEntry(
          currentPending,
          resolveErrorMessage(error, "Failed to create worktree."),
        );
      }
      if (options?.throwOnFailure) {
        throw error;
      }
      return null;
    }
  }, [
    beginPendingWorkspace,
    createWorktreeWorkspace,
    failPendingEntry,
    finalizeSelection,
    repoRoots,
    resolveWorktreeCreationInput,
    selectWorkspaceWithArrival,
    setPendingWorkspaceEntry,
    workspaceCollections,
  ]);

  const createWorktreeAndEnter = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: WorkspaceEntryOptions,
  ) => {
    await createWorktreeAndEnterInternal(input, options);
  }, [createWorktreeAndEnterInternal]);

  const createWorktreeAndEnterWithResult = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: WorkspaceEntryOptions,
  ): Promise<WorkspaceEntryResult> => {
    const result = await createWorktreeAndEnterInternal(input, {
      ...options,
      throwOnFailure: true,
    });
    if (!result) {
      throw new Error("Worktree creation was interrupted.");
    }
    return result;
  }, [createWorktreeAndEnterInternal]);

  return {
    createLocalWorkspaceAndEnter,
    createLocalWorkspaceAndEnterWithResult,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    createWorktreeAndEnterWithResult,
    isCreatingWorktreeWorkspace,
  };
}
