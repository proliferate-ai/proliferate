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
import {
  type GitHubDesktopSignInOptions,
} from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";
import { useAuthOrchestrationEffects } from "@/hooks/auth/workflows/use-auth-orchestration-effects";
import type { DesktopAuthTransaction } from "@/lib/integrations/auth/desktop-auth-transaction";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

// Owns Desktop auth transport actions. Product-facing event semantics live in
// use-product-auth-actions beneath ProductHostProvider.
export function useAuthActions(cloudClient: ProliferateCloudClient | null) {
  const authEffects = useAuthOrchestrationEffects(cloudClient);

  return {
    signInWithGitHub: useCallback(async (
      options: GitHubDesktopSignInOptions | undefined,
      transaction: DesktopAuthTransaction,
    ) => {
      return signInWithGitHub(options, authEffects, transaction);
    }, [authEffects]),
    signInWithPassword: useCallback(async (
      credentials: PasswordSignInCredentials,
      transaction: DesktopAuthTransaction,
    ) => {
      return signInWithPassword(credentials, authEffects, transaction);
    }, [authEffects]),
    signInWithSso: useCallback(async (
      options: DesktopSsoSignInOptions | undefined,
      transaction: DesktopAuthTransaction,
    ) => {
      return signInWithSso(options, authEffects, transaction);
    }, [authEffects]),
    signOut: useCallback(async (transaction: DesktopAuthTransaction) => {
      return signOut(authEffects, transaction);
    }, [authEffects]),
    cancelAuthFlow: useCallback(async (message?: string) => {
      await cancelActiveAuthFlow(message);
    }, []),
    linkGoogle: useCallback(async (transaction: DesktopAuthTransaction) => {
      return linkDesktopProvider("google", authEffects, transaction);
    }, [authEffects]),
  };
}
