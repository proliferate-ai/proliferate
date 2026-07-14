import type { AuthMethod } from "@proliferate/product-domain/auth/model";
import type {
  AuthCallback,
  LoginRequest,
  ProductAuthHost,
  ProductAuthUser,
  ProductClipboard,
  ProductDeploymentHost,
  ProductEntry,
  ProductLinks,
  ProductTelemetry,
} from "@proliferate/product-client/host/product-host";

import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { DesktopTelemetryRoute } from "@/lib/domain/telemetry/events";
import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";
import type { PasswordSignInCredentials } from "@/lib/integrations/auth/orchestration-password-flow";

import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import { setDesktopAppConfig } from "@/lib/access/tauri/config";
import { isTauriRuntimeAvailable } from "@/lib/access/tauri/connect-server";
import { relaunch } from "@/lib/access/tauri/updater";
import { copyText, openExternal } from "@/lib/access/tauri/shell";
import {
  decodeDesktopProductEntry,
  encodeDesktopReturnUrl,
} from "@/lib/domain/auth/desktop-navigation";
import { subscribeDeepLinkUrls } from "@/lib/access/tauri/deep-link";
import { resolveDesktopTelemetryRoute } from "@/lib/domain/telemetry/routes";
import {
  captureTelemetryException,
  clearTelemetryUser,
  getSupportReportReleaseId,
  getSupportReportTelemetryRefs,
  setTelemetryTag,
  setTelemetryUser,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { handleDesktopCallbackUrl } from "@/lib/integrations/auth/orchestration-callback";
import { discoverDesktopSso } from "@/lib/integrations/auth/proliferate-sso-auth";
import { DESKTOP_AUTH_REDIRECT_URI } from "@/lib/integrations/auth/proliferate-auth";

// Same generic string surfaced by the existing slug SSO flow: a missing org,
// no SSO, or disabled SSO all resolve to one answer so we never confirm which
// workspaces exist.
const SSO_UNAVAILABLE =
  "We could not find single sign-on for that workspace. Check the sign-in link your admin shared.";

// --- Deployment -------------------------------------------------------------

/**
 * Build the deployment host for the current process. `apiBaseUrl` is read from
 * the bootstrapped runtime config at construction time, so this is a factory
 * (not a module constant): the provider memoizes one instance after config
 * bootstrap. Switching writes `apiBaseUrl` and relaunches; a failed config
 * write rejects before relaunch so no in-process switch is claimed.
 */
export function createDesktopDeployment(): ProductDeploymentHost {
  const apiBaseUrl = getProliferateApiBaseUrl();
  if (!isTauriRuntimeAvailable()) {
    return { apiBaseUrl };
  }
  return {
    apiBaseUrl,
    async switchDeployment(apiBaseUrl: string): Promise<void> {
      await setDesktopAppConfig({ apiBaseUrl });
      await relaunch();
    },
    async resetDeployment(): Promise<void> {
      await setDesktopAppConfig({ apiBaseUrl: null });
      await relaunch();
    },
  };
}

// --- Auth mapping -----------------------------------------------------------

export function mapProductAuthUser(user: AuthUser): ProductAuthUser {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    avatarUrl: user.avatar_url,
    githubLogin: user.github_login,
  };
}

export interface DesktopAuthMethodAvailability {
  passwordAvailable: boolean;
  githubAvailable: boolean;
  ssoAvailable: boolean;
}

/**
 * The anonymous method list, in a fixed order, containing only currently
 * available methods. Desktop never advertises Google or Apple login.
 */
export function buildAnonymousMethods({
  passwordAvailable,
  githubAvailable,
  ssoAvailable,
}: DesktopAuthMethodAvailability): AuthMethod[] {
  const methods: AuthMethod[] = [];
  if (passwordAvailable) {
    methods.push("password");
  }
  if (githubAvailable) {
    methods.push("github");
  }
  if (ssoAvailable) {
    methods.push("sso");
  }
  return methods;
}

// --- Auth operations --------------------------------------------------------

/**
 * The subset of `useAuthActions()` the host operations delegate to. Structural
 * so the concrete hook result (with richer return types) is assignable.
 */
export interface DesktopAuthActions {
  signInWithGitHub: (options?: GitHubDesktopSignInOptions) => Promise<unknown>;
  signInWithPassword: (credentials: PasswordSignInCredentials) => Promise<unknown>;
  signInWithSso: (options?: DesktopSsoSignInOptions) => Promise<unknown>;
  signOut: () => Promise<unknown>;
  cancelAuthFlow: (message?: string) => Promise<void>;
  linkGoogle: () => Promise<unknown>;
}

export type DesktopAuthOperations = Pick<
  ProductAuthHost,
  "startLogin" | "finishLogin" | "cancelLogin" | "logout"
>;

/**
 * Build the login/finish/cancel/logout operations over the existing Desktop
 * auth actions. Each `LoginRequest` variant follows the frozen §7.2
 * disposition exactly; no field is discarded or coerced, and no new Google,
 * Apple, or GitHub-link login behavior is introduced. `getCallbackDeps`
 * returns the current orchestration deps so `finishLogin` can delegate to the
 * existing callback handler.
 */
export function createDesktopAuthOperations(
  actions: DesktopAuthActions,
  getCallbackDeps: () => AuthOrchestrationDeps,
): DesktopAuthOperations {
  async function startLogin(request: LoginRequest): Promise<void> {
    switch (request.kind) {
      case "password":
        await actions.signInWithPassword({
          email: request.email,
          password: request.password,
        });
        return;

      case "github": {
        if (
          request.purpose === "link" ||
          request.purpose === "required_github_link"
        ) {
          throw new Error(
            "GitHub account linking is not available from Desktop sign-in.",
          );
        }
        // Omitted purpose or "login": the existing action hard-codes login.
        await actions.signInWithGitHub({ prompt: request.prompt });
        return;
      }

      case "google": {
        if (request.purpose === "link") {
          await actions.linkGoogle();
          return;
        }
        throw new Error("Google sign-in is not available on Desktop.");
      }

      case "apple":
        throw new Error("Apple sign-in is not available on Desktop.");

      case "sso": {
        if (!request.slug) {
          await actions.signInWithSso({
            email: request.email,
            organizationId: request.organizationId,
            connectionId: request.connectionId,
          });
          return;
        }
        const discovery = await discoverDesktopSso({
          slug: request.slug,
          email: request.email,
          organizationId: request.organizationId,
          connectionId: request.connectionId,
        });
        if (!discovery.enabled || !discovery.organizationId) {
          throw new Error(SSO_UNAVAILABLE);
        }
        await actions.signInWithSso({
          organizationId: discovery.organizationId,
          connectionId: discovery.connectionId,
          prompt: "select_account",
        });
        return;
      }
    }
  }

  async function finishLogin(callback: AuthCallback): Promise<void> {
    if (!callback.state) {
      throw new Error("Desktop OAuth state is required to finish sign-in.");
    }
    if (callback.status === "failure") {
      // Failure callbacks never exchange. Reconstruct the provider-error URL and
      // let the callback machine clear the matching pending transaction and
      // publish the normalized callback issue.
      const params = new URLSearchParams({
        error: callback.code,
        state: callback.state,
      });
      const url = `${DESKTOP_AUTH_REDIRECT_URI}?${params.toString()}`;
      await handleDesktopCallbackUrl(url, getCallbackDeps());
      return;
    }
    // Success: preserve the existing PKCE code exchange.
    const params = new URLSearchParams({
      code: callback.code,
      state: callback.state,
    });
    const url = `${DESKTOP_AUTH_REDIRECT_URI}?${params.toString()}`;
    const handled = await handleDesktopCallbackUrl(url, getCallbackDeps());
    if (!handled) {
      throw new Error("The sign-in callback was not accepted.");
    }
  }

  async function cancelLogin(): Promise<void> {
    await actions.cancelAuthFlow();
  }

  async function logout(): Promise<void> {
    await actions.signOut();
  }

  return { startLogin, finishLogin, cancelLogin, logout };
}

// --- Clipboard, links -------------------------------------------------------

export const desktopClipboard: ProductClipboard = {
  writeText(value: string): Promise<void> {
    return copyText(value);
  },
};

export const desktopProductLinks: ProductLinks = {
  openExternal(url: string): Promise<void> {
    return openExternal(url);
  },
  buildReturnUrl(entry: ProductEntry): string {
    return encodeDesktopReturnUrl(entry);
  },
  observeInboundEntries(listener: (entry: ProductEntry) => void): () => void {
    return subscribeDeepLinkUrls((url) => {
      const entry = decodeDesktopProductEntry(url);
      if (entry !== null) {
        listener(entry);
      }
    });
  },
};

// --- Telemetry --------------------------------------------------------------

// The last resolved Desktop telemetry route, held across the process so a
// repeat pathname resolving to the same route suppresses a duplicate emission
// (mirroring use-telemetry-route-views).
let previousTelemetryRoute: DesktopTelemetryRoute | null = null;

export const desktopTelemetry: ProductTelemetry = {
  track({ name, properties }): void {
    // Boundary adaptation: the shared event is open-typed while the Desktop
    // sink is keyed by DesktopProductEventMap. The concrete event catalog is
    // owned by the emitting product code, so this is a localized cast.
    trackProductEvent(name as never, properties as never);
  },
  captureException(error, context): void {
    captureTelemetryException(
      error,
      context as Parameters<typeof captureTelemetryException>[1],
    );
  },
  setUser(user): void {
    if (user) {
      // setTelemetryUser needs the Desktop AuthUser shape; construct the
      // minimal identity fields it reads from the mapped ProductAuthUser.
      setTelemetryUser({
        id: user.id,
        email: user.email ?? "",
        display_name: user.displayName ?? null,
      });
      return;
    }
    clearTelemetryUser();
  },
  setTag(key: string, value: string): void {
    setTelemetryTag(key, value);
  },
  routeChanged(pathname: string): void {
    const route = resolveDesktopTelemetryRoute(pathname);
    if (previousTelemetryRoute === route) {
      return;
    }
    previousTelemetryRoute = route;
    setTelemetryTag("route", route);
    trackProductEvent("screen_viewed", { route });
  },
  getSupportContext() {
    return {
      clientReleaseId: getSupportReportReleaseId(),
      telemetryRefs: getSupportReportTelemetryRefs(),
    };
  },
};

// Test-only: reset the module-held route ref so route-suppression tests start
// from a clean slate.
export function __resetDesktopTelemetryRouteForTest(): void {
  previousTelemetryRoute = null;
}
