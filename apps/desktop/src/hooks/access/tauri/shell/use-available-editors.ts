import { useQuery } from "@tanstack/react-query";
import type { EditorInfo } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { availableEditorsKey } from "./query-keys";

const EMPTY_EDITORS: EditorInfo[] = [];

export function useAvailableEditors() {
  const files = useProductHost().desktop?.files ?? null;
  const telemetry = useProductTelemetry();

  return useQuery<EditorInfo[]>({
    queryKey: availableEditorsKey(),
    queryFn: async () => {
      if (!files) {
        return EMPTY_EDITORS;
      }
      try {
        return await files.listAvailableEditors();
      } catch (error) {
        telemetry.captureException(error, {
          tags: {
            action: "list_available_editors",
            domain: "settings",
            route: "settings",
          },
        });
        return EMPTY_EDITORS;
      }
    },
    enabled: files !== null,
    staleTime: Infinity,
  });
}
