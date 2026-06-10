import {
  configureCloudRequestMeasurement,
  createProliferateClient as createSdkProliferateClient,
  getProliferateClient as getSdkProliferateClient,
  isCloudAgentKind,
  ProliferateClientError,
  setProliferateClientFactory,
  type Middleware,
  type ProliferateStreamRequestInput,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
  type StoredAuthSession,
} from "@/lib/access/tauri/auth";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { getCurrentAuthSession } from "@/lib/domain/auth/current-auth-session";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement-catalog-types";
import { isAnyHarnessTimingEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import {
  isDefinitiveAuthRejection,
  isSessionExpiring,
  refreshDesktopUserSession,
} from "@/lib/integrations/auth/proliferate-auth";

export type * from "@proliferate/cloud-sdk/types";
export {
  isCloudAgentKind,
  ProliferateClientError,
};

async function loadValidSession(): Promise<StoredAuthSession | null> {
  const current = getCurrentAuthSession();
  const stored = await getStoredAuthSession();
  const candidate = current ?? stored;
  if (!candidate) return null;
  if (!isSessionExpiring(candidate)) {
    return candidate;
  }
  try {
    const refreshed = await refreshDesktopUserSession(candidate.refresh_token);
    await setStoredAuthSession(refreshed);
    return refreshed;
  } catch (error) {
    // Only a definitive server rejection invalidates the stored session; a
    // network blip during refresh must not sign the user out.
    if (isDefinitiveAuthRejection(error)) {
      await clearStoredAuthSession();
    }
    return null;
  }
}

async function refreshSessionOrThrow(
  session: StoredAuthSession,
): Promise<StoredAuthSession> {
  const refreshed = await refreshDesktopUserSession(session.refresh_token);
  await setStoredAuthSession(refreshed);
  return refreshed;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    return prepareDesktopCloudRequest(request);
  },

  async onResponse({ response, request }) {
    if (response.status === 401) {
      const stored = await getStoredAuthSession();
      if (!stored) {
        await clearStoredAuthSession();
        throw new ProliferateClientError(
          "Session expired. Please sign in again.",
          401,
          "unauthorized",
        );
      }
      try {
        const refreshed = await refreshSessionOrThrow(stored);
        const retryHeaders = new Headers(request.headers);
        retryHeaders.set("authorization", `Bearer ${refreshed.access_token}`);
        return fetch(new Request(request, { headers: retryHeaders }));
      } catch (error) {
        if (isDefinitiveAuthRejection(error)) {
          await clearStoredAuthSession();
          throw new ProliferateClientError(
            "Session expired. Please sign in again.",
            401,
            "unauthorized",
          );
        }
        throw new ProliferateClientError(
          "Could not refresh your session due to a network problem. Please retry.",
          503,
          "auth_refresh_unavailable",
        );
      }
    }
    return response;
  },
};

async function prepareDesktopCloudRequest(request: Request): Promise<Request> {
  if (isDevAuthBypassed()) {
    throw new ProliferateClientError(
      "Cloud workspaces require real sign-in. Set VITE_DEV_DISABLE_AUTH=false and sign in.",
      401,
      "dev_auth_bypass",
    );
  }
  const session = await loadValidSession();
  if (!session) {
    throw new ProliferateClientError(
      "You must sign in to use cloud workspaces.",
      401,
      "unauthorized",
    );
  }
  if (!request.headers.has("accept")) {
    request.headers.set("accept", "application/json");
  }
  request.headers.set("authorization", `Bearer ${session.access_token}`);
  if (request.body && !request.headers.has("content-type")) {
    request.headers.set("content-type", "application/json");
  }
  return request;
}

async function fetchDesktopCloudStream(
  input: ProliferateStreamRequestInput,
): Promise<Response> {
  const request = await prepareDesktopCloudRequest(new Request(input.url, {
    headers: input.headers,
    signal: input.signal,
  }));
  const response = await fetch(request);
  if (response.status !== 401) {
    return response;
  }

  const stored = await getStoredAuthSession();
  if (!stored) {
    await clearStoredAuthSession();
    throw new ProliferateClientError(
      "Session expired. Please sign in again.",
      401,
      "unauthorized",
    );
  }

  try {
    const refreshed = await refreshSessionOrThrow(stored);
    const retryHeaders = new Headers(request.headers);
    retryHeaders.set("authorization", `Bearer ${refreshed.access_token}`);
    return fetch(new Request(input.url, {
      headers: retryHeaders,
      signal: input.signal,
    }));
  } catch (error) {
    if (isDefinitiveAuthRejection(error)) {
      await clearStoredAuthSession();
      throw new ProliferateClientError(
        "Session expired. Please sign in again.",
        401,
        "unauthorized",
      );
    }
    throw new ProliferateClientError(
      "Could not refresh your session due to a network problem. Please retry.",
      503,
      "auth_refresh_unavailable",
    );
  }
}

configureCloudRequestMeasurement({
  isEnabled: isAnyHarnessTimingEnabled,
  record: (measurement) => {
    recordMeasurementMetric({
      type: "request",
      transport: "cloud",
      category: measurement.category,
      operationId: measurement.operationId as MeasurementOperationId | undefined,
      method: measurement.method,
      status: measurement.status,
      durationMs: measurement.durationMs,
    });
  },
});

function createDesktopProliferateClient(): ProliferateCloudClient {
  return createSdkProliferateClient({
    baseUrl: getProliferateApiBaseUrl(),
    middleware: [authMiddleware],
    streamRequest: fetchDesktopCloudStream,
  });
}

setProliferateClientFactory(createDesktopProliferateClient);

export function getProliferateClient(): ProliferateCloudClient {
  return getSdkProliferateClient();
}
