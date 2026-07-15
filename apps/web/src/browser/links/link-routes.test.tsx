// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real URL decoders; spy only the inbound-emit sink.
vi.mock("./web-product-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./web-product-links")>();
  return { ...actual, emitWebInboundEntry: vi.fn() };
});

vi.mock("../../lib/access/cloud/auth/web-auth-flow", () => ({
  startWebSsoFlow: vi.fn(),
}));

import { startWebSsoFlow } from "../../lib/access/cloud/auth/web-auth-flow";
import { BillingReturnRoute } from "./BillingReturnRoute";
import { IntegrationConnectCompleteRoute } from "./IntegrationConnectCompleteRoute";
import { OrganizationJoinRoute } from "./OrganizationJoinRoute";
import { emitWebInboundEntry } from "./web-product-links";

const emitMock = vi.mocked(emitWebInboundEntry);
const ssoMock = vi.mocked(startWebSsoFlow);

let originalLocation: Location;

function stubLocation(url: string) {
  const parsed = new URL(url);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      hostname: parsed.hostname,
      assign: vi.fn(),
      replace: vi.fn(),
    },
  });
}

function pathAndSearch(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  originalLocation = window.location;
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  vi.clearAllMocks();
});

function renderRoute(
  routePath: string,
  element: ReactElement,
  url: string,
) {
  stubLocation(url);
  return render(
    <MemoryRouter initialEntries={[pathAndSearch(url)]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="/settings/billing" element={<div data-testid="billing" />} />
        <Route
          path="/settings/integrations"
          element={<div data-testid="integrations" />}
        />
        <Route path="/" element={<div data-testid="home" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BillingReturnRoute", () => {
  it("emits a billing-return entry and routes to shared billing on a Web return", async () => {
    const { findByTestId } = renderRoute(
      "/settings/cloud",
      <BillingReturnRoute />,
      "https://app.proliferate.com/settings/cloud?checkout=success",
    );
    await findByTestId("billing");
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toMatchObject({
      kind: "billing-return",
      status: "success",
    });
  });

  it("hands a returnSurface=desktop return to the Desktop deep link", async () => {
    renderRoute(
      "/settings/cloud",
      <BillingReturnRoute />,
      "https://app.proliferate.com/settings/cloud?checkout=success&returnSurface=desktop",
    );
    await flush();
    expect(emitMock).not.toHaveBeenCalled();
    expect(window.location.replace).toHaveBeenCalledWith(
      "proliferate://settings/cloud?checkout=success",
    );
  });
});

describe("IntegrationConnectCompleteRoute", () => {
  it("emits the integration-callback entry and routes to integrations on a Web final surface", async () => {
    const { findByTestId } = renderRoute(
      "/plugins/connect/complete",
      <IntegrationConnectCompleteRoute />,
      "https://app.proliferate.com/plugins/connect/complete?source=integration_oauth_callback&status=completed&flowId=f1&finalSurface=web",
    );
    await findByTestId("integrations");
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toMatchObject({
      kind: "integration-callback",
      source: "integration_oauth_callback",
      status: "completed",
      flowId: "f1",
    });
  });

  it("hands a Desktop final surface to the proliferate://plugins deep link without leaking tokens", async () => {
    renderRoute(
      "/plugins/connect/complete",
      <IntegrationConnectCompleteRoute />,
      "https://app.proliferate.com/plugins/connect/complete?source=integration_oauth_callback&status=completed&flowId=f1&finalSurface=desktop&access_token=SECRET",
    );
    await flush();
    expect(emitMock).not.toHaveBeenCalled();
    const link = vi.mocked(window.location.replace).mock.calls[0][0] as string;
    expect(link).toBe(
      "proliferate://plugins?source=integration_oauth_callback&status=completed&flowId=f1",
    );
    expect(link).not.toContain("SECRET");
  });
});

describe("OrganizationJoinRoute", () => {
  it("starts Web SSO for the organization when SSO is usable", async () => {
    ssoMock.mockResolvedValueOnce(undefined);
    render(
      <MemoryRouter initialEntries={["/join/org_1"]}>
        <Routes>
          <Route path="/join/:orgId" element={<OrganizationJoinRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    stubLocation("https://app.proliferate.com/join/org_1");
    await flush();
    expect(ssoMock).toHaveBeenCalledWith({ organizationId: "org_1" });
  });

  it("falls back to the Desktop join deep link when SSO is unavailable", async () => {
    ssoMock.mockRejectedValueOnce(new Error("sso disabled"));
    stubLocation("https://app.proliferate.com/join/org_1");
    render(
      <MemoryRouter initialEntries={["/join/org_1"]}>
        <Routes>
          <Route path="/join/:orgId" element={<OrganizationJoinRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    expect(window.location.assign).toHaveBeenCalledWith("proliferate://join/org_1");
  });
});
