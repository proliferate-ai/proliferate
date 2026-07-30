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
  const rightPanelDragCollapsedRef = useRef(false);
  const handleRightPanelDrag = useCallback(
    (rawWidth: number) => {
      if (rightPanelDragCollapsedRef.current) {
        return;
      }
      const outcome = resolveRightPanelDragOutcome(rawWidth);
      if (outcome.kind === "collapse") {
        rightPanelDragCollapsedRef.current = true;
        // The last credible width stays persisted, so reopening restores the
        // size the user had chosen rather than the panel's default.
        setRightPanelOpen(false);
        return;
      }
      setRightPanelWidth(outcome.width);
    },
    [setRightPanelOpen, setRightPanelWidth],
  );
  const beginRightSeparatorDrag = useResize({
    direction: "horizontal",
    size: rightPanelWidth,
    onResize: handleRightPanelDrag,
    reverse: true,
    min: 0,
    max: RIGHT_PANEL_MAX_WIDTH,
  });
  const onRightSeparatorDown = useCallback(
    (event: MouseEvent) => {
      rightPanelDragCollapsedRef.current = false;
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
    rightPanelFocusRequestToken,
    requestRightPanelFocus,
    onRightSeparatorDown,
  };
}
