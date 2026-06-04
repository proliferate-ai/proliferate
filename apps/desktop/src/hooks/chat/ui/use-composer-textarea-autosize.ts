import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
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
  const cachedSizingRef = useRef<{
    lineHeightPx: number;
    rootFontSizePx: number;
  } | null>(null);
  const previousValueLengthRef = useRef(0);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    const cachedSizing = cachedSizingRef.current;
    const lineHeightPx = cachedSizing?.lineHeightPx
      ?? parseFloat(getComputedStyle(el).lineHeight);
    const rootFontSizePx = cachedSizing?.rootFontSizePx
      ?? parseFloat(getComputedStyle(document.documentElement).fontSize);
    cachedSizingRef.current = {
      lineHeightPx,
      rootFontSizePx,
    };
    if (value.length < previousValueLengthRef.current) {
      el.style.height = "auto";
    }
    const { heightPx, overflowY } = computeComposerTextareaAutosize({
      scrollHeightPx: el.scrollHeight,
      lineHeightPx,
      rootFontSizePx,
      lineHeightRem,
      minRows,
      maxRows,
      minHeightRem,
    });
    const nextHeight = `${heightPx}px`;
    if (el.style.height !== nextHeight) {
      el.style.height = nextHeight;
    }
    if (el.style.overflowY !== overflowY) {
      el.style.overflowY = overflowY;
    }
    previousValueLengthRef.current = value.length;
  }, [
    lineHeightRem,
    maxRows,
    minHeightRem,
    minRows,
    textareaRef,
    value.length,
  ]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  useLayoutEffect(() => {
    if (typeof MutationObserver === "undefined") {
      return;
    }

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      cachedSizingRef.current = null;
      resizeTextarea();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["style", "data-ui-font-size"],
    });

    return () => {
      observer.disconnect();
    };
  }, [resizeTextarea]);

  return { resizeTextarea };
}
