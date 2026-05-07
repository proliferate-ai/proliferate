import { useCallback } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import { canAttachPromptContent } from "@/lib/domain/chat/composer/prompt-content";
import { usePromptAttachments } from "@/hooks/chat/use-prompt-attachments";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export type PromptAttachmentController = ReturnType<typeof usePromptAttachments> & {
  canAttachFiles: boolean;
  supportsAttachments: boolean;
};

export function useChatPromptAttachments({
  activeSessionId,
  promptCapabilities,
  canAttachFiles,
}: {
  activeSessionId: string | null;
  promptCapabilities: PromptCapabilities | null;
  canAttachFiles: boolean;
}): PromptAttachmentController {
  const attachments = usePromptAttachments(activeSessionId, promptCapabilities);
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

  return {
    ...attachments,
    addFiles,
    addTextPaste,
    canAttachFiles,
    supportsAttachments,
  };
}
