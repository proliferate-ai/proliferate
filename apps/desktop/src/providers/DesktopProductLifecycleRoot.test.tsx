// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

vi.mock("@proliferate/product-domain/sessions/activity", () => ({
  isSessionSlotBusy: (snapshot: { busy?: boolean } | null) =>
    snapshot?.busy === true,
}));
vi.mock("@/lib/domain/sessions/directory/directory-activity", () => ({
  activitySnapshotFromDirectoryEntry: (entry: unknown) => entry,
  // Also mocked because the session-directory store imports it at module load.
  activityFromTranscript: () => ({}),
}));

import { DesktopProductLifecycleRoot } from "./DesktopProductLifecycleRoot";

type Entries = Record<string, { busy: boolean }>;

function setEntries(entries: Entries) {
  useSessionDirectoryStore.setState({ entriesById: entries as never });
}

function makeBridge(setRunningAgentCount: (count: number) => Promise<void>) {
  return { nativeUi: { setRunningAgentCount } } as unknown as DesktopBridge;
}

function makeHost(desktop: DesktopBridge | null): ProductHost {
  return {
    surface: desktop ? "desktop" : "web",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: { status: "loading" },
      restoreSession: async () => {},
      startLogin: async () => {},
      finishLogin: async () => {},
      cancelLogin: async () => {},
      logout: async () => {},
    },
    cloud: { client: null },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    links: {
      openExternal: async () => {},
      buildReturnUrl: () => "",
      observeInboundEntries: () => () => {},
    },
    clipboard: { writeText: async () => {} },
    telemetry: {
      track: () => {},
      captureException: () => {},
      setUser: () => {},
      setTag: () => {},
      routeChanged: () => {},
      getSupportContext: () => ({ clientReleaseId: "test" }),
    },
    desktop,
  };
}

function renderRoot(host: ProductHost) {
  return render(
    <ProductHostProvider host={host}>
      <DesktopProductLifecycleRoot />
    </ProductHostProvider>,
  );
}

beforeEach(() => {
  setEntries({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DesktopProductLifecycleRoot", () => {
  it("does not export or subscribe when desktop is null", () => {
    const subscribeSpy = vi.spyOn(useSessionDirectoryStore, "subscribe");
    renderRoot(makeHost(null));
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it("exports the initial busy count through the bridge", () => {
    setEntries({ a: { busy: true } });
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    renderRoot(makeHost(makeBridge(setRunningAgentCount)));

    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
    expect(setRunningAgentCount).toHaveBeenCalledWith(1);
  });

  it("exports only changed counts as sessions go busy and idle", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    renderRoot(makeHost(makeBridge(setRunningAgentCount)));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(0);

    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(1);

    // Unchanged busy count: no additional export.
    act(() => setEntries({ a: { busy: true }, b: { busy: false } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(2);

    act(() => setEntries({ a: { busy: false }, b: { busy: false } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(0);
    expect(setRunningAgentCount).toHaveBeenCalledTimes(3);
  });

  it("does not duplicate work when the host is replaced with the same bridge", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const bridge = makeBridge(setRunningAgentCount);
    const { rerender } = renderRoot(makeHost(bridge));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    // A brand-new host snapshot carrying the same stable bridge.
    rerender(
      <ProductHostProvider host={makeHost(bridge)}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    // The single subscription is still live.
    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(2);
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(1);
  });

  it("cleans up the subscription when the bridge is removed", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderRoot(makeHost(makeBridge(setRunningAgentCount)));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    rerender(
      <ProductHostProvider host={makeHost(null)}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );

    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
  });

  it("cleans up the subscription on unmount", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderRoot(makeHost(makeBridge(setRunningAgentCount)));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    unmount();
    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
  });
});
