import { useCallback } from "react";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import { isTelemetryHandled } from "@/lib/domain/telemetry/errors";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  cancelActiveAuthFlow,
  linkDesktopProvider,
  signInWithGitHub,
  signInWithSso,
  signOut,
} from "@/lib/integrations/auth/orchestration-provider-flow";
import {
  isAbortError,
  type GitHubDesktopSignInOptions,
} from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";
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
        if (isAbortError(error)) {
          throw error;
        }
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
    signInWithSso: useCallback(async (options?: DesktopSsoSignInOptions) => {
      try {
        const result = await signInWithSso(options, authEffects);
        trackProductEvent("auth_signed_in", {
          provider: result.provider,
          source: result.source,
        });
        return result;
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (!isTelemetryHandled(error)) {
          captureTelemetryException(error, {
            tags: {
              action: "sign_in",
              domain: "auth",
              provider: "sso",
            },
          });
        }
        trackProductEvent("auth_sign_in_failed", {
          failure_kind: classifyTelemetryFailure(error),
          provider: "sso",
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
    cancelAuthFlow: useCallback(async (message?: string) => {
      await cancelActiveAuthFlow(message);
    }, []),
    linkGoogle: useCallback(async () => {
      try {
        const result = await linkDesktopProvider("google", authEffects);
        trackProductEvent("auth_signed_in", {
          provider: result.provider,
          source: result.source,
        });
        return result;
      } catch (error) {
        if (!isTelemetryHandled(error)) {
          captureTelemetryException(error, {
            tags: {
              action: "link_provider",
              domain: "auth",
              provider: "google",
            },
          });
        }
        trackProductEvent("auth_sign_in_failed", {
          failure_kind: classifyTelemetryFailure(error),
          provider: "google",
        });
        throw error;
      }
    }, [authEffects]),
  };
}
