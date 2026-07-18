import { useEffect } from "react";
import { createDOMRange } from "@lexical/selection";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";

interface ComposerCaretMeasurement {
  color: string;
  height: number;
  left: number;
  top: number;
}

const CARET_WIDTH_PX = 1;

/**
 * Replaces WebKit's two-CSS-pixel redesigned insertion caret with a one-pixel
 * visual caret. The browser selection remains authoritative; this plugin only
 * paints its collapsed position and immediately restores the native caret when
 * it cannot prove that the replacement is visible.
 */
export function ComposerCaretPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let caretElement: HTMLSpanElement | null = null;
    let rootElement: HTMLElement | null = null;
    let rootCleanup: (() => void) | null = null;
    let isComposing = false;
    let scheduledFrame: number | null = null;
    let previousCaretColor = "";
    let previousCaretColorPriority = "";

    const restoreNativeCaret = () => {
      if (rootElement === null) return;
      if (previousCaretColor) {
        rootElement.style.setProperty(
          "caret-color",
          previousCaretColor,
          previousCaretColorPriority,
        );
      } else {
        rootElement.style.removeProperty("caret-color");
      }
    };

    const hideReplacementCaret = () => {
      if (caretElement !== null) {
        caretElement.style.display = "none";
      }
      restoreNativeCaret();
    };

    const destroyReplacementCaret = () => {
      hideReplacementCaret();
      caretElement?.remove();
      caretElement = null;
    };

    const ensureReplacementCaret = (root: HTMLElement): HTMLSpanElement | null => {
      const ownerDocument = root.ownerDocument;
      if (caretElement !== null && caretElement.ownerDocument === ownerDocument) {
        return caretElement;
      }

      caretElement?.remove();
      const body = ownerDocument.body;
      if (body === null) return null;

      const nextCaret = ownerDocument.createElement("span");
      nextCaret.setAttribute("aria-hidden", "true");
      nextCaret.setAttribute("data-chat-composer-caret", "");
      nextCaret.style.backgroundColor = "currentColor";
      nextCaret.style.display = "none";
      nextCaret.style.pointerEvents = "none";
      nextCaret.style.position = "fixed";
      nextCaret.style.width = `${CARET_WIDTH_PX}px`;
      nextCaret.style.zIndex = "2147483647";
      body.appendChild(nextCaret);
      caretElement = nextCaret;
      return nextCaret;
    };

    const rootHasFocus = (root: HTMLElement): boolean => {
      const activeElement = root.ownerDocument.activeElement;
      return activeElement !== null && root.contains(activeElement);
    };

    const measureCaret = (
      activeEditor: LexicalEditor,
      root: HTMLElement,
    ): ComposerCaretMeasurement | null => {
      const range = activeEditor.getEditorState().read((): Range | null => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        return createDOMRange(
          activeEditor,
          anchorNode,
          anchor.offset,
          anchorNode,
          anchor.offset,
        );
      });

      if (range === null) return null;
      const rangeRect = range.getBoundingClientRect();
      const measuredHeight = rangeRect.height;
      if (
        !Number.isFinite(rangeRect.left)
        || !Number.isFinite(rangeRect.top)
        || !Number.isFinite(measuredHeight)
        || measuredHeight <= 0
      ) return null;

      const ownerWindow = root.ownerDocument.defaultView;
      const computedStyle = ownerWindow?.getComputedStyle(root);
      const fontSize = Number.parseFloat(computedStyle?.fontSize ?? "");
      const proportionalHeight = Number.isFinite(fontSize) && fontSize > 0
        ? fontSize * 1.25
        : measuredHeight;
      const height = Math.min(measuredHeight, proportionalHeight);
      const deviceScale = ownerWindow?.devicePixelRatio || 1;
      const snap = (value: number) => Math.round(value * deviceScale) / deviceScale;

      return {
        color: computedStyle?.color || "currentColor",
        height: snap(height),
        left: snap(rangeRect.left),
        top: snap(rangeRect.top + ((measuredHeight - height) / 2)),
      };
    };

    const positionReplacementCaret = () => {
      if (scheduledFrame !== null && rootElement !== null) {
        rootElement.ownerDocument.defaultView?.cancelAnimationFrame(scheduledFrame);
        scheduledFrame = null;
      }

      const root = rootElement;
      if (root === null || isComposing || !rootHasFocus(root)) {
        hideReplacementCaret();
        return;
      }

      try {
        const measurement = measureCaret(editor, root);
        const caret = measurement === null ? null : ensureReplacementCaret(root);
        if (measurement === null || caret === null) {
          hideReplacementCaret();
          return;
        }

        caret.style.backgroundColor = measurement.color;
        caret.style.height = `${measurement.height}px`;
        caret.style.left = `${measurement.left}px`;
        caret.style.opacity = "1";
        caret.style.top = `${measurement.top}px`;
        caret.style.display = "block";

        if (
          !caret.isConnected
          || caret.style.display === "none"
          || caret.style.width !== `${CARET_WIDTH_PX}px`
          || measurement.height <= 0
        ) {
          hideReplacementCaret();
          return;
        }

        root.style.setProperty("caret-color", "transparent");
        if (typeof caret.getAnimations === "function") {
          for (const animation of caret.getAnimations()) {
            animation.currentTime = 0;
            animation.play();
          }
        }
      } catch {
        hideReplacementCaret();
      }
    };

    const scheduleReplacementCaret = () => {
      const root = rootElement;
      const ownerWindow = root?.ownerDocument.defaultView;
      if (root === null || ownerWindow === null || ownerWindow === undefined) {
        hideReplacementCaret();
        return;
      }
      if (scheduledFrame !== null) return;
      scheduledFrame = ownerWindow.requestAnimationFrame(() => {
        scheduledFrame = null;
        positionReplacementCaret();
      });
    };

    // Lexical may publish several updates in one input turn. Measure once on
    // the next display frame so typing never synchronously forces layout.
    const unregisterUpdate = editor.registerUpdateListener(() => {
      scheduleReplacementCaret();
    });

    const unregisterRoot = editor.registerRootListener((nextRoot) => {
      rootCleanup?.();
      rootCleanup = null;
      destroyReplacementCaret();
      rootElement = nextRoot;
      isComposing = false;

      if (nextRoot === null) return;
      previousCaretColor = nextRoot.style.getPropertyValue("caret-color");
      previousCaretColorPriority = nextRoot.style.getPropertyPriority("caret-color");
      const ownerDocument = nextRoot.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;

      const handleFocus = () => scheduleReplacementCaret();
      const handleBlur = () => queueMicrotask(() => {
        if (!rootHasFocus(nextRoot)) hideReplacementCaret();
      });
      const handleCompositionStart = () => {
        isComposing = true;
        hideReplacementCaret();
      };
      const handleCompositionEnd = () => {
        isComposing = false;
        scheduleReplacementCaret();
      };

      nextRoot.addEventListener("focus", handleFocus);
      nextRoot.addEventListener("blur", handleBlur);
      nextRoot.addEventListener("compositionstart", handleCompositionStart);
      nextRoot.addEventListener("compositionend", handleCompositionEnd);
      ownerDocument.addEventListener("selectionchange", scheduleReplacementCaret);
      ownerWindow?.addEventListener("resize", scheduleReplacementCaret);
      ownerWindow?.addEventListener("scroll", scheduleReplacementCaret, true);

      rootCleanup = () => {
        nextRoot.removeEventListener("focus", handleFocus);
        nextRoot.removeEventListener("blur", handleBlur);
        nextRoot.removeEventListener("compositionstart", handleCompositionStart);
        nextRoot.removeEventListener("compositionend", handleCompositionEnd);
        ownerDocument.removeEventListener("selectionchange", scheduleReplacementCaret);
        ownerWindow?.removeEventListener("resize", scheduleReplacementCaret);
        ownerWindow?.removeEventListener("scroll", scheduleReplacementCaret, true);
        if (scheduledFrame !== null) {
          ownerWindow?.cancelAnimationFrame(scheduledFrame);
          scheduledFrame = null;
        }
      };

      scheduleReplacementCaret();
    });

    return () => {
      unregisterUpdate();
      unregisterRoot();
      rootCleanup?.();
      destroyReplacementCaret();
      rootElement = null;
    };
  }, [editor]);

  return null;
}
