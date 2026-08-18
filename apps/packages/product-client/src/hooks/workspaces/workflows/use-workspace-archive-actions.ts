import {
  AnyHarnessError,
  type WorkspaceArchiveNoticeKind,
  type WorkspaceUnarchiveScenarioBody,
} from "@anyharness/sdk";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useArchivedWorkspacesInvalidation } from "#product/hooks/workspaces/cache/use-archived-workspaces-invalidation";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceSidebarActions } from "#product/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useWorkspaceArchiveVisibility } from "#product/hooks/workspaces/workflows/use-workspace-archive-visibility";
import {
  ARCHIVE_TIMEOUT,
  readGitLockedFile,
  readUnarchiveScenario,
  waitForArchiveSettlement,
} from "#product/hooks/workspaces/workflows/workspace-archive-request-settlement";
import {
  archiveNoticeDescription,
  unarchiveNoticeDescription,
  ARCHIVE_TOAST_COPY,
} from "#product/copy/workspaces/archive-toast-copy";
import {
  resolveArchiveWorkspaceRequest,
  resolveUnarchiveWorkspaceRequest,
  type UnarchiveScenarioAnswer,
} from "#product/lib/domain/workspaces/archived/archive-knob-resolution";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import {
  archiveWorkspace as archiveWorkspaceRequest,
  unarchiveWorkspace as unarchiveWorkspaceRequest,
} from "#product/lib/access/anyharness/workspaces";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useRepoPreferencesStore } from "#product/stores/preferences/repo-preferences-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { showToast } from "#product/primitives/utils/show-toast";

/** T7 ("busy") auto-dismisses; every other failure toast here is persistent
 * (via `isError`) because it is one. */
const BUSY_TOAST_DURATION_MS = 6_000;

/** T1/T2 success toasts auto-dismiss: Undo and the View links are expiring
 * conveniences, not decisions the toast must hold open — the archived page
 * keeps both affordances available after the toast is gone. */
const SUCCESS_TOAST_DURATION_MS = 10_000;

export interface UnarchiveScenarioState {
  workspaceId: string;
  workspaceName: string;
  scenario: WorkspaceUnarchiveScenarioBody["scenario"];
  occupantName: string | null;
  occupantLifecycle: string | null;
  strategies: WorkspaceUnarchiveScenarioBody["strategies"];
}

/**
 * The archive/unarchive workflow hook: owns the optimistic-hide set, knob
 * resolution at click time, the toast raises, the scenario-409 capture, and
 * invalidation of both the active-collections and archived queries. Rides
 * the R4 routes; components render and forward.
 */
export function useWorkspaceArchiveActions() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const invalidateActiveCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const invalidateArchived = useArchivedWorkspacesInvalidation(runtimeUrl);
  const { data: collections } = useWorkspaces();
  const { handleSelectWorkspace } = useWorkspaceSidebarActions();
  const navigate = useNavigate();
  const invalidateBoth = useCallback(async () => {
    await Promise.all([invalidateActiveCollections(), invalidateArchived()]);
  }, [invalidateActiveCollections, invalidateArchived]);

  const {
    addOptimistic,
    optimisticallyArchivedIds,
    pendingDecisionIds,
    releaseHiddenAfterListsSettle,
    removeOptimistic,
  } = useWorkspaceArchiveVisibility(invalidateBoth);
  const [scenario, setScenario] = useState<UnarchiveScenarioState | null>(null);
  // Per-pending-id metadata the reconciler needs once the POST has already
  // settled from this hook's own point of view: the name for a late T1, and
  // whether the workspace was selected for Undo's reselect. Cleared the
  // moment the id leaves the optimistic set, by whichever path clears it.
  const pendingArchiveMetaRef = useRef<Map<string, { name: string; wasSelected: boolean }>>(
    new Map(),
  );

  // Broken forward-reference: `archive`/`unarchive` are the retry target for
  // their own failure toasts, but they are declared after the code that
  // needs to call them. Refs (assigned during render, below) hold the
  // latest closure so an earlier-declared callback can still reach it.
  const archiveRef = useRef<(workspaceId: string, name: string, wasSelected: boolean) => void>(
    () => {},
  );
  const unarchiveRef = useRef<
    (workspaceId: string, name: string, answer?: UnarchiveScenarioAnswer) => void
  >(() => {});

  // Ids whose archive already SETTLED as success but whose list refetch has
  // not landed yet. Un-hiding at settle time would render the row back out
  // of the stale cached list for the refetch window (a visible flash right
  // as T1 pops), so these stay hidden — but they must leave the reconciler's
  // pending set at settle, or a poll tick inside that window would confirm
  // the same archive twice and raise a duplicate T1.
  const raiseArchiveFailureToast = useCallback((workspaceId: string, name: string, error: unknown) => {
    const code = error instanceof AnyHarnessError ? error.problem.code : undefined;
    switch (code) {
      case "WORKSPACE_GIT_OPERATION_IN_PROGRESS":
        showToast({
          weight: "announcement", tone: "destructive", isError: true,
          title: ARCHIVE_TOAST_COPY.archiveFailedTitle(name),
          description: ARCHIVE_TOAST_COPY.gitOperationInProgressDescription,
        });
        return;
      case "WORKSPACE_UNBORN_HEAD":
        showToast({
          weight: "announcement", tone: "destructive", isError: true,
          title: ARCHIVE_TOAST_COPY.archiveFailedTitle(name),
          description: ARCHIVE_TOAST_COPY.unbornHeadDescription,
        });
        return;
      case "WORKSPACE_HOLLOW_CHECKOUT":
        showToast({
          weight: "announcement", tone: "destructive", isError: true,
          title: ARCHIVE_TOAST_COPY.archiveFailedTitle(name),
          description: ARCHIVE_TOAST_COPY.hollowCheckoutDescription,
        });
        return;
      case "WORKSPACE_GIT_LOCKED":
        showToast({
          weight: "announcement", tone: "destructive", isError: true,
          title: ARCHIVE_TOAST_COPY.archiveFailedTitle(name),
          description: ARCHIVE_TOAST_COPY.gitLockedDescription(readGitLockedFile(error)),
        });
        return;
      case "WORKSPACE_OPERATION_IN_FLIGHT":
        showToast({
          weight: "announcement", tone: "warning",
          duration: BUSY_TOAST_DURATION_MS,
          title: ARCHIVE_TOAST_COPY.busyTitle(name),
          description: ARCHIVE_TOAST_COPY.busyDescription,
        });
        return;
      case "WORKSPACE_ARCHIVE_FAILED":
      default:
        showToast({
          weight: "announcement", tone: "destructive", isError: true,
          title: ARCHIVE_TOAST_COPY.archiveFailedTitle(name),
          description: ARCHIVE_TOAST_COPY.archiveFailedDescription,
          secondary: { label: "Retry", onClick: () => archiveRef.current(workspaceId, name, false) },
        });
    }
  }, []);

  const raiseUnarchiveFailureToast = useCallback((
    workspaceId: string,
    name: string,
    answer: UnarchiveScenarioAnswer | undefined,
    error: unknown,
  ) => {
    const code = error instanceof AnyHarnessError ? error.problem.code : undefined;
    if (code === "WORKSPACE_OPERATION_IN_FLIGHT") {
      showToast({
        weight: "announcement", tone: "warning",
        duration: BUSY_TOAST_DURATION_MS,
        title: ARCHIVE_TOAST_COPY.busyTitle(name),
        description: ARCHIVE_TOAST_COPY.busyDescription,
      });
      return;
    }
    showToast({
      weight: "announcement", tone: "destructive", isError: true,
      title: ARCHIVE_TOAST_COPY.unarchiveFailedTitle(name),
      description: ARCHIVE_TOAST_COPY.unarchiveFailedDescription,
      secondary: {
        label: "Retry",
        onClick: () => unarchiveRef.current(workspaceId, name, answer),
      },
    });
  }, []);

  // Shared between the immediate-success path and the reconciler's late
  // confirmation: Undo posts /unarchive through the same resolver either
  // way, and "View archived" always lands on the archived page. `wasSelected`
  // is captured by value (not re-read from the ref) so a click on Undo well
  // after the pending metadata is cleared still restores selection correctly.
  const raiseArchiveSuccessToast = useCallback((
    workspaceId: string,
    name: string,
    noticeKinds: readonly WorkspaceArchiveNoticeKind[],
    wasSelected: boolean,
  ) => {
    showToast({
      weight: "announcement",
      tone: "success",
      duration: SUCCESS_TOAST_DURATION_MS,
      title: ARCHIVE_TOAST_COPY.archiveSuccessTitle(name),
      description: archiveNoticeDescription(noticeKinds),
      secondary: {
        label: ARCHIVE_TOAST_COPY.undoLabel,
        onClick: () => {
          unarchiveRef.current(workspaceId, name);
          if (wasSelected) {
            handleSelectWorkspace(workspaceId);
          }
        },
      },
      commit: {
        label: ARCHIVE_TOAST_COPY.viewArchivedLabel,
        onClick: () => navigate(buildSettingsHref({ section: "archived-workspaces" })),
      },
    });
  }, [handleSelectWorkspace, navigate]);

  // Consumes and clears this id's pending metadata, returning whether it was
  // selected when archive was requested. Both settle paths (immediate and
  // reconciler-confirmed) call this exactly once, right before they stop
  // treating the id as pending.
  const finalizeArchiveMeta = useCallback((workspaceId: string): boolean => {
    const meta = pendingArchiveMetaRef.current.get(workspaceId);
    pendingArchiveMetaRef.current.delete(workspaceId);
    return meta?.wasSelected ?? false;
  }, []);

  const runArchive = useCallback(async (workspaceId: string, name: string) => {
    const workspace = collections?.workspaces.find((candidate) => candidate.id === workspaceId)
      ?? null;
    const request = resolveArchiveWorkspaceRequest({
      workspace,
      repoRoots: collections?.repoRoots ?? [],
      repoConfigs: useRepoPreferencesStore.getState().repoConfigs,
      deleteBranchOnArchive: useUserPreferencesStore.getState().deleteBranchOnArchive,
    });
    const connection = { runtimeUrl };
    const outcome = await waitForArchiveSettlement(
      archiveWorkspaceRequest(connection, workspaceId, request),
    );
    if (outcome === ARCHIVE_TIMEOUT) {
      // Unknown outcome: leave the row hidden, raise no toast. The pending
      // reconciler decides — it either prunes this id (firing T1 late) or
      // re-adds the row if the server still reports it active.
      return;
    }
    const wasSelected = finalizeArchiveMeta(workspaceId);
    releaseHiddenAfterListsSettle(workspaceId);
    raiseArchiveSuccessToast(
      workspaceId,
      name,
      outcome.notices.map((notice) => notice.kind),
      wasSelected,
    );
  }, [
    collections,
    finalizeArchiveMeta,
    raiseArchiveSuccessToast,
    releaseHiddenAfterListsSettle,
    runtimeUrl,
  ]);

  /**
   * The pending reconciler's confirmation path (`use-archive-pending-reconciler`):
   * the lifecycle-filtered poll found this id archived after this hook's own
   * settle-timeout gave up waiting. A slow success must still leave the user
   * an Undo, not silently vanish the row — so this fires T1 exactly as the
   * immediate-success path does, just without a notices list (the poll only
   * confirms lifecycle state, not the archive response body).
   */
  const confirmArchived = useCallback((workspaceId: string) => {
    const name = pendingArchiveMetaRef.current.get(workspaceId)?.name ?? "workspace";
    const wasSelected = finalizeArchiveMeta(workspaceId);
    releaseHiddenAfterListsSettle(workspaceId);
    raiseArchiveSuccessToast(workspaceId, name, [], wasSelected);
  }, [finalizeArchiveMeta, raiseArchiveSuccessToast, releaseHiddenAfterListsSettle]);

  /**
   * The pending reconciler's reinstate path: the server still reports this
   * id active, so the archive attempt never actually landed (crash before
   * response). The row comes back and NO toast fires — there was no failure,
   * the client was just stale about an attempt that didn't happen.
   */
  const reinstateOptimistic = useCallback((workspaceId: string) => {
    finalizeArchiveMeta(workspaceId);
    removeOptimistic(workspaceId);
    void invalidateBoth();
  }, [finalizeArchiveMeta, invalidateBoth, removeOptimistic]);

  const runUnarchive = useCallback(async (
    workspaceId: string,
    name: string,
    answer?: UnarchiveScenarioAnswer,
  ) => {
    const workspace = collections?.workspaces.find((candidate) => candidate.id === workspaceId)
      ?? null;
    const request = resolveUnarchiveWorkspaceRequest({
      workspace,
      repoRoots: collections?.repoRoots ?? [],
      repoConfigs: useRepoPreferencesStore.getState().repoConfigs,
      answer,
    });
    const connection = { runtimeUrl };
    try {
      const outcome = await unarchiveWorkspaceRequest(connection, workspaceId, request);
      setScenario(null);
      void invalidateBoth();
      const noticeKinds = outcome.notices.map((notice) => notice.kind);
      if (noticeKinds.includes("head_mismatch")) {
        showToast({
          weight: "announcement",
          tone: "warning",
          isError: true,
          title: ARCHIVE_TOAST_COPY.headMismatchTitle(name),
          description: ARCHIVE_TOAST_COPY.headMismatchDescription,
          commit: {
            label: ARCHIVE_TOAST_COPY.viewNowLabel,
            onClick: () => handleSelectWorkspace(workspaceId),
          },
        });
        return;
      }
      showToast({
        weight: "announcement",
        tone: "success",
        duration: SUCCESS_TOAST_DURATION_MS,
        title: ARCHIVE_TOAST_COPY.unarchiveSuccessTitle(name),
        description: unarchiveNoticeDescription(noticeKinds),
        commit: {
          label: ARCHIVE_TOAST_COPY.viewNowLabel,
          onClick: () => handleSelectWorkspace(workspaceId),
        },
      });
    } catch (error) {
      const scenarioBody = readUnarchiveScenario(error);
      if (scenarioBody) {
        setScenario({
          workspaceId,
          workspaceName: name,
          scenario: scenarioBody.scenario,
          occupantName: scenarioBody.occupantName ?? null,
          occupantLifecycle: scenarioBody.occupantLifecycle ?? null,
          strategies: scenarioBody.strategies,
        });
        return;
      }
      raiseUnarchiveFailureToast(workspaceId, name, answer, error);
    }
  }, [collections, handleSelectWorkspace, invalidateBoth, raiseUnarchiveFailureToast, runtimeUrl]);

  const archive = useCallback((workspaceId: string, name: string, wasSelected: boolean) => {
    pendingArchiveMetaRef.current.set(workspaceId, { name, wasSelected });
    addOptimistic(workspaceId);
    void runArchive(workspaceId, name).catch((error) => {
      finalizeArchiveMeta(workspaceId);
      removeOptimistic(workspaceId);
      raiseArchiveFailureToast(workspaceId, name, error);
    });
  }, [addOptimistic, finalizeArchiveMeta, raiseArchiveFailureToast, removeOptimistic, runArchive]);

  const unarchive = useCallback((
    workspaceId: string,
    name: string,
    answer?: UnarchiveScenarioAnswer,
  ) => {
    void runUnarchive(workspaceId, name, answer);
  }, [runUnarchive]);

  archiveRef.current = archive;
  unarchiveRef.current = unarchive;

  const dismissScenario = useCallback(() => setScenario(null), []);

  return {
    archive,
    unarchive,
    optimisticallyArchivedIds,
    pendingDecisionIds,
    confirmArchived,
    reinstateOptimistic,
    scenario,
    dismissScenario,
  };
}
