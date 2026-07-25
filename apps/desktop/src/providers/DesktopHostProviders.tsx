import { useMemo, type ReactNode } from "react";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { QueryClientProvider } from "@tanstack/react-query";

import { getProliferateClient } from "@/lib/access/cloud/client";
import { createAppQueryClient } from "@/lib/infra/query/query-client";

import { DesktopProductHostProvider } from "./DesktopProductHostProvider";
import { desktopTelemetry } from "./desktop-product-host";

// Preserve the pre-split module-singleton identity even under StrictMode's
// initial double render. Query errors use the one Desktop telemetry transport.
const desktopQueryClient = createAppQueryClient(desktopTelemetry.captureException);

/** Desktop-owned infrastructure around the shared product provider tree. */
export function DesktopHostProviders({ children }: { children: ReactNode }) {
  const cloudClient = useMemo(() => getProliferateClient(), []);

  return (
    <QueryClientProvider client={desktopQueryClient}>
      <CloudClientProvider client={cloudClient}>
        <DesktopProductHostProvider cloudClient={cloudClient}>
          {children}
        </DesktopProductHostProvider>
      </CloudClientProvider>
    </QueryClientProvider>
  );
}
