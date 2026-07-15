import {
  createBearerTokenMiddleware,
  createProliferateClient,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

/**
 * The browser Cloud-client constructor for the Web host. Builds an
 * openapi-fetch `ProliferateCloudClient` against the configured deployment base
 * URL. When an in-memory access token is present it installs the bearer-token
 * middleware (adding `authorization: Bearer <token>` to every request) and a
 * matching `streamRequest` for the SSE/streaming calls that bypass the
 * middleware chain. `createProliferateClient` performs no network I/O at
 * construction, so a fresh client is cheap to build whenever the token rotates.
 *
 * The token is held only in memory (React state in `WebCloudRoot`); it is never
 * read from or written to `localStorage`. The production session is rehydrated
 * from the HttpOnly refresh cookie via the bootstrap endpoint on every load.
 */
export function createWebCloudClient(
  apiBaseUrl: string,
  token: string | null,
): ProliferateCloudClient {
  return createProliferateClient({
    baseUrl: apiBaseUrl,
    middleware: token ? [createBearerTokenMiddleware(() => token)] : [],
    streamRequest: (input) => {
      const headers = new Headers(input.headers);
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      return fetch(input.url, {
        headers,
        signal: input.signal,
      });
    },
  });
}

// --- Sandbox-gateway access token -------------------------------------------
//
// The plain AnyHarness gateway-connection builders run deep in product code
// with no React host handle, so they read the token through the armed
// `host.cloud.getSandboxGatewayAccessToken` provider (WDU slice 04, ruling G4).
// On Web the derived gateway token IS the current in-memory web-session access
// token — a scoped resource token the product already carried to the connection
// layer, not the session/refresh credential (which stays in the HttpOnly
// cookie and never crosses this boundary). `WebCloudRoot` pushes the latest
// token here on every session change; the accessor rejects when there is no
// signed-in session, matching the prior transport's "must sign in" rejection.

let currentWebSessionToken: string | null = null;

/** Update the token the sandbox-gateway accessor returns. Called by the Web
 * session machine on every session change; passing `null` clears it on logout. */
export function setWebSessionAccessToken(token: string | null): void {
  currentWebSessionToken = token;
}

/** The Web `host.cloud.getSandboxGatewayAccessToken` implementation. Resolves
 * with the current in-memory web-session access token, or rejects when no
 * session is present (never returns a placeholder). */
export function getWebSandboxGatewayAccessToken(): Promise<string> {
  if (!currentWebSessionToken) {
    return Promise.reject(
      new Error("No web session is present to mint a sandbox-gateway token."),
    );
  }
  return Promise.resolve(currentWebSessionToken);
}
