import {
  getProliferateClient,
  ProliferateClientError,
  type Middleware,
  type ProliferateCloudClient,
} from "./core.js";
import type {
  AppleMobileCompleteRequest,
  AuthProviderName,
  AuthRefreshRequest,
  AuthSessionResponse,
  AuthSurface,
  AuthTokenRequest,
  PasswordCredentialResponse,
  PasswordLoginRequest,
  PasswordSetRequest,
  StartAuthRequest,
  StartAuthResponse,
} from "../types/auth.js";

export function createBearerTokenMiddleware(getToken: () => string | Promise<string>): Middleware {
  return {
    async onRequest({ request }) {
      request.headers.set("accept", "application/json");
      request.headers.set("authorization", `Bearer ${await getToken()}`);
      if (request.body && !request.headers.has("content-type")) {
        request.headers.set("content-type", "application/json");
      }
      return request;
    },
  };
}

export interface AuthRequestOptions {
  accessToken?: string | null;
  signal?: AbortSignal;
}

export async function startAuthProvider(
  surface: AuthSurface,
  provider: AuthProviderName,
  body: StartAuthRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<StartAuthResponse> {
  return authRequestJson<StartAuthResponse>(
    client,
    `/auth/${surface}/${provider}/start`,
    {
      method: "POST",
      body,
      accessToken: options.accessToken,
      signal: options.signal,
      credentials: surface === "web" ? "include" : "same-origin",
    },
  );
}

export async function exchangeWebAuthCode(
  body: AuthTokenRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/web/token", {
    method: "POST",
    body,
    accessToken: options.accessToken,
    credentials: "include",
    signal: options.signal,
  });
}

export async function exchangeMobileAuthCode(
  body: AuthTokenRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/mobile/token", {
    method: "POST",
    body,
    accessToken: options.accessToken,
    signal: options.signal,
  });
}

export async function completeAppleMobileAuth(
  body: AppleMobileCompleteRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/mobile/apple/complete", {
    method: "POST",
    body,
    accessToken: options.accessToken,
    signal: options.signal,
  });
}

export async function loginWebWithPassword(
  body: PasswordLoginRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/web/password/login", {
    method: "POST",
    body,
    accessToken: options.accessToken,
    credentials: "include",
    signal: options.signal,
  });
}

export async function loginMobileWithPassword(
  body: PasswordLoginRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/mobile/password/login", {
    method: "POST",
    body,
    accessToken: options.accessToken,
    signal: options.signal,
  });
}

export async function setPasswordCredential(
  body: PasswordSetRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<PasswordCredentialResponse> {
  if (!options.accessToken) {
    return client.requestJson<PasswordCredentialResponse>({
      method: "PUT",
      path: "/auth/password",
      body,
      signal: options.signal,
    });
  }
  return authRequestJson<PasswordCredentialResponse>(client, "/auth/password", {
    method: "PUT",
    body,
    accessToken: options.accessToken,
    signal: options.signal,
  });
}

export async function bootstrapWebSession(
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/web/session/bootstrap", {
    method: "POST",
    credentials: "include",
    signal: options.signal,
  });
}

export async function refreshWebSession(
  csrfToken: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/web/session/refresh", {
    method: "POST",
    credentials: "include",
    csrfToken,
    signal: options.signal,
  });
}

export async function logoutWebSession(
  csrfToken: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<void> {
  await authRequestJson<{ ok: boolean }>(client, "/auth/web/session/logout", {
    method: "POST",
    credentials: "include",
    csrfToken,
    signal: options.signal,
  });
}

export async function refreshMobileSession(
  body: AuthRefreshRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: AuthRequestOptions = {},
): Promise<AuthSessionResponse> {
  return authRequestJson<AuthSessionResponse>(client, "/auth/mobile/session/refresh", {
    method: "POST",
    body,
    accessToken: options.accessToken,
    signal: options.signal,
  });
}

interface AuthRequestJsonOptions {
  method: "POST" | "PUT";
  body?: unknown;
  accessToken?: string | null;
  csrfToken?: string | null;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}

async function authRequestJson<TResponse>(
  client: ProliferateCloudClient,
  path: string,
  options: AuthRequestJsonOptions,
): Promise<TResponse> {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.accessToken) {
    headers.set("authorization", `Bearer ${options.accessToken}`);
  }
  if (options.csrfToken) {
    headers.set("x-proliferate-csrf", options.csrfToken);
  }

  const response = await fetch(client.buildUrl(path), {
    method: options.method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: options.credentials,
    headers,
    signal: options.signal,
  });
  if (!response.ok) {
    throw await responseToError(response);
  }
  if (response.status === 204) {
    return undefined as TResponse;
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
