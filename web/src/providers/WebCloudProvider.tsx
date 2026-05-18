import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  bootstrapWebSession,
  logoutWebSession,
  type AuthSessionResponse,
} from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { webEnv } from "../config/env";
import { createWebCloudClient } from "../lib/access/cloud/client";

interface AuthTokenContextValue {
  token: string | null;
  bootstrapping: boolean;
  setToken: (token: string) => void;
  setSession: (session: AuthSessionResponse) => void;
  clearToken: () => Promise<void>;
}

const AuthTokenContext = createContext<AuthTokenContextValue | null>(null);
const queryClient = new QueryClient();

export function WebCloudProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const client = useMemo(() => createWebCloudClient(webEnv.apiBaseUrl, token), [token]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapClient = createWebCloudClient(webEnv.apiBaseUrl, null);
    bootstrapWebSession(bootstrapClient)
      .then((session) => {
        if (!cancelled) {
          queryClient.clear();
          setTokenState(session.accessToken);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenState(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
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
      bootstrapping,
      setToken(nextToken) {
        queryClient.clear();
        setTokenState(nextToken);
      },
      setSession(session) {
        queryClient.clear();
        setTokenState(session.accessToken);
      },
      async clearToken() {
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
        setTokenState(null);
      },
    }),
    [bootstrapping, token],
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
