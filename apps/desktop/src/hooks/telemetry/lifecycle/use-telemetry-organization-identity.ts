import { useEffect, useRef } from "react";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

// Owns the organization_id Sentry tag. Sets it whenever the active org is known.
export function useTelemetryOrganizationIdentity() {
  const telemetry = useProductTelemetry();
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );
  const previousOrganizationIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previousOrganizationIdRef.current === activeOrganizationId) {
      return;
    }
    previousOrganizationIdRef.current = activeOrganizationId;

    if (activeOrganizationId) {
      telemetry.setTag("organization_id", activeOrganizationId);
    } else {
      telemetry.setTag("organization_id", "none");
    }
  }, [activeOrganizationId, telemetry]);
}
