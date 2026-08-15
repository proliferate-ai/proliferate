import { useEffect, useRef, type RefObject } from "react";
import { createDOMRange } from "@lexical/selection";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import { useNativeOverlayOpen } from "#product/primitives/overlays/overlay-presence";

interface ComposerCaretMeasurement {
  color: string;
  height: number;
  left: number;
  top: number;
}

interface ComposerCaretPluginProps {
  caretRef: RefObject<HTMLSpanElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
}

const CARET_WIDTH_PX = 1;
const CARET_BOUNDS_TOLERANCE_PX = 1;
const HIDDEN_ANCESTOR_SELECTOR = '[aria-hidden="true"], [hidden], [inert]';

/**
 * Replaces WebKit's two-CSS-pixel redesigned insertion caret with a one-pixel
 * visual caret. The browser selection remains authoritative; this plugin only
 * paints its collapsed position and immediately restores the native caret when
 * it cannot prove that the replacement is visible inside its editor frame.
 */
export function ComposerCaretPlugin({
  caretRef,
  frameRef,
}: ComposerCaretPluginProps) {
  const [editor] = useLexicalComposerContext();
  // Focus deliberately stays in the composer while its native popovers are
  // open. Suppress the replacement until the surface closes; the native
  // fallback remains confined to the editor's own stacking context.
  const nativeOverlayOpen = useNativeOverlayOpen();
  const overlayOpenRef = useRef(nativeOverlayOpen);
  overlayOpenRef.current = nativeOverlayOpen;
  const scheduleForOverlayRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    scheduleForOverlayRef.current?.();
  }, [nativeOverlayOpen]);

  useEffect(() => {
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
      const caret = caretRef.current;
      if (caret !== null) {
        caret.style.display = "none";
      }
      restoreNativeCaret();
    };

    const rootHasFocus = (root: HTMLElement): boolean => {
      const activeElement = root.ownerDocument.activeElement;
      return activeElement !== null && root.contains(activeElement);
    };

    const replacementCanPaint = (
      root: HTMLElement,
      frame: HTMLElement,
      caret: HTMLElement,
    ): boolean => {
      if (
        !root.isConnected
        || !frame.isConnected
        || !caret.isConnected
        || !frame.contains(root)
        || !frame.contains(caret)
        || root.closest(HIDDEN_ANCESTOR_SELECTOR) !== null
      ) {
        return false;
      }

      const computedStyle = root.ownerDocument.defaultView?.getComputedStyle(root);
      return computedStyle?.display !== "none"
        && computedStyle?.visibility !== "hidden"
        && computedStyle?.visibility !== "collapse"
        && computedStyle?.getPropertyValue("content-visibility") !== "hidden";
    };

    const measureCaret = (
      activeEditor: LexicalEditor,
      root: HTMLElement,
      frame: HTMLElement,
    ): ComposerCaretMeasurement | null => {
      const range = activeEditor.getEditorState().read((): Range | null => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        const range = createDOMRange(
          activeEditor,
          anchorNode,
          anchor.offset,
          anchorNode,
          anchor.offset,
        );
        return range?.collapsed ? range : null;
      });

      if (range === null) return null;
      const rangeRect = range.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const measuredHeight = rangeRect.height;
      if (
        !hasFiniteArea(rootRect)
        || !hasFiniteArea(frameRect)
        || !Number.isFinite(rangeRect.left)
        || !Number.isFinite(rangeRect.top)
        || !Number.isFinite(measuredHeight)
        || measuredHeight <= 0
      ) return null;

      const rangeBottom = rangeRect.top + measuredHeight;
      if (
        !pointFitsHorizontalBounds(rangeRect.left, rootRect)
        || !pointFitsHorizontalBounds(rangeRect.left, frameRect)
        || !rangeFitsVerticalBounds(rangeRect.top, rangeBottom, rootRect)
        || !rangeFitsVerticalBounds(rangeRect.top, rangeBottom, frameRect)
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
        color: computedStyle?.getPropertyValue("--color-text-caret").trim()
          || computedStyle?.color
          || "currentColor",
        height: snap(height),
        left: snap(rangeRect.left - frameRect.left - frame.clientLeft),
        top: snap(
          rangeRect.top
            - frameRect.top
            - frame.clientTop
            + ((measuredHeight - height) / 2),
        ),
      };
    };

    const positionReplacementCaret = () => {
      if (scheduledFrame !== null && rootElement !== null) {
        rootElement.ownerDocument.defaultView?.cancelAnimationFrame(scheduledFrame);
        scheduledFrame = null;
      }

      const root = rootElement;
      const frame = frameRef.current;
      const caret = caretRef.current;
      if (
        root === null
        || frame === null
        || caret === null
        || isComposing
        || !rootHasFocus(root)
        || overlayOpenRef.current
        || !replacementCanPaint(root, frame, caret)
      ) {
        hideReplacementCaret();
        return;
      }

      try {
        const measurement = measureCaret(editor, root, frame);
        if (measurement === null) {
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
          !replacementCanPaint(root, frame, caret)
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
    scheduleForOverlayRef.current = scheduleReplacementCaret;

    // Lexical may publish several updates in one input turn. Measure once on
    // the next display frame so typing never synchronously forces layout.
    const unregisterUpdate = editor.registerUpdateListener(() => {
      scheduleReplacementCaret();
    });

    const unregisterRoot = editor.registerRootListener((nextRoot) => {
      rootCleanup?.();
      rootCleanup = null;
      hideReplacementCaret();
      rootElement = nextRoot;
      isComposing = false;

      if (nextRoot === null) return;
      previousCaretColor = nextRoot.style.getPropertyValue("caret-color");
      previousCaretColorPriority = nextRoot.style.getPropertyPriority("caret-color");
      const ownerDocument = nextRoot.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;
      const frame = frameRef.current;

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

      const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
      const resizeObserver = ResizeObserverConstructor && frame
        ? new ResizeObserverConstructor(scheduleReplacementCaret)
        : null;
      resizeObserver?.observe(nextRoot);
      if (frame !== null && frame !== nextRoot) resizeObserver?.observe(frame);

      const MutationObserverConstructor = ownerWindow?.MutationObserver;
      const visibilityObserver = MutationObserverConstructor
        ? new MutationObserverConstructor(scheduleReplacementCaret)
        : null;
      if (visibilityObserver !== null) {
        // The plugin mutates the root's inline caret-color itself, so observing
        // its style attribute would schedule an endless measure/mutate loop.
        visibilityObserver.observe(nextRoot, {
          attributeFilter: ["aria-hidden", "class", "hidden", "inert"],
          attributes: true,
        });
        for (
          let ancestor: HTMLElement | null = nextRoot.parentElement;
          ancestor !== null;
          ancestor = ancestor.parentElement
        ) {
          visibilityObserver.observe(ancestor, {
            attributeFilter: ["aria-hidden", "class", "hidden", "inert", "style"],
            attributes: true,
          });
        }
      }

      rootCleanup = () => {
        nextRoot.removeEventListener("focus", handleFocus);
        nextRoot.removeEventListener("blur", handleBlur);
        nextRoot.removeEventListener("compositionstart", handleCompositionStart);
        nextRoot.removeEventListener("compositionend", handleCompositionEnd);
        ownerDocument.removeEventListener("selectionchange", scheduleReplacementCaret);
        ownerWindow?.removeEventListener("resize", scheduleReplacementCaret);
        ownerWindow?.removeEventListener("scroll", scheduleReplacementCaret, true);
        resizeObserver?.disconnect();
        visibilityObserver?.disconnect();
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
      hideReplacementCaret();
      rootElement = null;
      scheduleForOverlayRef.current = null;
    };
  }, [caretRef, editor, frameRef]);

  return null;
}

function hasFiniteArea(rect: DOMRect): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.right)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function pointFitsHorizontalBounds(x: number, rect: DOMRect): boolean {
  return x >= rect.left - CARET_BOUNDS_TOLERANCE_PX
    && x <= rect.right + CARET_BOUNDS_TOLERANCE_PX;
}

function rangeFitsVerticalBounds(top: number, bottom: number, rect: DOMRect): boolean {
  return top >= rect.top - CARET_BOUNDS_TOLERANCE_PX
    && bottom <= rect.bottom + CARET_BOUNDS_TOLERANCE_PX;
}
