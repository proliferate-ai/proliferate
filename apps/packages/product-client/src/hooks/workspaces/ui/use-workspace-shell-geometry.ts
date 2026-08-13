import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

interface UseWorkspaceShellGeometryOptions {
  leftWidth: number;
  rightWidth: number;
  /**
   * Held true while the left separator drag is live. Pointer-driven geometry
   * must not retain the open/close easing or the edge trails the cursor.
   */
  snapLeft?: boolean;
  onToggleLeft: () => void;
}

interface WorkspaceShellGeometry {
  style: CSSProperties;
  snapLeft: boolean;
  toggleLeft: (options?: { snapGeometry?: boolean }) => void;
}

/**
 * Publishes the pane widths as `--workspace-left-width`/`--workspace-right-width`
 * on the shell root. The vars stay unregistered on purpose: WebKit applies
 * page zoom to a registered `<length>` custom property once when it computes
 * and again at the consumer, so a zoomed window renders width·zoom² (PRO-166).
 * Untyped vars substitute textually; each consumer eases its own concrete
 * property (width/left/padding) against the shared geometry durations, which
 * the snap attributes zero during pointer-driven drags.
 */
export function useWorkspaceShellGeometry({
  leftWidth,
  rightWidth,
  snapLeft: requestedSnapLeft = false,
  onToggleLeft,
}: UseWorkspaceShellGeometryOptions): WorkspaceShellGeometry {
  const snapClearFrameRef = useRef<number | null>(null);
  const [toggleSnapLeft, setToggleSnapLeft] = useState(false);

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

  useEffect(() => () => {
    if (snapClearFrameRef.current !== null) {
      window.cancelAnimationFrame(snapClearFrameRef.current);
    }
  }, []);

  return {
    snapLeft: requestedSnapLeft || toggleSnapLeft,
    style: {
      "--workspace-left-width": `${leftWidth}px`,
      "--workspace-right-width": `${rightWidth}px`,
    } as CSSProperties,
    toggleLeft,
  };
}
