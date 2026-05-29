import { useCallback, useEffect } from "react";
import { registerCurrentAuthSessionProvider } from "@/lib/domain/auth/current-auth-session";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { bootstrapAuth } from "@/lib/integrations/auth/orchestration";
import { useAuthOrchestrationEffects } from "@/hooks/auth/workflows/use-auth-orchestration-effects";

// Owns app-mounted auth bootstrap wiring. Does not own sign-in/sign-out actions.
export function useAuthBootstrap() {
  const authEffects = useAuthOrchestrationEffects();

  useEffect(() => {
    registerCurrentAuthSessionProvider(() => authEffects.getAuthState().session);
  }, [authEffects]);

  return useCallback(async () => {
    try {
      await bootstrapAuth(authEffects);
    } catch (error) {
      captureTelemetryException(error, {
        tags: {
          action: "bootstrap",
          domain: "auth",
        },
      });
    }
  }, [authEffects]);
}
