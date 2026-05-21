import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { type ReactNode, useMemo } from "react";

import { mobileEnv } from "../config/env";
import { createMobileCloudClient } from "../lib/access/cloud/client";
import { useMobileAuth } from "./MobileAuthProvider";

const queryClient = new QueryClient();

export function MobileCloudProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useMobileAuth();
  const client = useMemo(
    () => createMobileCloudClient(mobileEnv.apiBaseUrl, accessToken),
    [accessToken],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <CloudClientProvider client={client}>{children}</CloudClientProvider>
    </QueryClientProvider>
  );
}
