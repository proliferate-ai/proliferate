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

interface AuthTokenContextValue {
  token: string | null;
  user: AuthUser | null;
  bootstrapping: boolean;
  setToken: (token: string) => void;
  setSession: (session: AuthSessionResponse) => void;
  clearToken: () => Promise<void>;
}

const AuthTokenContext = createContext<AuthTokenContextValue | null>(null);
const queryClient = new QueryClient();

export function WebCloudProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const authEpochRef = useRef(0);
  const client = useMemo(() => createWebCloudClient(webEnv.apiBaseUrl, token), [token]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapEpoch = authEpochRef.current;
    const bootstrapClient = createWebCloudClient(webEnv.apiBaseUrl, null);
    bootstrapWebSession(bootstrapClient)
      .then((session) => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          queryClient.clear();
          setTokenState(session.accessToken);
          setUserState(session.user);
        }
      })
      .catch(() => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          setTokenState(null);
          setUserState(null);
        }
      })
      .finally(() => {
        if (!cancelled && authEpochRef.current === bootstrapEpoch) {
          setBootstrapping(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const authToken = useMemo<AuthTokenContextValue>(
    () => ({
      token,
      user,
      bootstrapping,
      setToken(nextToken) {
        authEpochRef.current += 1;
        queryClient.clear();
        setBootstrapping(false);
        setTokenState(nextToken);
        setUserState(null);
      },
      setSession(session) {
        authEpochRef.current += 1;
        queryClient.clear();
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
        setBootstrapping(false);
        setTokenState(null);
        setUserState(null);
      },
    }),
    [bootstrapping, token, user],
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
