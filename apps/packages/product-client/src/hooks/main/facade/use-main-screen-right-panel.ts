import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { useResize } from "#product/hooks/ui/layout/use-resize";
import {
  DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  clampRightPanelWidth,
  normalizeRightPanelDurableState,
  resolveRightPanelDragOutcome,
  type RightPanelDurableState,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { reconcileRightPanelWorkspaceState } from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";
import { resolveWithWorkspaceFallback } from "#product/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

export interface MainScreenRightPanelState {
  rightPanelState: RightPanelWorkspaceState;
  setRightPanelState: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  rightPanelOpen: boolean;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  rightPanelWidth: number;
  setRightPanelWidth: Dispatch<SetStateAction<number>>;
  /** True while a separator drag is actively resizing the panel. */
  rightPanelResizing: boolean;
  rightPanelFocusRequestToken: number;
  requestRightPanelFocus: () => void;
  onRightSeparatorDown: (event: MouseEvent) => void;
}

interface MainScreenRightPanelInput {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  isCloudWorkspaceSelected: boolean;
  // While a workspace entry is pending the panel is forced shut, unless the user
  // reopened it themselves during that same pending entry.
  rightPanelSuppressed: boolean;
}

// Owns everything about the right panel's frame: its persisted geometry, the
// open/closed state, focus requests, and the separator drag (including the
// drag-past-the-minimum collapse). Split out of the Main screen facade so the
// facade stays a composition of concerns rather than the place each one lives.
export function useMainScreenRightPanel({
  workspaceUiKey,
  materializedWorkspaceId,
  isCloudWorkspaceSelected,
  rightPanelSuppressed,
}: MainScreenRightPanelInput): MainScreenRightPanelState {
  const [rightPanelUserOpenOverride, setRightPanelUserOpenOverride] = useState<{
    materializedWorkspaceId: string;
    nonce: number;
  } | null>(null);
  // The right panel frame is shell-level; only its selected content is workspace-scoped.
  const [rightPanelSessionDurableState, setRightPanelSessionDurableState] =
    useState<RightPanelDurableState | null>(null);
  const [rightPanelFocusRequestToken, setRightPanelFocusRequestToken] = useState(0);
  const rightPanelDurableByWorkspace = useWorkspaceUiStore(
    (state) => state.rightPanelDurableByWorkspace,
  );
  const rightPanelMaterializedByWorkspace = useWorkspaceUiStore(
    (state) => state.rightPanelMaterializedByWorkspace,
  );
  const setRightPanelDurableForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelDurableForWorkspace,
  );
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelWidthForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelWidthForWorkspace,
  );
  const rightPanelDurableFallback = useMemo(
    () => resolveWithWorkspaceFallback(
      rightPanelDurableByWorkspace,
      workspaceUiKey,
      materializedWorkspaceId,
    ),
    [materializedWorkspaceId, rightPanelDurableByWorkspace, workspaceUiKey],
  );
  const persistedRightPanelDurableState = useMemo(
    () => normalizeRightPanelDurableState(
      rightPanelDurableFallback.value ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE,
    ),
    [rightPanelDurableFallback.value],
  );
  const rightPanelDurableState = rightPanelSessionDurableState
    ?? persistedRightPanelDurableState;
  const rightPanelMaterializedState = materializedWorkspaceId
    ? rightPanelMaterializedByWorkspace[materializedWorkspaceId]
      ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE
    : DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE;
  const rightPanelWidth = rightPanelDurableState.width ?? RIGHT_PANEL_DEFAULT_WIDTH;
  const rightPanelState = useMemo(
    () => reconcileRightPanelWorkspaceState(rightPanelMaterializedState, {
      isCloudWorkspaceSelected,
    }),
    [isCloudWorkspaceSelected, rightPanelMaterializedState],
  );
  useEffect(() => {
    if (
      !workspaceUiKey
      || !rightPanelDurableFallback.shouldWriteBack
      || !rightPanelDurableFallback.value
    ) {
      return;
    }
    setRightPanelDurableForWorkspace(workspaceUiKey, rightPanelDurableFallback.value);
  }, [
    rightPanelDurableFallback.shouldWriteBack,
    rightPanelDurableFallback.value,
    setRightPanelDurableForWorkspace,
    workspaceUiKey,
  ]);
  const setRightPanelState = useCallback<Dispatch<SetStateAction<RightPanelWorkspaceState>>>(
    (value) => {
      if (!workspaceUiKey) {
        return;
      }
      const next = typeof value === "function"
        ? (value as (previous: RightPanelWorkspaceState) => RightPanelWorkspaceState)(
            rightPanelState,
          )
        : value;
      if (materializedWorkspaceId) {
        setRightPanelMaterializedForWorkspace(
          materializedWorkspaceId,
          reconcileRightPanelWorkspaceState(next, { isCloudWorkspaceSelected }),
        );
      }
    },
    [
      isCloudWorkspaceSelected,
      materializedWorkspaceId,
      rightPanelState,
      setRightPanelMaterializedForWorkspace,
      workspaceUiKey,
    ],
  );
  const setRightPanelWidth = useCallback<Dispatch<SetStateAction<number>>>(
    (value) => {
      if (!workspaceUiKey) {
        return;
      }
      const nextWidth = typeof value === "function"
        ? (value as (previous: number) => number)(rightPanelDurableState.width)
        : value;
      const nextDurableState = {
        ...rightPanelDurableState,
        width: clampRightPanelWidth(nextWidth),
      };
      setRightPanelSessionDurableState(nextDurableState);
      setRightPanelDurableForWorkspace(workspaceUiKey, nextDurableState);
    },
    [
      rightPanelDurableState,
      setRightPanelDurableForWorkspace,
      workspaceUiKey,
    ],
  );
  const setRightPanelOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      if (!workspaceUiKey) {
        return;
      }
      const nextOpen = typeof value === "function"
        ? (value as (previous: boolean) => boolean)(rightPanelDurableState.open)
        : value;
      const nextDurableState = {
        ...rightPanelDurableState,
        open: nextOpen,
      };
      setRightPanelSessionDurableState(nextDurableState);
      setRightPanelDurableForWorkspace(workspaceUiKey, nextDurableState);
      if (nextOpen && materializedWorkspaceId) {
        setRightPanelUserOpenOverride((current) => ({
          materializedWorkspaceId,
          nonce: (current?.nonce ?? 0) + 1,
        }));
      } else {
        setRightPanelUserOpenOverride(null);
      }
    },
    [
      materializedWorkspaceId,
      rightPanelDurableState.open,
      rightPanelDurableState,
      setRightPanelDurableForWorkspace,
      workspaceUiKey,
    ],
  );
  const requestRightPanelFocus = useCallback(() => {
    setRightPanelFocusRequestToken((token) => token + 1);
  }, []);

  // Dragging the right separator expresses two gestures through one pointer
  // stream: resize while the requested width is credible, collapse once it is
  // not. The domain decides which (`resolveRightPanelDragOutcome`), so the
  // resize hook is deliberately given `min: 0` — a hook-level clamp at the
  // panel minimum would hide the very part of the gesture that means "close
  // this". Collapse ends the gesture: once closed, the remainder of the same
  // drag is ignored so a jittery pointer cannot re-expand the panel from under
  // the user's cursor.
  //
  // While the drag is live the width is session state only: writing the
  // durable store on every mousemove would re-serialize the whole persisted
  // workspace-ui slice per event (see the persistence subscriber in
  // `use-workspace-ui-lifecycle`). The gesture is one width choice, so it
  // commits once, on release. `rightPanelResizing` is exported so the shell
  // can drop the geometry easing while the width is pointer-driven.
  const rightPanelDragCollapsedRef = useRef(false);
  const rightPanelDragWidthRef = useRef<number | null>(null);
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const handleRightPanelDrag = useCallback(
    (rawWidth: number) => {
      if (rightPanelDragCollapsedRef.current || !workspaceUiKey) {
        return;
      }
      const outcome = resolveRightPanelDragOutcome(rawWidth);
      if (outcome.kind === "collapse") {
        rightPanelDragCollapsedRef.current = true;
        // Resizing ends here so the collapse itself animates: the last
        // credible width stays persisted, and reopening restores the size the
        // user had chosen rather than the panel's default.
        setRightPanelResizing(false);
        setRightPanelOpen(false);
        return;
      }
      rightPanelDragWidthRef.current = outcome.width;
      setRightPanelSessionDurableState({
        ...rightPanelDurableState,
        width: outcome.width,
      });
    },
    [rightPanelDurableState, setRightPanelOpen, workspaceUiKey],
  );
  const handleRightSeparatorDragEnd = useCallback(() => {
    setRightPanelResizing(false);
    const draggedWidth = rightPanelDragWidthRef.current;
    rightPanelDragWidthRef.current = null;
    if (draggedWidth !== null && workspaceUiKey) {
      setRightPanelWidthForWorkspace(workspaceUiKey, draggedWidth);
    }
  }, [setRightPanelWidthForWorkspace, workspaceUiKey]);
  // The rail's rendered width can sit below the persisted width while the
  // main-pane floor clamps it (MAIN_PANE_MIN_WIDTH in the rail's width
  // style). Seeding the drag from the rendered edge keeps the separator under
  // the pointer from the first pixel — starting from the larger persisted
  // value would replay the clamped-away difference as dead travel before
  // anything moved.
  const resolveRenderedRailWidth = useCallback(() => {
    const railWidth = document
      .querySelector("[data-right-panel-rail]")
      ?.getBoundingClientRect().width;
    return railWidth ? railWidth : rightPanelWidth;
  }, [rightPanelWidth]);
  const beginRightSeparatorDrag = useResize({
    direction: "horizontal",
    size: rightPanelWidth,
    resolveSize: resolveRenderedRailWidth,
    onResize: handleRightPanelDrag,
    onResizeEnd: handleRightSeparatorDragEnd,
    reverse: true,
    min: 0,
    max: RIGHT_PANEL_MAX_WIDTH,
  });
  const onRightSeparatorDown = useCallback(
    (event: MouseEvent) => {
      rightPanelDragCollapsedRef.current = false;
      rightPanelDragWidthRef.current = null;
      setRightPanelResizing(true);
      beginRightSeparatorDrag(event);
    },
    [beginRightSeparatorDrag],
  );

  const userOpenOverrideActive = Boolean(
    rightPanelUserOpenOverride
    && rightPanelUserOpenOverride.materializedWorkspaceId === materializedWorkspaceId
    && rightPanelSuppressed,
  );
  const rightPanelOpen = rightPanelDurableState.open
    && (!rightPanelSuppressed || userOpenOverrideActive);

  useEffect(() => {
    if (
      !rightPanelUserOpenOverride
      || rightPanelUserOpenOverride.materializedWorkspaceId !== materializedWorkspaceId
      || !rightPanelSuppressed
    ) {
      setRightPanelUserOpenOverride(null);
    }
  }, [
    materializedWorkspaceId,
    rightPanelSuppressed,
    rightPanelUserOpenOverride,
  ]);

  return {
    rightPanelState,
    setRightPanelState,
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelWidth,
    setRightPanelWidth,
    rightPanelResizing,
    rightPanelFocusRequestToken,
    requestRightPanelFocus,
    onRightSeparatorDown,
  };
}
