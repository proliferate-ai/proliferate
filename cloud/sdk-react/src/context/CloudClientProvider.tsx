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
  children: ReactNode;
}

export function CloudClientProvider({
  client,
  clientFactory,
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
    if (resolvedClient) {
      setProliferateClient(resolvedClient);
    }
  }, [resolvedClient]);

  return (
    <CloudClientContext.Provider value={resolvedClient}>
      {children}
    </CloudClientContext.Provider>
  );
}

export function useCloudClient(): ProliferateCloudClient {
  return useContext(CloudClientContext) ?? getProliferateClient();
}
