import type { AuthSessionResponse } from "@proliferate/cloud-sdk";
import type {
  AuthCallback,
  LoginRequest,
  ProductAuthHost,
  ProductAuthIssue,
  ProductLoginOutcome,
  ProductLogoutOutcome,
} from "@proliferate/product-client/host/product-host";
import { markLoginNotAttempted } from "@proliferate/product-client/internal/lib/domain/telemetry/errors";

import {
  completeWebAuthFlow,
  SSO_SLUG_UNAVAILABLE_CODE,
  startWebAuthFlow,
  startWebSsoFlow,
  startWebSsoFlowForSlug,
  webAuthFlowErrorCode,
} from "../../lib/access/cloud/auth/web-auth-flow";
import { isWebBetaAuthErrorCode } from "../../lib/domain/auth/web-auth-errors";

/**
 * The Web transport behind `host.auth`. It consolidates the existing browser
 * PKCE/OAuth/SSO flow (`web-auth-flow`, `pkce`) and the code exchange into the
 * shared {@link ProductAuthHost} operations. ProductClient owns the login UI and
 * gate; this module owns only browser transport and never imports
 * `auth-token-store`: the production session lives in the HttpOnly refresh
 * cookie plus an in-memory access token, and the PKCE transaction lives in
 * `sessionStorage` inside `web-auth-flow`. No bearer token is read from or
 * written to `localStorage`.
 */

export type WebAuthOperations = Pick<
  ProductAuthHost,
  "startLogin" | "finishLogin" | "cancelLogin" | "logout"
>;

export interface WebAuthTransportDeps {
  /** Commit an exchanged session (in-memory token + user). */
  setSession: (session: AuthSessionResponse) => void;
  /** Publish an anonymous auth issue (access denial / callback failure). */
  publishIssue: (issue: ProductAuthIssue) => void;
  /** Best-effort server logout (CSRF cookie) + clear the in-memory session. */
  logout: () => Promise<void>;
}

// A promise that never settles: an OAuth/SSO redirect flow leaves the page via
// `window.location.assign`, so `startLogin` neither resolves (no premature
// `auth_signed_in`) nor rejects once the redirect is in flight. The session
// resumes out of band through `finishLogin` on the callback route.
function pendingRedirect(): Promise<ProductLoginOutcome> {
  return new Promise<ProductLoginOutcome>(() => {});
}

/**
 * SSO server codes that are a *denial* (not a transport failure): the account or
 * connection is not allowed, so they normalize to `access_denied`, exactly like
 * the beta-gate codes. Every other failure is a `callback_failed`.
 */
const SSO_ACCESS_DENIED_CODES = new Set([
  "sso_connection_not_found",
  "not_configured",
  "sso_email_domain_not_allowed",
  "sso_user_not_team_member",
  "sso_jit_disabled",
  "sso_user_already_in_team",
]);

function isAccessDeniedCode(code: string): boolean {
  return isWebBetaAuthErrorCode(code) || SSO_ACCESS_DENIED_CODES.has(code);
}

/** Map a provider-reported failure callback (`?error=<code>`) to an issue. Also
 * the decoder for the stable server error codes landing on `/auth/error?code=`:
 * a denial code normalizes to `access_denied`, everything else to
 * `callback_failed` (provider error). */
export function mapFailureCallbackIssue(code: string): ProductAuthIssue {
  if (code === "missing_callback_params") {
    return { kind: "callback_failed", reason: "malformed_callback" };
  }
  if (isAccessDeniedCode(code)) {
    return { kind: "access_denied", code };
  }
  return { kind: "callback_failed", reason: "provider_error", providerCode: code };
}

/** Map a thrown exchange error (success branch that failed) to an issue. */
function mapExchangeFailureIssue(error: unknown): ProductAuthIssue {
  const code = webAuthFlowErrorCode(error);
  if (code && isAccessDeniedCode(code)) {
    return { kind: "access_denied", code };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("did not match")) {
    // The pending PKCE record was missing or its state hash mismatched — a
    // replayed, consumed, or forged callback. Fails visibly.
    return { kind: "callback_failed", reason: "state_mismatch" };
  }
  if (message.includes("missing code or state")) {
    return { kind: "callback_failed", reason: "malformed_callback" };
  }
  return { kind: "callback_failed", reason: "exchange_failed" };
}

/**
 * Build the four `host.auth` operations over the existing browser auth flow.
 * `startLogin` maps each {@link LoginRequest} to the browser flow hosted Web
 * supports (github/google OAuth + org/slug SSO); unsupported methods reject as
 * "not attempted" so the audited wrapper re-throws without a failure event.
 * `finishLogin` performs at most one code exchange per call — the caller
 * (`AuthCallbackRoute`) additionally single-flights it under Strict Mode, and
 * `completeWebAuthFlow` consumes and clears the one pending PKCE record so a
 * repeated call fails visibly.
 */
export function createWebAuthOperations(
  deps: WebAuthTransportDeps,
): WebAuthOperations {
  async function startLogin(
    request: LoginRequest,
  ): Promise<ProductLoginOutcome> {
    switch (request.kind) {
      case "github":
      case "google": {
        await startWebAuthFlow({ provider: request.kind, purpose: request.purpose });
        return pendingRedirect();
      }
      case "sso": {
        if (request.slug) {
          try {
            await startWebSsoFlowForSlug(request.slug);
          } catch (error) {
            if (webAuthFlowErrorCode(error) === SSO_SLUG_UNAVAILABLE_CODE) {
              throw markLoginNotAttempted(
                error instanceof Error ? error : new Error("SSO is unavailable."),
              );
            }
            throw error;
          }
        } else {
          await startWebSsoFlow({
            email: request.email,
            organizationId: request.organizationId,
            connectionId: request.connectionId,
          });
        }
        return pendingRedirect();
      }
      case "password":
        throw markLoginNotAttempted(
          new Error("Password sign-in is not available on hosted Web."),
        );
      case "apple":
        throw markLoginNotAttempted(
          new Error("Apple sign-in is not available on hosted Web."),
        );
    }
  }

  async function finishLogin(callback: AuthCallback): Promise<void> {
    if (callback.status === "failure") {
      const issue = mapFailureCallbackIssue(callback.code);
      deps.publishIssue(issue);
      throw new Error(`The sign-in callback failed: ${callback.code}`);
    }
    const params = new URLSearchParams({ code: callback.code });
    if (callback.state) {
      params.set("state", callback.state);
    }
    let session: AuthSessionResponse;
    try {
      session = await completeWebAuthFlow(params);
    } catch (error) {
      deps.publishIssue(mapExchangeFailureIssue(error));
      throw error;
    }
    deps.setSession(session);
  }

  async function cancelLogin(): Promise<void> {
    // A hosted-Web OAuth/SSO login is a full-page redirect: there is no
    // in-process flow to abort, so cancellation is a no-op (matching the prior
    // Web behavior, which had no cancel path).
  }

  async function logout(): Promise<ProductLogoutOutcome> {
    await deps.logout();
    // The web session does not retain which provider signed it in; the outcome
    // provider is an open-string boundary the product telemetry narrows.
    return { provider: "web" };
  }

  return { startLogin, finishLogin, cancelLogin, logout };
}

/** Decode the raw `/auth/callback` query into a normalized {@link AuthCallback}.
 * A provider `?error=` is a failure; a `code`+`state` pair is a success; missing
 * both is a malformed callback. The PKCE verifier and raw URL never appear in
 * the returned value. */
export function decodeWebAuthCallback(params: URLSearchParams): AuthCallback {
  const error = params.get("error");
  const state = params.get("state") ?? undefined;
  if (error) {
    return { status: "failure", code: error, state };
  }
  const code = params.get("code");
  if (code && state) {
    return { status: "success", code, state };
  }
  return { status: "failure", code: "missing_callback_params", state };
}
