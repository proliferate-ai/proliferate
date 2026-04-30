import { useCallback } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import { canAttachPromptContent } from "@/lib/domain/chat/prompt-content";
import { usePromptAttachments } from "@/hooks/chat/use-prompt-attachments";

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
  const addFiles = useCallback((files: Iterable<File>) => {
    if (!canAttachFiles) {
      return;
    }
    attachments.addFiles(files);
  }, [attachments.addFiles, canAttachFiles]);

  return {
    ...attachments,
    addFiles,
    canAttachFiles,
    supportsAttachments,
  };
}
