// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProductEntry,
  ProductLinks,
} from "@proliferate/product-client/host/product-host";
import { useProductEntryRouting } from "./use-product-entry-routing";

const hostState = vi.hoisted(() => ({
  links: null as ProductLinks | null,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ links: hostState.links }),
}));

interface LinksHarness {
  links: ProductLinks;
  emit(entry: ProductEntry): void;
  observe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

describe("useProductEntryRouting", () => {
  beforeEach(() => {
    hostState.links = createLinksHarness().links;
  });

  afterEach(() => {
    cleanup();
  });

  it("routes the initial snapshot and subsequent live entries", async () => {
    const links = createLinksHarness({
      kind: "organization-join",
      organizationId: "org-1",
    });
    hostState.links = links.links;

    const { result } = renderHook(() => useRoutingLocation(), {
      wrapper: TestRouter,
    });

    await waitFor(() => {
      expect(result.current).toBe(
        "/settings?section=account&joinOrganizationId=org-1",
      );
    });

    act(() => {
      links.emit({
        kind: "workspace",
        workspaceId: "ws-1",
        query: [["session", "one"], ["session", "two"]],
        fragment: "chat",
      });
    });
    await waitFor(() => {
      expect(result.current).toBe(
        "/workspaces/ws-1?session=one&session=two#chat",
      );
    });
    expect(links.observe).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes the replaced host links before using the replacement", async () => {
    const first = createLinksHarness();
    const second = createLinksHarness();
    hostState.links = first.links;

    const { result, rerender } = renderHook(() => useRoutingLocation(), {
      wrapper: TestRouter,
    });

    hostState.links = second.links;
    rerender();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(first.observe).toHaveBeenCalledTimes(1);
    expect(second.observe).toHaveBeenCalledTimes(1);

    act(() => {
      first.emit({ kind: "workspace", workspaceId: "stale" });
      second.emit({ kind: "workflow", workflowId: "current" });
    });

    await waitFor(() => {
      expect(result.current).toBe("/workflows/current");
    });
  });

  it("unsubscribes on unmount and does not route unsupported invitations", () => {
    const links = createLinksHarness();
    hostState.links = links.links;
    const { result, unmount } = renderHook(() => useRoutingLocation(), {
      wrapper: TestRouter,
    });

    act(() => {
      links.emit({ kind: "invitation", token: "parked" });
    });
    expect(result.current).toBe("/");

    unmount();
    expect(links.unsubscribe).toHaveBeenCalledTimes(1);
    act(() => {
      links.emit({ kind: "workspace", workspaceId: "after-unmount" });
    });
  });
});

function useRoutingLocation(): string {
  useProductEntryRouting();
  const location = useLocation();
  return `${location.pathname}${location.search}${location.hash}`;
}

function TestRouter({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>;
}

function createLinksHarness(initial?: ProductEntry): LinksHarness {
  let active = false;
  let listener: ((entry: ProductEntry) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    active = false;
  });
  const observe = vi.fn((nextListener: (entry: ProductEntry) => void) => {
    active = true;
    listener = nextListener;
    if (initial) {
      nextListener(initial);
    }
    return unsubscribe;
  });
  const links: ProductLinks = {
    openExternal: vi.fn(),
    buildReturnUrl: vi.fn(() => "proliferate://"),
    observeInboundEntries: observe,
  };

  return {
    links,
    observe,
    unsubscribe,
    emit(entry) {
      if (active) {
        listener?.(entry);
      }
    },
  };
}
