import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { webEnv } from "./config/env";
import { getWebTelemetryConfig } from "./lib/integrations/telemetry/config";
import {
  getWebRootErrorHandlers,
  initializeWebSentry,
} from "./lib/integrations/telemetry/sentry";
import { WebCloudProvider } from "./providers/WebCloudProvider";
import { WebTelemetryProvider } from "./providers/WebTelemetryProvider";
import "./index.css";

const telemetryConfig = getWebTelemetryConfig();
initializeWebSentry({
  environment: telemetryConfig.environment,
  release: telemetryConfig.release,
  sentry: telemetryConfig.sentry,
  apiBaseUrl: webEnv.apiBaseUrl,
});

ReactDOM.createRoot(
  document.getElementById("root")!,
  getWebRootErrorHandlers(),
).render(
  <React.StrictMode>
    <WebCloudProvider>
      <BrowserRouter>
        <WebTelemetryProvider>
          <App />
        </WebTelemetryProvider>
      </BrowserRouter>
    </WebCloudProvider>
  </React.StrictMode>,
);
