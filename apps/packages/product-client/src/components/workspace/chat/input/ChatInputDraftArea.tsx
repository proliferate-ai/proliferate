import type { RefObject } from "react";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { CHAT_COMPOSER_LABELS } from "#product/copy/chat/chat-copy";
import type { ChatComposerDraft } from "#product/lib/domain/chat/composer/file-mention-draft-model";
import {
  DraftAttachmentPreviewList,
  type DraftAttachmentPreviewListProps,
} from "#product/components/workspace/chat/content/PromptContentRenderer";
import { useChatDraftValue } from "#product/hooks/chat/ui/use-chat-draft-state";
import { ComposerCommandEditor } from "#product/components/workspace/chat/input/ComposerCommandEditor";
import { ComposerRichTextEditor } from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { ComposerTextareaFrame } from "@proliferate/ui/primitives/ComposerTextareaFrame";
import { QueuedPromptEditBanner } from "#product/components/workspace/chat/input/QueuedPromptEditBanner";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";

interface ChatInputDraftAreaProps {
  /** Picks the follow-up placeholder once the session transcript has turns. */
  hasSessionTurns: boolean;
  isEditingQueuedPrompt: boolean;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  textareaRef: RefObject<HTMLDivElement | null>;
  /**
   * PERF: the draft area subscribes to the live draft itself (by workspace
   * key) so keystrokes re-render only this subtree, not the whole ChatInput.
   */
  workspaceUiKey: string | null;
  onDraftChange: (draft: ChatComposerDraft) => void;
  canSubmit: boolean;
  isDisabled: boolean;
  onSubmit: () => void;
  onKeyDown: (event: ChatComposerKeyboardEvent) => void;
  hasDraftAttachments: boolean;
  draftAttachments: DraftAttachmentPreviewListProps["attachments"];
  onRemoveDraftAttachment: DraftAttachmentPreviewListProps["onRemove"];
  overlayHostElement: HTMLElement | null;
  onCancelEdit: () => void;
}

export function ChatInputDraftArea({
  hasSessionTurns,
  isEditingQueuedPrompt,
  editDraft,
  onEditDraftChange,
  textareaRef,
  workspaceUiKey,
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
  const draft = useChatDraftValue(workspaceUiKey);
  const placeholder = hasSessionTurns
    ? CHAT_COMPOSER_LABELS.followUpPlaceholder
    : CHAT_COMPOSER_LABELS.placeholder;
  if (isEditingQueuedPrompt) {
    return (
      <>
        <QueuedPromptEditBanner onCancel={onCancelEdit} />
        <ComposerTextareaFrame topInset="none">
          <ComposerRichTextEditor
            rootRef={textareaRef}
            value={editDraft}
            onChange={(value) => onEditDraftChange(value)}
            onKeyDown={onKeyDown}
            submitBehavior="editing"
            canSubmit={canSubmit}
            onSubmit={onSubmit}
            placeholder={placeholder}
            disabled={false}
            className="min-h-[2.5rem]"
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
        placeholder={placeholder}
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
