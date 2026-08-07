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

interface WorkspaceShellWidths {
  left: number;
  right: number;
}

interface UseWorkspaceShellGeometryOptions {
  leftWidth: number;
  rightWidth: number;
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
  snapLeft: boolean;
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
  snapRight = false,
  onToggleLeft,
}: UseWorkspaceShellGeometryOptions): WorkspaceShellGeometry {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const snapClearFrameRef = useRef<number | null>(null);
  const [snapLeft, setSnapLeft] = useState(false);
  const renderedRef = useRef<WorkspaceShellWidths>({
    left: leftWidth,
    right: rightWidth,
  });
  const usesManualInterpolation = useRef(needsManualInterpolation()).current;
  const reducedMotion = usePrefersReducedMotion();

  const toggleLeft = useCallback((options?: { snapGeometry?: boolean }) => {
    if (snapClearFrameRef.current !== null) {
      window.cancelAnimationFrame(snapClearFrameRef.current);
      snapClearFrameRef.current = null;
    }

    if (!options?.snapGeometry) {
      setSnapLeft(false);
      onToggleLeft();
      return;
    }

    setSnapLeft(true);
    onToggleLeft();
    snapClearFrameRef.current = window.requestAnimationFrame(() => {
      snapClearFrameRef.current = window.requestAnimationFrame(() => {
        snapClearFrameRef.current = null;
        setSnapLeft(false);
      });
    });
  }, [onToggleLeft]);

  useLayoutEffect(() => {
    if (!usesManualInterpolation) {
      renderedRef.current = { left: leftWidth, right: rightWidth };
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
    const target = { left: leftWidth, right: rightWidth };
    const setWidths = (widths: WorkspaceShellWidths) => {
      renderedRef.current = widths;
      root.style.setProperty("--workspace-left-width", `${widths.left}px`);
      root.style.setProperty("--workspace-right-width", `${widths.right}px`);
    };

    const animateLeft = !snapLeft && from.left !== target.left;
    const animateRight = !snapRight && from.right !== target.right;
    if (reducedMotion || (!animateLeft && !animateRight)) {
      setWidths(target);
      return;
    }

    if (snapLeft || snapRight) {
      setWidths({
        left: snapLeft ? target.left : from.left,
        right: snapRight ? target.right : from.right,
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
  }, [leftWidth, reducedMotion, rightWidth, snapLeft, snapRight, usesManualInterpolation]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    if (snapClearFrameRef.current !== null) {
      window.cancelAnimationFrame(snapClearFrameRef.current);
    }
  }, []);

  const rendered = usesManualInterpolation
    ? renderedRef.current
    : { left: leftWidth, right: rightWidth };

  return {
    rootRef,
    snapLeft,
    style: {
      "--workspace-left-width": `${rendered.left}px`,
      "--workspace-right-width": `${rendered.right}px`,
    } as CSSProperties,
    toggleLeft,
    usesManualInterpolation,
  };
}
