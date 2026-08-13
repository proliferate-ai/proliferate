import { useCallback, type ClipboardEvent } from "react";
import type { PromptAttachmentController } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { handlePromptAttachmentPaste } from "#product/lib/domain/chat/composer/prompt-attachment-paste";

export function useChatInputPaste({
  attachments,
  canAcceptPastedAttachments,
}: {
  attachments: PromptAttachmentController;
  canAcceptPastedAttachments: boolean;
}) {
  const claimPromptAttachmentPaste = useCallback((
    event: ClipboardEvent<HTMLDivElement>,
  ) => handlePromptAttachmentPaste({
    defaultPrevented: event.defaultPrevented,
    canAcceptAttachments: canAcceptPastedAttachments,
    fileCount: event.clipboardData.files.length,
    plainText: event.clipboardData.getData("text/plain"),
    addFiles: () => attachments.addFiles(event.clipboardData.files),
    addTextPaste: attachments.addTextPaste,
  }), [attachments, canAcceptPastedAttachments]);

  const handleFilePasteCapture = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (event.clipboardData.files.length === 0) return;
    if (!claimPromptAttachmentPaste(event)) return;

    // Claim file-bearing payloads before Lexical's target listener can import
    // a text fallback and prevent the attachment owner from seeing the files.
    event.preventDefault();
    event.stopPropagation();
  }, [claimPromptAttachmentPaste]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    // The editor owns formatted Markdown paste first. Once it has imported a
    // list or link, do not reinterpret the same clipboard text as an
    // attachment at the composer surface.
    if (claimPromptAttachmentPaste(event)) event.preventDefault();
  }, [claimPromptAttachmentPaste]);

  return { handleFilePasteCapture, handlePaste };
}
