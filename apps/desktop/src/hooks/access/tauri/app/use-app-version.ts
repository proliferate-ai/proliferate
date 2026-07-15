import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { appVersionKey } from "./query-keys";

export function useAppVersion() {
  const updater = useProductHost().desktop?.updater ?? null;
  const telemetry = useProductTelemetry();
  return useQuery<string>({
    queryKey: appVersionKey(),
    queryFn: async () => {
      if (updater === null) {
        return "0.0.0-dev";
      }
      try {
        return await updater.getVersion();
      } catch (error) {
        telemetry.captureException(error, {
          tags: {
            action: "load_app_version",
            domain: "settings",
            route: "settings",
          },
        });
        return "0.0.0-dev";
      }
    },
    enabled: updater !== null,
    staleTime: Infinity,
  });
}
