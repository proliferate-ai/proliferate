import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";

export interface HotPaintGate {
  workspaceId: string;
  sessionId: string;
  nonce: number;
  operationId: MeasurementOperationId | null;
  kind: "workspace_hot_reopen" | "session_hot_switch";
}

export function isHotPaintGatePendingForWorkspace(
  gate: HotPaintGate | null,
  workspaceId: string | null | undefined,
): boolean {
  return !!workspaceId && gate?.workspaceId === workspaceId;
}
