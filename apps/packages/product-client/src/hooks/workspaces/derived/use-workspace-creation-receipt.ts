import { useMemo } from "react";
import { useSetupStatusQuery, useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import {
  buildPendingWorkspaceUiKey,
  resolvePendingWorkspacePath,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { summarizeSetupFailure } from "#product/lib/domain/workspaces/creation/arrival";
import {
  resolveFirstWorkspaceSessionId,
  type WorkspaceCreationReceiptNoun,
  type WorkspaceCreationReceiptSource,
} from "#product/lib/domain/workspaces/creation/creation-receipt";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useRepoPreferencesStore } from "#product/stores/preferences/repo-preferences-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { shouldUseLocalRuntimeWorkspaceSessionsQuery } from "#product/lib/domain/workspaces/tabs/workspace-session-query-target";
import { useIsHotPaintGatePendingForWorkspace } from "#product/hooks/workspaces/derived/use-hot-paint-gate";

export interface WorkspaceCreationReceiptState {
  /** Stable per-creation identity (workspace ui key or pending-entry key). */
  receiptKey: string;
  source: WorkspaceCreationReceiptSource;
  /** Backing entry for creating/creation-failed receipts (Retry/Back). */
  pendingEntry: PendingWorkspaceEntry | null;
}

function isReceiptPendingSource(entry: PendingWorkspaceEntry | null): entry is PendingWorkspaceEntry {
  // Cloud and cowork provisioning keep their composer panel; the receipt
  // owns only local/worktree creations.
  return !!entry
    && (entry.source === "local-created" || entry.source === "worktree-created");
}

function pendingNoun(entry: PendingWorkspaceEntry): WorkspaceCreationReceiptNoun {
  return entry.request.kind === "worktree" ? "worktree" : "workspace";
}

/**
 * Presence probe for the workspace-creation receipt: returns the stable
 * receipt key when the current selection warrants a receipt row, null
 * otherwise. Kept cheap (store + collection reads plus the already-cached
 * workspace sessions query) so the transcript pane can decide whether to
 * emit the row at all.
 *
 * Receipts derive from server truth with no storage of their own:
 * - a worktree workspace carries its receipt in its FIRST session only (the
 *   session born with the creation; later sessions must not replay it);
 * - a local-created workspace shows one only while its arrival event is
 *   live (plain opened folders must not read as "created"), same
 *   first-session scope;
 * - a pending local/worktree creation shows the creating/failed receipt
 *   (there is only one session at that point, so no gating applies).
 */
export function useWorkspaceCreationReceiptKey(): string | null {
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const workspaceArrivalEvent = useSessionSelectionStore((state) => state.workspaceArrivalEvent);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeMaterializedSessionId = useSessionDirectoryStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.materializedSessionId ?? null
      : null
  );
  const { data: workspaceCollections } = useWorkspaces();
  const { materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  // Rides the same query/cache entry as the workspace header tabs; only
  // needed once a materialized (non-pending) workspace is selected.
  const { data: workspaceSessions } = useWorkspaceSessionsQuery({
    workspaceId: materializedWorkspaceId,
    enabled:
      !isReceiptPendingSource(pendingWorkspaceEntry)
      && shouldUseLocalRuntimeWorkspaceSessionsQuery({
        workspaceId: materializedWorkspaceId,
        hotPaintPending,
      }),
  });

  return useMemo(() => {
    if (isReceiptPendingSource(pendingWorkspaceEntry)) {
      return buildPendingWorkspaceUiKey(pendingWorkspaceEntry);
    }
    const { workspaceUiKey } = resolveSelectedWorkspaceIdentity({
      selectedLogicalWorkspaceId,
      materializedWorkspaceId: selectedWorkspaceId,
    });
    if (!workspaceUiKey || !materializedWorkspaceId) {
      return null;
    }
    const workspace = workspaceCollections?.workspaces.find(
      (candidate) => candidate.id === materializedWorkspaceId,
    ) ?? null;
    if (!workspace) {
      return null;
    }
    // Live-arrival bridge: the arrival event is published in the same flow
    // that clears the pending entry, so its presence means this very
    // selection just performed the creation — definitionally the workspace's
    // first session. Skipping the query-backed proof below keeps the receipt
    // mounted across the creating→created handoff; without it the key goes
    // null for a round trip and the pending row flashes back to "Thinking".
    if (
      workspaceArrivalEvent?.workspaceId === workspace.id
      && (workspace.kind === "worktree" || workspaceArrivalEvent.source === "local-created")
    ) {
      return workspaceUiKey;
    }
    // First-session scope: hold the receipt until the sessions list can
    // prove the active session is the workspace's first. Hidden (not
    // flashed) while the list or the active session's materialized id is
    // still loading.
    const firstSessionId = resolveFirstWorkspaceSessionId(workspaceSessions);
    if (
      !firstSessionId
      || !activeMaterializedSessionId
      || firstSessionId !== activeMaterializedSessionId
    ) {
      return null;
    }
    if (workspace.kind === "worktree") {
      return workspaceUiKey;
    }
    if (
      workspaceArrivalEvent?.workspaceId === workspace.id
      && workspaceArrivalEvent.source === "local-created"
    ) {
      return workspaceUiKey;
    }
    return null;
  }, [
    activeMaterializedSessionId,
    materializedWorkspaceId,
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    workspaceArrivalEvent,
    workspaceCollections?.workspaces,
    workspaceSessions,
  ]);
}

/**
 * Full receipt state for the mounted receipt component. Live and reloaded
 * sessions derive from the same sources: the workspace record for identity
 * and path, and the setup-status query (server-persisted execution record)
 * for setup command/status/output/terminal.
 */
export function useWorkspaceCreationReceiptState(): WorkspaceCreationReceiptState | null {
  const receiptKey = useWorkspaceCreationReceiptKey();
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();

  const pendingEntry = isReceiptPendingSource(pendingWorkspaceEntry)
    ? pendingWorkspaceEntry
    : null;

  const workspace = !pendingEntry && materializedWorkspaceId
    ? workspaceCollections?.workspaces.find(
        (candidate) => candidate.id === materializedWorkspaceId,
      ) ?? null
    : null;
  const repoRoot = workspace
    ? workspaceCollections?.repoRoots.find(
        (candidate) => candidate.id === workspace.repoRootId,
      ) ?? null
    : null;

  const pendingSourceRepoRootPath = useMemo(() => {
    const request = pendingEntry?.request;
    if (!request) {
      return null;
    }
    if (request.kind === "local") {
      return request.sourceRoot.trim() || null;
    }
    if (request.kind !== "worktree") {
      return null;
    }
    return workspaceCollections?.repoRoots.find(
      (candidate) => candidate.id === request.input.repoRootId,
    )?.path ?? null;
  }, [pendingEntry, workspaceCollections?.repoRoots]);

  const configuredSetupScriptPath = pendingEntry
    ? pendingSourceRepoRootPath
    : repoRoot?.path?.trim() || workspace?.path?.trim() || null;
  const configuredSetupScript = useRepoPreferencesStore((state) => {
    if (!configuredSetupScriptPath) {
      return "";
    }
    return state.repoConfigs[configuredSetupScriptPath]?.setupScript?.trim() ?? "";
  });

  const { data: setupStatus } = useSetupStatusQuery({
    workspaceId: workspace?.id ?? null,
    enabled:
      !!workspace
      && !!receiptKey
      && !hotPaintPending
      && configuredSetupScript.length > 0,
    refetchWhileRunning: true,
  });

  return useMemo(() => {
    if (!receiptKey) {
      return null;
    }

    if (pendingEntry) {
      const noun = pendingNoun(pendingEntry);
      const workspacePath = resolvePendingWorkspacePath(pendingEntry);
      if (pendingEntry.stage === "failed") {
        return {
          receiptKey,
          pendingEntry,
          source: {
            phase: "creation-failed" as const,
            noun,
            workspacePath,
            errorMessage: pendingEntry.errorMessage,
          },
        };
      }
      return {
        receiptKey,
        pendingEntry,
        source: {
          phase: "creating" as const,
          noun,
          workspacePath,
          setupCommand: configuredSetupScript || null,
        },
      };
    }

    if (!workspace) {
      return null;
    }

    const failureSummary = setupStatus?.status === "failed"
      ? summarizeSetupFailure({
        command: setupStatus.command,
        status: "failed",
        exitCode: setupStatus.exitCode ?? -1,
        stdout: setupStatus.stdout ?? "",
        stderr: setupStatus.stderr ?? "",
        durationMs: setupStatus.durationMs ?? 0,
      })
      : null;

    return {
      receiptKey,
      pendingEntry: null,
      source: {
        phase: "created" as const,
        noun: workspace.kind === "worktree" ? "worktree" as const : "workspace" as const,
        workspacePath: workspace.path,
        materializedWorkspaceId: workspace.id,
        setup: {
          command: setupStatus?.command?.trim() || configuredSetupScript || null,
          status: setupStatus?.status ?? null,
          failureSummary,
          terminalId: setupStatus?.terminalId ?? null,
        },
      },
    };
  }, [
    configuredSetupScript,
    pendingEntry,
    receiptKey,
    setupStatus,
    workspace,
  ]);
}
