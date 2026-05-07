import { useCallback, useLayoutEffect, type RefObject } from "react";
import { computeComposerTextareaAutosize } from "@/lib/domain/chat/composer/composer-textarea-sizing";

interface UseComposerTextareaAutosizeArgs {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  lineHeightRem: number;
  minRows: number;
  maxRows: number;
  minHeightRem: number;
}

export function useComposerTextareaAutosize({
  textareaRef,
  value,
  lineHeightRem,
  minRows,
  maxRows,
  minHeightRem,
}: UseComposerTextareaAutosizeArgs): {
  resizeTextarea: () => void;
} {
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    const lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    el.style.height = "auto";
    const { heightPx, overflowY } = computeComposerTextareaAutosize({
      scrollHeightPx: el.scrollHeight,
      lineHeightPx,
      rootFontSizePx,
      lineHeightRem,
      minRows,
      maxRows,
      minHeightRem,
    });
    el.style.height = `${heightPx}px`;
    el.style.overflowY = overflowY;
  }, [
    lineHeightRem,
    maxRows,
    minHeightRem,
    minRows,
    textareaRef,
  ]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  return { resizeTextarea };
}
