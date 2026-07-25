import { useEffect } from "react";
import {
  clearTelemetryUser,
  setTelemetryTag,
  setTelemetryUser,
} from "@/lib/integrations/telemetry/client";
import { useAuthStore } from "@/stores/auth/auth-store";
import { isSignedInAuthStatus } from "@/lib/domain/auth/auth-state-mapping";

// Owns telemetry user identity and auth-status tags. Does not own auth state.
export function useTelemetryAuthIdentity() {
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (isSignedInAuthStatus(authStatus) && user) {
      setTelemetryUser(user);
      setTelemetryTag("auth_status", "authenticated");
      return;
    }

    clearTelemetryUser();
    setTelemetryTag("auth_status", authStatus);
  }, [authStatus, user]);
}
