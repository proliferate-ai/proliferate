import {
  bootstrapWebSession,
  logoutWebSession,
  type AuthSessionResponse,
  type AuthUser,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setSandboxGatewayAccessTokenProvider } from "@proliferate/product-client/infra/cloud-gateway";
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { webEnv } from "../../config/env";
import { isApiUnreachableError } from "../../lib/access/cloud/session-bootstrap-failure";
import { webBetaAuthErrorCode } from "../../lib/domain/auth/web-auth-errors";
import {
  createWebCloudClient,
  getWebSandboxGatewayAccessToken,
  setWebSessionAccessToken,
} from "./create-web-cloud-client";

const SESSION_BOOTSTRAP_TIMEOUT_MS = 5_000;
const WEB_CSRF_COOKIE = "proliferate_web_csrf";

// Arm the Cloud sandbox-gateway access-token provider once at module scope
// (mirroring Desktop's `DesktopHostProviders`) so the plain gateway-connection
// builders resolve the current web-session token. `WebCloudRoot` keeps that
// token current through `setWebSessionAccessToken`.
setSandboxGatewayAccessTokenProvider(getWebSandboxGatewayAccessToken);

// One Query cache for the whole Web host, mirroring the single legacy client.
const queryClient = new QueryClient();

export type WebSessionStatus = "loading" | "anonymous" | "authenticated";

export interface WebSessionState {
  status: WebSessionStatus;
  /** In-memory access token; never persisted to localStorage. */
  token: string | null;
  user: AuthUser | null;
  /** Present only while anonymous as the result of a failure. */
  issue: ProductAuthIssue | null;
}

export interface WebSessionContextValue {
  state: WebSessionState;
  client: ProliferateCloudClient;
  setSession: (session: AuthSessionResponse) => void;
  publishIssue: (issue: ProductAuthIssue) => void;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const WebSessionContext = createContext<WebSessionContextValue | null>(null);

/**
 * The Web host's Cloud/session root. It owns the single Query cache, the
 * cookie-based session bootstrap machine, and the memoized Cloud client, and
 * supplies `CloudClientProvider`. It exposes the reactive session state so
 * `WebProductHostProvider` can build the immutable ProductHost snapshot above
 * ProductClient.
 *
 * The bootstrap machine is the legacy `WebCloudProvider` machine minus every
 * bearer-token localStorage access: on load it silently rehydrates from the
 * HttpOnly refresh cookie (`POST /auth/web/session/bootstrap`,
 * `credentials: "include"`); the exchanged access token and user live only in
 * React state for the session. It reads and writes no bearer token in
 * `localStorage`.
 */
export function WebCloudRoot({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<WebSessionStatus>("loading");
  const [issue, setIssue] = useState<ProductAuthIssue | null>(null);
  const authEpochRef = useRef(0);

  const client = useMemo(
    () => createWebCloudClient(webEnv.apiBaseUrl, token),
    [token],
  );

  // Keep the in-memory token, the module-level gateway accessor, and the Query
  // cache consistent on every session transition.
  const applyToken = useCallback((next: string | null) => {
    setWebSessionAccessToken(next);
    queryClient.clear();
    setTokenState(next);
  }, []);

  const setSession = useCallback(
    (session: AuthSessionResponse) => {
      authEpochRef.current += 1;
      applyToken(session.accessToken);
      setUser(session.user);
      setIssue(null);
      setStatus("authenticated");
    },
    [applyToken],
  );

  const publishIssue = useCallback(
    (nextIssue: ProductAuthIssue) => {
      authEpochRef.current += 1;
      applyToken(null);
      setUser(null);
      setIssue(nextIssue);
      setStatus("anonymous");
    },
    [applyToken],
  );

  const goAnonymous = useCallback(() => {
    authEpochRef.current += 1;
    applyToken(null);
    setUser(null);
    setIssue(null);
    setStatus("anonymous");
  }, [applyToken]);

  const runBootstrap = useCallback((): (() => void) => {
    const bootstrapEpoch = authEpochRef.current;
    let cancelled = false;
    const bootstrapClient = createWebCloudClient(webEnv.apiBaseUrl, null);
    const abortController = new AbortController();
    // Dev bounds the wait so a missing local API surfaces an actionable
    // deployment-unreachable state instead of an indefinite loader; production
    // keeps the unbounded wait.
    const timeoutId = import.meta.env.DEV
      ? window.setTimeout(
          () => abortController.abort(),
          SESSION_BOOTSTRAP_TIMEOUT_MS,
        )
      : null;
    bootstrapWebSession(bootstrapClient, { signal: abortController.signal })
      .then((session) => {
        if (cancelled || authEpochRef.current !== bootstrapEpoch) {
          return;
        }
        setSession(session);
      })
      .catch((error: unknown) => {
        if (cancelled || authEpochRef.current !== bootstrapEpoch) {
          return;
        }
        const betaCode = webBetaAuthErrorCode(error);
        if (betaCode) {
          publishIssue({ kind: "access_denied", code: betaCode });
          return;
        }
        if (import.meta.env.DEV && isApiUnreachableError(error)) {
          publishIssue({ kind: "deployment_unreachable" });
          return;
        }
        goAnonymous();
      })
      .finally(() => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [setSession, publishIssue, goAnonymous]);

  const restoreSession = useCallback(async (): Promise<void> => {
    authEpochRef.current += 1;
    applyToken(null);
    setUser(null);
    setIssue(null);
    setStatus("loading");
    runBootstrap();
  }, [applyToken, runBootstrap]);

  const logout = useCallback(async (): Promise<void> => {
    authEpochRef.current += 1;
    const csrfToken = readCookie(WEB_CSRF_COOKIE);
    if (csrfToken) {
      const logoutClient = createWebCloudClient(webEnv.apiBaseUrl, null);
      try {
        await logoutWebSession(csrfToken, logoutClient);
      } catch {
        // Local logout still clears the in-memory session.
      }
    }
    goAnonymous();
  }, [goAnonymous]);

  // One-shot bootstrap on mount.
  useEffect(() => runBootstrap(), [runBootstrap]);

  const value = useMemo<WebSessionContextValue>(
    () => ({
      state: { status, token, user, issue },
      client,
      setSession,
      publishIssue,
      restoreSession,
      logout,
    }),
    [
      status,
      token,
      user,
      issue,
      client,
      setSession,
      publishIssue,
      restoreSession,
      logout,
    ],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <CloudClientProvider client={client}>
        <WebSessionContext.Provider value={value}>
          {children}
        </WebSessionContext.Provider>
      </CloudClientProvider>
    </QueryClientProvider>
  );
}

export function useWebSession(): WebSessionContextValue {
  const value = useContext(WebSessionContext);
  if (value === null) {
    throw new Error("useWebSession must be used within a WebCloudRoot.");
  }
  return value;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}
