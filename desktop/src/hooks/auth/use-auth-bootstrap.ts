import { useCallback, useEffect } from "react";
import { registerCurrentAuthSessionProvider } from "@/lib/domain/auth/current-auth-session";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useAuthStore } from "@/stores/auth/auth-store";
import { bootstrapAuth } from "@/lib/integrations/auth/orchestration";

export function useAuthBootstrap() {
  useEffect(() => {
    registerCurrentAuthSessionProvider(() => useAuthStore.getState().session);
  }, []);

  return useCallback(async () => {
    try {
      await bootstrapAuth();
    } catch (error) {
      captureTelemetryException(error, {
        tags: {
          action: "bootstrap",
          domain: "auth",
        },
      });
    }
  }, []);
}
