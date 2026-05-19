import * as AppleAuthentication from "expo-apple-authentication";
import { Linking } from "react-native";

import {
  completeAppleMobileAuth,
  exchangeMobileAuthCode,
  startAuthProvider,
  type AuthProviderName,
  type AuthPurpose,
  type AuthSessionResponse,
} from "@proliferate/cloud-sdk";

import { mobileEnv } from "../../../../config/env";
import { createOAuthState, createPkcePair } from "../../../infra/auth/pkce";
import { createMobileCloudClient } from "../client";

const MOBILE_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export async function runMobileOAuthFlow(input: {
  provider: Exclude<AuthProviderName, "apple">;
  purpose?: AuthPurpose;
  accessToken?: string | null;
}): Promise<AuthSessionResponse> {
  const purpose = input.purpose ?? "login";
  const client = createMobileCloudClient(mobileEnv.apiBaseUrl, null);
  const pkce = await createPkcePair();
  const clientState = await createOAuthState();
  const start = await startAuthProvider(
    "mobile",
    input.provider,
    {
      purpose,
      clientState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: "S256",
      redirectUri: mobileEnv.redirectUri,
      prompt: "select_account",
    },
    client,
    { accessToken: input.accessToken },
  );
  if (!start.authorizationUrl) {
    throw new Error(`${input.provider} did not return an authorization URL.`);
  }
  const callbackUrl = await openMobileAuthUrl(start.authorizationUrl);
  const callback = new URL(callbackUrl);
  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  const error = callback.searchParams.get("error");
  if (error) {
    throw new Error(error);
  }
  if (!code || state !== clientState) {
    throw new Error("The auth callback did not match this app session.");
  }
  return exchangeMobileAuthCode(
    {
      code,
      codeVerifier: pkce.verifier,
      grantType: "authorization_code",
    },
    client,
  );
}

export async function runMobileAppleFlow(input: {
  purpose?: AuthPurpose;
  accessToken?: string | null;
}): Promise<AuthSessionResponse> {
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error("Sign in with Apple is not available on this device.");
  }
  const purpose = input.purpose ?? "login";
  const client = createMobileCloudClient(mobileEnv.apiBaseUrl, null);
  const pkce = await createPkcePair();
  const clientState = await createOAuthState();
  const start = await startAuthProvider(
    "mobile",
    "apple",
    {
      purpose,
      clientState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: "S256",
      redirectUri: mobileEnv.redirectUri,
    },
    client,
    { accessToken: input.accessToken },
  );
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    state: start.state,
    nonce: start.nonce,
  });
  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token.");
  }
  return completeAppleMobileAuth(
    {
      state: start.state,
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      email: credential.email,
      displayName: displayNameFromAppleCredential(credential.fullName),
    },
    client,
    { accessToken: input.accessToken },
  );
}

function displayNameFromAppleCredential(
  name: AppleAuthentication.AppleAuthenticationFullName | null,
): string | null {
  if (!name) {
    return null;
  }
  const value = [name.givenName, name.familyName].filter(Boolean).join(" ").trim();
  return value || null;
}

function openMobileAuthUrl(authorizationUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (isMobileAuthCallback(url)) {
        finish(() => resolve(url));
      }
    });
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Sign in timed out.")));
    }, MOBILE_AUTH_TIMEOUT_MS);

    function finish(callback: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      subscription.remove();
      callback();
    }

    Linking.openURL(authorizationUrl).catch((error: unknown) => {
      finish(() => reject(error));
    });
  });
}

function isMobileAuthCallback(url: string): boolean {
  try {
    const actual = new URL(url);
    const expected = new URL(mobileEnv.redirectUri);
    return (
      actual.protocol === expected.protocol &&
      actual.hostname === expected.hostname &&
      actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}
