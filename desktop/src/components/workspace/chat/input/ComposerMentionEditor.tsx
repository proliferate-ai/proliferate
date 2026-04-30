import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useChatFileMentionSearch } from "@/hooks/chat/use-chat-file-mention-search";
import {
  isComposerMentionSelectKey,
  isRawComposerSubmitKey,
} from "@/lib/domain/chat/composer-keyboard";
import {
  createTextDraft,
  findMentionTrigger,
  linearOffsetFromPosition,
  positionFromLinearOffset,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
  type MentionTrigger,
} from "@/lib/domain/chat/file-mentions";
import { formatMarkdownFileLink } from "@/lib/domain/chat/file-mention-links";
import { ComposerFileMentionSearch } from "./ComposerFileMentionSearch";
import { ComposerTextarea } from "./ComposerTextarea";

type FileSearchResult = SearchWorkspaceFilesResponse["results"][number];

interface ComposerMentionEditorProps {
  draft: ChatComposerDraft;
  onDraftChange: (draft: ChatComposerDraft) => void;
  placeholder: string;
  canSubmit: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  minHeightRem: number;
  maxHeightRem: number;
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
  minHeightRem,
  maxHeightRem,
  searchHostElement,
}: ComposerMentionEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
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

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const minPx = Number.isFinite(rootFontSizePx)
      ? rootFontSizePx * minHeightRem
      : minHeightRem * 16;
    const maxPx = Number.isFinite(rootFontSizePx)
      ? rootFontSizePx * maxHeightRem
      : maxHeightRem * 16;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    const next = Math.min(maxPx, Math.max(minPx, contentHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = contentHeight > maxPx ? "auto" : "hidden";
  }, [maxHeightRem, minHeightRem]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, text]);

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
    onDraftChange(createTextDraft(value));
    setSearchSuppressed(false);
    window.requestAnimationFrame(() => {
      updateSelection();
      resizeTextarea();
    });
  }, [onDraftChange, resizeTextarea, updateSelection]);

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
      <div
        className="mb-2 flex-grow select-text overflow-y-auto px-3"
        style={{
          minHeight: `${minHeightRem}rem`,
          maxHeight: `${maxHeightRem}rem`,
        }}
      >
        <ComposerTextarea
          data-chat-composer-editor
          data-telemetry-mask
          ref={textareaRef}
          rows={2}
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
          style={{
            minHeight: `${minHeightRem}rem`,
            maxHeight: `${maxHeightRem}rem`,
          }}
          className={disabled ? "opacity-60" : ""}
        />
      </div>
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
