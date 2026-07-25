import { useCallback, useMemo } from "react";
import type {
  LoginRequest,
  ProductAuthHost,
} from "@proliferate/product-client/host/product-host";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { isTelemetryHandled } from "@/lib/domain/telemetry/errors";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";

export interface ProductAuthActions {
  startLogin: ProductAuthHost["startLogin"];
  logout: ProductAuthHost["logout"];
}

/** Product-owned auth event/error semantics over the host's transport calls. */
export function useProductAuthActions(): ProductAuthActions {
  const { auth } = useProductHost();
  const telemetry = useProductTelemetry();

  const startLogin = useCallback(async (request: LoginRequest) => {
    try {
      const result = await auth.startLogin(request);
      telemetry.track("auth_signed_in", {
        provider: result.provider,
        source: result.source,
      });
      return result;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (!isTelemetryHandled(error)) {
        telemetry.captureException(error, {
          tags: {
            action: "purpose" in request && request.purpose === "link"
              ? "link_provider"
              : "sign_in",
            domain: "auth",
            provider: request.kind,
          },
        });
      }
      telemetry.track("auth_sign_in_failed", {
        failure_kind: classifyTelemetryFailure(error),
        provider: request.kind,
      });
      throw error;
    }
  }, [auth, telemetry]);

  const logout = useCallback(async () => {
    try {
      const result = await auth.logout();
      telemetry.track("auth_signed_out", { provider: result.provider });
      return result;
    } catch (error) {
      telemetry.captureException(error, {
        tags: {
          action: "sign_out",
          domain: "auth",
        },
      });
      throw error;
    }
  }, [auth, telemetry]);

  return useMemo(() => ({ startLogin, logout }), [logout, startLogin]);
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}
