import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";

type DebugRenderReasonValues = Record<string, unknown>;

export function useDebugRenderReason(
  component: string,
  values: DebugRenderReasonValues,
): void {
  useDebugValueChange("render_reason", component, values);
}
