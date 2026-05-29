import type { DesktopWorkspaceKind } from "@/lib/domain/telemetry/events";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

export function resolveDesktopTelemetryWorkspaceKind(
  workspaceId: string | null,
): DesktopWorkspaceKind | "none" {
  if (!workspaceId) return "none";
  return parseCloudWorkspaceSyntheticId(workspaceId) ? "cloud" : "local";
}
