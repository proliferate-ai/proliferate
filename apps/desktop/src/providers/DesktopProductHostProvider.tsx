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
import { useAppCapabilitiesAtApiBaseUrl } from "@/hooks/capabilities/derived/use-app-capabilities";
import { useDesktopAuthMethodsAtApiBaseUrl } from "@/hooks/access/cloud/auth/use-auth-methods";
import { useGitHubDesktopAuthAvailabilityAtApiBaseUrl } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useSsoDiscoveryAtApiBaseUrl } from "@/hooks/access/cloud/auth/use-sso-discovery";

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
 * method list, normalized auth issue, or the `cloudClient` reference); token rotation,
 * organization selection, routes, workspace/runtime state, and preference
 * changes do not replace it. Static adapters retain stable identity across
 * replacements. It constructs no second Cloud/Query/runtime/auth/telemetry
 * instance — it reuses the exact `cloudClient` passed by AppProviders.
 */
export function DesktopProductHostProvider({
  cloudClient,
  children,
}: DesktopProductHostProviderProps) {
  const deployment = useMemo(() => createDesktopDeployment(), []);
  const status = useAuthStore((state) => state.status);
  // Read identity fields narrowly so token rotation (which does not touch these
  // fields) never replaces the host.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const displayName = useAuthStore((state) => state.user?.display_name ?? null);
  const email = useAuthStore((state) => state.user?.email ?? null);
  const avatarUrl = useAuthStore((state) => state.user?.avatar_url ?? null);
  const githubLogin = useAuthStore((state) => state.user?.github_login ?? null);
  const authIssue = useAuthStore((state) => state.issue);

  const restoreSession = useAuthBootstrap(cloudClient);
  const actions = useAuthActions(cloudClient);
  const orchestrationEffects = useAuthOrchestrationEffects(cloudClient);

  const { cloudEnabled } = useAppCapabilitiesAtApiBaseUrl(deployment.apiBaseUrl);
  const { data: authMethods } = useDesktopAuthMethodsAtApiBaseUrl(
    deployment.apiBaseUrl,
  );
  const { data: githubAvailability } =
    useGitHubDesktopAuthAvailabilityAtApiBaseUrl(deployment.apiBaseUrl);
  const { data: ssoDiscovery } = useSsoDiscoveryAtApiBaseUrl(
    deployment.apiBaseUrl,
    { enabled: cloudEnabled },
  );

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
  const anonymousIssue = status === "anonymous" ? authIssue : null;

  const authState = useMemo<AuthState>(() => {
    if (status === "bootstrapping") {
      return { status: "loading" };
    }
    if (status === "authenticated") {
      return {
        status: "authenticated",
        user: userId === null
          ? null
          : mapProductAuthUser({
              id: userId,
              email: email ?? "",
              display_name: displayName,
              github_login: githubLogin,
              avatar_url: avatarUrl,
            }),
        readiness: { status: "ready" },
      };
    }
    return {
      status: "anonymous",
      methods,
      ...(anonymousIssue ? { issue: anonymousIssue } : {}),
    };
    // methods is folded into anonymousMethodsKey so authenticated method
    // changes do not recompute the snapshot; identity fields are gated to
    // authenticated status so anonymous/bootstrapping identity mutations do
    // not recompute it either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status,
    authenticatedUserId,
    authenticatedDisplayName,
    authenticatedEmail,
    authenticatedAvatarUrl,
    authenticatedGithubLogin,
    anonymousMethodsKey,
    anonymousIssue,
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
