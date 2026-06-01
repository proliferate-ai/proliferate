import type {
  CreateCoworkThreadRequest,
  CreateCoworkThreadResponse,
  Session,
} from "@anyharness/sdk";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/cloud/collections";
import {
  buildPendingWorkspaceOriginTarget,
  type PendingCoworkRequestInput,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";

export interface CreateCoworkThreadWorkflowInput {
  agentKind: string;
  modelId: string;
  modeId?: string | null;
  launchControlValues?: Record<string, string>;
  draftText?: string | null;
  sourceWorkspaceId?: string | null;
  coworkWorkspaceDelegationEnabled: boolean;
  runtimeUrl: string;
}

export interface CreateCoworkThreadWorkflowDeps {
  createPendingWorkspaceAttemptId(): string;
  nowMs(): number;
  nowIso(): string;
  startLatencyTimer(): number;
  elapsedMs(startedAt: number): number;
  elapsedSince(createdAt: number): number;
  logLatency(event: string, fields?: Record<string, unknown>): void;
  getSelectedWorkspaceId(): string | null;
  getPendingWorkspaceEntry(): PendingWorkspaceEntry | null;
  isAttemptCurrent(attemptId: string): boolean;
  setThreadsCollapsed(collapsed: boolean): void;
  beginPendingWorkspace(
    entry: PendingWorkspaceEntry,
    options: {
      initialSession: {
        kind: "session";
        agentKind: string;
        modelId: string;
        modeId?: string | null;
        launchControlValues?: Record<string, string>;
        displayTitle: string;
      };
    },
  ): string | null;
  navigateToWorkspaceShell(): void;
  createCoworkThread(
    input: CreateCoworkThreadRequest,
  ): Promise<CreateCoworkThreadResponse>;
  applyLaunchDefaults(input: {
    session: Session;
    agentKind: string;
    launchControlValues?: Record<string, string>;
  }): Promise<Session>;
  upsertLocalWorkspace(workspace: CreateCoworkThreadResponse["workspace"]): void;
  upsertWorkspaceSessionRecord(workspaceId: string, session: Session): void;
  recordCreatedSession(input: {
    projectedSessionId: string | null;
    launchedSession: Session;
    workspaceId: string;
    agentKind: string;
    modelId: string;
    modeId: string | null;
  }): void;
  setDraftText(workspaceId: string, text: string): void;
  clearDraft(workspaceId: string): void;
  setPendingWorkspaceEntry(entry: PendingWorkspaceEntry | null): void;
  activateWorkspace(input: {
    logicalWorkspaceId: string | null;
    workspaceId: string;
    clearPending: boolean;
    initialActiveSessionId: string | null;
  }): void;
  rememberLastViewedSession(workspaceId: string, sessionId: string): void;
  trackWorkspaceInteraction(workspaceId: string, viewedAt: string): void;
  markWorkspaceViewed(workspaceId: string): void;
  markWorkspaceBootstrappedInSession(workspaceId: string): void;
  initWorkspace(input: {
    workspaceUiKey: string;
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    treeStateKey: string;
  }): Promise<void>;
  showToast(message: string): void;
}

export type CreateCoworkThreadWorkflowResult =
  CreateCoworkThreadResponse
  & { projectedSessionId: string | null };

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function createCoworkThreadWorkflow(
  input: CreateCoworkThreadWorkflowInput,
  deps: CreateCoworkThreadWorkflowDeps,
): Promise<CreateCoworkThreadWorkflowResult | null> {
  const totalStartedAt = deps.startLatencyTimer();
  const modeId = input.modeId?.trim() || resolveCoworkDefaultSessionModeId(input.agentKind);
  const pendingRequest: PendingCoworkRequestInput = {
    agentKind: input.agentKind,
    modelId: input.modelId,
    ...(modeId ? { modeId } : {}),
    draftText: input.draftText ?? null,
    sourceWorkspaceId: input.sourceWorkspaceId ?? null,
  };

  const selectedWorkspaceId = deps.getSelectedWorkspaceId();
  const entry: PendingWorkspaceEntry = {
    attemptId: deps.createPendingWorkspaceAttemptId(),
    source: "cowork-created",
    stage: "submitting",
    displayName: "Cowork thread",
    repoLabel: null,
    baseBranchName: null,
    workspaceId: null,
    request: { kind: "cowork", input: pendingRequest },
    originTarget: buildPendingWorkspaceOriginTarget(selectedWorkspaceId),
    errorMessage: null,
    setupScript: null,
    createdAt: deps.nowMs(),
  };

  deps.logLatency("workspace.cowork.create.pending_shell", {
    attemptId: entry.attemptId,
    agentKind: input.agentKind,
    modelId: input.modelId,
  });
  deps.setThreadsCollapsed(false);
  const projectedSessionId = deps.beginPendingWorkspace(entry, {
    initialSession: {
      kind: "session",
      agentKind: input.agentKind,
      modelId: input.modelId,
      modeId,
      launchControlValues: input.launchControlValues,
      displayTitle: input.modelId,
    },
  });
  deps.navigateToWorkspaceShell();

  try {
    if (!deps.isAttemptCurrent(entry.attemptId)) {
      return null;
    }

    const createStartedAt = deps.startLatencyTimer();
    deps.logLatency("workspace.cowork.create.request.start", {
      attemptId: entry.attemptId,
      agentKind: input.agentKind,
      modelId: input.modelId,
      modeId: modeId ?? null,
      workspaceDelegationEnabled: input.coworkWorkspaceDelegationEnabled,
      elapsedSincePendingMs: deps.elapsedSince(entry.createdAt),
    });

    const result = await deps.createCoworkThread({
      agentKind: input.agentKind,
      modelId: input.modelId,
      coworkWorkspaceDelegationEnabled: input.coworkWorkspaceDelegationEnabled,
      ...(modeId ? { modeId } : {}),
    });

    deps.logLatency("workspace.cowork.create.request.success", {
      attemptId: entry.attemptId,
      workspaceId: result.workspace.id,
      sessionId: result.session.id,
      createElapsedMs: deps.elapsedMs(createStartedAt),
      totalElapsedMs: deps.elapsedMs(totalStartedAt),
    });

    if (!deps.isAttemptCurrent(entry.attemptId)) {
      return null;
    }

    const launchedSession = await deps.applyLaunchDefaults({
      session: result.session,
      agentKind: input.agentKind,
      launchControlValues: input.launchControlValues,
    });

    if (!deps.isAttemptCurrent(entry.attemptId)) {
      return null;
    }

    deps.upsertLocalWorkspace(result.workspace);
    deps.upsertWorkspaceSessionRecord(result.workspace.id, launchedSession);
    const activeSessionId = projectedSessionId ?? launchedSession.id;
    deps.recordCreatedSession({
      projectedSessionId,
      launchedSession,
      workspaceId: result.workspace.id,
      agentKind: input.agentKind,
      modelId: input.modelId,
      modeId: modeId ?? null,
    });
    if (input.draftText?.length) {
      deps.setDraftText(result.workspace.id, input.draftText);
      if (input.sourceWorkspaceId && input.sourceWorkspaceId !== result.workspace.id) {
        deps.clearDraft(input.sourceWorkspaceId);
      }
    }

    const selectionStartedAt = deps.startLatencyTimer();
    deps.setPendingWorkspaceEntry({
      ...entry,
      workspaceId: result.workspace.id,
      request: { kind: "select-existing", workspaceId: result.workspace.id },
    });
    deps.activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: result.workspace.id,
      clearPending: false,
      initialActiveSessionId: activeSessionId,
    });
    deps.rememberLastViewedSession(result.workspace.id, launchedSession.id);
    deps.trackWorkspaceInteraction(result.workspace.id, deps.nowIso());
    deps.markWorkspaceViewed(result.workspace.id);
    deps.markWorkspaceBootstrappedInSession(result.workspace.id);

    const workspaceInitStartedAt = deps.startLatencyTimer();
    void deps.initWorkspace({
      workspaceUiKey: result.workspace.id,
      materializedWorkspaceId: result.workspace.id,
      anyharnessWorkspaceId: result.workspace.id,
      runtimeUrl: input.runtimeUrl,
      treeStateKey: workspaceFileTreeStateKey(result.workspace),
    }).then(() => {
      deps.logLatency("workspace.cowork.create.workspace_initialized", {
        attemptId: entry.attemptId,
        workspaceId: result.workspace.id,
        elapsedMs: deps.elapsedMs(workspaceInitStartedAt),
      });
    }).catch(() => {
      deps.logLatency("workspace.cowork.create.workspace_init_failed", {
        attemptId: entry.attemptId,
        workspaceId: result.workspace.id,
        elapsedMs: deps.elapsedMs(workspaceInitStartedAt),
      });
    });
    deps.logLatency("workspace.cowork.create.selection.success", {
      attemptId: entry.attemptId,
      workspaceId: result.workspace.id,
      selectionElapsedMs: deps.elapsedMs(selectionStartedAt),
      totalElapsedMs: deps.elapsedMs(totalStartedAt),
    });
    if (deps.isAttemptCurrent(entry.attemptId)) {
      deps.setPendingWorkspaceEntry(null);
    }
    return {
      ...result,
      projectedSessionId,
    };
  } catch (error) {
    const message = resolveErrorMessage(error, "Couldn't start cowork thread.");
    deps.logLatency("workspace.cowork.create.failed", {
      attemptId: entry.attemptId,
      errorMessage: message,
      elapsedSincePendingMs: deps.elapsedSince(entry.createdAt),
    });
    if (deps.isAttemptCurrent(entry.attemptId)) {
      const currentPending = deps.getPendingWorkspaceEntry();
      const failedEntry = currentPending?.attemptId === entry.attemptId
        ? currentPending
        : entry;
      deps.setPendingWorkspaceEntry({
        ...failedEntry,
        stage: "failed",
        errorMessage: message,
      });
    }
    deps.showToast(message);
    throw error;
  }
}
