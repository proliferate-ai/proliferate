import { useCallback } from "react";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  buildWorkspaceArrivalEvent,
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/arrival";
import { useWorkspaces } from "./use-workspaces";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";
import {
  buildSubmittingPendingWorkspaceEntry as buildSubmittingPendingEntry,
  createPendingWorkspaceAttemptId as createAttemptId,
} from "@/lib/domain/workspaces/pending-entry";
import {
  type CreateWorktreeWorkspaceInput,
  type WorktreeCreationParams,
} from "@/lib/domain/workspaces/workspace-creation";
import { sidebarRepoGroupKeyForWorkspace } from "@/lib/domain/workspaces/sidebar-group-key";
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
} from "@/lib/infra/debug-latency";
import {
  annotateLatencyFlow,
  failLatencyFlow,
} from "@/lib/infra/latency-flow";

function resolveDisplayNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "workspace";
}

const EMPTY_REPO_ROOTS: RepoRoot[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];

function normalizeWorktreeInput(
  input: string | CreateWorktreeWorkspaceInput,
  source: Workspace | null,
  allWorkspaces: readonly Workspace[],
): CreateWorktreeWorkspaceInput {
  const existingBasenames = source
    ? collectWorktreeBasenamesForRepo(allWorkspaces, source)
    : new Set<string>();

  if (typeof input === "string") {
    return {
      repoRootId: input,
      workspaceName: generateWorkspaceSlug(existingBasenames),
    };
  }

  return {
    ...input,
    workspaceName: input.workspaceName?.trim() || generateWorkspaceSlug(existingBasenames),
  };
}

function isAttemptCurrent(attemptId: string): boolean {
  return useHarnessStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface CreateLocalWorkspaceAndEnterOptions {
  lightweight?: boolean;
  repoGroupKeyToExpand?: string | null;
}

interface CreateWorktreeAndEnterOptions {
  lightweight?: boolean;
  latencyFlowId?: string | null;
  repoGroupKeyToExpand?: string | null;
}

interface CreateWorktreeAndEnterInternalOptions extends CreateWorktreeAndEnterOptions {
  throwOnFailure?: boolean;
}

interface WorkspaceEntryResult {
  workspaceId: string;
}

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
  const { selectWorkspaceWithArrival } = useWorkspaceEntryFlow();
  const { selectWorkspace } = useWorkspaceSelection();
  const enterPendingWorkspaceShell = useHarnessStore(
    (state) => state.enterPendingWorkspaceShell,
  );
  const setPendingWorkspaceEntry = useHarnessStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useHarnessStore(
    (state) => state.setWorkspaceArrivalEvent,
  );

  const beginPendingWorkspace = useCallback((entry: PendingWorkspaceEntry) => {
    logLatency("workspace.entry.pending_shell", {
      attemptId: entry.attemptId,
      source: entry.source,
      requestKind: entry.request.kind,
      displayName: entry.displayName,
      repoLabel: entry.repoLabel,
      baseBranchName: entry.baseBranchName,
      originKind: entry.originTarget.kind,
    });
    useWorkspaceFilesStore.getState().reset();
    enterPendingWorkspaceShell(entry);
  }, [enterPendingWorkspaceShell]);

  const finalizeSelection = useCallback(async (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: { latencyFlowId?: string | null; repoGroupKeyToExpand?: string | null },
  ): Promise<boolean> => {
    const selectionStartedAt = startLatencyTimer();
    logLatency("workspace.entry.selection.start", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });

    setPendingWorkspaceEntry({
      ...entry,
      workspaceId,
      request: { kind: "select-existing", workspaceId },
      errorMessage: null,
    });
    annotateLatencyFlow(options?.latencyFlowId, {
      attemptId: entry.attemptId,
      targetWorkspaceId: workspaceId,
    });
    if (options?.repoGroupKeyToExpand) {
      ensureRepoGroupExpanded(options.repoGroupKeyToExpand);
    }

    await selectWorkspace(workspaceId, {
      force: true,
      preservePending: true,
      latencyFlowId: options?.latencyFlowId,
    });

    if (!isAttemptCurrent(entry.attemptId)) {
      logLatency("workspace.entry.selection.stale", {
        attemptId: entry.attemptId,
        source: entry.source,
        workspaceId,
        selectionElapsedMs: elapsedMs(selectionStartedAt),
      });
      return false;
    }

    setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
      workspaceId,
      source: entry.source,
      setupScript: entry.setupScript,
      baseBranchName: entry.baseBranchName,
    }));
    setPendingWorkspaceEntry(null);
    logLatency("workspace.entry.selection.success", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      selectionElapsedMs: elapsedMs(selectionStartedAt),
      totalElapsedMs: elapsedSince(entry.createdAt),
    });
    return true;
  }, [selectWorkspace, setPendingWorkspaceEntry, setWorkspaceArrivalEvent]);

  const failPendingEntry = useCallback((
    entry: PendingWorkspaceEntry,
    errorMessage: string,
    overrides?: Partial<Pick<PendingWorkspaceEntry, "workspaceId" | "request" | "setupScript">>,
  ) => {
    if (!isAttemptCurrent(entry.attemptId)) {
      return;
    }

    logLatency("workspace.entry.failed", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId: overrides?.workspaceId ?? entry.workspaceId,
      errorMessage,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });
    setPendingWorkspaceEntry({
      ...entry,
      stage: "failed",
      errorMessage,
      workspaceId: overrides?.workspaceId ?? entry.workspaceId,
      request: overrides?.request ?? entry.request,
      setupScript: overrides?.setupScript ?? entry.setupScript,
    });
  }, [setPendingWorkspaceEntry]);

  const createLocalWorkspaceAndEnter = useCallback(async (
    sourceRoot: string,
    options?: CreateLocalWorkspaceAndEnterOptions,
  ) => {
    const startedAt = startLatencyTimer();
    const sourceRepoGroupKey = options?.repoGroupKeyToExpand ?? sourceRoot;
    // Open immediately for feedback; success reopens using the returned workspace.
    ensureRepoGroupExpanded(sourceRepoGroupKey);

    // Lightweight path: skip pending shell, keep current workspace visible,
    // just run the mutation and select on success. Used when creating from
    // the sidebar while already in a workspace.
    if (options?.lightweight) {
      try {
        const workspace = await createLocalWorkspace(sourceRoot);
        await selectWorkspaceWithArrival({
          workspaceId: workspace.id,
          source: "local-created",
          setupScript: null,
          baseBranchName: null,
          repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(workspace, repoRoots),
        });
      } catch (error) {
        throw error;
      }
      return;
    }

    const entry = buildSubmittingPendingEntry({
      attemptId: createAttemptId(),
      selectedWorkspaceId: useHarnessStore.getState().selectedWorkspaceId,
      source: "local-created",
      displayName: resolveDisplayNameFromPath(sourceRoot),
      request: { kind: "local", sourceRoot },
    });

    beginPendingWorkspace(entry);

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
        return;
      }
      const selectionEntry: PendingWorkspaceEntry = {
        ...entry,
        workspaceId: workspace.id,
        request: { kind: "select-existing", workspaceId: workspace.id },
      };
      await finalizeSelection(selectionEntry, workspace.id, {
        repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(workspace, repoRoots),
      });
    } catch (error) {
      const currentPending = useHarnessStore.getState().pendingWorkspaceEntry;
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
    }
  }, [
    beginPendingWorkspace,
    createLocalWorkspace,
    failPendingEntry,
    finalizeSelection,
    repoRoots,
    selectWorkspaceWithArrival,
  ]);

  const createWorktreeAndEnterInternal = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: CreateWorktreeAndEnterInternalOptions,
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

    // Lightweight path: skip pending shell, keep current workspace visible.
    // Used when creating from the sidebar while already in a workspace.
    if (options?.lightweight) {
      try {
        const resolved = await resolveWorktreeCreationInput(normalizedInput);
        const result = await createWorktreeWorkspace(resolved.params, {
          latencyFlowId: options.latencyFlowId,
        });
        const repoGroupKeyToExpand = sidebarRepoGroupKeyForWorkspace(result.workspace, repoRoots);
        annotateLatencyFlow(options.latencyFlowId, {
          targetWorkspaceId: result.workspace.id,
        });
        await selectWorkspaceWithArrival({
          workspaceId: result.workspace.id,
          source: "worktree-created",
          setupScript: result.setupScript ?? null,
          baseBranchName: resolved.params.baseRef,
          repoGroupKeyToExpand,
          latencyFlowId: options.latencyFlowId,
        });
        return { workspaceId: result.workspace.id };
      } catch (error) {
        failLatencyFlow(options?.latencyFlowId, "worktree_enter_failed");
        throw error;
      }
    }

    const entry = buildSubmittingPendingEntry({
      attemptId: createAttemptId(),
      selectedWorkspaceId: useHarnessStore.getState().selectedWorkspaceId,
      source: "worktree-created",
      displayName: normalizedInput.workspaceName?.trim() || "worktree",
      request: { kind: "worktree", input: normalizedInput },
    });
    annotateLatencyFlow(options?.latencyFlowId, {
      attemptId: entry.attemptId,
    });

    beginPendingWorkspace(entry);

    let params: WorktreeCreationParams | null = null;

    try {
      const resolveStartedAt = startLatencyTimer();
      logLatency("workspace.worktree.resolve.start", {
        attemptId: entry.attemptId,
        repoRootId: normalizedInput.repoRootId,
        sourceWorkspaceId: normalizedInput.sourceWorkspaceId ?? null,
      });
      const resolved = await resolveWorktreeCreationInput(normalizedInput);
      params = resolved.params;
      logLatency("workspace.worktree.resolve.success", {
        attemptId: entry.attemptId,
        repoRootId: normalizedInput.repoRootId,
        sourceWorkspaceId: normalizedInput.sourceWorkspaceId ?? null,
        repoLabel: resolved.repoName,
        branchName: resolved.params.branchName,
        baseRef: resolved.params.baseRef,
        resolveElapsedMs: elapsedMs(resolveStartedAt),
      });

      if (!isAttemptCurrent(entry.attemptId)) {
        return null;
      }

      const updatedEntry: PendingWorkspaceEntry = {
        ...entry,
        repoLabel: resolved.repoName,
        baseBranchName: resolved.params.baseRef,
        request: { kind: "worktree", input: normalizedInput },
      };
      setPendingWorkspaceEntry(updatedEntry);

      const createStartedAt = startLatencyTimer();
      logLatency("workspace.worktree.create.request.start", {
        attemptId: entry.attemptId,
        repoRootId: normalizedInput.repoRootId,
        sourceWorkspaceId: normalizedInput.sourceWorkspaceId ?? null,
        targetPath: resolved.params.targetPath,
        branchName: resolved.params.branchName,
        baseRef: resolved.params.baseRef,
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
        ...updatedEntry,
        workspaceId: result.workspace.id,
        request: { kind: "select-existing", workspaceId: result.workspace.id },
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
      return { workspaceId: result.workspace.id };
    } catch (error) {
      const currentPending = useHarnessStore.getState().pendingWorkspaceEntry;
      failLatencyFlow(options?.latencyFlowId, "worktree_enter_failed");
      failPendingEntry(
        currentPending?.attemptId === entry.attemptId
          ? currentPending
          : entry,
        resolveErrorMessage(error, "Failed to create worktree."),
        params ? { request: { kind: "worktree", input: normalizedInput } } : undefined,
      );
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
    options?: CreateWorktreeAndEnterOptions,
  ) => {
    await createWorktreeAndEnterInternal(input, options);
  }, [createWorktreeAndEnterInternal]);

  const createWorktreeAndEnterWithResult = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: CreateWorktreeAndEnterOptions,
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
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    createWorktreeAndEnterWithResult,
    isCreatingWorktreeWorkspace,
  };
}
