import type { KeyboardEventHandler, RefObject } from "react";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "@/config/chat";
import { CHAT_COMPOSER_LABELS } from "@/copy/chat/chat-copy";
import type { ChatComposerDraft } from "@/lib/domain/chat/composer/file-mention-draft-model";
import {
  DraftAttachmentPreviewList,
  type DraftAttachmentPreviewListProps,
} from "@/components/workspace/chat/content/PromptContentRenderer";
import { ComposerCommandEditor } from "./ComposerCommandEditor";
import { ComposerTextarea } from "./ComposerTextarea";
import { ComposerTextareaFrame } from "./ComposerTextareaFrame";
import { QueuedPromptEditBanner } from "./QueuedPromptEditBanner";

interface ChatInputDraftAreaProps {
  isEditingQueuedPrompt: boolean;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: ChatComposerDraft;
  onDraftChange: (draft: ChatComposerDraft) => void;
  canSubmit: boolean;
  isDisabled: boolean;
  onSubmit: () => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  hasDraftAttachments: boolean;
  draftAttachments: DraftAttachmentPreviewListProps["attachments"];
  onRemoveDraftAttachment: DraftAttachmentPreviewListProps["onRemove"];
  overlayHostElement: HTMLElement | null;
  onCancelEdit: () => void;
}

export function ChatInputDraftArea({
  isEditingQueuedPrompt,
  editDraft,
  onEditDraftChange,
  textareaRef,
  draft,
  onDraftChange,
  canSubmit,
  isDisabled,
  onSubmit,
  onKeyDown,
  hasDraftAttachments,
  draftAttachments,
  onRemoveDraftAttachment,
  overlayHostElement,
  onCancelEdit,
}: ChatInputDraftAreaProps) {
  if (isEditingQueuedPrompt) {
    return (
      <>
        <QueuedPromptEditBanner onCancel={onCancelEdit} />
        <ComposerTextareaFrame topInset="none">
          <ComposerTextarea
            data-chat-composer-editor
            data-telemetry-mask
            ref={textareaRef}
            rows={WORKSPACE_CHAT_COMPOSER_INPUT.minRows}
            value={editDraft}
            onChange={(event) => onEditDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={CHAT_COMPOSER_LABELS.placeholder}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </ComposerTextareaFrame>
      </>
    );
  }

  return (
    <>
      <DraftAttachmentPreviewList
        attachments={draftAttachments}
        onRemove={onRemoveDraftAttachment}
      />
      <ComposerCommandEditor
        draft={draft}
        onDraftChange={onDraftChange}
        placeholder={CHAT_COMPOSER_LABELS.placeholder}
        canSubmit={canSubmit}
        disabled={isDisabled}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        topInset={hasDraftAttachments ? "none" : "standard"}
        overlayHostElement={overlayHostElement}
      />
    </>
  );
}
