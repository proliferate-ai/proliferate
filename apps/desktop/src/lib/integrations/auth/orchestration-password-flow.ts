import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import type { AuthSignInSource, AuthTelemetryProvider } from "@/lib/domain/telemetry/events";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
import { AuthRequestError } from "@/lib/integrations/auth/proliferate-auth";
import { signInWithDesktopPassword } from "@/lib/integrations/auth/proliferate-auth-password";
import {
  applyAuthenticatedState,
  applyDevBypassState,
  toError,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";

export interface PasswordSignInCredentials {
  email: string;
  password: string;
}

// Direct email/password sign-in. Unlike the browser-based provider flows there
// is no PKCE handoff: the server returns the desktop token pair in one call.
export async function signInWithPassword(
  credentials: PasswordSignInCredentials,
  deps: AuthOrchestrationDeps,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  if (isDevAuthBypassed()) {
    applyDevBypassState(deps);
    return {
      provider: "dev_bypass",
      source: "dev_bypass",
    };
  }

  const controlPlaneReachable = await checkControlPlaneReachable();
  if (!controlPlaneReachable) {
    throw new AuthRequestError(
      "Signing in requires a reachable control plane.",
      503,
    );
  }

  try {
    const session = await signInWithDesktopPassword(
      credentials.email,
      credentials.password,
    );
    await applyAuthenticatedState(deps, session);
    return {
      provider: "password",
      source: "password_form",
    };
  } catch (error) {
    throw toError(error, "Sign-in failed");
  }
}
