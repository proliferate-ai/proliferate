// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { useProductAuthActions } from "./use-product-auth-actions";

function makeHost(overrides?: Partial<ProductHost["auth"]>): ProductHost {
  return {
    surface: "desktop",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: { status: "anonymous", methods: ["password", "github"] },
      restoreSession: vi.fn(async () => {}),
      startLogin: vi.fn(async () => ({
        provider: "github" as const,
        source: "desktop_callback" as const,
      })),
      finishLogin: vi.fn(async () => {}),
      cancelLogin: vi.fn(async () => {}),
      logout: vi.fn(async () => ({ provider: "github" as const })),
      ...overrides,
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
      track: vi.fn(),
      captureException: vi.fn(),
      setUser: vi.fn(),
      setTag: vi.fn(),
      routeChanged: vi.fn(),
      getSupportContext: () => ({ clientReleaseId: "test" }),
    },
    desktop: null,
  };
}

function wrapperFor(host: ProductHost) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ProductHostProvider host={host}>{children}</ProductHostProvider>;
  };
}

describe("useProductAuthActions", () => {
  it("emits the exact normalized sign-in result after transport success", async () => {
    const host = makeHost();
    const rendered = renderHook(() => useProductAuthActions(), {
      wrapper: wrapperFor(host),
    });

    await act(() => rendered.result.current.startLogin({ kind: "github" }));

    expect(host.auth.startLogin).toHaveBeenCalledWith({ kind: "github" });
    expect(host.telemetry.track).toHaveBeenCalledWith({
      name: "auth_signed_in",
      properties: {
        provider: "github",
        source: "desktop_callback",
      },
    });
  });

  it("captures and emits a typed failure once before rethrowing", async () => {
    const error = new Error("nope");
    const host = makeHost({
      startLogin: vi.fn(async () => {
        throw error;
      }),
    });
    const rendered = renderHook(() => useProductAuthActions(), {
      wrapper: wrapperFor(host),
    });

    await expect(act(() => rendered.result.current.startLogin({
      kind: "google",
      purpose: "link",
    }))).rejects.toBe(error);

    expect(host.telemetry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: "link_provider",
        domain: "auth",
        provider: "google",
      },
    });
    expect(host.telemetry.track).toHaveBeenCalledWith({
      name: "auth_sign_in_failed",
      properties: {
        failure_kind: "unknown_error",
        provider: "google",
      },
    });
  });

  it("emits sign-out only after transport success", async () => {
    const host = makeHost();
    const rendered = renderHook(() => useProductAuthActions(), {
      wrapper: wrapperFor(host),
    });

    await act(() => rendered.result.current.logout());

    expect(host.telemetry.track).toHaveBeenCalledWith({
      name: "auth_signed_out",
      properties: { provider: "github" },
    });
  });
});
