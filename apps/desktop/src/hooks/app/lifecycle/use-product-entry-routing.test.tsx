// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProductEntry,
  ProductHost,
} from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { decodeDesktopProductEntry } from "@/lib/domain/auth/desktop-navigation";
import { useProductEntryRouting } from "@/hooks/app/lifecycle/use-product-entry-routing";
import { makeTestProductHost } from "@/test/product-host-fixtures";

// A toggle the mocked useNavigate reads at call time so one test can force the
// router navigate to throw while every other test keeps the real navigate.
const routerControl = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return ((...args: Parameters<typeof navigate>) => {
        if (routerControl.shouldThrow) {
          throw new Error("navigation boom");
        }
        return navigate(...args);
      }) as typeof navigate;
    },
  };
});

type Listener = (entry: ProductEntry) => void;

interface LinkHarness {
  host: ProductHost;
  emit: (entry: ProductEntry) => void;
  subscriberCount: () => number;
  unsubscribeCount: () => number;
  captureException: ReturnType<typeof vi.fn>;
}

/**
 * A controllable ProductHost whose `observeInboundEntries` records
 * subscribe/unsubscribe and lets the test push entries. `initial`, when
 * supplied, is delivered synchronously at subscription time to model the deep
 * link the process launched with.
 */
function createLinkHarness(options: { initial?: ProductEntry } = {}): LinkHarness {
  const listeners = new Set<Listener>();
  let unsubscribeCount = 0;
  const captureException = vi.fn();

  const observeInboundEntries = (listener: Listener) => {
    listeners.add(listener);
    if (options.initial) {
      listener(options.initial);
    }
    return () => {
      unsubscribeCount += 1;
      listeners.delete(listener);
    };
  };

  const host = makeTestProductHost({
    overrides: {
      links: {
        openExternal: async () => {},
        buildReturnUrl: () => "",
        observeInboundEntries,
      },
      telemetry: {
        track: () => {},
        captureException,
        setUser: () => {},
        setTag: () => {},
        routeChanged: () => {},
        getSupportContext: () => ({ clientReleaseId: "desktop@test" }),
      },
    },
  });

  return {
    host,
    emit: (entry) => {
      for (const listener of [...listeners]) {
        listener(entry);
      }
    },
    subscriberCount: () => listeners.size,
    unsubscribeCount: () => unsubscribeCount,
    captureException,
  };
}

function renderRouting(harness: LinkHarness) {
  let currentLocation = "";
  function Probe() {
    useProductEntryRouting();
    const location = useLocation();
    currentLocation = `${location.pathname}${location.search}${location.hash}`;
    return null;
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/"]}>
        <ProductHostProvider host={harness.host}>{children}</ProductHostProvider>
      </MemoryRouter>
    );
  }
  const utils = render(
    <Wrapper>
      <Probe />
    </Wrapper>,
  );
  return { ...utils, location: () => currentLocation };
}

afterEach(() => {
  routerControl.shouldThrow = false;
  cleanup();
});

describe("useProductEntryRouting", () => {
  it("navigates on the initial inbound entry delivered at subscription time", () => {
    const harness = createLinkHarness({
      initial: { kind: "workspace", workspaceId: "ws-1" },
    });

    const { location } = renderRouting(harness);

    expect(location()).toBe("/workspaces/ws-1");
    expect(harness.subscriberCount()).toBe(1);
  });

  it("navigates on a live inbound entry that arrives after subscription", () => {
    const harness = createLinkHarness();

    const { location } = renderRouting(harness);
    expect(location()).toBe("/");

    act(() => {
      harness.emit({ kind: "organization-join", organizationId: "org-9" });
    });

    expect(location()).toBe("/settings?section=account&joinOrganizationId=org-9");
  });

  it("preserves duplicate query keys and the fragment through the mapped route", () => {
    const harness = createLinkHarness();
    const { location } = renderRouting(harness);

    act(() => {
      harness.emit({
        kind: "workspace",
        workspaceId: "ws-1",
        query: [
          ["x", "1"],
          ["x", "2"],
        ],
        fragment: "thread-42",
      });
    });

    expect(location()).toBe("/workspaces/ws-1?x=1&x=2#thread-42");
  });

  it("unsubscribes on unmount and drops any later delivery", () => {
    const harness = createLinkHarness();
    const { unmount, location } = renderRouting(harness);

    unmount();
    expect(harness.unsubscribeCount()).toBe(1);
    expect(harness.subscriberCount()).toBe(0);

    // A delivery after unmount reaches no listener, so nothing navigates.
    act(() => {
      harness.emit({ kind: "workspace", workspaceId: "ws-late" });
    });
    expect(location()).not.toContain("ws-late");
  });

  it("reports a navigation failure through host telemetry without retrying", () => {
    const harness = createLinkHarness();
    const { location } = renderRouting(harness);

    routerControl.shouldThrow = true;
    act(() => {
      harness.emit({ kind: "workspace", workspaceId: "ws-1" });
    });

    // The navigate threw, was caught, reported once, and never retried or queued.
    expect(location()).toBe("/");
    expect(harness.captureException).toHaveBeenCalledTimes(1);
    expect(harness.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ action: "product_entry_routing" }),
      }),
    );
  });

  it("never delivers auth-callback URLs to routing (they decode to null)", () => {
    // Auth callbacks are consumed by the auth transport; the decoder that feeds
    // observeInboundEntries returns null for them, so they never reach routing.
    expect(
      decodeDesktopProductEntry("proliferate://auth/callback?code=abc&state=xyz"),
    ).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://auth?code=abc")).toBeNull();
  });
});
