import { useCallback } from "react";
import {
  cancelActiveAuthFlow,
  linkDesktopProvider,
  signInWithGitHub,
  signInWithSso,
  signOut,
} from "@/lib/integrations/auth/orchestration-provider-flow";
import {
  signInWithPassword,
  type PasswordSignInCredentials,
} from "@/lib/integrations/auth/orchestration-password-flow";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";
import { useAuthOrchestrationEffects } from "@/hooks/auth/workflows/use-auth-orchestration-effects";

// Transport-only auth actions beneath the Desktop ProductHost. Each callback
// runs the orchestration flow and surfaces its normalized {provider, source}
// (or {provider} for sign-out) result to the host, which returns it upward.
// Product telemetry for these operations is emitted ABOVE the host boundary by
// `useAuditedAuth`; this hook must not classify or emit telemetry, so it stays
// assignable as the host provider without depending on ProductHost.
export function useAuthActions() {
  const authEffects = useAuthOrchestrationEffects();

  return {
    signInWithGitHub: useCallback(
      (options?: GitHubDesktopSignInOptions) =>
        signInWithGitHub(options, authEffects),
      [authEffects],
    ),
    signInWithPassword: useCallback(
      (credentials: PasswordSignInCredentials) =>
        signInWithPassword(credentials, authEffects),
      [authEffects],
    ),
    signInWithSso: useCallback(
      (options?: DesktopSsoSignInOptions) => signInWithSso(options, authEffects),
      [authEffects],
    ),
    signOut: useCallback(() => signOut(authEffects), [authEffects]),
    cancelAuthFlow: useCallback(
      (message?: string) => cancelActiveAuthFlow(message),
      [],
    ),
    linkGoogle: useCallback(
      () => linkDesktopProvider("google", authEffects),
      [authEffects],
    ),
  };
}
