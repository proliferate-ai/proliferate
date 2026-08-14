import { useCallback, useMemo } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import { canAttachPromptContent } from "#product/domain/chats/composer/prompt-attachment-rules";
import { usePromptAttachments } from "#product/hooks/chat/ui/use-prompt-attachments";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import type {
  DroppedPathCandidate,
  PromptAttachmentDescriptor,
} from "#product/domain/chats/composer/prompt-attachment-rules";

export type PromptAttachmentController = ReturnType<typeof usePromptAttachments> & {
  canAttachFiles: boolean;
  supportsAttachments: boolean;
};

export function useChatPromptAttachments({
  scopeKey,
  promptCapabilities,
  canAttachFiles,
  resolveDroppedPaths,
  onBeforeReleaseAttachments,
}: {
  scopeKey: string | null;
  promptCapabilities: PromptCapabilities | null;
  canAttachFiles: boolean;
  resolveDroppedPaths?: (() => Promise<DroppedPathCandidate[]>) | null;
  onBeforeReleaseAttachments?: (
    attachments: readonly PromptAttachmentDescriptor[],
  ) => void;
}): PromptAttachmentController {
  const attachments = usePromptAttachments(scopeKey, promptCapabilities, {
    onBeforeReleaseAttachments,
    resolveDroppedPaths,
  });
  const supportsAttachments = canAttachPromptContent(promptCapabilities);
  const pasteAttachmentsEnabled = useUserPreferencesStore((state) => state.pasteAttachmentsEnabled);
  const addFiles = useCallback((files: Iterable<File>) => {
    if (!canAttachFiles) {
      return;
    }
    attachments.addFiles(files);
  }, [attachments.addFiles, canAttachFiles]);
  const addDroppedFiles = useCallback((files: Iterable<File>) => {
    if (!canAttachFiles) {
      return;
    }
    attachments.addDroppedFiles(files);
  }, [attachments.addDroppedFiles, canAttachFiles]);
  const addTextPaste = useCallback((text: string): boolean => {
    if (!canAttachFiles || !pasteAttachmentsEnabled) {
      return false;
    }
    return attachments.addTextPaste(text);
  }, [attachments.addTextPaste, canAttachFiles, pasteAttachmentsEnabled]);

  return useMemo(() => ({
    attachments: attachments.attachments,
    addFiles,
    addDroppedFiles,
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
    addDroppedFiles,
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
