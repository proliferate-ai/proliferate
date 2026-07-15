// Email/password desktop sign-in transport, split from proliferate-auth.ts
// to keep that module under the frontend size threshold.

import type { StoredAuthSession } from "@/lib/access/tauri/auth"
import { fetchAuthResponse, parseAuthError } from "./proliferate-auth-transport"
import {
  buildUrl,
  toStoredSession,
  type DesktopTokenResponse,
} from "./proliferate-auth"

// `getDesktopAuthMethods` (the public auth-methods probe) was promoted to
// product-owned cloud access at
// `@proliferate/product-client/internal/lib/access/cloud/auth-probes`.

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
