import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

import { webEnv } from "../config/env";
import {
  clearStoredAuthToken,
  readStoredAuthToken,
  writeStoredAuthToken,
} from "../lib/access/cloud/auth-token-store";
import { createWebCloudClient } from "../lib/access/cloud/client";

interface AuthTokenContextValue {
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

const AuthTokenContext = createContext<AuthTokenContextValue | null>(null);
const queryClient = new QueryClient();

export function WebCloudProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(() => readStoredAuthToken());
  const client = useMemo(() => createWebCloudClient(webEnv.apiBaseUrl, token), [token]);

  const authToken = useMemo<AuthTokenContextValue>(
    () => ({
      token,
      setToken(nextToken) {
        writeStoredAuthToken(nextToken);
        setTokenState(nextToken);
        void queryClient.invalidateQueries();
      },
      clearToken() {
        clearStoredAuthToken();
        setTokenState(null);
        queryClient.clear();
      },
    }),
    [token],
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
