import { useQuery } from "@tanstack/react-query";
import { getAppVersion } from "@/lib/access/tauri/updater";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { appVersionKey } from "./query-keys";

export function useAppVersion() {
  return useQuery<string>({
    queryKey: appVersionKey(),
    queryFn: async () => {
      try {
        return await getAppVersion();
      } catch (error) {
        captureTelemetryException(error, {
          tags: {
            action: "load_app_version",
            domain: "settings",
            route: "settings",
          },
        });
        return "0.0.0-dev";
      }
    },
    staleTime: Infinity,
  });
}
