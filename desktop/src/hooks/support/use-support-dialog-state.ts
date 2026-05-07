import { useMemo, useState } from "react";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { SUPPORT_EMAIL_ADDRESS } from "@/config/capabilities";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useSendSupportMessage } from "@/hooks/access/cloud/use-send-support-message";
import { useSessionDebugActions } from "@/hooks/support/use-session-debug-actions";
import {
  buildSupportEmailBody,
  formatSupportContextLabel,
  normalizeSupportMessageForSend,
} from "@/lib/domain/support/formatting";
import type { SupportMessageContext } from "@/lib/access/cloud/client";
import { useTauriDiagnosticsActions } from "@/hooks/access/tauri/use-diagnostics-actions";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseSupportDialogStateOptions {
  onClose: () => void;
  context: SupportMessageContext;
}

export function useSupportDialogState({
  onClose,
  context,
}: UseSupportDialogStateOptions) {
  const { supportEnabled } = useAppCapabilities();
  const authStatus = useAuthStore((state) => state.status);
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
  const { sendSupportMessage, isSendingSupportMessage } = useSendSupportMessage();
  const sessionDebugActions = useSessionDebugActions();
  const [message, setMessage] = useState("");
  const [isExportingDebugBundle, setIsExportingDebugBundle] = useState(false);
  const inAppSupportEnabled = supportEnabled && authStatus === "authenticated";
  const canExportDebugBundle = isTauriDesktop();
  const contextLabel = useMemo(() => formatSupportContextLabel(context), [context]);
  const fallbackBody = useMemo(() => buildSupportEmailBody(context), [context]);

  async function handleSend() {
    const normalizedMessage = normalizeSupportMessageForSend(message);
    if (!normalizedMessage) {
      return;
    }

    try {
      await sendSupportMessage({
        message: normalizedMessage,
        context,
      });
      showToast("Support note sent.", "info");
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to send support note.");
    }
  }

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
    inAppSupportEnabled,
    isCopyingInvestigationJson: sessionDebugActions.isCopyingInvestigationJson,
    isExportingDebugBundle,
    isExportingReplayRecording: sessionDebugActions.isExportingReplayRecording,
    isExportingSessionDebugJson: sessionDebugActions.isExportingSessionDebugJson,
    isExportingWorkspaceDebugJson: sessionDebugActions.isExportingWorkspaceDebugJson,
    isSendingSupportMessage,
    message,
    setMessage,
    handleSend,
    handleCopyEmail,
    handleEmail,
    handleGmail,
    handleOutlook,
  };
}
