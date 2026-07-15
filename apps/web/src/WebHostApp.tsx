import { ProductClient } from "@proliferate/product-client/ProductClient";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { useEffect, useRef, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthCallbackRoute } from "./browser/auth/AuthCallbackRoute";
import { AuthErrorRoute } from "./browser/auth/AuthErrorRoute";
import { SsoLoginEntryRoute } from "./browser/auth/SsoLoginEntryRoute";
import { WebCloudRoot } from "./browser/cloud/WebCloudRoot";
import { BillingReturnRoute } from "./browser/links/BillingReturnRoute";
import { IntegrationConnectCompleteRoute } from "./browser/links/IntegrationConnectCompleteRoute";
import { OrganizationJoinRoute } from "./browser/links/OrganizationJoinRoute";
import {
  decodeWebGithubAppHomeSource,
  decodeWebGithubAppSettingsReturn,
  emitWebInboundEntry,
} from "./browser/links/web-product-links";
import { InstrumentedRoutes } from "./browser/telemetry/web-telemetry";
import { useWebProductHost } from "./web-host";

/**
 * The Web host mount envelope. It wires the browser transport around the
 * compiled shared product:
 *
 *   BrowserRouter
 *     -> WebCloudRoot (QueryClientProvider -> CloudClientProvider -> session)
 *          -> WebProductHostBoundary (ProductHostProvider with the Web host)
 *               -> narrow host callback/return routes
 *               -> ProductClient catch-all (Web's InstrumentedRoutes)
 *
 * ProductClient owns login, the authenticated route tree, pages, stores, and
 * product telemetry events. The host owns only the browser callback/return
 * decoders that terminate browser protocols, sitting beside the ProductClient
 * catch-all rather than forming a second product router.
 */
export function WebHostApp() {
  return (
    <BrowserRouter>
      <WebCloudRoot>
        <WebProductHostBoundary>
          <WebGithubAppReturnBridge />
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackRoute />} />
            <Route path="/auth/error" element={<AuthErrorRoute />} />
            <Route path="/login/:slug" element={<SsoLoginEntryRoute />} />
            <Route path="/join/:orgId" element={<OrganizationJoinRoute />} />
            <Route path="/settings/cloud" element={<BillingReturnRoute />} />
            <Route
              path="/plugins/connect/complete"
              element={<IntegrationConnectCompleteRoute />}
            />
            <Route
              path="/*"
              element={<ProductClient RoutesComponent={InstrumentedRoutes} />}
            />
          </Routes>
        </WebProductHostBoundary>
      </WebCloudRoot>
    </BrowserRouter>
  );
}

/**
 * Builds the one reactive Web ProductHost snapshot and supplies it through
 * ProductHostProvider. Must render inside WebCloudRoot so it can read the
 * browser session and the authenticated viewer.
 */
function WebProductHostBoundary({ children }: { children: ReactNode }) {
  const host = useWebProductHost();
  return <ProductHostProvider host={host}>{children}</ProductHostProvider>;
}

/**
 * A bounded external-return bridge for the GitHub-App return URLs the product
 * itself produces (`/settings/...?source=github_app_*_callback`,
 * `/?source=github_app_*_callback`). It runs once on the cold external return,
 * emits the normalized settings entry so the shared Cloud/GitHub-App queries
 * refresh, and otherwise no-ops — it is not a generic settings router. The home
 * return needs no emit: ProductClient's home renders with the preserved URL and
 * refreshes from it.
 */
function WebGithubAppReturnBridge() {
  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;
    const parsed = new URL(window.location.href);
    const settingsEntry = decodeWebGithubAppSettingsReturn(parsed);
    if (settingsEntry) {
      emitWebInboundEntry(settingsEntry);
      return;
    }
    // Recognized home return: no entry kind to emit; ProductClient's home reads
    // the preserved source from the URL. Kept as a bounded recognition only.
    void decodeWebGithubAppHomeSource(parsed);
  }, []);
  return null;
}
