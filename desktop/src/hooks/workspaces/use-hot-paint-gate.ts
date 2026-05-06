import {
  isHotPaintGatePendingForWorkspace,
  useSessionSelectionStore,
} from "@/stores/sessions/session-selection-store";

export function useIsHotPaintGatePendingForWorkspace(
  workspaceId: string | null | undefined,
): boolean {
  return useSessionSelectionStore((state) =>
    isHotPaintGatePendingForWorkspace(state.hotPaintGate, workspaceId)
  );
}
