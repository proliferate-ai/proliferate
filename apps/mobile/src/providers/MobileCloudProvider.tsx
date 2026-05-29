import { AppState } from "react-native";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { mobileEnv } from "../config/env";
import { createMobileCloudClient } from "../lib/access/cloud/client";
import { useMobileAuth } from "./MobileAuthProvider";

export function MobileCloudProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useMobileAuth();
  const queryClientState = useRef<{
    accessToken: string | null;
    client: QueryClient;
    epoch: number;
  } | null>(null);
  if (!queryClientState.current || queryClientState.current.accessToken !== accessToken) {
    queryClientState.current = {
      accessToken,
      client: new QueryClient(),
      epoch: (queryClientState.current?.epoch ?? 0) + 1,
    };
  }
  const queryClient = queryClientState.current.client;
  const queryClientEpoch = queryClientState.current.epoch;
  const client = useMemo(
    () => createMobileCloudClient(mobileEnv.apiBaseUrl, accessToken),
    [accessToken],
  );

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return (
    <QueryClientProvider key={queryClientEpoch} client={queryClient}>
      <CloudClientProvider client={client}>{children}</CloudClientProvider>
    </QueryClientProvider>
  );
}
