// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sentinels = vi.hoisted(() => ({
  appQueryClient: { __brand: "app-query-client" } as unknown,
  cloudClient: { __brand: "cloud-client" } as unknown,
}));

const captured = vi.hoisted(() => ({
  getProliferateClientCalls: 0,
  queryClientProviderClient: undefined as unknown,
  cloudClientProviderClient: undefined as unknown,
  hostProviderCloudClient: undefined as unknown,
}));

vi.mock("@/providers/app-query-client", () => ({
  appQueryClient: sentinels.appQueryClient,
}));

vi.mock("@/lib/access/cloud/client", () => ({
  getProliferateClient: () => {
    captured.getProliferateClientCalls += 1;
    return sentinels.cloudClient;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClientProvider: ({ client, children }: { client: unknown; children: ReactNode }) => {
    captured.queryClientProviderClient = client;
    return <>{children}</>;
  },
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  CloudClientProvider: ({ client, children }: { client: unknown; children: ReactNode }) => {
    captured.cloudClientProviderClient = client;
    return <>{children}</>;
  },
}));

vi.mock("./DesktopProductHostProvider", () => ({
  DesktopProductHostProvider: ({
    cloudClient,
    children,
  }: {
    cloudClient: unknown;
    children: ReactNode;
  }) => {
    captured.hostProviderCloudClient = cloudClient;
    return <>{children}</>;
  },
}));

import { DesktopHostProviders } from "./DesktopHostProviders";

afterEach(() => {
  cleanup();
});

describe("DesktopHostProviders", () => {
  it("wires the one Query client and one Cloud client into the host tree", () => {
    render(
      <DesktopHostProviders>
        <div data-testid="child">child</div>
      </DesktopHostProviders>,
    );

    // Product tree renders beneath the host envelope.
    expect(screen.getByTestId("child")).toBeTruthy();

    // Exactly one Cloud client is constructed and shared.
    expect(captured.getProliferateClientCalls).toBe(1);

    // The one appQueryClient singleton reaches the react-query provider.
    expect(captured.queryClientProviderClient).toBe(sentinels.appQueryClient);

    // The same cloudClient instance flows to both the Cloud provider and the
    // ProductHost constructor — no second instance is built.
    expect(captured.cloudClientProviderClient).toBe(sentinels.cloudClient);
    expect(captured.hostProviderCloudClient).toBe(sentinels.cloudClient);
    expect(captured.hostProviderCloudClient).toBe(captured.cloudClientProviderClient);
  });
});
