// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchServerMeta: vi.fn(),
  getVersion: vi.fn(async () => "0.4.0"),
  resetDeployment: vi.fn(async () => {}),
  switchDeployment: vi.fn(async () => {}),
}));

const hostState = vi.hoisted(() => ({
  deployment: {
    apiBaseUrl: "https://api.proliferate.com",
    resetDeployment: mocks.resetDeployment,
    switchDeployment: mocks.switchDeployment,
  } as {
    apiBaseUrl: string;
    resetDeployment?: () => Promise<void>;
    switchDeployment?: (apiBaseUrl: string) => Promise<void>;
  },
  desktop: {
    updater: { getVersion: mocks.getVersion },
    connect: { fetchServerMeta: mocks.fetchServerMeta },
  } as {
    updater: { getVersion: () => Promise<string> };
    connect: { fetchServerMeta: (url: string) => Promise<unknown> };
  } | null,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => hostState,
}));

// The connect-server meta probe is now a Desktop bridge port (ruling R2a); the
// deployment origin is read from host.deployment. Keep the official-host check
// returning true so connectedServerHost stays null, matching the prior mock.
vi.mock("#product/lib/infra/proliferate-api", () => ({
  isOfficialHostedApiBaseUrl: () => true,
}));

import { useConnectServer } from "./use-connect-server";

describe("useConnectServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostState.desktop = {
      updater: { getVersion: mocks.getVersion },
      connect: { fetchServerMeta: mocks.fetchServerMeta },
    };
    hostState.deployment.resetDeployment = mocks.resetDeployment;
    hostState.deployment.switchDeployment = mocks.switchDeployment;
    mocks.fetchServerMeta.mockResolvedValue({
      ok: true,
      meta: {
        deploymentMode: "self_hosted",
        minDesktopVersion: "0.3.0",
      },
    });
  });

  afterEach(cleanup);

  it("delegates the confirmed deployment switch to ProductHost", async () => {
    const { result } = renderHook(() => useConnectServer());

    await act(async () => {
      await result.current.openForUrl("https://self.example.test");
    });
    expect(result.current.step).toBe("trust-confirm");

    await act(async () => {
      await result.current.confirmConnect();
    });

    expect(mocks.switchDeployment).toHaveBeenCalledWith("https://self.example.test");
  });

  it("delegates reset and hides the flow without Desktop deployment actions", async () => {
    const rendered = renderHook(() => useConnectServer());
    await act(async () => {
      await rendered.result.current.resetToDefaultServer();
    });
    expect(mocks.resetDeployment).toHaveBeenCalledTimes(1);

    hostState.deployment.resetDeployment = undefined;
    rendered.rerender();
    expect(rendered.result.current.available).toBe(false);
  });
});
