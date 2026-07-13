// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { DesktopBridge } from "./desktop-bridge";
import type { ProductHost } from "./product-host";
import { ProductHostProvider, useProductHost } from "./ProductHostProvider";

function makeHost(overrides: Partial<ProductHost> = {}): ProductHost {
  return {
    surface: "web",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      state: { status: "loading" },
      restoreSession: async () => {},
      startLogin: async () => {},
      finishLogin: async () => {},
      logout: async () => {},
    },
    cloud: { client: null },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    links: { openExternal: async () => {} },
    clipboard: { writeText: async () => {} },
    telemetry: {
      track: () => {},
      captureException: () => {},
      setUser: () => {},
    },
    desktop: null,
    ...overrides,
  };
}

function wrapperFor(host: ProductHost) {
  return ({ children }: { children: ReactNode }) => (
    <ProductHostProvider host={host}>{children}</ProductHostProvider>
  );
}

describe("ProductHostProvider", () => {
  it("gives a consumer the supplied host", () => {
    const host = makeHost();
    const { result } = renderHook(() => useProductHost(), {
      wrapper: wrapperFor(host),
    });
    expect(result.current.surface).toBe("web");
    expect(result.current.deployment.apiBaseUrl).toBe("https://api.example.test");
  });

  it("preserves object identity — no clone or reconstruction", () => {
    const host = makeHost();
    const { result } = renderHook(() => useProductHost(), {
      wrapper: wrapperFor(host),
    });
    expect(result.current).toBe(host);
    expect(result.current.auth).toBe(host.auth);
    expect(result.current.cloud).toBe(host.cloud);
  });

  it("works with desktop: null", () => {
    const host = makeHost({ surface: "web", desktop: null });
    const { result } = renderHook(() => useProductHost(), {
      wrapper: wrapperFor(host),
    });
    expect(result.current.desktop).toBeNull();
  });

  it("works with a supplied DesktopBridge", () => {
    const desktop = {} as DesktopBridge;
    const host = makeHost({ surface: "desktop", desktop });
    const { result } = renderHook(() => useProductHost(), {
      wrapper: wrapperFor(host),
    });
    expect(result.current.surface).toBe("desktop");
    expect(result.current.desktop).toBe(desktop);
  });

  it("throws a useful error when used outside the provider", () => {
    expect(() => renderHook(() => useProductHost())).toThrow(
      /must be used within a ProductHostProvider/,
    );
  });
});
