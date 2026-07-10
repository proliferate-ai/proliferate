import {
  getProliferateClient,
  ProliferateClientError,
  type ProliferateCloudClient,
} from "./core.js";
import type { AuthSurface } from "../types/auth.js";
import type {
  OrganizationSsoConnectionRequest,
  OrganizationSsoConnectionResponse,
  OrganizationSsoConnectionTestResponse,
  OrganizationSsoConnectionUpdateRequest,
  OrganizationSsoConnectionsResponse,
  SsoDiscoveryResponse,
  StartSsoAuthRequest,
  StartSsoAuthResponse,
} from "../types/sso.js";

export interface SsoRequestOptions {
  signal?: AbortSignal;
}

export interface DiscoverSsoOptions extends SsoRequestOptions {
  email?: string | null;
  organizationId?: string | null;
  connectionId?: string | null;
  slug?: string | null;
}

export async function discoverSso(
  options: DiscoverSsoOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SsoDiscoveryResponse> {
  return ssoRequestJson<SsoDiscoveryResponse>(client, "/auth/sso/discover", {
    method: "GET",
    query: {
      email: options.email ?? undefined,
      organizationId: options.organizationId ?? undefined,
      connectionId: options.connectionId ?? undefined,
      slug: options.slug ?? undefined,
    },
    credentials: "include",
    signal: options.signal,
  });
}

export async function startSsoAuth(
  surface: AuthSurface,
  body: StartSsoAuthRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: SsoRequestOptions = {},
): Promise<StartSsoAuthResponse> {
  return ssoRequestJson<StartSsoAuthResponse>(client, `/auth/${surface}/sso/start`, {
    method: "POST",
    body,
    credentials: surface === "web" ? "include" : "same-origin",
    signal: options.signal,
  });
}

export async function listOrganizationSsoConnections(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionsResponse> {
  return (
    await client.GET("/v1/organizations/{organization_id}/sso/connections", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function createOrganizationSsoConnection(
  organizationId: string,
  input: OrganizationSsoConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionResponse> {
  return (
    await client.POST("/v1/organizations/{organization_id}/sso/connections", {
      params: { path: { organization_id: organizationId } },
      body: input,
    })
  ).data!;
}

export async function updateOrganizationSsoConnection(
  organizationId: string,
  connectionId: string,
  input: OrganizationSsoConnectionUpdateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionResponse> {
  return (
    await client.PATCH(
      "/v1/organizations/{organization_id}/sso/connections/{connection_id}",
      {
        params: { path: { organization_id: organizationId, connection_id: connectionId } },
        body: input,
      },
    )
  ).data!;
}

export async function testOrganizationSsoConnection(
  organizationId: string,
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionTestResponse> {
  return (
    await client.POST(
      "/v1/organizations/{organization_id}/sso/connections/{connection_id}/test",
      {
        params: { path: { organization_id: organizationId, connection_id: connectionId } },
      },
    )
  ).data!;
}

export async function enableOrganizationSsoConnection(
  organizationId: string,
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionResponse> {
  return (
    await client.POST(
      "/v1/organizations/{organization_id}/sso/connections/{connection_id}/enable",
      {
        params: { path: { organization_id: organizationId, connection_id: connectionId } },
      },
    )
  ).data!;
}

export async function disableOrganizationSsoConnection(
  organizationId: string,
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionResponse> {
  return (
    await client.POST(
      "/v1/organizations/{organization_id}/sso/connections/{connection_id}/disable",
      {
        params: { path: { organization_id: organizationId, connection_id: connectionId } },
      },
    )
  ).data!;
}

export async function deleteOrganizationSsoConnection(
  organizationId: string,
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationSsoConnectionResponse> {
  return (
    await client.DELETE(
      "/v1/organizations/{organization_id}/sso/connections/{connection_id}",
      {
        params: { path: { organization_id: organizationId, connection_id: connectionId } },
      },
    )
  ).data!;
}

interface SsoRequestJsonOptions {
  method: "GET" | "POST";
  query?: Record<string, string | null | undefined>;
  body?: unknown;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}

async function ssoRequestJson<TResponse>(
  client: ProliferateCloudClient,
  path: string,
  options: SsoRequestJsonOptions,
): Promise<TResponse> {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(client.buildUrl(path, options.query), {
    method: options.method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: options.credentials,
    headers,
    signal: options.signal,
  });
  if (!response.ok) {
    throw await responseToError(response);
  }
  return await response.json() as TResponse;
}

async function responseToError(response: Response): Promise<ProliferateClientError> {
  let payload:
    | { detail?: { code?: string; message?: string } | string }
    | undefined;
  try {
    payload = await response.clone().json() as typeof payload;
  } catch {
    // Fall through to status text.
  }
  const detail = payload?.detail;
  if (detail && typeof detail === "object") {
    return new ProliferateClientError(
      detail.message ?? response.statusText ?? "Request failed",
      response.status,
      detail.code ?? null,
    );
  }
  if (typeof detail === "string") {
    return new ProliferateClientError(detail, response.status, null);
  }
  return new ProliferateClientError(
    response.statusText || "Request failed",
    response.status,
    null,
  );
}
