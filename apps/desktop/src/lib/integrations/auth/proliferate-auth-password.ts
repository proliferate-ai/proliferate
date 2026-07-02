// Email/password desktop sign-in transport, split from proliferate-auth.ts
// to keep that module under the frontend size threshold.

import type { StoredAuthSession } from "@/lib/access/tauri/auth"
import { fetchAuthResponse, parseAuthError } from "./proliferate-auth-transport"
import {
  buildUrl,
  toStoredSession,
  type DesktopTokenResponse,
} from "./proliferate-auth"

interface AuthMethodsResponse {
  password_login: boolean
  github: boolean
}

export interface DesktopAuthMethods {
  passwordLogin: boolean
  github: boolean
}

export async function getDesktopAuthMethods(): Promise<DesktopAuthMethods> {
  const response = await fetchAuthResponse(buildUrl("/auth/desktop/methods"), {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    throw await parseAuthError(response)
  }

  const payload = (await response.json()) as AuthMethodsResponse
  return {
    passwordLogin: payload.password_login === true,
    github: payload.github === true,
  }
}

export async function signInWithDesktopPassword(
  email: string,
  password: string,
): Promise<StoredAuthSession> {
  const response = await fetchAuthResponse(buildUrl("/auth/desktop/password/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw await parseAuthError(response)
  }

  return toStoredSession((await response.json()) as DesktopTokenResponse)
}
