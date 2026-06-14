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
import { isApiUnreachableError } from "../lib/access/cloud/session-bootstrap-failure";

const SESSION_BOOTSTRAP_TIMEOUT_MS = 5_000;

interface AuthTokenContextValue {
  token: string | null;
  user: AuthUser | null;
  bootstrapping: boolean;
  bootstrapUnreachable: boolean;
  setToken: (token: string) => void;
  setSession: (session: AuthSessionResponse) => void;
  clearToken: () => Promise<void>;
}

const AuthTokenContext = createContext<AuthTokenContextValue | null>(null);
const queryClient = new QueryClient();

export function WebCloudProvider({ children }: { children: ReactNode }) {
  const initialTokenRef = useRef<string | null | undefined>(undefined);
  if (initialTokenRef.current === undefined) {
    initialTokenRef.current = readStoredAuthToken();
  }
  const [token, setTokenState] = useState<string | null>(initialTokenRef.current);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(initialTokenRef.current === null);
  const [bootstrapUnreachable, setBootstrapUnreachable] = useState(false);
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
    const abortController = new AbortController();
    // In dev, bound the wait so a missing local API surfaces an actionable
    // notice instead of an indefinite loading screen. Production keeps the
    // unbounded wait.
    const timeoutId = import.meta.env.DEV
      ? window.setTimeout(() => abortController.abort(), SESSION_BOOTSTRAP_TIMEOUT_MS)
      : null;
    bootstrapWebSession(bootstrapClient, { signal: abortController.signal })
      .then((session) => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          queryClient.clear();
          setTokenState(session.accessToken);
          setUserState(session.user);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          setTokenState(null);
          setUserState(null);
          setBootstrapUnreachable(import.meta.env.DEV && isApiUnreachableError(error));
        }
      })
      .finally(() => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          setBootstrapping(false);
        }
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, []);

  const authToken = useMemo<AuthTokenContextValue>(
    () => ({
      token,
      user,
      bootstrapping,
      bootstrapUnreachable,
      setToken(nextToken) {
        authEpochRef.current += 1;
        queryClient.clear();
        writeStoredAuthToken(nextToken);
        setBootstrapping(false);
        setBootstrapUnreachable(false);
        setTokenState(nextToken);
        setUserState(null);
      },
      setSession(session) {
        authEpochRef.current += 1;
        queryClient.clear();
        clearStoredAuthToken();
        setBootstrapping(false);
        setBootstrapUnreachable(false);
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
    [bootstrapping, bootstrapUnreachable, token, user],
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
