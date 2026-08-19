// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeProps: [] as Array<{ runtimeUrl: string | null }>,
  resolveConnection: vi.fn(),
  workspaceProps: [] as Array<{
    workspaceId: string | null;
    resolveConnection: (workspaceId: string) => Promise<unknown>;
  }>,
  workspacePathProviderMounts: 0,
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
  AnyHarnessWorkspace: ({
    children,
    workspaceId,
    resolveConnection,
  }: {
    children: ReactNode;
    workspaceId: string | null;
    resolveConnection: (workspaceId: string) => Promise<unknown>;
  }) => {
    mocks.workspaceProps.push({ workspaceId, resolveConnection });
    return <div data-testid="anyharness-workspace">{children}</div>;
  },
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

vi.mock("#product/providers/WorkspacePathProvider", () => ({
  WorkspacePathProvider: ({ children }: { children: ReactNode }) => {
    mocks.workspacePathProviderMounts += 1;
    return <div data-testid="workspace-path-provider">{children}</div>;
  },
}));

import { ProductProviderRoot } from "#product/providers/ProductProviderRoot";
import {
  useProductWorkspaceConnectionResolver,
  type ProductWorkspaceConnectionResolver,
} from "#product/providers/ProductWorkspaceConnectionProvider";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

let observedProductResolver: ProductWorkspaceConnectionResolver | null = null;

function ProductConnectionProbe() {
  observedProductResolver = useProductWorkspaceConnectionResolver();
  return <div data-testid="product-child" />;
}

beforeEach(() => {
  mocks.runtimeProps.length = 0;
  mocks.workspaceProps.length = 0;
  mocks.workspacePathProviderMounts = 0;
  mocks.resolveConnection.mockReset();
  observedProductResolver = null;
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

    expect(mocks.runtimeProps[mocks.runtimeProps.length - 1]?.runtimeUrl).toBeNull();

    act(() => {
      useHarnessConnectionStore.setState({ connectionState: "healthy" });
    });
    expect(mocks.runtimeProps[mocks.runtimeProps.length - 1]?.runtimeUrl)
      .toBe("http://127.0.0.1:9001");

    act(() => {
      useHarnessConnectionStore.setState({ connectionState: "failed" });
    });
    expect(mocks.runtimeProps[mocks.runtimeProps.length - 1]?.runtimeUrl).toBeNull();
  });

  it("mounts one path provider inside the SDK workspace and narrows only the SDK adapter", async () => {
    const productEnvelope = {
      connection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "runtime-workspace",
        runtimeGeneration: 5,
        runtimeAccessKind: "direct",
      },
      filesystemOrigin: "desktop-local",
    };
    mocks.resolveConnection.mockResolvedValue(productEnvelope);
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-materialized",
      selectedLogicalWorkspaceId: "logical:workspace",
    });

    render(
      <ProductProviderRoot>
        <ProductConnectionProbe />
      </ProductProviderRoot>,
    );

    const sdkWorkspace = screen.getByTestId("anyharness-workspace");
    const pathProvider = screen.getByTestId("workspace-path-provider");
    expect(sdkWorkspace.contains(pathProvider)).toBe(true);
    expect(pathProvider.contains(screen.getByTestId("product-child"))).toBe(true);
    expect(mocks.workspacePathProviderMounts).toBe(1);
    expect(mocks.workspaceProps.at(-1)?.workspaceId).toBe("logical:workspace");

    await expect(mocks.workspaceProps.at(-1)?.resolveConnection("workspace-materialized"))
      .resolves.toEqual(productEnvelope.connection);
    await expect(observedProductResolver?.("workspace-materialized"))
      .resolves.toEqual(productEnvelope);
    expect(mocks.resolveConnection).toHaveBeenCalledWith("workspace-materialized");
  });
});
