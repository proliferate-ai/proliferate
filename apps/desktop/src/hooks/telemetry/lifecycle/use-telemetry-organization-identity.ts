import { useEffect } from "react";
import { setTelemetryTag } from "@/lib/integrations/telemetry/client";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

// Owns the organization_id Sentry tag. Sets it whenever the active org is known.
export function useTelemetryOrganizationIdentity() {
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );

  useEffect(() => {
    if (activeOrganizationId) {
      setTelemetryTag("organization_id", activeOrganizationId);
    } else {
      setTelemetryTag("organization_id", "none");
    }
  }, [activeOrganizationId]);
}
