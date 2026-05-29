import { useEffect } from "react";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";

// Owns the connector catalog surface view event. Does not own catalog state.
export function useConnectorsCatalogViewTelemetry(): void {
  useEffect(() => {
    trackProductEvent("connectors_pane_viewed", undefined);
  }, []);
}
