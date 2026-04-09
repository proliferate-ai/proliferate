import { useCallback } from "react";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import { isTelemetryHandled } from "@/lib/domain/telemetry/errors";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { signInWithGitHub, signOut } from "@/lib/integrations/auth/orchestration";

export function useAuthActions() {
  return {
    signInWithGitHub: useCallback(async () => {
      try {
        const result = await signInWithGitHub();
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
    }, []),
    signOut: useCallback(async () => {
      try {
        const result = await signOut();
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
    }, []),
  };
}
