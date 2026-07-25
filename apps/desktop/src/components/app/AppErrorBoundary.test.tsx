// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { AppErrorBoundary } from "./AppErrorBoundary";

const telemetry = {
  track: vi.fn(),
  captureException: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  routeChanged: vi.fn(),
  getSupportContext: vi.fn(() => ({ clientReleaseId: "test" })),
};

function makeHost(desktop: DesktopBridge | null): ProductHost {
  return {
    surface: desktop === null ? "web" : "desktop",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: { status: "anonymous", methods: [] },
      restoreSession: async () => {},
      startLogin: async () => ({ provider: "github", source: "desktop_callback" }),
      finishLogin: async () => {},
      cancelLogin: async () => {},
      logout: async () => ({ provider: "github" }),
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
    telemetry,
    desktop,
  };
}

function renderBoundary(host: ProductHost, child: ReactNode) {
  return render(
    <StrictMode>
      <ProductHostProvider host={host}>
        <AppErrorBoundary>{child}</AppErrorBoundary>
      </ProductHostProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("reports once through Desktop diagnostics and preserves fallback reset", () => {
    const reportReactRenderError = vi.fn();
    const desktop = {
      diagnostics: { reportReactRenderError },
    } as unknown as DesktopBridge;
    const error = new Error("desktop render failed");
    let shouldThrow = true;
    function FlakyProduct() {
      if (shouldThrow) throw error;
      return <div>Recovered product</div>;
    }

    renderBoundary(makeHost(desktop), <FlakyProduct />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(reportReactRenderError).toHaveBeenCalledTimes(1);
    expect(reportReactRenderError).toHaveBeenCalledWith(
      error,
      expect.any(String),
    );
    expect(telemetry.captureException).not.toHaveBeenCalled();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered product")).toBeTruthy();
  });

  it("reports once through host telemetry when desktop is null", () => {
    const error = new Error("web render failed");
    function BrokenProduct(): never {
      throw error;
    }

    renderBoundary(makeHost(null), <BrokenProduct />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(telemetry.captureException).toHaveBeenCalledTimes(1);
    expect(telemetry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: "react_render",
        domain: "app",
      },
      extras: {
        componentStack: expect.any(String),
      },
    });
  });
});
