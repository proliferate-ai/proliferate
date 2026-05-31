import { useMemo, useState } from "react";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { SUPPORT_EMAIL_ADDRESS } from "@/config/capabilities";
import { useSessionDebugActions } from "@/hooks/support/workflows/use-session-debug-actions";
import {
  buildSupportEmailBody,
  formatSupportContextLabel,
} from "@/lib/domain/support/formatting";
import type { SupportMessageContext } from "@/lib/domain/support/types";
import { useTauriDiagnosticsActions } from "@/hooks/access/tauri/use-diagnostics-actions";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseSupportDialogStateOptions {
  onClose: () => void;
  context: SupportMessageContext;
}

/**
 * Owns support dialog UI state and user-facing support actions.
 * Does not own session debug collection internals.
 */
export function useSupportDialogState({
  onClose,
  context,
}: UseSupportDialogStateOptions) {
  const {
    copyText,
    openEmailCompose,
    openGmailCompose,
    openOutlookCompose,
  } = useTauriShellActions();
  const {
    exportDebugBundle,
    isTauriDesktop,
  } = useTauriDiagnosticsActions();
  const showToast = useToastStore((state) => state.show);
  const sessionDebugActions = useSessionDebugActions();
  const [isExportingDebugBundle, setIsExportingDebugBundle] = useState(false);
  const canExportDebugBundle = import.meta.env.DEV && isTauriDesktop();
  const contextLabel = useMemo(() => formatSupportContextLabel(context), [context]);
  const fallbackBody = useMemo(() => buildSupportEmailBody(context), [context]);

  async function handleCopyEmail() {
    try {
      await copyText(SUPPORT_EMAIL_ADDRESS);
      showToast("Support email copied.", "info");
    } catch {
      showToast("Failed to copy support email.");
    }
  }

  async function handleEmail() {
    try {
      await openEmailCompose({
        to: SUPPORT_EMAIL_ADDRESS,
        subject: CAPABILITY_COPY.supportEmailSubject,
        body: fallbackBody,
      });
      onClose();
    } catch {
      showToast("Failed to open email.");
    }
  }

  async function handleGmail() {
    try {
      await openGmailCompose({
        to: SUPPORT_EMAIL_ADDRESS,
        subject: CAPABILITY_COPY.supportEmailSubject,
        body: fallbackBody,
      });
      onClose();
    } catch {
      showToast("Failed to open Gmail.");
    }
  }

  async function handleOutlook() {
    try {
      await openOutlookCompose({
        to: SUPPORT_EMAIL_ADDRESS,
        subject: CAPABILITY_COPY.supportEmailSubject,
        body: fallbackBody,
      });
      onClose();
    } catch {
      showToast("Failed to open Outlook.");
    }
  }

  async function handleExportDebugBundle() {
    if (!canExportDebugBundle) {
      showToast("Debug bundle export is only available in the desktop app.");
      return;
    }

    setIsExportingDebugBundle(true);

    try {
      const outputPath = await exportDebugBundle();
      if (!outputPath) {
        return;
      }

      showToast("Debug bundle exported.", "info");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to export debug bundle.");
    } finally {
      setIsExportingDebugBundle(false);
    }
  }

  return {
    canExportDebugBundle,
    canCopyInvestigationJson: sessionDebugActions.canCopyInvestigationJson,
    canExportActiveSessionJson: sessionDebugActions.canExportActiveSessionJson,
    canExportReplayRecording: sessionDebugActions.canExportReplayRecording,
    canExportWorkspaceJson: sessionDebugActions.canExportWorkspaceJson,
    contextLabel,
    fallbackEmail: SUPPORT_EMAIL_ADDRESS,
    handleCopyInvestigationJson: sessionDebugActions.handleCopyInvestigationJson,
    handleExportActiveSessionJson: sessionDebugActions.handleExportActiveSessionJson,
    handleExportReplayRecording: sessionDebugActions.handleExportReplayRecording,
    handleExportDebugBundle,
    handleExportWorkspaceJson: sessionDebugActions.handleExportWorkspaceJson,
    isCopyingInvestigationJson: sessionDebugActions.isCopyingInvestigationJson,
    isExportingDebugBundle,
    isExportingReplayRecording: sessionDebugActions.isExportingReplayRecording,
    isExportingSessionDebugJson: sessionDebugActions.isExportingSessionDebugJson,
    isExportingWorkspaceDebugJson: sessionDebugActions.isExportingWorkspaceDebugJson,
    handleCopyEmail,
    handleEmail,
    handleGmail,
    handleOutlook,
  };
}
