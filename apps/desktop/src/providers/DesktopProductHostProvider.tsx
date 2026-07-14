import { useMemo, useRef, type ReactNode } from "react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type {
  AuthState,
  ProductAuthHost,
  ProductHost,
} from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { desktopProductStorage } from "@/lib/access/browser/product-storage";
import { desktopBridge } from "@/lib/access/tauri/desktop-bridge";
import { isProductAuthRequired } from "@/lib/domain/auth/auth-mode";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useAuthBootstrap } from "@/hooks/auth/lifecycle/use-auth-bootstrap";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import { useAuthOrchestrationEffects } from "@/hooks/auth/workflows/use-auth-orchestration-effects";
import { useAppCapabilitiesFor } from "@/hooks/capabilities/derived/use-app-capabilities";
import { useDesktopAuthMethodsFor } from "@/hooks/access/cloud/auth/use-auth-methods";
import { useGitHubDesktopAuthAvailabilityFor } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useSsoDiscoveryFor } from "@/hooks/access/cloud/auth/use-sso-discovery";

import {
  buildAnonymousMethods,
  createDesktopAuthOperations,
  createDesktopDeployment,
  desktopClipboard,
  desktopProductLinks,
  desktopTelemetry,
  mapProductAuthUser,
} from "./desktop-product-host";

export interface DesktopProductHostProviderProps {
  cloudClient: ProliferateCloudClient | null;
  children: ReactNode;
}

/**
 * Constructs the one Desktop-owned ProductHost snapshot and supplies it through
 * ProductHostProvider. The snapshot is replaced only when an approved reactive
 * input changes (auth status, authenticated user identity, the anonymous
 * method list, or the `cloudClient` reference); token rotation, auth errors,
 * organization selection, routes, workspace/runtime state, and preference
 * changes do not replace it. Static adapters retain stable identity across
 * replacements. It constructs no second Cloud/Query/runtime/auth/telemetry
 * instance — it reuses the exact `cloudClient` passed by DesktopHostProviders.
 */
export function DesktopProductHostProvider({
  cloudClient,
  children,
}: DesktopProductHostProviderProps) {
  const status = useAuthStore((state) => state.status);
  // Read identity fields narrowly so token rotation (which does not touch these
  // fields) never replaces the host.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const displayName = useAuthStore((state) => state.user?.display_name ?? null);
  const email = useAuthStore((state) => state.user?.email ?? null);
  const avatarUrl = useAuthStore((state) => state.user?.avatar_url ?? null);
  const githubLogin = useAuthStore((state) => state.user?.github_login ?? null);
  const issue = useAuthStore((state) => state.issue ?? null);

  const restoreSession = useAuthBootstrap();
  const actions = useAuthActions();
  const orchestrationEffects = useAuthOrchestrationEffects();

  // The provider builds the host, so it cannot read the deployment back through
  // `useProductHost()`. It owns the Desktop deployment adapter and passes that
  // base URL into the probe hooks explicitly (the `*For` variants), which is the
  // exact value product-tree consumers later read from `host.deployment`.
  const deployment = useMemo(() => createDesktopDeployment(), []);
  const apiBaseUrl = deployment.apiBaseUrl;

  const { cloudEnabled } = useAppCapabilitiesFor(apiBaseUrl);
  const { data: authMethods } = useDesktopAuthMethodsFor(apiBaseUrl);
  const { data: githubAvailability } = useGitHubDesktopAuthAvailabilityFor(apiBaseUrl);
  const { data: ssoDiscovery } = useSsoDiscoveryFor(apiBaseUrl, { enabled: cloudEnabled });

  const passwordAvailable = cloudEnabled && authMethods?.passwordLogin === true;
  const githubAvailable = cloudEnabled && githubAvailability?.enabled === true;
  const ssoAvailable = cloudEnabled && ssoDiscovery?.enabled === true;

  const methods = useMemo(
    () =>
      buildAnonymousMethods({
        passwordAvailable,
        githubAvailable,
        ssoAvailable,
      }),
    [passwordAvailable, githubAvailable, ssoAvailable],
  );
  const methodsKey = methods.join(",");
  // Method availability replaces the host only while anonymous; once
  // authenticated it must not participate in host replacement.
  const anonymousMethodsKey = status === "anonymous" ? methodsKey : "";

  // Identity fields replace the host only while authenticated; mutations that
  // arrive during anonymous/bootstrapping (where the AuthState carries no user)
  // must not participate in host replacement — mirroring anonymousMethodsKey.
  const isAuthenticated = status === "authenticated";
  const authenticatedUserId = isAuthenticated ? userId : null;
  const authenticatedDisplayName = isAuthenticated ? displayName : null;
  const authenticatedEmail = isAuthenticated ? email : null;
  const authenticatedAvatarUrl = isAuthenticated ? avatarUrl : null;
  const authenticatedGithubLogin = isAuthenticated ? githubLogin : null;

  // The normalized anonymous issue replaces the host only while anonymous; a
  // stale issue lingering behind an authenticated/bootstrapping status must not
  // participate in host replacement, mirroring the identity/method gating.
  const anonymousIssue = status === "anonymous" ? issue : null;
  const anonymousIssueKey = anonymousIssue ? JSON.stringify(anonymousIssue) : "";

  const authState = useMemo<AuthState>(() => {
    if (status === "bootstrapping") {
      return { status: "loading" };
    }
    if (status === "authenticated") {
      // Desktop is always product-ready once authenticated; the connect_github
      // action_required readiness is a Web-only mapping the type must support
      // but Desktop never emits. The user is null only in the existing
      // cached-session degraded path where no user record is present.
      return {
        status: "authenticated",
        user: authenticatedUserId
          ? mapProductAuthUser({
              id: authenticatedUserId,
              email: authenticatedEmail ?? "",
              display_name: authenticatedDisplayName,
              github_login: authenticatedGithubLogin,
              avatar_url: authenticatedAvatarUrl,
            })
          : null,
        readiness: { status: "ready" },
      };
    }
    return anonymousIssue
      ? { status: "anonymous", methods, issue: anonymousIssue }
      : { status: "anonymous", methods };
    // methods is folded into anonymousMethodsKey and the issue into
    // anonymousIssueKey so authenticated method/issue changes do not recompute
    // the snapshot; identity fields are gated to authenticated status so
    // anonymous/bootstrapping identity mutations do not recompute it either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status,
    authenticatedUserId,
    authenticatedDisplayName,
    authenticatedEmail,
    authenticatedAvatarUrl,
    authenticatedGithubLogin,
    anonymousMethodsKey,
    anonymousIssueKey,
  ]);

  // Auth operations stay stable as long as the underlying action callbacks do
  // (each is a useCallback keyed on the stable orchestration effects). The deps
  // getter reads the latest effects via a ref without widening those deps.
  const orchestrationEffectsRef = useRef(orchestrationEffects);
  orchestrationEffectsRef.current = orchestrationEffects;
  const authOps = useMemo(
    () =>
      createDesktopAuthOperations(
        actions,
        () => orchestrationEffectsRef.current,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      actions.signInWithGitHub,
      actions.signInWithPassword,
      actions.signInWithSso,
      actions.signOut,
      actions.cancelAuthFlow,
      actions.linkGoogle,
    ],
  );

  const authRequired = isProductAuthRequired();

  const auth = useMemo<ProductAuthHost>(
    () => ({
      authRequired,
      state: authState,
      restoreSession,
      startLogin: authOps.startLogin,
      finishLogin: authOps.finishLogin,
      cancelLogin: authOps.cancelLogin,
      logout: authOps.logout,
    }),
    [authRequired, authState, restoreSession, authOps],
  );

  const host = useMemo<ProductHost>(
    () => ({
      surface: "desktop",
      deployment,
      auth,
      cloud: { client: cloudClient },
      storage: desktopProductStorage,
      links: desktopProductLinks,
      clipboard: desktopClipboard,
      telemetry: desktopTelemetry,
      desktop: desktopBridge,
    }),
    [cloudClient, auth, deployment],
  );

  return <ProductHostProvider host={host}>{children}</ProductHostProvider>;
}
