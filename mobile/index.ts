import { registerRootComponent } from "expo";

import { getMobileTelemetryConfig } from "./src/lib/integrations/telemetry/config";
import { initializeMobilePostHog } from "./src/lib/integrations/telemetry/posthog";
import {
  initializeMobileSentry,
  wrapMobileSentryRoot,
} from "./src/lib/integrations/telemetry/sentry";
import App from "./src/App";

const telemetryConfig = getMobileTelemetryConfig();
initializeMobileSentry({
  environment: telemetryConfig.environment,
  release: telemetryConfig.release,
  sentry: telemetryConfig.sentry,
});
initializeMobilePostHog({
  environment: telemetryConfig.environment,
  release: telemetryConfig.release,
  posthog: telemetryConfig.posthog,
});

registerRootComponent(wrapMobileSentryRoot(App));
