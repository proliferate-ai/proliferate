import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";

import { getProliferateClient } from "@/lib/access/cloud/client";
import { appQueryClient } from "@/providers/app-query-client";
import { DesktopProductHostProvider } from "./DesktopProductHostProvider";

/**
 * Host-owned infrastructure envelope. Mounts the one Query cache, the one Cloud
 * SDK client, and the one ProductHost snapshot. Everything here is Desktop
 * infrastructure that stays behind after the product tree is extracted; it
 * constructs no product provider and reads no product state.
 *
 * There is exactly one `appQueryClient` (the module singleton, composed with the
 * Desktop telemetry capture in `app-query-client.ts`) and exactly one
 * `cloudClient`. The same `cloudClient` reference flows into both
 * `CloudClientProvider` and `DesktopProductHostProvider`, so no second instance
 * is ever constructed.
 */
export function DesktopHostProviders({ children }: { children: ReactNode }) {
  const cloudClient = useMemo(() => getProliferateClient(), []);

  return (
    <QueryClientProvider client={appQueryClient}>
      <CloudClientProvider client={cloudClient}>
        <DesktopProductHostProvider cloudClient={cloudClient}>
          {children}
        </DesktopProductHostProvider>
      </CloudClientProvider>
    </QueryClientProvider>
  );
}
