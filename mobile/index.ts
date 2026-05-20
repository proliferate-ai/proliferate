import { registerRootComponent } from "expo";

import { getMobileTelemetryConfig } from "./src/lib/integrations/telemetry/config";
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

registerRootComponent(wrapMobileSentryRoot(App));
