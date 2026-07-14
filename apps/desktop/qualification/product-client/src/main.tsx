import { createProliferateClient } from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { ProductClientBuildCanary } from "@proliferate/product-client/qualification/ProductClientBuildCanary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

// QUALIFICATION-ONLY Desktop build canary entry. It is NOT a Tauri app and does
// not boot the Desktop product. Its only job is to prove that the Desktop Vite
// toolchain compiles and ships the ProductClient build canary through the exact
// package/export/`#product/*` resolution the future ProductClient entry will
// use — including its lazy authenticated split, generated inputs, `?raw` text,
// image/audio/svg assets, fonts, and shared product CSS.
//
// It mounts the canary inside the SHAPE of the Desktop host provider envelope
// (BrowserRouter > QueryClientProvider > CloudClientProvider > ProductHostProvider)
// but with a minimal typed host: `desktop: null` (no native bridge is available
// or needed to qualify the build). This is a build fixture, not the product.

// A cheap real Cloud client. `createProliferateClient` builds an openapi-fetch
// client with middleware and performs no network I/O at construction, so it is
// safe to construct here rather than stubbing the provider.
const cloudClient = createProliferateClient({
  baseUrl: "https://product-client-qualification.invalid",
});

const queryClient = new QueryClient();

// A minimal typed ProductHost. Every capability is an inert no-op — the canary
// exercises the build graph, not host behavior. `desktop: null` is deliberate.
const qualificationHost: ProductHost = {
  surface: "desktop",
  deployment: { apiBaseUrl: cloudClient.baseUrl },
  auth: {
    authRequired: true,
    state: { status: "loading" },
    restoreSession: async () => {},
    startLogin: async () => ({ provider: "github", source: "qualification" }),
    finishLogin: async () => {},
    cancelLogin: async () => {},
    logout: async () => ({ provider: "github" }),
  },
  cloud: { client: cloudClient },
  storage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  links: {
    openExternal: async () => {},
    buildReturnUrl: () => "https://product-client-qualification.invalid/callback",
    observeInboundEntries: () => () => {},
  },
  clipboard: { writeText: async () => {} },
  telemetry: {
    track: () => {},
    captureException: () => {},
    setUser: () => {},
    setTag: () => {},
    routeChanged: () => {},
    getSupportContext: () => ({ clientReleaseId: "desktop-qualification" }),
  },
  desktop: null,
};

// Plain React Router `Routes` — the qualification host passes this as the
// `RoutesComponent` prop. Desktop/Web pass their Sentry-instrumented
// InstrumentedRoutes in production; ProductClient never imports Sentry.
function QualificationRoutes() {
  return (
    <Routes>
      <Route
        path="*"
        element={<div data-testid="desktop-qualification-route" />}
      />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <CloudClientProvider client={cloudClient}>
          <ProductHostProvider host={qualificationHost}>
            <ProductClientBuildCanary RoutesComponent={QualificationRoutes} />
          </ProductHostProvider>
        </CloudClientProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
