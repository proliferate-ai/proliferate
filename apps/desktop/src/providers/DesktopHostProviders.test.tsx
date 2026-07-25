// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => {
  const cloudClient = { kind: "desktop-cloud-client" };
  const captureException = vi.fn();
  return {
    captureException,
    cloudClient,
    constructedQueryClients: [] as Array<{
      captureException: unknown;
      client: object;
    }>,
    queryProviderClients: [] as unknown[],
    cloudProviderClients: [] as unknown[],
    productHostCloudClients: [] as unknown[],
  };
});

vi.mock("@/lib/access/cloud/client", () => ({
  getProliferateClient: vi.fn(() => providerState.cloudClient),
}));

vi.mock("@/lib/infra/query/query-client", () => ({
  createAppQueryClient: vi.fn((captureException: unknown) => {
    const client = { kind: "desktop-query-client" };
    providerState.constructedQueryClients.push({ captureException, client });
    return client;
  }),
}));

vi.mock("./desktop-product-host", () => ({
  desktopTelemetry: {
    captureException: providerState.captureException,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClientProvider: ({
    children,
    client,
  }: {
    children: ReactNode;
    client: unknown;
  }) => {
    providerState.queryProviderClients.push(client);
    return children;
  },
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  CloudClientProvider: ({
    children,
    client,
  }: {
    children: ReactNode;
    client: unknown;
  }) => {
    providerState.cloudProviderClients.push(client);
    return children;
  },
}));

vi.mock("./DesktopProductHostProvider", () => ({
  DesktopProductHostProvider: ({
    children,
    cloudClient,
  }: {
    children: ReactNode;
    cloudClient: unknown;
  }) => {
    providerState.productHostCloudClients.push(cloudClient);
    return children;
  },
}));

import { DesktopHostProviders } from "./DesktopHostProviders";

afterEach(() => {
  cleanup();
  providerState.queryProviderClients.length = 0;
  providerState.cloudProviderClients.length = 0;
  providerState.productHostCloudClients.length = 0;
});

describe("DesktopHostProviders", () => {
  it("constructs one module-stable Query client with the Desktop telemetry adapter", () => {
    expect(providerState.constructedQueryClients).toHaveLength(1);
    expect(providerState.constructedQueryClients[0]?.captureException).toBe(
      providerState.captureException,
    );

    const first = render(
      <StrictMode>
        <DesktopHostProviders>
          <div>first product</div>
        </DesktopHostProviders>
      </StrictMode>,
    );
    expect(screen.getByText("first product")).toBeTruthy();

    const queryClient = providerState.constructedQueryClients[0]?.client;
    expect(providerState.queryProviderClients.length).toBeGreaterThan(0);
    expect(
      providerState.queryProviderClients.every((client) => client === queryClient),
    ).toBe(true);
    expect(providerState.constructedQueryClients).toHaveLength(1);

    first.unmount();
    render(
      <StrictMode>
        <DesktopHostProviders>
          <div>remounted product</div>
        </DesktopHostProviders>
      </StrictMode>,
    );

    expect(screen.getByText("remounted product")).toBeTruthy();
    expect(providerState.constructedQueryClients).toHaveLength(1);
    expect(
      providerState.queryProviderClients.every((client) => client === queryClient),
    ).toBe(true);
  });

  it("passes the exact same Cloud client to both provider boundaries", () => {
    render(
      <StrictMode>
        <DesktopHostProviders>
          <div>product</div>
        </DesktopHostProviders>
      </StrictMode>,
    );

    expect(providerState.cloudProviderClients.length).toBeGreaterThan(0);
    expect(providerState.productHostCloudClients.length).toBeGreaterThan(0);
    expect(
      providerState.cloudProviderClients.every(
        (client) => client === providerState.cloudClient,
      ),
    ).toBe(true);
    expect(
      providerState.productHostCloudClients.every(
        (client) => client === providerState.cloudClient,
      ),
    ).toBe(true);
  });
});
