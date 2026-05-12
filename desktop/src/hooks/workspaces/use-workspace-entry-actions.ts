import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  buildWorkspaceArrivalEvent,
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/creation/arrival";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import type {
  PendingWorkspaceEntry,
  PendingWorkspaceInitialSession,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry as buildSubmittingPendingEntry,
  createPendingWorkspaceAttemptId as createAttemptId,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  type CreateWorktreeWorkspaceInput,
} from "@/lib/domain/workspaces/creation/workspace-creation";
import { sidebarRepoGroupKeyForWorkspace } from "@/lib/domain/workspaces/sidebar/sidebar-group-key";
import {
  ensureRepoGroupExpanded,
  useWorkspaceUiStore,
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
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import {
  ensurePendingWorkspaceSessionShell,
} from "@/hooks/workspaces/workflows/pending-workspace-session-shell";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  useActiveSessionLaunchState,
  useActiveSessionModeState,
} from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";

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
  return useSessionSelectionStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function requestChatInputFocus(): void {
  useChatInputStore.getState().requestFocus();
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function displayTitleForPendingSession(agentKind: string, modelId: string): string {
  return resolveModelDisplayName({
    agentKind,
    modelId,
    preferKnownAlias: true,
  }) ?? modelId;
}

function buildPendingInitialSession(input: {
  agentKind: string | null | undefined;
  modelId: string | null | undefined;
  modeId?: string | null;
  displayTitle?: string | null;
}): PendingWorkspaceInitialSession | null {
  const agentKind = input.agentKind?.trim();
  const modelId = input.modelId?.trim();
  if (!agentKind || !modelId) {
    return null;
  }

  return {
    kind: "session",
    agentKind,
    modelId,
    modeId: input.modeId ?? null,
    displayTitle: input.displayTitle ?? displayTitleForPendingSession(agentKind, modelId),
  };
}

interface CreateLocalWorkspaceAndEnterOptions {
  lightweight?: boolean;
  repoGroupKeyToExpand?: string | null;
  initialSession?: PendingWorkspaceInitialSession | null;
}

interface CreateLocalWorkspaceAndEnterInternalOptions extends CreateLocalWorkspaceAndEnterOptions {
  throwOnFailure?: boolean;
}

interface CreateWorktreeAndEnterOptions {
  lightweight?: boolean;
  latencyFlowId?: string | null;
  repoGroupKeyToExpand?: string | null;
  initialSession?: PendingWorkspaceInitialSession | null;
}

interface CreateWorktreeAndEnterInternalOptions extends CreateWorktreeAndEnterOptions {
  throwOnFailure?: boolean;
}

interface WorkspaceEntryResult {
  workspaceId: string;
  projectedSessionId: string | null;
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
  const configuredLaunch = useConfiguredLaunchReadiness();
  const launchDefaults = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
  })));
  const activeLaunchState = useActiveSessionLaunchState();
  const activeModeState = useActiveSessionModeState();
  const { selectWorkspace } = useWorkspaceSelection();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const enterPendingWorkspaceShell = useSessionSelectionStore(
    (state) => state.enterPendingWorkspaceShell,
  );
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );

  const beginPendingWorkspace = useCallback((
    entry: PendingWorkspaceEntry,
    options?: { initialSession?: PendingWorkspaceInitialSession | null },
  ): string | null => {
    const preferredAgentKind = launchDefaults.defaultChatAgentKind;
    const preferredModelId = preferredAgentKind
      ? launchDefaults.defaultChatModelIdByAgentKind[preferredAgentKind] ?? null
      : null;
    const initialSession = options?.initialSession === undefined
      ? buildPendingInitialSession({
        agentKind: configuredLaunch.selection?.kind,
        modelId: configuredLaunch.selection?.modelId,
        modeId: configuredLaunch.selection?.kind
          ? launchDefaults.defaultSessionModeByAgentKind[configuredLaunch.selection.kind] ?? null
          : null,
        displayTitle: configuredLaunch.displayName,
      }) ?? buildPendingInitialSession({
        agentKind: preferredAgentKind,
        modelId: preferredModelId,
        modeId: preferredAgentKind
          ? launchDefaults.defaultSessionModeByAgentKind[preferredAgentKind] ?? null
          : null,
      }) ?? buildPendingInitialSession({
        agentKind: activeLaunchState.currentLaunchIdentity?.kind,
        modelId: activeLaunchState.currentLaunchIdentity?.modelId,
        modeId: activeModeState.currentModeId,
      })
      : options.initialSession;
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    let projectedSessionId: string | null = null;
    batchSessionStoreWrites(() => {
      projectedSessionId = ensurePendingWorkspaceSessionShell({
        entry,
        initialSession: initialSession ?? null,
      });
      resetWorkspaceEditorState();
      if (projectedSessionId) {
        writeChatShellIntentForSession({
          workspaceId: pendingWorkspaceUiKey,
          shellWorkspaceId: pendingWorkspaceUiKey,
          sessionId: projectedSessionId,
        });
      }
      enterPendingWorkspaceShell(entry, {
        initialActiveSessionId: projectedSessionId,
      });
    });
    logLatency("workspace.entry.pending_shell", {
      attemptId: entry.attemptId,
      source: entry.source,
      requestKind: entry.request.kind,
      displayName: entry.displayName,
      repoLabel: entry.repoLabel,
      baseBranchName: entry.baseBranchName,
      originKind: entry.originTarget.kind,
      projectedSessionId,
      pendingWorkspaceUiKey,
      selectedLogicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
      activeSessionId: useSessionSelectionStore.getState().activeSessionId,
      storedActiveShellTabKey:
        useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace[pendingWorkspaceUiKey] ?? null,
      directorySessionIds:
        useSessionDirectoryStore.getState().sessionIdsByWorkspaceId[pendingWorkspaceUiKey] ?? [],
    });
    requestChatInputFocus();
    return projectedSessionId;
  }, [
    activeLaunchState.currentLaunchIdentity,
    activeModeState.currentModeId,
    configuredLaunch.displayName,
    configuredLaunch.selection,
    enterPendingWorkspaceShell,
    launchDefaults,
  ]);

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

    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    const currentActiveSessionId = useSessionSelectionStore.getState().activeSessionId;
    const projectedActiveSessionId = currentActiveSessionId
      && getSessionRecord(currentActiveSessionId)?.workspaceId === pendingWorkspaceUiKey
      ? currentActiveSessionId
      : null;

    await selectWorkspace(workspaceId, {
      force: true,
      preservePending: true,
      initialActiveSessionId: projectedActiveSessionId,
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

    materializePendingWorkspaceSessions(entry, workspaceId);

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
  }, [
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
  ]);

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

  const createLocalWorkspaceAndEnterInternal = useCallback(async (
    sourceRoot: string,
    options?: CreateLocalWorkspaceAndEnterInternalOptions,
  ): Promise<WorkspaceEntryResult | null> => {
    const startedAt = startLatencyTimer();
    const sourceRepoGroupKey = options?.repoGroupKeyToExpand ?? sourceRoot;
    // Open immediately for feedback; success reopens using the returned workspace.
    ensureRepoGroupExpanded(sourceRepoGroupKey);

    // Lightweight path: skip pending shell, keep current workspace visible,
    // just run the mutation and select on success. Used when creating from
    // the sidebar while already in a workspace.
    if (options?.lightweight) {
      try {
        requestChatInputFocus();
        const workspace = await createLocalWorkspace(sourceRoot);
        await selectWorkspaceWithArrival({
          workspaceId: workspace.id,
          source: "local-created",
          setupScript: null,
          baseBranchName: null,
          repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(workspace, repoRoots),
        });
        return { workspaceId: workspace.id, projectedSessionId: null };
      } catch (error) {
        throw error;
      }
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
        request: { kind: "select-existing", workspaceId: workspace.id },
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
    options?: CreateLocalWorkspaceAndEnterOptions,
  ) => {
    await createLocalWorkspaceAndEnterInternal(sourceRoot, options);
  }, [createLocalWorkspaceAndEnterInternal]);

  const createLocalWorkspaceAndEnterWithResult = useCallback(async (
    sourceRoot: string,
    options?: CreateLocalWorkspaceAndEnterOptions,
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
        requestChatInputFocus();
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
        return { workspaceId: result.workspace.id, projectedSessionId: null };
      } catch (error) {
        failLatencyFlow(options?.latencyFlowId, "worktree_enter_failed");
        throw error;
      }
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
    createLocalWorkspaceAndEnterWithResult,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    createWorktreeAndEnterWithResult,
    isCreatingWorktreeWorkspace,
  };
}
