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
import { applySelectedOrganizationHeaders } from "@/lib/access/cloud/owner-context-headers";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement-catalog-types";
import { isAnyHarnessTimingEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import { desktopAuthCoordinator } from "@/lib/integrations/auth/auth-coordinator-instance";
import type {
  AuthorityStamp,
  AuthRejectionOutcome,
} from "@/lib/integrations/auth/auth-coordinator";

export type * from "@proliferate/cloud-sdk/types";
export {
  isCloudAgentKind,
  ProliferateClientError,
};

// The credentials each outgoing request actually used. A late 401 hands this
// stamp back to the auth coordinator so an old generation/revision can never
// invalidate or overwrite newer credentials (spec §4.2). All stored-credential
// writes/clears happen inside the coordinator — never here.
const requestCredentialStamps = new WeakMap<Request, AuthorityStamp>();

function sessionExpiredError(): ProliferateClientError {
  return new ProliferateClientError(
    "Session expired. Please sign in again.",
    401,
    "unauthorized",
  );
}

function refreshUnavailableError(): ProliferateClientError {
  return new ProliferateClientError(
    "Could not refresh your session due to a network problem. Please retry.",
    503,
    "auth_refresh_unavailable",
  );
}

async function prepareDesktopCloudRequest(request: Request): Promise<Request> {
  if (isDevAuthBypassed()) {
    throw new ProliferateClientError(
      "Cloud workspaces require real sign-in. Set VITE_DEV_DISABLE_AUTH=false and sign in.",
      401,
      "dev_auth_bypass",
    );
  }
  const snapshot = await desktopAuthCoordinator.getFreshCredentialSnapshot();
  if (!snapshot) {
    throw new ProliferateClientError(
      "You must sign in to use cloud workspaces.",
      401,
      "unauthorized",
    );
  }
  if (!request.headers.has("accept")) {
    request.headers.set("accept", "application/json");
  }
  request.headers.set("authorization", `Bearer ${snapshot.session.access_token}`);
  applySelectedOrganizationHeaders(request.headers);
  if (request.body && !request.headers.has("content-type")) {
    request.headers.set("content-type", "application/json");
  }
  requestCredentialStamps.set(request, {
    authGeneration: snapshot.authGeneration,
    credentialRevision: snapshot.credentialRevision,
  });
  return request;
}

// Resolves a 401 through the coordinator. Returns the session to retry with,
// or throws the terminal error. Only a same-generation request may retry:
// a stale-authority request must never obtain the newer authority's token.
async function resolveCloudAuthRejection(request: Request): Promise<string> {
  const stamp =
    requestCredentialStamps.get(request)
    ?? desktopAuthCoordinator.getAuthorityStamp();
  const outcome: AuthRejectionOutcome =
    await desktopAuthCoordinator.handleCloudAuthRejection(stamp);
  switch (outcome.kind) {
    case "refreshed":
    case "superseded":
      return outcome.session.access_token;
    case "unavailable":
      throw refreshUnavailableError();
    case "invalidated":
    case "stale-authority":
      throw sessionExpiredError();
  }
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    return prepareDesktopCloudRequest(request);
  },

  async onResponse({ response, request }) {
    if (response.status === 401) {
      const accessToken = await resolveCloudAuthRejection(request);
      const retryHeaders = new Headers(request.headers);
      retryHeaders.set("authorization", `Bearer ${accessToken}`);
      return fetch(new Request(request, { headers: retryHeaders }));
    }
    if (response.ok) {
      // The deployment answered: recover a retained unreachable authority.
      void desktopAuthCoordinator.markReachable();
    }
    return response;
  },
};

export async function getDesktopCloudAccessToken(): Promise<string> {
  if (isDevAuthBypassed()) {
    throw new ProliferateClientError(
      "Cloud workspaces require real sign-in. Set VITE_DEV_DISABLE_AUTH=false and sign in.",
      401,
      "dev_auth_bypass",
    );
  }
  const snapshot = await desktopAuthCoordinator.getFreshCredentialSnapshot();
  if (!snapshot) {
    throw new ProliferateClientError(
      "You must sign in to use cloud workspaces.",
      401,
      "unauthorized",
    );
  }
  return snapshot.session.access_token;
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

  const accessToken = await resolveCloudAuthRejection(request);
  const retryHeaders = new Headers(request.headers);
  retryHeaders.set("authorization", `Bearer ${accessToken}`);
  return fetch(new Request(input.url, {
    headers: retryHeaders,
    signal: input.signal,
  }));
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
