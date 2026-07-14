import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackProductEvent: vi.fn(),
  captureTelemetryException: vi.fn(),
  setTelemetryUser: vi.fn(),
  clearTelemetryUser: vi.fn(),
  setTelemetryTag: vi.fn(),
  getSupportReportReleaseId: vi.fn(),
  getSupportReportTelemetryRefs: vi.fn(),
}));

// Keep the host module's native and auth leaves inert while exercising the
// telemetry capability in isolation.
vi.mock("@/lib/infra/proliferate-api", () => ({
  getProliferateApiBaseUrl: vi.fn(),
}));
vi.mock("@/lib/access/tauri/config", () => ({
  setDesktopAppConfig: vi.fn(),
}));
vi.mock("@/lib/access/tauri/connect-server", () => ({
  isTauriRuntimeAvailable: vi.fn(),
}));
vi.mock("@/lib/access/tauri/updater", () => ({
  relaunch: vi.fn(),
}));
vi.mock("@/lib/access/tauri/shell", () => ({
  copyText: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("@/lib/access/tauri/deep-link", () => ({
  subscribeDeepLinkUrls: vi.fn(),
}));
vi.mock("@/lib/integrations/navigation/dev-desktop-handoff-source", () => ({
  subscribeDevDesktopHandoffs: vi.fn(),
}));
vi.mock("@/lib/integrations/auth/proliferate-sso-auth", () => ({
  discoverDesktopSso: vi.fn(),
}));
vi.mock("@/lib/integrations/auth/orchestration-callback", () => ({
  beginDesktopAuthTransaction: vi.fn(),
  handleDesktopCallbackUrl: vi.fn(),
}));
vi.mock("@/lib/integrations/auth/desktop-auth-transaction", () => ({
  isCurrentDesktopAuthTransaction: vi.fn(),
  staleDesktopAuthTransactionError: vi.fn(),
}));
vi.mock("@/lib/integrations/auth/proliferate-auth", () => ({
  DESKTOP_AUTH_REDIRECT_URI: "proliferate://auth/callback",
}));
vi.mock("@/lib/integrations/telemetry/client", () => ({
  trackProductEvent: mocks.trackProductEvent,
  captureTelemetryException: mocks.captureTelemetryException,
  setTelemetryUser: mocks.setTelemetryUser,
  clearTelemetryUser: mocks.clearTelemetryUser,
  setTelemetryTag: mocks.setTelemetryTag,
  getSupportReportReleaseId: mocks.getSupportReportReleaseId,
  getSupportReportTelemetryRefs: mocks.getSupportReportTelemetryRefs,
}));

import {
  __resetDesktopTelemetryRouteForTest,
  desktopTelemetry,
} from "./desktop-product-host";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("desktopTelemetry", () => {
  it("track delegates once to trackProductEvent", () => {
    desktopTelemetry.track({ name: "custom_event", properties: { a: 1 } });
    expect(mocks.trackProductEvent).toHaveBeenCalledTimes(1);
    expect(mocks.trackProductEvent).toHaveBeenCalledWith("custom_event", {
      a: 1,
    });
  });

  it("captureException delegates to captureTelemetryException", () => {
    const error = new Error("boom");
    desktopTelemetry.captureException(error, { tags: { k: "v" } });
    expect(mocks.captureTelemetryException).toHaveBeenCalledWith(error, {
      tags: { k: "v" },
    });
  });

  it("setUser maps to the Desktop user, and null clears it", () => {
    desktopTelemetry.setUser({
      id: "user-1",
      email: "a@example.test",
      displayName: "Ada",
    });
    expect(mocks.setTelemetryUser).toHaveBeenCalledWith({
      id: "user-1",
      email: "a@example.test",
      display_name: "Ada",
    });

    desktopTelemetry.setUser(null);
    expect(mocks.clearTelemetryUser).toHaveBeenCalledTimes(1);
  });

  it("setTag delegates to setTelemetryTag", () => {
    desktopTelemetry.setTag("k", "v");
    expect(mocks.setTelemetryTag).toHaveBeenCalledWith("k", "v");
  });

  it("routeChanged emits once per resolved route and suppresses repeats", () => {
    __resetDesktopTelemetryRouteForTest();

    desktopTelemetry.routeChanged("/");
    desktopTelemetry.routeChanged("/");
    desktopTelemetry.routeChanged("/settings");

    // "main" (from "/") emits once, the repeat is suppressed, "settings" emits.
    expect(mocks.trackProductEvent.mock.calls).toEqual([
      ["screen_viewed", { route: "main" }],
      ["screen_viewed", { route: "settings" }],
    ]);
    expect(mocks.setTelemetryTag.mock.calls).toEqual([
      ["route", "main"],
      ["route", "settings"],
    ]);
  });

  it("getSupportContext reads the release id and telemetry refs", () => {
    mocks.getSupportReportReleaseId.mockReturnValue("desktop@1.2.3+abcdef");
    mocks.getSupportReportTelemetryRefs.mockReturnValue({
      posthogDistinctId: "distinct-1",
    });
    expect(desktopTelemetry.getSupportContext()).toEqual({
      clientReleaseId: "desktop@1.2.3+abcdef",
      telemetryRefs: { posthogDistinctId: "distinct-1" },
    });
  });
});
