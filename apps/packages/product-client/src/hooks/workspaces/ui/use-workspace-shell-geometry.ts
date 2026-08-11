import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { motion } from "@proliferate/design/motion";
import { usePrefersReducedMotion } from "#product/hooks/ui/motion/use-prefers-reduced-motion";
import {
  resolveWorkspaceShellSizing,
  type WorkspaceShellResizeEdge,
} from "#product/lib/domain/workspaces/shell/workspace-shell-sizing";

interface WorkspaceShellWidths {
  left: number;
  right: number;
}

interface UseWorkspaceShellGeometryOptions {
  leftWidth: number;
  rightWidth: number;
  /** The rail whose live pointer gesture should receive width precedence. */
  activeResizeEdge?: WorkspaceShellResizeEdge | null;
  /** Held true while the left separator drag is live. */
  snapLeftResize?: boolean;
  /**
   * Held true while the right separator drag is live. A pointer-driven width
   * must land exactly where the cursor is on every frame — easing it would
   * rubber-band the panel edge behind the pointer and keep re-laying the
   * panes out for the full panel duration after each move.
   */
  snapRight?: boolean;
  onToggleLeft: () => void;
}

interface WorkspaceShellGeometry {
  rootRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  leftWidth: number;
  rightWidth: number;
  snapLeft: boolean;
  snapViewport: boolean;
  toggleLeft: (options?: { snapGeometry?: boolean }) => void;
  usesManualInterpolation: boolean;
}

function needsManualInterpolation(): boolean {
  if (typeof window === "undefined" || typeof CSS === "undefined") {
    return false;
  }
  return typeof CSS.registerProperty !== "function";
}

function easeOutCubic(progress: number): number {
  return 1 - ((1 - progress) ** 3);
}

export function useWorkspaceShellGeometry({
  leftWidth,
  rightWidth,
  activeResizeEdge = null,
  snapLeftResize = false,
  snapRight = false,
  onToggleLeft,
}: UseWorkspaceShellGeometryOptions): WorkspaceShellGeometry {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const snapClearFrameRef = useRef<number | null>(null);
  const viewportSnapClearFrameRef = useRef<number | null>(null);
  const containerWidthRef = useRef<number | null>(null);
  const allocationPriorityRef = useRef<WorkspaceShellResizeEdge>("left");
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [toggleSnapLeft, setToggleSnapLeft] = useState(false);
  const [snapViewport, setSnapViewport] = useState(false);
  const allocationPriority = activeResizeEdge ?? allocationPriorityRef.current;
  const target = resolveWorkspaceShellSizing({
    containerWidth,
    leftWidth,
    rightWidth,
    priority: allocationPriority,
  });
  const snapLeft = toggleSnapLeft || snapLeftResize;
  const renderedRef = useRef<WorkspaceShellWidths>({
    left: target.left,
    right: target.right,
  });
  const usesManualInterpolation = useRef(needsManualInterpolation()).current;
  const reducedMotion = usePrefersReducedMotion();

  const toggleLeft = useCallback((options?: { snapGeometry?: boolean }) => {
    if (snapClearFrameRef.current !== null) {
      window.cancelAnimationFrame(snapClearFrameRef.current);
      snapClearFrameRef.current = null;
    }

    if (!options?.snapGeometry) {
      setToggleSnapLeft(false);
      onToggleLeft();
      return;
    }

    setToggleSnapLeft(true);
    onToggleLeft();
    snapClearFrameRef.current = window.requestAnimationFrame(() => {
      snapClearFrameRef.current = window.requestAnimationFrame(() => {
        snapClearFrameRef.current = null;
        setToggleSnapLeft(false);
      });
    });
  }, [onToggleLeft]);

  useLayoutEffect(() => {
    if (activeResizeEdge) {
      // Retain the last edge the user actually moved. Restoring persisted
      // widths after the gesture then keeps the opposite rail as the one that
      // yields until a viewport resize returns layout to passive left-first
      // allocation.
      allocationPriorityRef.current = activeResizeEdge;
    }
  }, [activeResizeEdge]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const applyContainerWidth = (nextWidth: number) => {
      if (
        !Number.isFinite(nextWidth)
        || nextWidth <= 0
        || nextWidth === containerWidthRef.current
      ) {
        return;
      }
      containerWidthRef.current = nextWidth;
      allocationPriorityRef.current = "left";
      setSnapViewport(true);
      setContainerWidth(nextWidth);

      if (viewportSnapClearFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportSnapClearFrameRef.current);
      }
      viewportSnapClearFrameRef.current = window.requestAnimationFrame(() => {
        viewportSnapClearFrameRef.current = window.requestAnimationFrame(() => {
          viewportSnapClearFrameRef.current = null;
          setSnapViewport(false);
        });
      });
    };

    applyContainerWidth(root.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === root);
      if (entry) {
        applyContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!usesManualInterpolation) {
      renderedRef.current = target;
      return;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const root = rootRef.current;
    if (!root) {
      return;
    }

    const from = renderedRef.current;
    const setWidths = (widths: WorkspaceShellWidths) => {
      renderedRef.current = widths;
      root.style.setProperty("--workspace-left-width", `${widths.left}px`);
      root.style.setProperty("--workspace-right-width", `${widths.right}px`);
    };

    const animateLeft = !snapViewport && !snapLeft && from.left !== target.left;
    const animateRight = !snapViewport && !snapRight && from.right !== target.right;
    if (reducedMotion || (!animateLeft && !animateRight)) {
      setWidths(target);
      return;
    }

    if (snapViewport || snapLeft || snapRight) {
      setWidths({
        left: snapViewport || snapLeft ? target.left : from.left,
        right: snapViewport || snapRight ? target.right : from.right,
      });
    }

    let startedAt: number | null = null;
    const tick = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / motion.duration.panelMs);
      const eased = easeOutCubic(progress);
      const widths = {
        left: animateLeft ? from.left + ((target.left - from.left) * eased) : target.left,
        right: animateRight ? from.right + ((target.right - from.right) * eased) : target.right,
      };
      setWidths(widths);

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(tick);
  }, [
    reducedMotion,
    snapLeft,
    snapRight,
    snapViewport,
    target.left,
    target.right,
    usesManualInterpolation,
  ]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    if (snapClearFrameRef.current !== null) {
      window.cancelAnimationFrame(snapClearFrameRef.current);
    }
    if (viewportSnapClearFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportSnapClearFrameRef.current);
    }
  }, []);

  const rendered = usesManualInterpolation
    ? renderedRef.current
    : target;

  return {
    rootRef,
    leftWidth: target.left,
    rightWidth: target.right,
    snapLeft,
    snapViewport,
    style: {
      "--workspace-left-width": `${rendered.left}px`,
      "--workspace-right-width": `${rendered.right}px`,
    } as CSSProperties,
    toggleLeft,
    usesManualInterpolation,
  };
}
