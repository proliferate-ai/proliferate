import {
  getProliferateClient,
  setProliferateClient,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";

const CloudClientContext = createContext<ProliferateCloudClient | null>(null);

export interface CloudClientProviderProps {
  client?: ProliferateCloudClient | null;
  clientFactory?: (() => ProliferateCloudClient) | null;
  /** Keep false for nested context-only scopes that must not replace the host default client. */
  syncGlobalClient?: boolean;
  children: ReactNode;
}

export function CloudClientProvider({
  client,
  clientFactory,
  syncGlobalClient = true,
  children,
}: CloudClientProviderProps) {
  const resolvedClient = useMemo(() => {
    if (client) {
      return client;
    }
    if (clientFactory) {
      return clientFactory();
    }
    return null;
  }, [client, clientFactory]);

  useEffect(() => {
    if (syncGlobalClient && resolvedClient) {
      setProliferateClient(resolvedClient);
    }
  }, [resolvedClient, syncGlobalClient]);

  return (
    <CloudClientContext.Provider value={resolvedClient}>
      {children}
    </CloudClientContext.Provider>
  );
}

export function useCloudClient(): ProliferateCloudClient {
  return useContext(CloudClientContext) ?? getProliferateClient();
}
