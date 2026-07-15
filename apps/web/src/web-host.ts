import type { AuthUser } from "@proliferate/cloud-sdk";
import { useAuthViewer } from "@proliferate/cloud-sdk-react";
import type { AuthMethod } from "@proliferate/product-domain/auth/model";
import type {
  AuthState,
  ProductAuthHost,
  ProductAuthUser,
  ProductDeploymentHost,
  ProductHost,
} from "@proliferate/product-client/host/product-host";
import { isProductAuthRequired } from "@proliferate/product-client/internal/lib/domain/auth/auth-mode";
import { useMemo } from "react";

import { createWebAuthOperations } from "./browser/auth/web-auth-transport";
import { webProductClipboard } from "./browser/clipboard/web-product-clipboard";
import { getWebSandboxGatewayAccessToken } from "./browser/cloud/create-web-cloud-client";
import { useWebSession } from "./browser/cloud/WebCloudRoot";
import { webProductLinks } from "./browser/links/web-product-links";
import { webProductStorage } from "./browser/storage/web-product-storage";
import { webProductTelemetry } from "./browser/telemetry/web-telemetry";
import { webEnv } from "./config/env";

/**
 * The Web host's ProductHost assembly. This hook mirrors Desktop's
 * `DesktopProductHostProvider` shape: it reads the reactive browser session
 * (`WebCloudRoot`) plus the authenticated viewer, derives the shared
 * {@link AuthState}, and returns one immutable {@link ProductHost} snapshot. It
 * constructs no second Cloud/Query client — it reuses the exact client the
 * session root built. `WebHostApp` mounts the returned host through
 * `ProductHostProvider` above ProductClient.
 *
 * `desktop` is always `null`: the Web host never mounts a native runtime,
 * workspace, SSH, updater, worker, native menu, or native filesystem lifecycle.
 * The static adapters (storage/links/clipboard/telemetry) keep stable identity
 * across snapshot replacements; the snapshot is replaced only when the auth
 * state, the readiness the viewer resolves, or the Cloud-client authority
 * changes.
 */

// The identity methods hosted Web advertises to the shared login screen while
// anonymous. Legacy Web offered GitHub + Google OAuth and org/slug SSO (never
// password or Apple); this is the faithful port of that set. A future stage may
// replace this static list with a Web availability probe — the shared login UI
// reads `methods` and refines what it renders.
const WEB_ANONYMOUS_METHODS: AuthMethod[] = ["github", "google", "sso"];

/** Map the Cloud `UserRead` session identity to the shared `ProductAuthUser`. */
export function mapWebProductAuthUser(user: AuthUser): ProductAuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name ?? null,
    avatarUrl: user.avatar_url ?? null,
    githubLogin: user.github_login ?? null,
  };
}

export function useWebProductHost(): ProductHost {
  const { state, client, setSession, publishIssue, restoreSession, logout } =
    useWebSession();

  const isAuthenticated = state.status === "authenticated";
  // The GitHub-connection readiness the shared gate blocks on is a Web-only
  // mapping (Desktop never emits `action_required`). Only query the viewer once
  // a session is present; a bounded window before it resolves reads as `ready`,
  // and a resolved `githubConnected: false` flips the snapshot to
  // `action_required` exactly as the legacy Web gate did.
  const viewer = useAuthViewer(isAuthenticated && state.token !== null);
  const githubConnected = viewer.data?.githubConnected;

  const deployment = useMemo<ProductDeploymentHost>(
    // Hosted Web receives one configured deployment and cannot switch it, so no
    // `switchDeployment`/`resetDeployment` (those are Desktop-only capabilities).
    () => ({ apiBaseUrl: webEnv.apiBaseUrl }),
    [],
  );

  const authOps = useMemo(
    () => createWebAuthOperations({ setSession, publishIssue, logout }),
    [setSession, publishIssue, logout],
  );

  const authState = useMemo<AuthState>(() => {
    if (state.status === "loading") {
      return { status: "loading" };
    }
    if (state.status === "authenticated") {
      return {
        status: "authenticated",
        // `user` is null only in the degraded path where the session is trusted
        // but the identity record is not yet present.
        user: state.user ? mapWebProductAuthUser(state.user) : null,
        readiness:
          githubConnected === false
            ? { status: "action_required", action: "connect_github" }
            : { status: "ready" },
      };
    }
    return state.issue
      ? { status: "anonymous", methods: WEB_ANONYMOUS_METHODS, issue: state.issue }
      : { status: "anonymous", methods: WEB_ANONYMOUS_METHODS };
  }, [state.status, state.user, state.issue, githubConnected]);

  const auth = useMemo<ProductAuthHost>(
    () => ({
      authRequired: isProductAuthRequired(),
      state: authState,
      restoreSession,
      startLogin: authOps.startLogin,
      finishLogin: authOps.finishLogin,
      cancelLogin: authOps.cancelLogin,
      logout: authOps.logout,
    }),
    [authState, restoreSession, authOps],
  );

  return useMemo<ProductHost>(
    () => ({
      surface: "web",
      deployment,
      auth,
      cloud: {
        client,
        getSandboxGatewayAccessToken: getWebSandboxGatewayAccessToken,
      },
      storage: webProductStorage,
      links: webProductLinks,
      clipboard: webProductClipboard,
      telemetry: webProductTelemetry,
      desktop: null,
    }),
    [deployment, auth, client],
  );
}
