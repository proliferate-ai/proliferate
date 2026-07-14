import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import { useCallback, useMemo, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useSessionDebugReplayCapability } from "@/hooks/support/lifecycle/use-session-debug-replay-capability";
import { createSessionDebugClient } from "@/lib/access/anyharness/debug-client";
import {
  formatSessionDebugErrorMessage,
  planSessionDebugActionAvailability,
  type SessionDebugActionState,
} from "@/lib/domain/support/session-debug/action-state";
import {
  copyInvestigationJsonAction,
  exportActiveSessionDebugJsonAction,
  exportReplayRecordingAction,
  exportWorkspaceDebugJsonAction,
  type SessionDebugActionDependencies,
} from "@/lib/workflows/support/session-debug-export-workflows";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * Owns support-facing session and workspace debug export actions.
 * Does not own session runtime lifecycle or replay ingestion.
 */
export function useSessionDebugActions() {
  const host = useProductHost();
  const diagnostics = host.desktop?.diagnostics ?? null;
  const workspaceContext = useAnyHarnessWorkspaceContext();
  const contextWorkspaceId = workspaceContext.workspaceId;
  const copyText = host.clipboard.writeText;
  const saveDiagnosticJson = useCallback(
    (suggestedFileName: string, contents: string) =>
      diagnostics?.saveJson({ suggestedFileName, contents }) ?? Promise.resolve(null),
    [diagnostics],
  );
  const resolveConnection = workspaceContext.resolveConnection;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const sessionRecords = useSessionDirectoryStore((state) => state.entriesById);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const showToast = useToastStore((state) => state.show);
  const [isCopyingInvestigationJson, setIsCopyingInvestigationJson] = useState(false);
  const [isExportingSessionDebugJson, setIsExportingSessionDebugJson] = useState(false);
  const [isExportingWorkspaceDebugJson, setIsExportingWorkspaceDebugJson] = useState(false);
  const [isExportingReplayRecording, setIsExportingReplayRecording] = useState(false);

  const actionState: SessionDebugActionState = {
    runtimeUrl,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    activeSessionId,
    sessionRecords,
  };

  const dependencies = useMemo<SessionDebugActionDependencies<AnyHarnessResolvedConnection>>(() => ({
    now: () => new Date(),
    copyText,
    saveDiagnosticJson,
    resolveWorkspace: (workspaceId) => resolveWorkspaceConnectionFromContext(
      {
        workspaceId: contextWorkspaceId,
        resolveConnection,
      },
      workspaceId,
    ),
    getClient: createSessionDebugClient,
  }), [contextWorkspaceId, copyText, resolveConnection, saveDiagnosticJson]);

  const isDesktop = diagnostics !== null;
  const isDev = import.meta.env.DEV;
  const baseAvailability = planSessionDebugActionAvailability(actionState, {
    isDev,
    isTauriDesktop: isDesktop,
    replayExportAvailable: false,
  });
  const replayExportAvailable = useSessionDebugReplayCapability({
    activeSessionWorkspaceId: baseAvailability.activeSessionWorkspaceId,
    dependencies,
  });
  const {
    canCopyInvestigationJson,
    canExportActiveSessionJson,
    canExportReplayRecording,
    canExportWorkspaceJson,
  } = planSessionDebugActionAvailability(actionState, {
    isDev,
    isTauriDesktop: isDesktop,
    replayExportAvailable,
  });

  async function handleCopyInvestigationJson() {
    setIsCopyingInvestigationJson(true);
    try {
      await copyInvestigationJsonAction(actionState, dependencies);
      showToast("Investigation JSON copied.", "info");
    } catch (error) {
      showToast(formatSessionDebugErrorMessage(error));
    } finally {
      setIsCopyingInvestigationJson(false);
    }
  }

  async function handleExportActiveSessionJson() {
    setIsExportingSessionDebugJson(true);
    try {
      const outputPath = await exportActiveSessionDebugJsonAction(actionState, dependencies);
      if (outputPath) {
        showToast("Session debug JSON exported.", "info");
      }
    } catch (error) {
      showToast(formatSessionDebugErrorMessage(error));
    } finally {
      setIsExportingSessionDebugJson(false);
    }
  }

  async function handleExportReplayRecording() {
    setIsExportingReplayRecording(true);
    try {
      const recording = await exportReplayRecordingAction(actionState, dependencies);
      showToast(`Replay recording exported: ${recording.label}`, "info");
    } catch (error) {
      showToast(formatSessionDebugErrorMessage(error));
    } finally {
      setIsExportingReplayRecording(false);
    }
  }

  async function handleExportWorkspaceJson() {
    setIsExportingWorkspaceDebugJson(true);
    try {
      const outputPath = await exportWorkspaceDebugJsonAction(actionState, dependencies);
      if (outputPath) {
        showToast("Workspace debug JSON exported.", "info");
      }
    } catch (error) {
      showToast(formatSessionDebugErrorMessage(error));
    } finally {
      setIsExportingWorkspaceDebugJson(false);
    }
  }

  return {
    canCopyInvestigationJson,
    canExportActiveSessionJson,
    canExportReplayRecording,
    canExportWorkspaceJson,
    handleCopyInvestigationJson,
    handleExportActiveSessionJson,
    handleExportReplayRecording,
    handleExportWorkspaceJson,
    isCopyingInvestigationJson,
    isExportingSessionDebugJson,
    isExportingReplayRecording,
    isExportingWorkspaceDebugJson,
  };
}
