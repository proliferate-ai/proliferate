// Shared product theme + Tailwind utilities (compiled by @tailwindcss/vite from
// the @source globs in this stylesheet). Without it the transcript's
// `overflow-y-auto` / `flex-1 min-h-0` classes are inert and nothing scrolls.
import "@proliferate/design/product.css";

import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import { createProliferateClient } from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import type { SessionViewState } from "#product/domain/sessions/activity";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import ReactDOM from "react-dom/client";
import { hostStore, scrollPhysicsDriver } from "./scroll-physics-host";

// A cheap real Cloud client (no network at construction), mirroring the
// browser-build fixture. Every host capability below is an inert no-op: this
// fixture proves scroll physics, not product pages or auth policy.
const cloudClient = createProliferateClient({
  baseUrl: "https://scroll-physics-qualification.invalid",
});

const queryClient = new QueryClient({
  // The transcript's file-actions hook subscribes to `useWorkspaces` (react
  // query). There is no server here; disable retries/refetch so an errored
  // query stays quiet and deterministic instead of retrying on a timer.
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
  },
});

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
  cloud: {
    client: cloudClient,
    getSandboxGatewayAccessToken: async () => {
      throw new Error("scroll-physics fixture performs no network I/O");
    },
  },
  storage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  links: {
    openExternal: async () => {},
    buildReturnUrl: () => "https://scroll-physics-qualification.invalid/callback",
    observeInboundEntries: () => () => {},
  },
  clipboard: { writeText: async () => {} },
  telemetry: {
    track: () => {},
    captureException: () => {},
    setUser: () => {},
    setTag: () => {},
    routeChanged: () => {},
    getSupportContext: () => ({ clientReleaseId: "scroll-physics-qualification" }),
    getAnonymousInstallId: async () => "scroll-physics-qualification",
  },
  desktop: null,
};

// Fixed, deterministic geometry. A short viewport guarantees a handful of tall
// turns overflow, so real scrolling happens. The dock reserves composer space
// and feeds a constant non-zero `bottomInsetPx`, exactly the shape the live
// composer inset takes.
const VIEWPORT_HEIGHT_PX = 520;
const VIEWPORT_WIDTH_PX = 760;
const DOCK_HEIGHT_PX = 120;

function ScrollPhysicsFixture() {
  const snapshot = useSyncExternalStore(hostStore.subscribe, hostStore.getSnapshot);
  const sessionViewState: SessionViewState = snapshot.sessionBusy ? "working" : "idle";

  return (
    <div
      data-scroll-physics-root="true"
      style={{
        width: VIEWPORT_WIDTH_PX,
        height: VIEWPORT_HEIGHT_PX,
        display: "flex",
        flexDirection: "column",
        margin: "0 auto",
        overflow: "hidden",
      }}
    >
      {/* The transcript owns the flex-1 scroll region. */}
      <MessageList
        activeSessionId={snapshot.activeSessionId}
        selectedWorkspaceId="workspace-scroll-physics"
        optimisticPrompt={null}
        transcript={snapshot.transcript}
        sessionViewState={sessionViewState}
        hasOlderHistory={snapshot.hasOlderHistory}
        olderHistoryCursor={snapshot.olderHistoryCursor}
        bottomInsetPx={DOCK_HEIGHT_PX}
        nonDisplacingBottomInsetPx={0}
        onLoadOlderHistory={() => scrollPhysicsDriver.prependOlderHistory()}
      />
      {/* Fake dock: reserves composer height, never scrolls. */}
      <div
        data-scroll-physics-dock="true"
        style={{ height: DOCK_HEIGHT_PX, flex: "0 0 auto" }}
      />
    </div>
  );
}

window.__scrollPhysics = scrollPhysicsDriver;

// No StrictMode: its intentional double-mount would run the transcript's
// per-session reset/glue loop twice, which would perturb the very scroll
// physics this fixture measures.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <CloudClientProvider client={cloudClient}>
      <ProductHostProvider host={qualificationHost}>
        {/* Inert AnyHarness runtime + workspace context: the transcript's
            file/workspace hooks require both providers, but this fixture never
            resolves a live runtime connection (`runtimeUrl: null`, and a
            fail-closed fetch), so no network is ever attempted. */}
        <AnyHarnessRuntime
          runtimeUrl={null}
          fetch={async () => {
            throw new Error("scroll-physics fixture performs no network I/O");
          }}
        >
          <AnyHarnessWorkspace
            workspaceId={null}
            resolveConnection={async () => {
              throw new Error("scroll-physics fixture resolves no live connection");
            }}
          >
            <ScrollPhysicsFixture />
          </AnyHarnessWorkspace>
        </AnyHarnessRuntime>
      </ProductHostProvider>
    </CloudClientProvider>
  </QueryClientProvider>,
);
