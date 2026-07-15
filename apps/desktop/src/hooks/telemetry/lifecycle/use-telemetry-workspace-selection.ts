import { useEffect, useRef } from "react";
import { resolveDesktopTelemetryWorkspaceKind } from "@/lib/domain/telemetry/workspace-kind";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

// Owns selected-workspace telemetry tags and events. Reports through the typed
// telemetry adapter. Does not own workspace kind classification.
export function useTelemetryWorkspaceSelection() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const telemetry = useProductTelemetry();
  const previousWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousWorkspaceIdRef.current === selectedWorkspaceId) return;
    previousWorkspaceIdRef.current = selectedWorkspaceId;

    const kind = resolveDesktopTelemetryWorkspaceKind(selectedWorkspaceId);
    telemetry.setTag("workspace_kind", kind);

    if (kind === "none") return;

    telemetry.track("workspace_selected", {
      workspace_kind: kind,
    });
  }, [selectedWorkspaceId, telemetry]);
}
