import { useEffect } from "react";
import {
  clearTelemetryUser,
  setTelemetryTag,
  setTelemetryUser,
} from "@/lib/integrations/telemetry/client";
import { useAuthStore } from "@/stores/auth/auth-store";

export function useTelemetryAuthIdentity() {
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (authStatus === "authenticated" && user) {
      setTelemetryUser(user);
      setTelemetryTag("auth_status", "authenticated");
      return;
    }

    clearTelemetryUser();
    setTelemetryTag("auth_status", authStatus);
  }, [authStatus, user]);
}
