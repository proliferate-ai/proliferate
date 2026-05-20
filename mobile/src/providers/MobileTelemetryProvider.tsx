import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { getMobileTelemetryConfig } from "../lib/integrations/telemetry/config";
import {
  identifyMobilePostHogUser,
  initializeMobilePostHog,
  resetMobilePostHogUser,
} from "../lib/integrations/telemetry/posthog";
import {
  clearMobileSentryUser,
  setMobileSentryUser,
} from "../lib/integrations/telemetry/sentry";
import { useMobileAuth } from "./MobileAuthProvider";

export function MobileTelemetryProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => getMobileTelemetryConfig(), []);
  const { authState, user } = useMobileAuth();
  const lastIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    initializeMobilePostHog({
      environment: config.environment,
      release: config.release,
      posthog: config.posthog,
    });
  }, [config]);

  useEffect(() => {
    if (authState === "signed_out") {
      if (lastIdentityRef.current !== null) {
        clearMobileSentryUser();
        resetMobilePostHogUser();
        lastIdentityRef.current = null;
      }
      return;
    }

    if (!user || lastIdentityRef.current === user.id) {
      return;
    }

    setMobileSentryUser(user.id);
    identifyMobilePostHogUser(user);
    lastIdentityRef.current = user.id;
  }, [authState, user]);

  return children;
}
