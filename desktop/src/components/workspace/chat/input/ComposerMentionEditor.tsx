import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { useChatFileMentionSearch } from "@/hooks/chat/use-chat-file-mention-search";
import { useComposerTextareaAutosize } from "@/hooks/chat/use-composer-textarea-autosize";
import {
  isComposerMentionSelectKey,
  isRawComposerSubmitKey,
  isRepeatedComposerSubmitKey,
} from "@/lib/domain/chat/composer/composer-keyboard";
import {
  createTextDraft,
  findMentionTrigger,
  linearOffsetFromPosition,
  positionFromLinearOffset,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
  type MentionTrigger,
} from "@/lib/domain/chat/transcript/file-mentions";
import { formatMarkdownFileLink } from "@/lib/domain/chat/transcript/file-mention-links";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/measurement/debug-measurement";
import { ComposerFileMentionSearch } from "./ComposerFileMentionSearch";
import { ComposerTextarea } from "./ComposerTextarea";
import { ComposerTextareaFrame, type ComposerTextareaFrameTopInset } from "./ComposerTextareaFrame";

type FileSearchResult = SearchWorkspaceFilesResponse["results"][number];

interface ComposerMentionEditorProps {
  draft: ChatComposerDraft;
  onDraftChange: (draft: ChatComposerDraft) => void;
  placeholder: string;
  canSubmit: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  topInset: ComposerTextareaFrameTopInset;
  searchHostElement?: HTMLElement | null;
}

export function ComposerMentionEditor({
  draft,
  onDraftChange,
  placeholder,
  canSubmit,
  disabled,
  onSubmit,
  onKeyDown,
  topInset,
  searchHostElement,
}: ComposerMentionEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const typingOperationRef = useRef<MeasurementOperationId | null>(null);
  const text = serializeChatDraftToPrompt(draft);
  const [selectionOffset, setSelectionOffset] = useState(text.length);
  const [searchSuppressed, setSearchSuppressed] = useState(false);
  const trigger = useMemo(() => {
    if (searchSuppressed || disabled) {
      return null;
    }
    const textDraft = createTextDraft(text);
    return findMentionTrigger(textDraft, positionFromLinearOffset(textDraft, selectionOffset));
  }, [disabled, searchSuppressed, selectionOffset, text]);

  const updateSelection = useCallback(() => {
    const next = textareaRef.current?.selectionStart ?? text.length;
    setSelectionOffset(next);
    setSearchSuppressed(false);
    return next;
  }, [text.length]);
  const { resizeTextarea } = useComposerTextareaAutosize({
    textareaRef,
    value: text,
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  useLayoutEffect(() => {
    const next = pendingSelectionRef.current;
    const el = textareaRef.current;
    if (next === null || !el) {
      return;
    }
    el.setSelectionRange(next, next);
    setSelectionOffset(next);
    pendingSelectionRef.current = null;
  }, [text]);

  const replaceText = useCallback((nextText: string, nextSelection: number) => {
    pendingSelectionRef.current = nextSelection;
    onDraftChange(createTextDraft(nextText));
  }, [onDraftChange]);

  const handleChange = useCallback((value: string) => {
    const operationId = startMeasurementOperation({
      kind: "composer_typing",
      sampleKey: "composer",
      surfaces: [
        "chat-composer",
        "chat-composer-dock",
        "chat-surface",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ],
      idleTimeoutMs: 1500,
      maxDurationMs: 8000,
      cooldownMs: 2000,
    });
    if (operationId) {
      typingOperationRef.current = operationId;
      markOperationForNextCommit(operationId, [
        "chat-composer",
        "chat-composer-dock",
        "chat-surface",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ]);
    }
    onDraftChange(createTextDraft(value));
    setSearchSuppressed(false);
    window.requestAnimationFrame(() => {
      updateSelection();
      resizeTextarea();
    });
  }, [onDraftChange, resizeTextarea, updateSelection]);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(typingOperationRef.current, "unmount");
    typingOperationRef.current = null;
  }, []);

  const handleSelectSearchResult = useCallback((result: FileSearchResult) => {
    if (!trigger) {
      return;
    }

    const replacement = `${formatMarkdownFileLink(result.name, result.path)} `;
    const { start, end } = mentionTriggerOffsets(text, trigger);
    const replaceEnd = /\s/u.test(text[end] ?? "") ? end + 1 : end;
    replaceText(
      `${text.slice(0, start)}${replacement}${text.slice(replaceEnd)}`,
      start + replacement.length,
    );
    setSearchSuppressed(true);
    textareaRef.current?.focus({ preventScroll: true });
  }, [replaceText, text, trigger]);

  const search = useChatFileMentionSearch({
    open: !!trigger,
    query: trigger?.query ?? "",
    onSelect: handleSelectSearchResult,
  });

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (trigger) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        search.moveHighlight(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        search.moveHighlight(-1);
        return;
      }
      if (isComposerMentionSelectKey(event)) {
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

    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (isRepeatedComposerSubmitKey(event)) {
      event.preventDefault();
      return;
    }

    if (
      isRawComposerSubmitKey(event)
    ) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }, [
    canSubmit,
    onKeyDown,
    onSubmit,
    search,
    trigger,
  ]);

  const searchTray = trigger ? (
    <ComposerFileMentionSearch
      query={trigger.query}
      results={search.results}
      highlightedIndex={search.highlightedIndex}
      isLoading={search.isLoading}
      errorMessage={search.errorMessage}
      listRef={search.listRef}
      onSelect={handleSelectSearchResult}
      onRowMouseEnter={search.handleRowMouseEnter}
      setRowRef={search.setRowRef}
      className={searchHostElement ? "mx-0" : undefined}
    />
  ) : null;

  return (
    <>
      {searchTray && searchHostElement
        ? createPortal(searchTray, searchHostElement)
        : searchTray}
      <ComposerTextareaFrame topInset={topInset}>
        <ComposerTextarea
          data-chat-composer-editor
          data-telemetry-mask
          ref={textareaRef}
          rows={WORKSPACE_CHAT_COMPOSER_INPUT.minRows}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onSelect={updateSelection}
          onClick={updateSelection}
          onKeyUp={updateSelection}
          placeholder={placeholder}
          readOnly={disabled}
          aria-disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className={disabled ? "opacity-60" : ""}
        />
      </ComposerTextareaFrame>
    </>
  );
}

function mentionTriggerOffsets(
  text: string,
  trigger: MentionTrigger,
): { start: number; end: number } {
  const textDraft = createTextDraft(text);
  return {
    start: linearOffsetFromPosition(textDraft, trigger.start),
    end: linearOffsetFromPosition(textDraft, trigger.end),
  };
}
