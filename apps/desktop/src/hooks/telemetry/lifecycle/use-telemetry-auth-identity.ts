import { useEffect } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";

// Owns telemetry user identity and auth-status tags. Reads the shared auth state
// from the mounted ProductHost (not the Desktop auth store) and reports through
// the typed telemetry adapter. Does not own auth state.
export function useTelemetryAuthIdentity() {
  const authState = useProductHost().auth.state;
  const telemetry = useProductTelemetry();

  const status = authState.status;
  const user = authState.status === "authenticated" ? authState.user : null;

  useEffect(() => {
    if (status === "authenticated" && user) {
      telemetry.setUser(user);
      telemetry.setTag("auth_status", "authenticated");
      return;
    }

    telemetry.setUser(null);
    telemetry.setTag("auth_status", status);
  }, [status, user, telemetry]);
}
