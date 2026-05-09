import { useCallback } from "react";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import { isTelemetryHandled } from "@/lib/domain/telemetry/errors";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  signInWithGitHub,
  signOut,
} from "@/lib/integrations/auth/orchestration";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";
import { useAuthOrchestrationEffects } from "@/hooks/auth/workflows/use-auth-orchestration-effects";

// Owns user-triggered auth actions and their telemetry. Does not own auth bootstrap.
export function useAuthActions() {
  const authEffects = useAuthOrchestrationEffects();

  return {
    signInWithGitHub: useCallback(async (options?: GitHubDesktopSignInOptions) => {
      try {
        const result = await signInWithGitHub(options, authEffects);
        trackProductEvent("auth_signed_in", {
          provider: result.provider,
          source: result.source,
        });
        return result;
      } catch (error) {
        if (!isTelemetryHandled(error)) {
          captureTelemetryException(error, {
            tags: {
              action: "sign_in",
              domain: "auth",
              provider: "github",
            },
          });
        }
        trackProductEvent("auth_sign_in_failed", {
          failure_kind: classifyTelemetryFailure(error),
          provider: "github",
        });
        throw error;
      }
    }, [authEffects]),
    signOut: useCallback(async () => {
      try {
        const result = await signOut(authEffects);
        trackProductEvent("auth_signed_out", {
          provider: result.provider,
        });
        return result;
      } catch (error) {
        captureTelemetryException(error, {
          tags: {
            action: "sign_out",
            domain: "auth",
          },
        });
        throw error;
      }
    }, [authEffects]),
  };
}
