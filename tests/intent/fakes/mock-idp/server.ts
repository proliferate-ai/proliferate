// Pluggable mock-IdP slot for T2-AUTH-3 (SSO OIDC round-trip).
//
// Choice: an in-process OIDC provider (`oauth2-mock-server`) over a Docker
// container (e.g. dex). Rationale, per the task brief:
//   - no Docker dependency for local runs or the provisional CI job (this
//     suite already avoids Docker everywhere else — see stack/boot.ts);
//   - real cryptography (RSA-signed id_tokens verified against a real JWKS
//     endpoint), so the server's actual OIDC client code
//     (integrations/sso/oidc.py) is exercised unmodified, not mocked out;
//   - per-identity claims are trivially test-controlled via the library's
//     `BeforeTokenSigning` event hook, which is exactly the "assert any
//     identity on demand" shape this scenario needs (happy path + negatives
//     each want a different subject/email/domain).
// Proven workable against the server's real OIDC client with no product
// changes: the only accommodation needed was setting
// PROLIFERATE_SSO_OIDC_ALLOW_PRIVATE_PROVIDER_URLS=true for this profile
// (stack/boot.ts), an existing settings seam for exactly this (see
// server/proliferate/config.py and server/tests/unit/auth/test_sso.py's own
// http://127.0.0.1 tests) — no HTTPS requirement was hit, so the dex fallback
// was never needed.
//
// The server auto-approves any authorization request at GET /authorize (no
// login prompt) and mints a fully-formed OIDC token set at POST /token; this
// module only needs to steer the identity claims asserted at token-signing
// time.

import { OAuth2Server, Events } from "oauth2-mock-server";

export interface MockIdpIdentity {
  /** Stable OIDC `sub` — drives the sso_identity dedup/re-login behavior. */
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
}

export interface MockIdp {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** OIDC endpoint URLs for the connection's static-endpoint fields
   * (oidcIssuerUrl/oidcAuthorizationEndpoint/oidcTokenEndpoint/oidcJwksUri) —
   * bypasses discovery-document fetching entirely, matching
   * `_require_oidc_configured`'s "has_static_endpoints" branch. */
  endpoints: {
    issuer: string;
    authorization: string;
    token: string;
    jwks: string;
  };
  /** Every subsequent token exchange asserts this identity, until changed.
   * Tests run serially against one mock server instance, so a single mutable
   * "current identity" is safe and avoids re-registering a hook per call. */
  setIdentity(identity: MockIdpIdentity): void;
  stop(): Promise<void>;
}

const DEFAULT_IDENTITY: MockIdpIdentity = {
  sub: "mock-idp-unset-subject",
  email: "unset@allowed.example.com",
  emailVerified: true,
};

export async function startMockIdp(): Promise<MockIdp> {
  const server = new OAuth2Server();
  await server.issuer.keys.generate("RS256");
  // Port 0: let the OS assign a free port (this profile owns no reserved port
  // for the mock IdP — see boot.ts — so collisions across worktrees/runs are
  // avoided the same way ephemeral test servers usually dodge them).
  await server.start(0, "127.0.0.1");
  const issuerUrl = server.issuer.url;
  if (!issuerUrl) {
    throw new Error("mock IdP failed to report its issuer URL after starting");
  }

  let currentIdentity: MockIdpIdentity = DEFAULT_IDENTITY;

  server.service.on(Events.BeforeTokenSigning, (token) => {
    token.payload.sub = currentIdentity.sub;
    token.payload.email = currentIdentity.email;
    token.payload.email_verified = currentIdentity.emailVerified ?? true;
    if (currentIdentity.name) {
      token.payload.name = currentIdentity.name;
    }
  });

  const clientId = "t2intent-mock-idp-client";
  const clientSecret = "t2intent-mock-idp-secret";

  return {
    issuerUrl,
    clientId,
    clientSecret,
    endpoints: {
      issuer: issuerUrl,
      authorization: `${issuerUrl}/authorize`,
      token: `${issuerUrl}/token`,
      jwks: `${issuerUrl}/jwks`,
    },
    setIdentity(identity: MockIdpIdentity) {
      currentIdentity = identity;
    },
    stop: () => server.stop(),
  };
}
