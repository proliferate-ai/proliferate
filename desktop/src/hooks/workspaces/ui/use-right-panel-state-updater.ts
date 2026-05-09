import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  reconcileRightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-state";
import type { RightPanelWorkspaceState } from "@/lib/domain/workspaces/shell/right-panel-model";
import { rightPanelStateEqual } from "@/lib/domain/workspaces/shell/right-panel-view";

export function useRightPanelStateUpdater({
  isCloudWorkspaceSelected,
  onStateChange,
}: {
  isCloudWorkspaceSelected: boolean;
  onStateChange: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
}) {
  return useCallback(
    (value: SetStateAction<RightPanelWorkspaceState>) => {
      onStateChange((previous) => {
        const current = reconcileRightPanelWorkspaceState(previous, {
          isCloudWorkspaceSelected,
        });
        const next = typeof value === "function"
          ? (value as (previousValue: RightPanelWorkspaceState) => RightPanelWorkspaceState)(
              current,
            )
          : value;
        const reconciledNext = reconcileRightPanelWorkspaceState(next, {
          isCloudWorkspaceSelected,
        });
        if (!rightPanelStateEqual(current, reconciledNext)) {
          return reconciledNext;
        }
        return rightPanelStateEqual(previous, current) ? previous : current;
      });
    },
    [isCloudWorkspaceSelected, onStateChange],
  );
}
