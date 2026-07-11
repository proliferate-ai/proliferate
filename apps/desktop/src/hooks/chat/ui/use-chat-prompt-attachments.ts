import { useCallback, useMemo } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import { canAttachPromptContent } from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import { usePromptAttachments } from "@/hooks/chat/ui/use-prompt-attachments";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export type PromptAttachmentController = ReturnType<typeof usePromptAttachments> & {
  canAttachFiles: boolean;
  supportsAttachments: boolean;
};

export function useChatPromptAttachments({
  scopeKey,
  promptCapabilities,
  canAttachFiles,
}: {
  scopeKey: string | null;
  promptCapabilities: PromptCapabilities | null;
  canAttachFiles: boolean;
}): PromptAttachmentController {
  const attachments = usePromptAttachments(scopeKey, promptCapabilities);
  const supportsAttachments = canAttachPromptContent(promptCapabilities);
  const pasteAttachmentsEnabled = useUserPreferencesStore((state) => state.pasteAttachmentsEnabled);
  const addFiles = useCallback((files: Iterable<File>) => {
    if (!canAttachFiles) {
      return;
    }
    attachments.addFiles(files);
  }, [attachments.addFiles, canAttachFiles]);
  const addTextPaste = useCallback((text: string): boolean => {
    if (!canAttachFiles || !pasteAttachmentsEnabled) {
      return false;
    }
    return attachments.addTextPaste(text);
  }, [attachments.addTextPaste, canAttachFiles, pasteAttachmentsEnabled]);

  return useMemo(() => ({
    attachments: attachments.attachments,
    addFiles,
    addTextPaste,
    removeAttachment: attachments.removeAttachment,
    clearAttachments: attachments.clearAttachments,
    clearSubmittedAttachments: attachments.clearSubmittedAttachments,
    snapshotForSubmit: attachments.snapshotForSubmit,
    hasAttachments: attachments.hasAttachments,
    hasSupportedAttachments: attachments.hasSupportedAttachments,
    canAttachFiles,
    supportsAttachments,
  }), [
    addFiles,
    addTextPaste,
    attachments.attachments,
    attachments.clearAttachments,
    attachments.clearSubmittedAttachments,
    attachments.hasAttachments,
    attachments.hasSupportedAttachments,
    attachments.removeAttachment,
    attachments.snapshotForSubmit,
    canAttachFiles,
    supportsAttachments,
  ]);
}
