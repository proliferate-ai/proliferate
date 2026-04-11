import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopTelemetryRoutingState } from "@/lib/domain/telemetry/mode";

const mocks = vi.hoisted(() => {
  let runtimeState: DesktopTelemetryRoutingState = {
    disabled: false,
    telemetryMode: "hosted_product",
    anonymousEnabled: true,
    vendorEnabled: true,
  };

  return {
    get runtimeState() {
      return runtimeState;
    },
    set runtimeState(value: DesktopTelemetryRoutingState) {
      runtimeState = value;
    },
    resolveRoutingStateMock: vi.fn(() => runtimeState),
    getDesktopTelemetryConfigMock: vi.fn(() => ({
      environment: "production",
      release: "proliferate-desktop@test",
      sentry: {
        enabled: true,
        dsn: "https://sentry.example/123",
        tracesSampleRate: 1,
        enableLogs: true,
      },
      posthog: {
        enabled: true,
        apiKey: "phc_test",
        apiHost: "https://us.i.posthog.com",
        sessionRecordingEnabled: false,
      },
    })),
    isBuildTelemetryDisabledMock: vi.fn(() => false),
    getRuntimeDesktopAppConfigMock: vi.fn(() => ({
      apiBaseUrl: "https://api.proliferate.com",
      telemetryDisabled: false,
      nativeDevProfile: false,
    })),
    getProliferateApiBaseUrlMock: vi.fn(() => "https://api.proliferate.com"),
    getProliferateApiOriginMock: vi.fn(() => "https://api.proliferate.com"),
    handleAnonymousProductEventMock: vi.fn(),
    initializeDesktopSentryMock: vi.fn(),
    captureDesktopSentryExceptionMock: vi.fn(),
    getDesktopRootErrorHandlersMock: vi.fn(() => ({})),
    setDesktopSentryUserMock: vi.fn(),
    clearDesktopSentryUserMock: vi.fn(),
    setDesktopSentryTagMock: vi.fn(),
    addDesktopSentryBreadcrumbMock: vi.fn(),
    initializeDesktopPostHogMock: vi.fn(),
    identifyDesktopPostHogUserMock: vi.fn(),
    resetDesktopPostHogUserMock: vi.fn(),
    trackDesktopPostHogEventMock: vi.fn(),
  };
});

vi.mock("@/lib/domain/telemetry/mode", () => ({
  resolveDesktopTelemetryRoutingState: mocks.resolveRoutingStateMock,
}));

vi.mock("./config", () => ({
  getDesktopTelemetryConfig: mocks.getDesktopTelemetryConfigMock,
  isBuildTelemetryDisabled: mocks.isBuildTelemetryDisabledMock,
}));

vi.mock("@/lib/infra/proliferate-api", () => ({
  getRuntimeDesktopAppConfig: mocks.getRuntimeDesktopAppConfigMock,
  getProliferateApiBaseUrl: mocks.getProliferateApiBaseUrlMock,
  getProliferateApiOrigin: mocks.getProliferateApiOriginMock,
}));

vi.mock("@/lib/integrations/telemetry/anonymous", () => ({
  handleAnonymousProductEvent: mocks.handleAnonymousProductEventMock,
}));

vi.mock("./sentry", () => ({
  initializeDesktopSentry: mocks.initializeDesktopSentryMock,
  captureDesktopSentryException: mocks.captureDesktopSentryExceptionMock,
  getDesktopRootErrorHandlers: mocks.getDesktopRootErrorHandlersMock,
  setDesktopSentryUser: mocks.setDesktopSentryUserMock,
  clearDesktopSentryUser: mocks.clearDesktopSentryUserMock,
  setDesktopSentryTag: mocks.setDesktopSentryTagMock,
  addDesktopSentryBreadcrumb: mocks.addDesktopSentryBreadcrumbMock,
}));

vi.mock("./posthog", () => ({
  initializeDesktopPostHog: mocks.initializeDesktopPostHogMock,
  identifyDesktopPostHogUser: mocks.identifyDesktopPostHogUserMock,
  resetDesktopPostHogUser: mocks.resetDesktopPostHogUserMock,
  trackDesktopPostHogEvent: mocks.trackDesktopPostHogEventMock,
}));

async function loadTelemetryClient() {
  vi.resetModules();
  return import("./client");
}

describe("desktop telemetry client", () => {
  beforeEach(() => {
    mocks.runtimeState = {
      disabled: false,
      telemetryMode: "hosted_product",
      anonymousEnabled: true,
      vendorEnabled: true,
    };
    mocks.resolveRoutingStateMock.mockClear();
    mocks.getDesktopTelemetryConfigMock.mockClear();
    mocks.isBuildTelemetryDisabledMock.mockClear();
    mocks.getRuntimeDesktopAppConfigMock.mockClear();
    mocks.getProliferateApiBaseUrlMock.mockClear();
    mocks.getProliferateApiOriginMock.mockClear();
    mocks.handleAnonymousProductEventMock.mockClear();
    mocks.initializeDesktopSentryMock.mockClear();
    mocks.captureDesktopSentryExceptionMock.mockClear();
    mocks.getDesktopRootErrorHandlersMock.mockClear();
    mocks.setDesktopSentryUserMock.mockClear();
    mocks.clearDesktopSentryUserMock.mockClear();
    mocks.setDesktopSentryTagMock.mockClear();
    mocks.addDesktopSentryBreadcrumbMock.mockClear();
    mocks.initializeDesktopPostHogMock.mockClear();
    mocks.identifyDesktopPostHogUserMock.mockClear();
    mocks.resetDesktopPostHogUserMock.mockClear();
    mocks.trackDesktopPostHogEventMock.mockClear();
  });

  it("initializes vendor telemetry only when vendor routing is enabled", async () => {
    const client = await loadTelemetryClient();

    client.initializeDesktopTelemetry();

    expect(mocks.initializeDesktopSentryMock).toHaveBeenCalledOnce();
    expect(mocks.initializeDesktopSentryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        telemetryMode: "hosted_product",
      }),
    );
    expect(mocks.initializeDesktopPostHogMock).toHaveBeenCalledOnce();

    mocks.initializeDesktopSentryMock.mockClear();
    mocks.initializeDesktopPostHogMock.mockClear();
    mocks.runtimeState = {
      disabled: false,
      telemetryMode: "self_managed",
      anonymousEnabled: true,
      vendorEnabled: false,
    };

    const selfManagedClient = await loadTelemetryClient();
    selfManagedClient.initializeDesktopTelemetry();

    expect(mocks.initializeDesktopSentryMock).not.toHaveBeenCalled();
    expect(mocks.initializeDesktopPostHogMock).not.toHaveBeenCalled();
  });

  it("does not capture vendor exceptions outside hosted_product", async () => {
    mocks.runtimeState = {
      disabled: false,
      telemetryMode: "self_managed",
      anonymousEnabled: true,
      vendorEnabled: false,
    };

    const client = await loadTelemetryClient();
    client.captureTelemetryException(new Error("boom"));

    expect(mocks.captureDesktopSentryExceptionMock).not.toHaveBeenCalled();
  });

  it("sends only user id to Sentry while keeping the full user for PostHog", async () => {
    const client = await loadTelemetryClient();
    const user: AuthUser = {
      id: "user-123",
      email: "user@example.com",
      display_name: "Test User",
      is_active: true,
      is_verified: true,
      github_login: "test-user",
    };

    client.setTelemetryUser(user);

    expect(mocks.setDesktopSentryUserMock).toHaveBeenCalledOnce();
    expect(mocks.setDesktopSentryUserMock).toHaveBeenCalledWith("user-123");
    expect(mocks.identifyDesktopPostHogUserMock).toHaveBeenCalledOnce();
    expect(mocks.identifyDesktopPostHogUserMock).toHaveBeenCalledWith(user);
  });
});
