import { createAppQueryClient } from "@/lib/infra/query/query-client";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

/**
 * The one host-owned QueryClient instance. The product-owned factory
 * (`createAppQueryClient`) stays vendor-free; Desktop composes it here with its
 * concrete telemetry capture so cache/mutation errors reach the Sentry sink.
 * There is exactly one instance for the whole app.
 *
 * TODO(S5 root split): when `AppProviders` splits into `DesktopHostProviders`
 * and `ProductProviderRoot`, this construction moves into the host provider and
 * the product tree obtains the client from react-query context rather than a
 * module import (WorkspaceProviders' cache reads included).
 */
export const appQueryClient = createAppQueryClient({
  captureException: captureTelemetryException,
});
