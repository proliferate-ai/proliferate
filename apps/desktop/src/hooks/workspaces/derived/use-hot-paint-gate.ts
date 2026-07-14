import { isHotPaintGatePendingForWorkspace } from "#product/lib/domain/sessions/hot-paint-gate";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function useIsHotPaintGatePendingForWorkspace(
  workspaceId: string | null | undefined,
): boolean {
  return useSessionSelectionStore((state) =>
    isHotPaintGatePendingForWorkspace(state.hotPaintGate, workspaceId)
  );
}
