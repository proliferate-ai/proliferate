import { useEffect } from "react";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

// Owns the organization_id telemetry tag. Sets it whenever the active org is
// known, reporting through the typed telemetry adapter.
export function useTelemetryOrganizationIdentity() {
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );
  const telemetry = useProductTelemetry();

  useEffect(() => {
    telemetry.setTag(
      "organization_id",
      activeOrganizationId ? activeOrganizationId : "none",
    );
  }, [activeOrganizationId, telemetry]);
}
