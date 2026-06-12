import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  bootstrapWebSession,
  logoutWebSession,
  type AuthSessionResponse,
  type AuthUser,
} from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { webEnv } from "../config/env";
import { createWebCloudClient } from "../lib/access/cloud/client";
import {
  clearStoredAuthToken,
  readStoredAuthToken,
  writeStoredAuthToken,
} from "../lib/access/cloud/auth-token-store";

interface AuthTokenContextValue {
  token: string | null;
  user: AuthUser | null;
  bootstrapping: boolean;
  connectionFailed: boolean;
  setToken: (token: string) => void;
  setSession: (session: AuthSessionResponse) => void;
  clearToken: () => Promise<void>;
}

const AuthTokenContext = createContext<AuthTokenContextValue | null>(null);
const queryClient = new QueryClient();

// Stop waiting on the bootstrap request if the API never answers, so the
// sign-in screen can render (and, in development, explain why).
const BOOTSTRAP_SESSION_TIMEOUT_MS = 8000;

export function WebCloudProvider({ children }: { children: ReactNode }) {
  const initialTokenRef = useRef<string | null | undefined>(undefined);
  if (initialTokenRef.current === undefined) {
    initialTokenRef.current = readStoredAuthToken();
  }
  const [token, setTokenState] = useState<string | null>(initialTokenRef.current);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(initialTokenRef.current === null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const authEpochRef = useRef(0);
  const client = useMemo(() => createWebCloudClient(webEnv.apiBaseUrl, token), [token]);

  useEffect(() => {
    if (initialTokenRef.current !== null) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    const bootstrapEpoch = authEpochRef.current;
    const bootstrapClient = createWebCloudClient(webEnv.apiBaseUrl, null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), BOOTSTRAP_SESSION_TIMEOUT_MS);
    bootstrapWebSession(bootstrapClient, { signal: controller.signal })
      .then((session) => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          queryClient.clear();
          setConnectionFailed(false);
          setTokenState(session.accessToken);
          setUserState(session.user);
        }
      })
      .catch((error) => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          setConnectionFailed(isApiUnreachableError(error));
          setTokenState(null);
          setUserState(null);
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          setBootstrapping(false);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  const authToken = useMemo<AuthTokenContextValue>(
    () => ({
      token,
      user,
      bootstrapping,
      connectionFailed,
      setToken(nextToken) {
        authEpochRef.current += 1;
        queryClient.clear();
        writeStoredAuthToken(nextToken);
        setBootstrapping(false);
        setTokenState(nextToken);
        setUserState(null);
      },
      setSession(session) {
        authEpochRef.current += 1;
        queryClient.clear();
        clearStoredAuthToken();
        setBootstrapping(false);
        setTokenState(session.accessToken);
        setUserState(session.user);
      },
      async clearToken() {
        authEpochRef.current += 1;
        const csrfToken = readCookie("proliferate_web_csrf");
        if (csrfToken) {
          const logoutClient = createWebCloudClient(webEnv.apiBaseUrl, null);
          try {
            await logoutWebSession(csrfToken, logoutClient);
          } catch {
            // Local logout should still clear the in-memory session.
          }
        }
        queryClient.clear();
        clearStoredAuthToken();
        setBootstrapping(false);
        setTokenState(null);
        setUserState(null);
      },
    }),
    [bootstrapping, connectionFailed, token, user],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <CloudClientProvider client={client}>
        <AuthTokenContext.Provider value={authToken}>
          {children}
        </AuthTokenContext.Provider>
      </CloudClientProvider>
    </QueryClientProvider>
  );
}

export function useAuthToken() {
  const value = useContext(AuthTokenContext);
  if (!value) {
    throw new Error("useAuthToken must be used within WebCloudProvider.");
  }
  return value;
}

// Distinguishes "the API could not be reached" (request aborted by our timeout,
// or fetch failing to connect at all) from genuine auth responses such as a 401.
function isApiUnreachableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  // fetch() rejects with a TypeError when it cannot establish a connection.
  return error instanceof TypeError;
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
