import { createAppQueryClient } from "@/lib/infra/query/query-client";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

/**
 * The one host-owned QueryClient instance. The product-owned factory
 * (`createAppQueryClient`) stays vendor-free; Desktop composes it here with its
 * concrete telemetry capture so cache/mutation errors reach the Sentry sink.
 * There is exactly one instance for the whole app.
 *
 * `DesktopHostProviders` (the host-owned composition) imports this singleton and
 * feeds it to the react-query provider; there is one instance for the whole app.
 */
export const appQueryClient = createAppQueryClient({
  captureException: captureTelemetryException,
});
