import { useState, type RefObject } from "react";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { CHAT_COMPOSER_LABELS } from "#product/copy/chat/chat-copy";
import type {
  ChatComposerDraft,
  ChatComposerEditorSnapshot,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import {
  DraftAttachmentPreviewList,
  type DraftAttachmentPreviewListProps,
  type PromptAttachmentPreviewHandler,
} from "#product/components/workspace/chat/content/PromptContentRenderer";
import {
  useChatDraftValue,
  useChatSelectedResponseContexts,
} from "#product/hooks/chat/ui/use-chat-draft-state";
import { ComposerCommandEditor } from "#product/components/workspace/chat/input/ComposerCommandEditor";
import { ComposerRichTextEditor } from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { ComposerTextareaFrame } from "#product/primitives/patterns/ComposerTextareaFrame";
import { QueuedPromptEditBanner } from "#product/components/workspace/chat/input/QueuedPromptEditBanner";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";
import { SelectedResponseContextList } from "#product/components/workspace/chat/input/SelectedResponseContextList";

interface ChatInputDraftAreaProps {
  /** Picks the follow-up placeholder once the session transcript has turns. */
  hasSessionTurns: boolean;
  isEditingQueuedPrompt: boolean;
  editingQueueSeq: number | null;
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
  onOpenDraftAttachment: PromptAttachmentPreviewHandler;
  onRemoveSelectedResponseContext: (id: string) => void;
  overlayHostElement: HTMLElement | null;
  onCancelEdit: () => void;
}

export function ChatInputDraftArea({
  hasSessionTurns,
  isEditingQueuedPrompt,
  editingQueueSeq,
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
  onOpenDraftAttachment,
  onRemoveSelectedResponseContext,
  overlayHostElement,
  onCancelEdit,
}: ChatInputDraftAreaProps) {
  const [editEditorState, setEditEditorState] = useState<{
    queueSeq: number | null;
    value: string;
    snapshot: ChatComposerEditorSnapshot;
  }>();
  const editSnapshot = editEditorState?.queueSeq === editingQueueSeq
    && editEditorState.value === editDraft
    ? editEditorState.snapshot
    : undefined;
  const draft = useChatDraftValue(workspaceUiKey);
  const selectedResponseContexts = useChatSelectedResponseContexts(workspaceUiKey);
  const placeholder = hasSessionTurns
    ? CHAT_COMPOSER_LABELS.followUpPlaceholder
    : CHAT_COMPOSER_LABELS.placeholder;
  if (isEditingQueuedPrompt) {
    return (
      <>
        <QueuedPromptEditBanner onCancel={onCancelEdit} />
        <ComposerTextareaFrame topInset="none">
          <div
            className="relative overflow-y-auto"
            style={{
              minHeight: `${WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
              // Capped at 25dvh so the draft area never crowds out the
              // transcript above it on short viewports, even when maxRows
              // would otherwise let it grow taller.
              maxHeight: `min(calc(var(--text-composer--line-height) * ${WORKSPACE_CHAT_COMPOSER_INPUT.maxRows}), 25dvh)`,
            }}
          >
            <ComposerRichTextEditor
              rootRef={textareaRef}
              value={editDraft}
              snapshot={editSnapshot}
              onChange={(value, _eventTimeStampMs, snapshot) => {
                setEditEditorState({ queueSeq: editingQueueSeq, value, snapshot });
                onEditDraftChange(value);
              }}
              onKeyDown={onKeyDown}
              canSubmit={canSubmit}
              onSubmit={onSubmit}
              placeholder={placeholder}
              disabled={false}
            />
          </div>
        </ComposerTextareaFrame>
      </>
    );
  }

  return (
    <>
      <DraftAttachmentPreviewList
        attachments={draftAttachments}
        onRemove={onRemoveDraftAttachment}
        onOpenAttachment={onOpenDraftAttachment}
      />
      <SelectedResponseContextList
        contexts={selectedResponseContexts}
        onRemove={onRemoveSelectedResponseContext}
      />
      <ComposerCommandEditor
        draft={draft}
        onDraftChange={onDraftChange}
        placeholder={placeholder}
        canSubmit={canSubmit}
        disabled={isDisabled}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        topInset={hasDraftAttachments || selectedResponseContexts.length > 0 ? "none" : "standard"}
        overlayHostElement={overlayHostElement}
      />
    </>
  );
}
