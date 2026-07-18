import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { LexicalEditor } from "lexical";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { useChatSlashCommandMenu } from "#product/hooks/chat/ui/use-chat-slash-command-menu";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import { findSlashCommandTrigger } from "#product/lib/domain/chat/composer/slash-command-draft-edits";
import type { SessionSlashCommandViewModel } from "#product/lib/domain/chat/composer/session-slash-command-policy";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordTypingKeystrokeLatency,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { markTypingActivity } from "#product/lib/infra/interaction/typing-activity-store";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { ComposerSlashCommandSearch } from "#product/components/workspace/chat/input/ComposerSlashCommandSearch";
import {
  ComposerRichTextEditor,
  replaceComposerMarkdown,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { ComposerTextareaFrame, type ComposerTextareaFrameTopInset } from "@proliferate/ui/primitives/ComposerTextareaFrame";

interface ComposerCommandEditorProps {
  draft: ChatComposerDraft;
  onDraftChange: (draft: ChatComposerDraft) => void;
  placeholder: string;
  canSubmit: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  topInset: ComposerTextareaFrameTopInset;
  overlayHostElement?: HTMLElement | null;
}

const TYPING_SURFACES = [
  "chat-composer", "chat-composer-dock", "chat-composer-dock-region",
  "chat-composer-dock-slots", "chat-composer-dock-input",
  "chat-composer-dock-footer", "chat-surface", "transcript-list",
  "header-tabs", "workspace-sidebar",
];

export function ComposerCommandEditor({
  draft,
  onDraftChange,
  placeholder,
  canSubmit,
  disabled,
  onSubmit,
  onKeyDown,
  topInset,
  overlayHostElement,
}: ComposerCommandEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const typingOperationRef = useRef<MeasurementOperationId | null>(null);
  const markdown = serializeChatDraftToPrompt(draft);
  const [plainText, setPlainText] = useState(markdown);
  const [searchSuppressed, setSearchSuppressed] = useState(false);
  const trigger = useMemo(() => (
    searchSuppressed || disabled
      ? null
      : findSlashCommandTrigger(plainText, plainText.length)
  ), [disabled, plainText, searchSuppressed]);

  const handleChange = useCallback((value: string) => {
    markTypingActivity();
    const operationId = startMeasurementOperation({
      kind: "composer_typing",
      sampleKey: "composer",
      surfaces: TYPING_SURFACES,
      idleTimeoutMs: 1500,
      maxDurationMs: 8000,
      cooldownMs: 2000,
    });
    if (operationId) {
      typingOperationRef.current = operationId;
      markOperationForNextCommit(operationId, TYPING_SURFACES);
    }
    recordTypingKeystrokeLatency({
      operationId,
      surface: "chat-composer",
      eventTimeStampMs: null,
    });
    onDraftChange(createTextDraft(value));
    setSearchSuppressed(false);
  }, [onDraftChange]);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(typingOperationRef.current, "unmount");
    typingOperationRef.current = null;
  }, []);

  const handleSelectSearchResult = useCallback((command: SessionSlashCommandViewModel) => {
    if (!trigger || !editorRef.current) return;
    const replacement = `${command.displayName} `;
    const replaceEnd = /\s/u.test(plainText[trigger.end] ?? "") ? trigger.end + 1 : trigger.end;
    const next = `${plainText.slice(0, trigger.start)}${replacement}${plainText.slice(replaceEnd)}`;
    replaceComposerMarkdown(editorRef.current, next);
    onDraftChange(createTextDraft(next));
    setPlainText(next);
    setSearchSuppressed(true);
    editorRef.current.focus();
  }, [onDraftChange, plainText, trigger]);

  const search = useChatSlashCommandMenu({
    open: !!trigger,
    query: trigger?.query ?? "",
    onSelect: handleSelectSearchResult,
  });

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (trigger) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        search.moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && search.commands.length > 0) {
        event.preventDefault();
        search.selectHighlighted();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSearchSuppressed(true);
        return;
      }
    }

    if (
      event.key === "Enter"
      && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    ) {
      if (event.currentTarget.closest("li") || selectionIsInsideList()) return;
      event.preventDefault();
      if (!event.repeat && canSubmit) onSubmit();
      return;
    }

    onKeyDown?.(event);
  }, [canSubmit, onKeyDown, onSubmit, search, trigger]);

  const searchTray = trigger ? (
    <ComposerSlashCommandSearch
      commands={search.commands}
      highlightedIndex={search.highlightedIndex}
      listRef={search.listRef}
      onSelect={handleSelectSearchResult}
      onRowMouseEnter={search.handleRowMouseEnter}
      setRowRef={search.setRowRef}
    />
  ) : null;

  return (
    <>
      {searchTray && overlayHostElement ? createPortal(searchTray, overlayHostElement) : searchTray}
      <ComposerTextareaFrame topInset={topInset}>
        <div
          className="relative overflow-y-auto"
          style={{
            minHeight: `${WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
            maxHeight: `calc(var(--text-composer--line-height) * ${WORKSPACE_CHAT_COMPOSER_INPUT.maxRows})`,
          }}
        >
          <ComposerRichTextEditor
            value={markdown}
            onChange={handleChange}
            onPlainTextChange={setPlainText}
            onKeyDown={handleKeyDown}
            editorRef={(editor) => { editorRef.current = editor; }}
            placeholder={placeholder}
            disabled={disabled}
          />
        </div>
      </ComposerTextareaFrame>
    </>
  );
}

function selectionIsInsideList(): boolean {
  const anchor = document.getSelection()?.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  return element?.closest("li") !== null && element?.closest("li") !== undefined;
}
