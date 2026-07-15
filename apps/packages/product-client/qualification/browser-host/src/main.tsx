import { createProliferateClient } from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { ProductClientBuildCanary } from "@proliferate/product-client/qualification/ProductClientBuildCanary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

// QUALIFICATION-ONLY minimal browser host. It proves the host/package contract
// only — it is NOT a second Web product and does not implement product pages or
// auth policy. It builds through a production Vite build to prove that a
// browser host with NO native bridge (`desktop: null`, `surface: "web"`) can
// compile and ship the ProductClient build canary, its lazy authenticated
// split, and every representative resource shape (generated JSON, `?raw` text,
// image, audio, svg, font, and shared product CSS) via the package export.
//
// The canary is imported through the package's public export map exactly as an
// external consumer would; the compiled canary resolves its authenticated root
// and assets through the package-private `#product/*` -> dist mechanism.

// A cheap real Cloud client. `createProliferateClient` builds an openapi-fetch
// client with middleware and performs no network I/O at construction, so the
// real constructor is used rather than a stub.
const cloudClient = createProliferateClient({
  baseUrl: "https://product-client-qualification.invalid",
});

const queryClient = new QueryClient();

// A minimal typed ProductHost for a non-native browser host. Every capability
// is an inert no-op; `desktop: null` is the load-bearing assertion — any
// local/native lifecycle must fail closed by not mounting.
const qualificationHost: ProductHost = {
  surface: "web",
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
    getSupportContext: () => ({ clientReleaseId: "browser-qualification" }),
  },
  desktop: null,
};

// Plain React Router `Routes` — the browser qualification host passes plain
// Routes as the `RoutesComponent`. ProductClient imports no Sentry.
function QualificationRoutes() {
  return (
    <Routes>
      <Route
        path="*"
        element={<div data-testid="browser-qualification-route" />}
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
