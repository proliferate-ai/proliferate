import {
  isHotPaintGatePendingForWorkspace,
  useHarnessStore,
} from "@/stores/sessions/harness-store";

export function useIsHotPaintGatePendingForWorkspace(
  workspaceId: string | null | undefined,
): boolean {
  return useHarnessStore((state) =>
    isHotPaintGatePendingForWorkspace(state.hotPaintGate, workspaceId)
  );
}
