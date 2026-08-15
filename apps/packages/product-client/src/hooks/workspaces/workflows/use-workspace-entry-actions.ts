import { useCallback } from "react";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  buildSubmittingPendingWorkspaceEntry as buildSubmittingPendingEntry,
  createPendingWorkspaceAttemptId as createAttemptId,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  type CreateWorktreeWorkspaceInput,
} from "#product/lib/domain/workspaces/creation/workspace-creation";
import { sidebarRepoGroupKeyForWorkspace } from "#product/lib/domain/workspaces/sidebar/sidebar-group-key";
import { ensureRepoGroupExpanded } from "#product/stores/preferences/workspace-ui-store";
import { useWorkspaceActions } from "#product/hooks/workspaces/workflows/use-workspace-actions";
import { useWorkspaceEntryFlow } from "#product/hooks/workspaces/workflows/use-workspace-entry-flow";
import { useWorkspaceEntrySelectionDeps } from "#product/hooks/workspaces/workflows/use-workspace-entry-selection-deps";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import {
  annotateLatencyFlow,
  failLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import {
  buildMaterializedWorktreePendingEntry,
  normalizeWorktreeInput,
  resolveDisplayNameFromPath,
  resolveErrorMessage,
} from "#product/hooks/workspaces/workflows/workspace-entry-action-helpers";
import {
  failPendingWorkspaceEntry,
  finalizePendingWorkspaceSelection,
  type WorkspaceEntryFinalizationResult,
} from "#product/hooks/workspaces/workflows/workspace-entry-finalization";
import {
  getPendingWorkspaceEntry,
  isAttemptLive,
  patchAttempt,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import {
  runLightweightLocalWorkspaceEntry,
  runLightweightWorktreeWorkspaceEntry,
} from "#product/hooks/workspaces/workflows/workspace-entry-lightweight";
import type {
  WorkspaceEntryInternalOptions,
  WorkspaceEntryOptions,
  WorkspaceEntryResult,
} from "#product/hooks/workspaces/workflows/workspace-entry-types";

const EMPTY_REPO_ROOTS: RepoRoot[] = [], EMPTY_WORKSPACES: Workspace[] = [];

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
  const entrySelectionDeps = useWorkspaceEntrySelectionDeps();

  const finalizeSelection = useCallback(async (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: {
      latencyFlowId?: string | null;
      repoGroupKeyToExpand?: string | null;
      knownWorkspace?: Workspace | null;
    },
  ): Promise<WorkspaceEntryFinalizationResult> => {
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
      attemptId: options?.attemptId ?? createAttemptId(),
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
      if (!isAttemptLive(entry.attemptId)) {
        return null;
      }
      const selectionEntry: PendingWorkspaceEntry = {
        ...entry,
        workspaceId: workspace.id,
      };
      // `committed` without `selected` is a background completion: the user
      // switched away mid-create and the launch finished behind them.
      const selection = await finalizeSelection(selectionEntry, workspace.id, {
        repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(workspace, repoRoots),
        knownWorkspace: workspace,
      });
      return selection.committed ? { workspaceId: workspace.id, projectedSessionId } : null;
    } catch (error) {
      const workspaceId = getPendingWorkspaceEntry(entry.attemptId)?.workspaceId ?? null;
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

  // Null means the user dismissed the pending workspace, not that creation
  // failed: real failures throw from the internal action.
  const createLocalWorkspaceAndEnterWithResult = useCallback((
    sourceRoot: string,
    options?: WorkspaceEntryOptions,
  ): Promise<WorkspaceEntryResult | null> => {
    return createLocalWorkspaceAndEnterInternal(sourceRoot, {
      ...options,
      throwOnFailure: true,
    });
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

    const attemptId = options?.attemptId ?? createAttemptId();
    let entry: PendingWorkspaceEntry | null = null;
    let projectedSessionId: string | null = null;

    try {
      // INSTANT SHELL: enter the pending chat shell synchronously — BEFORE the
      // resolve roundtrip — so a home-page send swaps straight into the chat
      // view with the user's message + thinking. Labels are provisional (repo
      // folder name, "New worktree") and are patched with resolved names right
      // after the resolve; the pending UI key is attemptId-based, so patching
      // display fields is safe.
      entry = buildSubmittingPendingEntry({
        attemptId,
        selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
        source: "worktree-created",
        displayName: normalizedInput.workspaceName ?? "New worktree",
        repoLabel: sourceRepoGroupKey ? sourceRepoGroupKey.split("/").pop() ?? null : null,
        baseBranchName: normalizedInput.baseBranch ?? normalizedInput.defaultBranch ?? null,
        request: { kind: "worktree", input: normalizedInput, retryInput: normalizedInput },
      });
      projectedSessionId = beginPendingWorkspace(entry, {
        initialSession: options?.initialSession,
      });
      annotateLatencyFlow(options?.latencyFlowId, {
        attemptId: entry.attemptId,
      });

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
      const resolvedEntry: PendingWorkspaceEntry = {
        ...entry,
        displayName: resolved.params.workspaceName,
        repoLabel: resolved.repoName,
        baseBranchName: resolved.params.baseRef,
        request: { kind: "worktree", input: resolvedInput, retryInput: normalizedInput },
      };
      patchAttempt(attemptId, resolvedEntry);
      entry = resolvedEntry;
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
      if (!isAttemptLive(entry.attemptId)) {
        return null;
      }

      const selectionEntry = buildMaterializedWorktreePendingEntry({
        entry,
        resolvedInput,
        workspace: result.workspace,
        fallbackBranchName: resolved.params.branchName,
        fallbackBaseRef: resolved.params.baseRef,
        setupScript: result.setupScript ?? null,
      });

      // `committed` without `selected` is a background completion: the user
      // switched away mid-create and the launch finished behind them.
      const selection = await finalizeSelection(selectionEntry, result.workspace.id, {
        latencyFlowId: options?.latencyFlowId,
        repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(result.workspace, repoRoots),
        knownWorkspace: result.workspace,
      });
      if (!selection.committed) {
        return null;
      }
      return { workspaceId: result.workspace.id, projectedSessionId };
    } catch (error) {
      const currentPending = getPendingWorkspaceEntry(attemptId);
      failLatencyFlow(options?.latencyFlowId, "worktree_enter_failed");
      if (entry && currentPending) {
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
    workspaceCollections,
  ]);

  const createWorktreeAndEnter = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: WorkspaceEntryOptions,
  ) => {
    await createWorktreeAndEnterInternal(input, options);
  }, [createWorktreeAndEnterInternal]);

  // Null means the user dismissed the pending worktree, not that creation
  // failed: real failures throw from the internal action.
  const createWorktreeAndEnterWithResult = useCallback((
    input: string | CreateWorktreeWorkspaceInput,
    options?: WorkspaceEntryOptions,
  ): Promise<WorkspaceEntryResult | null> => {
    return createWorktreeAndEnterInternal(input, {
      ...options,
      throwOnFailure: true,
    });
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
