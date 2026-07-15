import { useEffect, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

/**
 * Apply the macOS traffic-light window chrome through the host's native-UI
 * bridge (ruling G5). Off a native/mac host the bridge is null and the action
 * is a no-op; the product already gates the call on a mac desktop.
 */
export function useTauriWindowActions() {
  const nativeUi = useProductHost().desktop?.nativeUi ?? null;
  return useMemo(
    () => ({
      applyMacWindowChrome: async (): Promise<void> => {
        await nativeUi?.applyMacosWindowChrome();
      },
    }),
    [nativeUi],
  );
}

export function useMacWindowChrome(): void {
  const { applyMacWindowChrome: applyChrome } = useTauriWindowActions();

  useEffect(() => {
    void applyChrome();
  }, [applyChrome]);
}
