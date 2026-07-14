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
  signInWithPassword,
  type PasswordSignInCredentials,
} from "@/lib/integrations/auth/orchestration-password-flow";
import {
  isAbortError,
  type GitHubDesktopSignInOptions,
} from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";
import { useAuthOrchestrationEffects } from "@/hooks/auth/workflows/use-auth-orchestration-effects";
import type { DesktopAuthTransaction } from "@/lib/integrations/auth/desktop-auth-transaction";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

// Owns user-triggered auth actions and their telemetry. Does not own auth bootstrap.
export function useAuthActions(cloudClient: ProliferateCloudClient | null) {
  const authEffects = useAuthOrchestrationEffects(cloudClient);

  return {
    signInWithGitHub: useCallback(async (
      options: GitHubDesktopSignInOptions | undefined,
      transaction: DesktopAuthTransaction,
    ) => {
      try {
        const result = await signInWithGitHub(options, authEffects, transaction);
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
    signInWithPassword: useCallback(async (
      credentials: PasswordSignInCredentials,
      transaction: DesktopAuthTransaction,
    ) => {
      try {
        const result = await signInWithPassword(
          credentials,
          authEffects,
          transaction,
        );
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
              provider: "password",
            },
          });
        }
        trackProductEvent("auth_sign_in_failed", {
          failure_kind: classifyTelemetryFailure(error),
          provider: "password",
        });
        throw error;
      }
    }, [authEffects]),
    signInWithSso: useCallback(async (
      options: DesktopSsoSignInOptions | undefined,
      transaction: DesktopAuthTransaction,
    ) => {
      try {
        const result = await signInWithSso(options, authEffects, transaction);
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
    signOut: useCallback(async (transaction: DesktopAuthTransaction) => {
      try {
        const result = await signOut(authEffects, transaction);
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
    linkGoogle: useCallback(async (transaction: DesktopAuthTransaction) => {
      try {
        const result = await linkDesktopProvider(
          "google",
          authEffects,
          transaction,
        );
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
