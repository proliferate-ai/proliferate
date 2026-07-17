import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import { installWebTelemetry } from "./browser/telemetry/install-web-telemetry";
import { WebHostApp } from "./WebHostApp";
import "./index.css";

// The Web host bootstrap: install the browser/vendor transport, then mount the
// thin Web host around the compiled shared product. WebHostApp owns the router,
// Cloud/session root, ProductHost snapshot, and the narrow browser
// callback/return decoders around ProductClient.
document.documentElement.dataset.proliferateClient = "web";

const rootErrorHandlers = installWebTelemetry();

ReactDOM.createRoot(
  document.getElementById("root")!,
  rootErrorHandlers,
).render(
  <StrictMode>
    <WebHostApp />
  </StrictMode>,
);
