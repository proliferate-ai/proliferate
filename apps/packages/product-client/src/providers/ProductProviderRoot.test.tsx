// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeProps: [] as Array<{ runtimeUrl: string | null }>,
  resolveConnection: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  AnyHarnessRuntime: ({
    children,
    runtimeUrl,
  }: {
    children: ReactNode;
    runtimeUrl: string | null;
  }) => {
    mocks.runtimeProps.push({ runtimeUrl });
    return children;
  },
  AnyHarnessWorkspace: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: null,
    cloud: { client: null },
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: { state: { status: "anonymous", methods: [] } },
  }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

vi.mock("#product/hooks/workspaces/cache/use-resolve-workspace-connection", () => ({
  useResolveWorkspaceConnection: () => mocks.resolveConnection,
}));

vi.mock("#product/hooks/workspaces/cache/use-cloud-workspace-materialization-cache-boundary", () => ({
  useCloudWorkspaceMaterializationCacheBoundary: () => {},
}));

vi.mock("#product/providers/TelemetryProvider", () => ({
  TelemetryProvider: ({ children }: { children: ReactNode }) => children,
}));

import { ProductProviderRoot } from "#product/providers/ProductProviderRoot";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

beforeEach(() => {
  mocks.runtimeProps.length = 0;
  useHarnessConnectionStore.setState({
    runtimeUrl: "http://127.0.0.1:9001",
    connectionState: "connecting",
    error: null,
  });
  useSessionSelectionStore.setState({
    selectedWorkspaceId: null,
    selectedLogicalWorkspaceId: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("ProductProviderRoot", () => {
  it("publishes the local runtime to runtime-level SDK queries only while it is healthy", () => {
    render(
      <ProductProviderRoot>
        <div />
      </ProductProviderRoot>,
    );

    expect(mocks.runtimeProps.at(-1)?.runtimeUrl).toBeNull();

    act(() => {
      useHarnessConnectionStore.setState({ connectionState: "healthy" });
    });
    expect(mocks.runtimeProps.at(-1)?.runtimeUrl).toBe("http://127.0.0.1:9001");

    act(() => {
      useHarnessConnectionStore.setState({ connectionState: "failed" });
    });
    expect(mocks.runtimeProps.at(-1)?.runtimeUrl).toBeNull();
  });
});
