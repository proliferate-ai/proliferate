import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

import {
  refreshMobileSession,
  type AuthProviderName,
  type AuthSessionResponse,
  type AuthUser,
} from "@proliferate/cloud-sdk";

import {
  runMobileAppleFlow,
  runMobileOAuthFlow,
} from "../lib/access/cloud/auth/mobile-auth-flow";
import { createMobileCloudClient } from "../lib/access/cloud/client";
import {
  deleteMobileStorageItem,
  getMobileStorageItem,
  setMobileStorageItem,
} from "../lib/access/mobile-storage";
import { mobileEnv } from "../config/env";

const ACCESS_TOKEN_KEY = "proliferate.mobile.accessToken";
const REFRESH_TOKEN_KEY = "proliferate.mobile.refreshToken";
const DEV_REFRESH_TOKEN_PARAM = "proliferateDevRefreshToken";

export type MobileAuthState = "bootstrapping" | "signed_out" | "needs_github" | "active";
export type MobileAuthAction = AuthProviderName | "github_link" | null;

interface MobileAuthContextValue {
  authState: MobileAuthState;
  accessToken: string | null;
  user: AuthUser | null;
  loadingAction: MobileAuthAction;
  error: string | null;
  signInWithProvider: (provider: AuthProviderName) => Promise<void>;
  connectGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<MobileAuthState>("bootstrapping");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingAction, setLoadingAction] = useState<MobileAuthAction>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bootstrapSession()
      .then(async (session) => {
        if (!cancelled && session) {
          await applySession(session, setAccessToken, setUser, setAuthState);
        }
      })
      .catch(() => {
        if (!cancelled) {
          void clearStoredSession();
          setAccessToken(null);
          setUser(null);
          setAuthState("signed_out");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthState((state) => (state === "bootstrapping" ? "signed_out" : state));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<MobileAuthContextValue>(
    () => ({
      authState,
      accessToken,
      user,
      loadingAction,
      error,
      clearError() {
        setError(null);
      },
      async signInWithProvider(provider) {
        if (loadingAction) {
          return;
        }
        setError(null);
        setLoadingAction(provider);
        try {
          const session =
            provider === "apple"
              ? await runMobileAppleFlow({})
              : await runMobileOAuthFlow({ provider });
          await applySession(session, setAccessToken, setUser, setAuthState);
        } catch (authError) {
          setError(errorMessage(authError));
        } finally {
          setLoadingAction(null);
        }
      },
      async connectGitHub() {
        if (!accessToken || loadingAction) {
          return;
        }
        setError(null);
        setLoadingAction("github_link");
        try {
          const session = await runMobileOAuthFlow({
            provider: "github",
            purpose: "required_github_link",
            accessToken,
          });
          await applySession(session, setAccessToken, setUser, setAuthState);
        } catch (authError) {
          setError(errorMessage(authError));
        } finally {
          setLoadingAction(null);
        }
      },
      async signOut() {
        setLoadingAction(null);
        setError(null);
        await clearStoredSession();
        setAccessToken(null);
        setUser(null);
        setAuthState("signed_out");
      },
    }),
    [accessToken, authState, error, loadingAction, user],
  );

  return (
    <MobileAuthContext.Provider value={value}>
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const value = useContext(MobileAuthContext);
  if (!value) {
    throw new Error("useMobileAuth must be used within MobileAuthProvider.");
  }
  return value;
}

async function bootstrapSession(): Promise<AuthSessionResponse | null> {
  const refreshToken =
    readDevWebRefreshTokenFromLocation() ?? (await getMobileStorageItem(REFRESH_TOKEN_KEY));
  if (!refreshToken) {
    return null;
  }
  const client = createMobileCloudClient(mobileEnv.apiBaseUrl, null);
  return refreshMobileSession(
    {
      refreshToken,
      grantType: "refresh_token",
    },
    client,
  );
}

function readDevWebRefreshTokenFromLocation(): string | null {
  const webWindow = typeof window !== "undefined" ? window : undefined;
  const globalScope = typeof globalThis !== "undefined"
    ? globalThis as {
      history?: { replaceState?: (data: unknown, unused: string, url?: string) => void };
      location?: {
        hash: string;
        hostname: string;
        pathname: string;
        search: string;
      };
    }
    : undefined;
  const location = webWindow?.location ?? globalScope?.location;
  const history = webWindow?.history ?? globalScope?.history;
  if (
    Platform.OS !== "web"
    || !location
    || !isLocalDevWebHost(location.hostname)
  ) {
    return null;
  }

  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash);
  const refreshToken = params.get(DEV_REFRESH_TOKEN_PARAM);
  if (!refreshToken) {
    return null;
  }

  params.delete(DEV_REFRESH_TOKEN_PARAM);
  const nextHash = params.toString();
  const nextUrl = `${location.pathname}${location.search}${nextHash ? `#${nextHash}` : ""}`;
  if (history?.replaceState) {
    history.replaceState(null, "", nextUrl);
  } else {
    try {
      location.hash = nextHash ? `#${nextHash}` : "";
    } catch {
      // Some embedded web harnesses expose a read-only Location fragment.
    }
  }
  return refreshToken;
}

function isLocalDevWebHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function applySession(
  session: AuthSessionResponse,
  setAccessToken: (token: string | null) => void,
  setUser: (user: AuthUser | null) => void,
  setAuthState: (state: MobileAuthState) => void,
): Promise<void> {
  setAccessToken(session.accessToken);
  setUser(session.user);
  await setMobileStorageItem(ACCESS_TOKEN_KEY, session.accessToken);
  if (session.refreshToken) {
    await setMobileStorageItem(REFRESH_TOKEN_KEY, session.refreshToken);
  }
  setAuthState(session.readiness.productReady ? "active" : "needs_github");
}

async function clearStoredSession(): Promise<void> {
  await Promise.all([
    deleteMobileStorageItem(ACCESS_TOKEN_KEY),
    deleteMobileStorageItem(REFRESH_TOKEN_KEY),
  ]);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Authentication could not be completed.";
}
