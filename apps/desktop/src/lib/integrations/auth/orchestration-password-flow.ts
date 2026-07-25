import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import type { AuthSignInSource, AuthTelemetryProvider } from "@/lib/domain/telemetry/events";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
import { AuthRequestError } from "@/lib/integrations/auth/proliferate-auth";
import { signInWithDesktopPassword } from "@/lib/integrations/auth/proliferate-auth-password";
import { desktopAuthCoordinator } from "./auth-coordinator-instance";
import {
  applyDevBypassState,
  toError,
} from "./orchestration-effects";

export interface PasswordSignInCredentials {
  email: string;
  password: string;
}

// Direct email/password sign-in. Unlike the browser-based provider flows there
// is no PKCE handoff: the server returns the desktop token pair in one call.
export async function signInWithPassword(
  credentials: PasswordSignInCredentials,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  if (isDevAuthBypassed()) {
    await applyDevBypassState();
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

  // Password sign-in has no PKCE pending record; it still runs as a
  // coordinator sign-in transaction so a competing flow supersedes it.
  const transactionId = `password:${crypto.randomUUID()}`;
  desktopAuthCoordinator.beginSignInTransaction(transactionId);
  try {
    const session = await signInWithDesktopPassword(
      credentials.email,
      credentials.password,
    );
    const committed = await desktopAuthCoordinator.commitSignInSession({
      transactionId,
      session,
    });
    if (!committed) {
      throw new AuthRequestError("Sign-in was superseded by another auth flow.", 409);
    }
    return {
      provider: "password",
      source: "password_form",
    };
  } catch (error) {
    desktopAuthCoordinator.cancelSignInTransaction(transactionId);
    throw toError(error, "Sign-in failed");
  }
}
