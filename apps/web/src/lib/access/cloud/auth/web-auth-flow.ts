import {
  discoverSso,
  exchangeWebAuthCode,
  startSsoAuth,
  startAuthProvider,
  type AuthProviderName,
  type AuthPurpose,
  type AuthSessionResponse,
} from "@proliferate/cloud-sdk";

import { routes } from "../../../../config/routes";
import { webEnv } from "../../../../config/env";
import { createOAuthState, createPkcePair } from "../../../infra/auth/pkce";
import { createWebCloudClient } from "../client";

const PENDING_WEB_AUTH_KEY = "proliferate.web.pendingAuth";

export class WebAuthFlowError extends Error {
  code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "WebAuthFlowError";
    this.code = code;
  }
}

interface PendingWebAuth {
  provider: AuthProviderName | "sso";
  purpose: AuthPurpose;
  state: string;
  codeVerifier: string;
  createdAt: number;
}

export async function startWebAuthFlow(input: {
  provider: AuthProviderName;
  purpose?: AuthPurpose;
  accessToken?: string | null;
}): Promise<void> {
  const purpose = input.purpose ?? "login";
  const client = createWebCloudClient(webEnv.apiBaseUrl, null);
  const pkce = await createPkcePair();
  const clientState = createOAuthState();
  const redirectUri = new URL(routes.authCallback, window.location.origin).toString();
  const response = await startAuthProvider(
    "web",
    input.provider,
    {
      purpose,
      clientState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: "S256",
      redirectUri,
      prompt: "select_account",
    },
    client,
    { accessToken: input.accessToken },
  );
  if (!response.authorizationUrl) {
    throw new Error(`${input.provider} did not return an authorization URL.`);
  }
  writePendingWebAuth({
    provider: input.provider,
    purpose,
    state: clientState,
    codeVerifier: pkce.verifier,
    createdAt: Date.now(),
  });
  window.location.assign(response.authorizationUrl);
}

export async function startWebSsoFlow(input: { email: string }): Promise<void> {
  const email = input.email.trim();
  if (!email) {
    throw new Error("Enter your work email to continue with SSO.");
  }
  const client = createWebCloudClient(webEnv.apiBaseUrl, null);
  const discovery = await discoverSso({ email }, client);
  if (!discovery.enabled) {
    throw new Error("SSO is not configured for this email domain.");
  }
  const pkce = await createPkcePair();
  const clientState = createOAuthState();
  const redirectUri = new URL(routes.authCallback, window.location.origin).toString();
  const response = await startSsoAuth(
    "web",
    {
      clientState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: "S256",
      redirectUri,
      email,
      organizationId: discovery.organizationId ?? undefined,
      connectionId: discovery.connectionId ?? undefined,
      prompt: "select_account",
    },
    client,
  );
  writePendingWebAuth({
    provider: "sso",
    purpose: "login",
    state: clientState,
    codeVerifier: pkce.verifier,
    createdAt: Date.now(),
  });
  window.location.assign(response.authorizationUrl);
}

export async function completeWebAuthFlow(
  searchParams: URLSearchParams,
): Promise<AuthSessionResponse> {
  const error = searchParams.get("error");
  if (error) {
    throw new WebAuthFlowError(authCallbackErrorMessage(error), error);
  }
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    throw new Error("The auth callback was missing code or state.");
  }
  const pending = readPendingWebAuth();
  clearPendingWebAuth();
  if (!pending || pending.state !== state) {
    throw new Error("The auth callback state did not match this browser session.");
  }
  const client = createWebCloudClient(webEnv.apiBaseUrl, null);
  return exchangeWebAuthCode(
    {
      code,
      codeVerifier: pending.codeVerifier,
      grantType: "authorization_code",
    },
    client,
  );
}

export function webAuthFlowErrorCode(error: unknown): string | null {
  if (error instanceof WebAuthFlowError) {
    return error.code;
  }
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function authCallbackErrorMessage(code: string): string {
  switch (code) {
    case "web_beta_email_missing":
    case "web_beta_email_not_allowed":
      return "Hosted web access is currently limited to beta users.";
    case "sso_connection_not_found":
    case "not_configured":
      return "SSO is not configured for this account.";
    default:
      return code;
  }
}

function writePendingWebAuth(pending: PendingWebAuth): void {
  sessionStorage.setItem(PENDING_WEB_AUTH_KEY, JSON.stringify(pending));
}

function readPendingWebAuth(): PendingWebAuth | null {
  const raw = sessionStorage.getItem(PENDING_WEB_AUTH_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PendingWebAuth;
  } catch {
    return null;
  }
}

function clearPendingWebAuth(): void {
  sessionStorage.removeItem(PENDING_WEB_AUTH_KEY);
}
