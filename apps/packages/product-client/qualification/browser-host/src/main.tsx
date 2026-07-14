import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { ProductClientBuildCanary } from "@proliferate/product-client/qualification/ProductClientBuildCanary";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes } from "react-router-dom";
import "@proliferate/design/product.css";

const queryClient = new QueryClient();

const host: ProductHost = {
  surface: "web",
  deployment: { apiBaseUrl: "https://app.test" },
  auth: {
    authRequired: true,
    state: { status: "loading" },
    restoreSession: async () => {},
    startLogin: async () => ({ provider: "password", source: "password_form" }),
    finishLogin: async () => {},
    cancelLogin: async () => {},
    logout: async () => ({ provider: "password" }),
  },
  cloud: { client: null },
  storage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  links: {
    openExternal: async () => {},
    buildReturnUrl: () => "https://app.test",
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <CloudClientProvider client={host.cloud.client}>
        <ProductHostProvider host={host}>
          <BrowserRouter>
            <ProductClientBuildCanary RoutesComponent={Routes} />
          </BrowserRouter>
        </ProductHostProvider>
      </CloudClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
