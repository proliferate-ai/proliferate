import { useCallback, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  LoginRequest,
  ProductLoginOutcome,
  ProductLogoutOutcome,
} from "@proliferate/product-client/host/product-host";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import type {
  AuthSignInSource,
  AuthTelemetryProvider,
} from "@/lib/domain/telemetry/events";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import {
  isLoginNotAttempted,
  isTelemetryHandled,
} from "@/lib/domain/telemetry/errors";
import { isAbortError } from "@/lib/integrations/auth/proliferate-auth";

/**
 * The failure-side `provider` a login request classifies to. On success the
 * provider/source come from the host outcome (dev-bypass vs the real provider,
 * the concrete transport path). On failure the transport may never resolve a
 * provider, so — exactly as the prior below-host emitter did — the request kind
 * supplies the static failure provider. Every `LoginRequest["kind"]` is a valid
 * `AuthTelemetryProvider`.
 */
function failureProviderForRequest(
  request: LoginRequest,
): AuthTelemetryProvider {
  return request.kind;
}

/** Google is only reachable as an account link on Desktop; every other request
 * is a sign-in. Mirrors the prior `action` capture tag. */
function captureActionForRequest(request: LoginRequest): string {
  return request.kind === "google" ? "link_provider" : "sign_in";
}

export interface AuditedAuth {
  startLogin: (request: LoginRequest) => Promise<ProductLoginOutcome>;
  logout: () => Promise<ProductLogoutOutcome>;
  cancelLogin: (message?: string) => Promise<void>;
}

/**
 * The single product-owned wrapper around `host.auth.startLogin`/`logout`. It
 * is the one place auth product events are emitted, above the host boundary,
 * through the typed telemetry facade. Every product login/logout caller routes
 * through this hook so telemetry coverage matches the prior below-host emitter
 * exactly:
 *
 * - success → `auth_signed_in {provider, source}` / `auth_signed_out {provider}`
 *   from the normalized host outcome;
 * - non-abort, transport-attempted failure → `captureException` (skipped when
 *   the error is already telemetry-handled) then `auth_sign_in_failed
 *   {failure_kind, provider}`;
 * - abort → re-thrown with no emission;
 * - a host pre-transport rejection (unsupported method / unresolved
 *   precondition) → re-thrown with no emission, matching the prior emitter that
 *   only fired once an orchestration flow ran.
 *
 * `cancelLogin` is a plain pass-through: cancelling an in-flight flow emitted no
 * telemetry before and emits none now.
 */
export function useAuditedAuth(): AuditedAuth {
  const { startLogin, logout, cancelLogin } = useProductHost().auth;
  const telemetry = useProductTelemetry();

  const auditedStartLogin = useCallback(
    async (request: LoginRequest): Promise<ProductLoginOutcome> => {
      try {
        const outcome = await startLogin(request);
        telemetry.track("auth_signed_in", {
          provider: outcome.provider as AuthTelemetryProvider,
          source: outcome.source as AuthSignInSource,
        });
        return outcome;
      } catch (error) {
        if (isAbortError(error) || isLoginNotAttempted(error)) {
          throw error;
        }
        const provider = failureProviderForRequest(request);
        if (!isTelemetryHandled(error)) {
          telemetry.captureException(error, {
            tags: {
              action: captureActionForRequest(request),
              domain: "auth",
              provider,
            },
          });
        }
        telemetry.track("auth_sign_in_failed", {
          failure_kind: classifyTelemetryFailure(error),
          provider,
        });
        throw error;
      }
    },
    [startLogin, telemetry],
  );

  const auditedLogout = useCallback(async (): Promise<ProductLogoutOutcome> => {
    try {
      const outcome = await logout();
      telemetry.track("auth_signed_out", {
        provider: outcome.provider as AuthTelemetryProvider,
      });
      return outcome;
    } catch (error) {
      telemetry.captureException(error, {
        tags: { action: "sign_out", domain: "auth" },
      });
      throw error;
    }
  }, [logout, telemetry]);

  return useMemo<AuditedAuth>(
    () => ({
      startLogin: auditedStartLogin,
      logout: auditedLogout,
      cancelLogin,
    }),
    [auditedStartLogin, auditedLogout, cancelLogin],
  );
}
