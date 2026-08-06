import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion } from "@proliferate/design/motion";
import { useCoarsePointer } from "#product/hooks/ui/layout/use-coarse-pointer";
import { usePrefersReducedMotion } from "#product/hooks/ui/motion/use-prefers-reduced-motion";

export type WorkspaceSidebarPeekState =
  | "inactive"
  | "open"
  | "closing"
  | "preparing"
  | "toggle-closing"
  | "closed";

interface UseWorkspaceSidebarPeekOptions {
  open: boolean;
  onToggleSidebar: (options?: { snapGeometry?: boolean }) => void;
}

export function useWorkspaceSidebarPeek({
  open,
  onToggleSidebar,
}: UseWorkspaceSidebarPeekOptions) {
  const [peekActive, setPeekActive] = useState(false);
  const [peekExiting, setPeekExiting] = useState(false);
  const [peekPreparing, setPeekPreparing] = useState(false);
  const [toggleCloseActive, setToggleCloseActive] = useState(false);
  const peekCloseTimerRef = useRef<number | null>(null);
  const peekExitTimerRef = useRef<number | null>(null);
  const toggleRestTimerRef = useRef<number | null>(null);
  const peekPrepareFrameRef = useRef<number | null>(null);
  const peekShowFrameRef = useRef<number | null>(null);
  const previousOpenRef = useRef(open);
  const coarsePointer = useCoarsePointer();
  const reducedMotion = usePrefersReducedMotion();

  // The ordinary close needs one paint at translate 0. Reduced motion skips
  // that phase entirely so the edge trigger is available immediately.
  const closingOnThisRender = !reducedMotion && previousOpenRef.current && !open;
  const toggleClosing = closingOnThisRender || toggleCloseActive;
  const peekVisible = peekActive || peekExiting || peekPreparing;

  const cancelPeekClose = useCallback(() => {
    if (peekCloseTimerRef.current !== null) {
      window.clearTimeout(peekCloseTimerRef.current);
      peekCloseTimerRef.current = null;
    }
  }, []);

  const cancelPeekExit = useCallback(() => {
    if (peekExitTimerRef.current !== null) {
      window.clearTimeout(peekExitTimerRef.current);
      peekExitTimerRef.current = null;
    }
  }, []);

  const cancelPeekPreparation = useCallback(() => {
    if (peekPrepareFrameRef.current !== null) {
      window.cancelAnimationFrame(peekPrepareFrameRef.current);
      peekPrepareFrameRef.current = null;
    }
    if (peekShowFrameRef.current !== null) {
      window.cancelAnimationFrame(peekShowFrameRef.current);
      peekShowFrameRef.current = null;
    }
  }, []);

  const cancelToggleRest = useCallback(() => {
    if (toggleRestTimerRef.current !== null) {
      window.clearTimeout(toggleRestTimerRef.current);
      toggleRestTimerRef.current = null;
    }
  }, []);

  const activatePeek = useCallback(() => {
    if (coarsePointer || open) {
      return;
    }
    cancelPeekClose();
    cancelPeekExit();

    if (peekActive) {
      setPeekExiting(false);
      return;
    }

    if (toggleClosing) {
      cancelToggleRest();
      cancelPeekPreparation();
      setToggleCloseActive(false);
      setPeekExiting(false);

      if (reducedMotion) {
        setPeekPreparing(false);
        setPeekActive(true);
        return;
      }

      // Toggle-close rests at translate 0. Paint the peek's -8px rest state
      // first, then reveal on the following frame so every animated peek
      // travels from the window edge.
      setPeekPreparing(true);
      peekPrepareFrameRef.current = window.requestAnimationFrame(() => {
        peekPrepareFrameRef.current = null;
        peekShowFrameRef.current = window.requestAnimationFrame(() => {
          peekShowFrameRef.current = null;
          setPeekPreparing(false);
          setPeekActive(true);
        });
      });
      return;
    }

    setPeekPreparing(false);
    setPeekExiting(false);
    setPeekActive(true);
  }, [
    cancelPeekClose,
    cancelPeekExit,
    cancelPeekPreparation,
    cancelToggleRest,
    coarsePointer,
    open,
    peekActive,
    reducedMotion,
    toggleClosing,
  ]);

  const holdPeek = useCallback(() => {
    if (
      open
      || (!peekActive
        && !peekExiting
        && !peekPreparing
        && peekCloseTimerRef.current === null)
    ) {
      return;
    }
    activatePeek();
  }, [activatePeek, open, peekActive, peekExiting, peekPreparing]);

  const deactivatePeek = useCallback(() => {
    if (open || !peekActive) {
      return;
    }
    cancelPeekClose();
    peekCloseTimerRef.current = window.setTimeout(() => {
      peekCloseTimerRef.current = null;
      setPeekActive(false);
      cancelPeekExit();

      if (reducedMotion) {
        setPeekExiting(false);
        return;
      }

      setPeekExiting(true);
      peekExitTimerRef.current = window.setTimeout(() => {
        peekExitTimerRef.current = null;
        setPeekExiting(false);
      }, motion.duration.exitMs);
    }, motion.delay.hoverCardHideMs);
  }, [cancelPeekClose, cancelPeekExit, open, peekActive, reducedMotion]);

  useLayoutEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;

    if (open || reducedMotion) {
      cancelToggleRest();
      setToggleCloseActive(false);
      return;
    }
    if (!wasOpen) {
      return;
    }

    setToggleCloseActive(true);
    cancelToggleRest();
    toggleRestTimerRef.current = window.setTimeout(() => {
      toggleRestTimerRef.current = null;
      setToggleCloseActive(false);
    }, motion.duration.panelMs);
  }, [cancelToggleRest, open, reducedMotion]);

  useEffect(() => {
    if (!open) {
      return;
    }
    cancelPeekClose();
    cancelPeekExit();
    cancelPeekPreparation();
    setPeekActive(false);
    setPeekExiting(false);
    setPeekPreparing(false);
  }, [cancelPeekClose, cancelPeekExit, cancelPeekPreparation, open]);

  useEffect(() => () => {
    cancelPeekClose();
    cancelPeekExit();
    cancelPeekPreparation();
    cancelToggleRest();
  }, [cancelPeekClose, cancelPeekExit, cancelPeekPreparation, cancelToggleRest]);

  const handleToggleSidebar = useCallback(() => {
    const snapGeometry = !open && (peekActive || peekExiting);
    cancelPeekClose();
    cancelPeekExit();
    cancelPeekPreparation();
    setPeekActive(false);
    setPeekExiting(false);
    setPeekPreparing(false);
    onToggleSidebar({ snapGeometry });
  }, [
    cancelPeekClose,
    cancelPeekExit,
    cancelPeekPreparation,
    onToggleSidebar,
    open,
    peekActive,
    peekExiting,
  ]);

  const peekState: WorkspaceSidebarPeekState = open
    ? "inactive"
    : peekActive
      ? "open"
      : peekExiting
        ? "closing"
        : peekPreparing
          ? "preparing"
          : toggleClosing
            ? "toggle-closing"
            : "closed";

  return {
    activatePeek,
    deactivatePeek,
    handleToggleSidebar,
    holdPeek,
    peekActive,
    peekExiting,
    peekPreparing,
    peekState,
    peekVisible,
    toggleClosing,
  };
}
