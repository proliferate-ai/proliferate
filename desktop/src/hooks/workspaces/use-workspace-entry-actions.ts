import { useCallback } from "react";
import type { Workspace } from "@anyharness/sdk";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  buildWorkspaceArrivalEvent,
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/arrival";
import { useWorkspaces } from "./use-workspaces";
import type {
  PendingWorkspaceEntry,
  PendingWorkspaceOriginTarget,
  PendingWorkspaceRequest,
} from "@/lib/domain/workspaces/pending-entry";
import {
  type CreateWorktreeWorkspaceInput,
  type WorktreeCreationParams,
} from "@/lib/domain/workspaces/workspace-creation";
import type { CreateCloudWorkspaceRequest } from "@/lib/integrations/cloud/client";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/collections";
import { ensureRepoGroupExpanded } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useWorkspaceSelection } from "./selection/use-workspace-selection";
import { useCloudWorkspaceActions } from "@/hooks/cloud/use-cloud-workspace-actions";
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

function createAttemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveDisplayNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "workspace";
}

function buildOriginTarget(selectedWorkspaceId: string | null): PendingWorkspaceOriginTarget {
  return selectedWorkspaceId
    ? { kind: "workspace", workspaceId: selectedWorkspaceId }
    : { kind: "home" };
}

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

function buildSubmittingPendingEntry(input: {
  attemptId: string;
  source: PendingWorkspaceEntry["source"];
  displayName: string;
  repoLabel?: string | null;
  baseBranchName?: string | null;
  request: PendingWorkspaceRequest;
}): PendingWorkspaceEntry {
  return {
    attemptId: input.attemptId,
    source: input.source,
    stage: "submitting",
    displayName: input.displayName,
    repoLabel: input.repoLabel ?? null,
    baseBranchName: input.baseBranchName ?? null,
    workspaceId: null,
    request: input.request,
    originTarget: buildOriginTarget(useHarnessStore.getState().selectedWorkspaceId),
    errorMessage: null,
    setupScript: null,
    createdAt: Date.now(),
  };
}

export function useWorkspaceEntryActions() {
  const { data: workspaceCollections } = useWorkspaces();
  const {
    resolveWorktreeCreationInput,
    createLocalWorkspace,
    isCreatingLocalWorkspace,
    createWorktreeWorkspace,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceActions();
  const {
    createCloudWorkspace,
    isCreatingCloudWorkspace,
  } = useCloudWorkspaceActions();
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
    options?: { latencyFlowId?: string | null },
  ) => {
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
      return;
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
    options?: { lightweight?: boolean },
  ) => {
    const startedAt = startLatencyTimer();

    // Lightweight path: skip pending shell, keep current workspace visible,
    // just run the mutation and select on success. Used when creating from
    // the sidebar while already in a workspace.
    if (options?.lightweight) {
      try {
        const workspace = await createLocalWorkspace(sourceRoot);
        ensureRepoGroupExpanded(localWorkspaceGroupKey(workspace));
        setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
          workspaceId: workspace.id,
          source: "local-created",
          setupScript: null,
          baseBranchName: null,
        }));
        await selectWorkspace(workspace.id, { force: true });
      } catch (error) {
        throw error;
      }
      return;
    }

    const entry = buildSubmittingPendingEntry({
      attemptId: createAttemptId(),
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
      await finalizeSelection(selectionEntry, workspace.id);
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
  }, [beginPendingWorkspace, createLocalWorkspace, failPendingEntry, finalizeSelection, selectWorkspace, setWorkspaceArrivalEvent]);

  const createWorktreeAndEnter = useCallback(async (
    input: string | CreateWorktreeWorkspaceInput,
    options?: { lightweight?: boolean; latencyFlowId?: string | null },
  ) => {
    const startedAt = startLatencyTimer();
    const allWorkspaces = workspaceCollections?.localWorkspaces ?? [];
    const repoRootId = typeof input === "string" ? input : input.repoRootId;
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
        ensureRepoGroupExpanded(localWorkspaceGroupKey(result.workspace));
        setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
          workspaceId: result.workspace.id,
          source: "worktree-created",
          setupScript: result.setupScript ?? null,
          baseBranchName: resolved.params.baseRef,
        }));
        annotateLatencyFlow(options.latencyFlowId, {
          targetWorkspaceId: result.workspace.id,
        });
        await selectWorkspace(result.workspace.id, {
          force: true,
          latencyFlowId: options.latencyFlowId,
        });
      } catch (error) {
        failLatencyFlow(options?.latencyFlowId, "worktree_enter_failed");
        throw error;
      }
      return;
    }

    const entry = buildSubmittingPendingEntry({
      attemptId: createAttemptId(),
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
        return;
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
        return;
      }

      const selectionEntry: PendingWorkspaceEntry = {
        ...updatedEntry,
        workspaceId: result.workspace.id,
        request: { kind: "select-existing", workspaceId: result.workspace.id },
        baseBranchName: resolved.params.baseRef,
        setupScript: result.setupScript ?? null,
      };

      await finalizeSelection(selectionEntry, result.workspace.id, {
        latencyFlowId: options?.latencyFlowId,
      });
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
    }
  }, [
    beginPendingWorkspace,
    createWorktreeWorkspace,
    failPendingEntry,
    finalizeSelection,
    resolveWorktreeCreationInput,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    workspaceCollections,
  ]);

  const createCloudWorkspaceAndEnter = useCallback(async (
    input: CreateCloudWorkspaceRequest,
  ) => {
    const startedAt = startLatencyTimer();
    const branchName = input.branchName?.trim() || "cloud-workspace";
    const repoLabel = input.gitOwner && input.gitRepoName
      ? `${input.gitOwner}/${input.gitRepoName}`
      : null;
    const entry = buildSubmittingPendingEntry({
      attemptId: createAttemptId(),
      source: "cloud-created",
      displayName: branchName,
      repoLabel,
      baseBranchName: input.baseBranch?.trim() || null,
      request: { kind: "cloud", input },
    });

    beginPendingWorkspace(entry);

    try {
      logLatency("workspace.cloud_create.request.start", {
        attemptId: entry.attemptId,
        repoLabel,
        branchName,
        baseBranchName: entry.baseBranchName,
      });
      const workspace = await createCloudWorkspace(input);
      logLatency("workspace.cloud_create.request.success", {
        attemptId: entry.attemptId,
        workspaceId: workspace.id,
        status: workspace.status,
        requestElapsedMs: elapsedMs(startedAt),
      });
      if (!isAttemptCurrent(entry.attemptId)) {
        return;
      }

      const workspaceId = cloudWorkspaceSyntheticId(workspace.id);
      const updatedEntry: PendingWorkspaceEntry = {
        ...entry,
        stage: workspace.status === "ready" ? "submitting" : "awaiting-cloud-ready",
        workspaceId,
        request: { kind: "select-existing", workspaceId },
      };
      setPendingWorkspaceEntry(updatedEntry);

      if (workspace.status === "ready") {
        await finalizeSelection(updatedEntry, workspaceId);
        return;
      }

      await selectWorkspace(workspaceId, {
        force: true,
        preservePending: true,
      });
      logLatency("workspace.cloud_create.awaiting_ready", {
        attemptId: entry.attemptId,
        workspaceId,
        status: workspace.status,
        totalElapsedMs: elapsedSince(entry.createdAt),
      });
    } catch (error) {
      const currentPending = useHarnessStore.getState().pendingWorkspaceEntry;
      failPendingEntry(
        currentPending?.attemptId === entry.attemptId
          ? currentPending
          : entry,
        resolveErrorMessage(error, "Failed to create cloud workspace."),
      );
    }
  }, [
    beginPendingWorkspace,
    createCloudWorkspace,
    failPendingEntry,
    finalizeSelection,
    selectWorkspace,
    setPendingWorkspaceEntry,
  ]);

  return {
    createLocalWorkspaceAndEnter,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
    createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace,
  };
}
