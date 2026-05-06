import { useEffect, useRef } from "react";
import type { DesktopWorkspaceKind } from "@/lib/domain/telemetry/events";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  setTelemetryTag,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

function workspaceKind(workspaceId: string | null): DesktopWorkspaceKind | "none" {
  if (!workspaceId) return "none";
  return parseCloudWorkspaceSyntheticId(workspaceId) ? "cloud" : "local";
}

export function useTelemetryWorkspaceSelection() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const previousWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousWorkspaceIdRef.current === selectedWorkspaceId) return;
    previousWorkspaceIdRef.current = selectedWorkspaceId;

    const kind = workspaceKind(selectedWorkspaceId);
    setTelemetryTag("workspace_kind", kind);

    if (kind === "none") return;

    trackProductEvent("workspace_selected", {
      workspace_kind: kind,
    });
  }, [selectedWorkspaceId]);
}
