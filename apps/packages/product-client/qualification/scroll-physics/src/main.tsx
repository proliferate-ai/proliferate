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

function ScrollPhysicsFixture() {
  const snapshot = useSyncExternalStore(hostStore.subscribe, hostStore.getSnapshot);
  const sessionViewState: SessionViewState = snapshot.sessionBusy ? "working" : "idle";
  // Rung 7 (Q6): the dock inset model split, driven by the host. bottomInsetPx
  // is the TOTAL inset (resolveTranscriptBottomInsets splits it back into
  // structural + non-displacing); the fake dock's own height tracks the
  // structural inset so the transcript's client height changes exactly as it
  // does when the real composer grows/collapses.
  const structuralInsetPx = snapshot.structuralInsetPx;
  const nonDisplacingInsetPx = snapshot.nonDisplacingInsetPx;
  const totalBottomInsetPx = structuralInsetPx + nonDisplacingInsetPx;

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
        bottomInsetPx={totalBottomInsetPx}
        nonDisplacingBottomInsetPx={nonDisplacingInsetPx}
        onLoadOlderHistory={() => scrollPhysicsDriver.prependOlderHistory()}
      />
      {/* Fake dock: reserves composer height, never scrolls. Its height tracks
          the structural inset so a composer grow/collapse changes the
          transcript's client height, as it does in the real app. */}
      <div
        data-scroll-physics-dock="true"
        style={{ height: structuralInsetPx, flex: "0 0 auto" }}
      />
    </div>
  );
}

window.__scrollPhysics = scrollPhysicsDriver;

// TEMPORARY DIAGNOSTIC (remove before merge): intercept every programmatic
// scrollTop write and every scroll event on the transcript viewport and log
// them to the console (harvested from the Playwright trace on failure), so a
// hosted-only failure shows whether writes execute, what they read back, and
// how the native scroll interleaves.
{
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return (desc.get as () => number).call(this);
    },
    set(this: Element, value: number) {
      const isViewport = (this as HTMLElement).dataset?.transcriptVirtualizationMode !== undefined
        || (this as HTMLElement).querySelector?.("[data-transcript-virtualization-mode]") != null;
      (desc.set as (v: number) => void).call(this, value);
      if (isViewport) {
        const back = (desc.get as () => number).call(this);
        console.log(`[diag] write t=${performance.now().toFixed(1)} want=${value} got=${back} sh=${this.scrollHeight}`);
      }
    },
  });
  void proto;
  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target as HTMLElement;
      if (el?.querySelector?.("[data-transcript-virtualization-mode]") == null) {
        return;
      }
      console.log(`[diag] scroll t=${performance.now().toFixed(1)} top=${(desc.get as () => number).call(el)} sh=${el.scrollHeight}`);
    },
    { capture: true, passive: true },
  );
}

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
