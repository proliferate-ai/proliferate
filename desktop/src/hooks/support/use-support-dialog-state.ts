import { useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useSendSupportMessage } from "@/hooks/cloud/use-send-support-message";
import {
  buildSupportEmailBody,
  formatSupportContextLabel,
} from "@/lib/domain/support/formatting";
import type { SupportMessageContext } from "@/lib/integrations/cloud/client";
import {
  copyText,
  openEmailCompose,
  openGmailCompose,
  openOutlookCompose,
} from "@/platform/tauri/shell";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseSupportDialogStateOptions {
  open: boolean;
  onClose: () => void;
  context: SupportMessageContext;
}

export function useSupportDialogState({
  open,
  onClose,
  context,
}: UseSupportDialogStateOptions) {
  const { supportEnabled } = useAppCapabilities();
  const authStatus = useAuthStore((state) => state.status);
  const showToast = useToastStore((state) => state.show);
  const { sendSupportMessage, isSendingSupportMessage } = useSendSupportMessage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const inAppSupportEnabled = supportEnabled && authStatus === "authenticated";
  const contextLabel = useMemo(() => formatSupportContextLabel(context), [context]);
  const fallbackBody = useMemo(() => buildSupportEmailBody(context), [context]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setMessage("");
  }, [open]);

  useEffect(() => {
    if (!open || !inAppSupportEnabled) {
      return;
    }

    textareaRef.current?.focus();
  }, [inAppSupportEnabled, open]);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    try {
      await sendSupportMessage({
        message: trimmed,
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
      await copyText(CAPABILITY_COPY.supportEmailAddress);
      showToast("Support email copied.", "info");
    } catch {
      showToast("Failed to copy support email.");
    }
  }

  async function handleEmail() {
    try {
      await openEmailCompose({
        to: CAPABILITY_COPY.supportEmailAddress,
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
        to: CAPABILITY_COPY.supportEmailAddress,
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
        to: CAPABILITY_COPY.supportEmailAddress,
        subject: CAPABILITY_COPY.supportEmailSubject,
        body: fallbackBody,
      });
      onClose();
    } catch {
      showToast("Failed to open Outlook.");
    }
  }

  return {
    contextLabel,
    fallbackEmail: CAPABILITY_COPY.supportEmailAddress,
    inAppSupportEnabled,
    isSendingSupportMessage,
    message,
    setMessage,
    textareaRef,
    handleSend,
    handleCopyEmail,
    handleEmail,
    handleGmail,
    handleOutlook,
  };
}
