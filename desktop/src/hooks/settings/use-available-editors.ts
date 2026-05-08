import { useQuery } from "@tanstack/react-query";
import {
  type EditorInfo,
  useTauriShellActions,
} from "@/hooks/access/tauri/use-shell-actions";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { availableEditorsKey } from "./query-keys";

const EMPTY_EDITORS: EditorInfo[] = [];

export function useAvailableEditors() {
  const { listAvailableEditors } = useTauriShellActions();

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
