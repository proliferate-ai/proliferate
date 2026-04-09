import { useQuery } from "@tanstack/react-query";
import { listAvailableEditors, type EditorInfo } from "@/platform/tauri/shell";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { availableEditorsKey } from "./query-keys";

const EMPTY_EDITORS: EditorInfo[] = [];

export function useAvailableEditors() {
  return useQuery<EditorInfo[]>({
    queryKey: availableEditorsKey(),
    queryFn: async () => {
      try {
        return await listAvailableEditors();
      } catch (error) {
        captureTelemetryException(error, {
          tags: {
            action: "list_available_editors",
            domain: "settings",
            route: "settings",
          },
        });
        return EMPTY_EDITORS;
      }
    },
    staleTime: Infinity,
  });
}
