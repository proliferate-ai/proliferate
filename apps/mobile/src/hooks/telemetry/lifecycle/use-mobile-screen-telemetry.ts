import { useEffect, useRef } from "react";

import type { MobileAuthState } from "../../../providers/MobileAuthProvider";
import {
  trackMobilePostHogScreenView,
  type MobileTelemetryScreen,
} from "../../../lib/integrations/telemetry/posthog";
import { addMobileSentryBreadcrumb } from "../../../lib/integrations/telemetry/sentry";

export function useMobileScreenTelemetry(
  authState: MobileAuthState,
  screen: MobileTelemetryScreen,
): void {
  const lastScreenRef = useRef<MobileTelemetryScreen | null>(null);

  useEffect(() => {
    if (authState !== "active") {
      lastScreenRef.current = null;
      return;
    }

    if (lastScreenRef.current === screen) {
      return;
    }

    lastScreenRef.current = screen;
    addMobileSentryBreadcrumb("mobile_screen_viewed", {
      screen,
      surface: "mobile",
    });
    trackMobilePostHogScreenView(screen);
  }, [authState, screen]);
}
