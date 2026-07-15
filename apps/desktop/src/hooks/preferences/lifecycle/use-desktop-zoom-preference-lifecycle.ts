import { useEffect } from "react";

import type { DesktopNativeUiBridge } from "@proliferate/product-client/host/desktop-bridge";

import { resolveWindowZoomScale } from "@/lib/domain/preferences/appearance";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useDesktopZoomPreferenceLifecycle(
  setZoom: DesktopNativeUiBridge["setZoom"],
): void {
  useEffect(() => {
    const applyStoredZoom = () => {
      const { windowZoomId } = useUserPreferencesStore.getState();
      const { factor } = resolveWindowZoomScale(windowZoomId);
      void setZoom(factor).catch(() => {
        // Native zoom is non-critical; shared document appearance still applies.
      });
    };

    applyStoredZoom();
    return useUserPreferencesStore.subscribe((state, previous) => {
      if (state.windowZoomId !== previous.windowZoomId) {
        applyStoredZoom();
      }
    });
  }, [setZoom]);
}
