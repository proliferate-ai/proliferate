import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initMock: vi.fn(),
  withSentryReactRouterV7RoutingMock: vi.fn((component: unknown) => component),
  reactRouterIntegrationMock: vi.fn(() => "react-router-integration"),
  replayIntegrationMock: vi.fn(() => "replay-integration"),
  reactErrorHandlerMock: vi.fn(() => "error-handler"),
  setUserMock: vi.fn(),
  setTagMock: vi.fn(),
  addBreadcrumbMock: vi.fn(),
  withScopeMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  init: mocks.initMock,
  withSentryReactRouterV7Routing: mocks.withSentryReactRouterV7RoutingMock,
  reactRouterV7BrowserTracingIntegration: mocks.reactRouterIntegrationMock,
  replayIntegration: mocks.replayIntegrationMock,
  reactErrorHandler: mocks.reactErrorHandlerMock,
  setUser: mocks.setUserMock,
  setTag: mocks.setTagMock,
  addBreadcrumb: mocks.addBreadcrumbMock,
  withScope: mocks.withScopeMock,
  captureException: mocks.captureExceptionMock,
}));

vi.mock("react-router-dom", () => ({
  Routes: "Routes",
  useLocation: vi.fn(),
  useNavigationType: vi.fn(),
  createRoutesFromChildren: vi.fn(),
  matchRoutes: vi.fn(),
}));

async function loadSentryModule() {
  vi.resetModules();
  return import("./sentry");
}

describe("desktop sentry transport", () => {
  beforeEach(() => {
    mocks.initMock.mockClear();
    mocks.withSentryReactRouterV7RoutingMock.mockClear();
    mocks.reactRouterIntegrationMock.mockClear();
    mocks.reactErrorHandlerMock.mockClear();
    mocks.setUserMock.mockClear();
    mocks.setTagMock.mockClear();
    mocks.addBreadcrumbMock.mockClear();
    mocks.withScopeMock.mockClear();
    mocks.captureExceptionMock.mockClear();
  });

  it("initializes renderer Sentry with surface and telemetry_mode tags", async () => {
    const sentry = await loadSentryModule();

    sentry.initializeDesktopSentry({
      environment: "production",
      release: "proliferate-desktop@test",
      sentry: {
        enabled: true,
        dsn: "https://sentry.example/123",
        tracesSampleRate: 1,
        enableLogs: true,
        replaysOnErrorSampleRate: 1,
      },
      apiBaseUrl: "https://app.proliferate.com/api",
      telemetryMode: "hosted_product",
    });

    expect(mocks.initMock).toHaveBeenCalledOnce();
    expect(mocks.initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialScope: {
          tags: {
            surface: "desktop_renderer",
            telemetry_mode: "hosted_product",
          },
        },
      }),
    );
  });

  it("preserves the top-level deployment environment through beforeSend scrubbing", async () => {
    const sentry = await loadSentryModule();

    sentry.initializeDesktopSentry({
      environment: "production",
      release: "proliferate-desktop@test",
      sentry: {
        enabled: true,
        dsn: "https://sentry.example/123",
        tracesSampleRate: 1,
        enableLogs: true,
        replaysOnErrorSampleRate: 1,
      },
      apiBaseUrl: "https://app.proliferate.com/api",
      telemetryMode: "hosted_product",
    });

    const initArgs = mocks.initMock.mock.calls[0][0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };
    const scrubbed = initArgs.beforeSend({
      environment: "production",
      tags: { environment: "prod" },
    });

    // Deployment identity survives; a nested `environment` value stays redacted.
    expect(scrubbed.environment).toBe("production");
    expect((scrubbed.tags as Record<string, unknown>).environment).toBe("[redacted]");
  });

  it("bounds cyclic and deep payloads at the Sentry scrubber entrypoints", async () => {
    const sentry = await loadSentryModule();

    sentry.initializeDesktopSentry({
      environment: "production",
      release: "proliferate-desktop@test",
      sentry: {
        enabled: true,
        dsn: "https://sentry.example/123",
        tracesSampleRate: 1,
        enableLogs: true,
        replaysOnErrorSampleRate: 1,
      },
      apiBaseUrl: "https://app.proliferate.com/api",
      telemetryMode: "hosted_product",
    });

    const initArgs = mocks.initMock.mock.calls[0][0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
      beforeBreadcrumb: (breadcrumb: Record<string, unknown>) => Record<string, unknown>;
      beforeSendSpan: (span: Record<string, unknown>) => Record<string, unknown>;
    };
    const cyclicEvent: Record<string, unknown> = { environment: "production" };
    cyclicEvent.self = cyclicEvent;
    const cyclicSpan: Record<string, unknown> = { description: "safe" };
    cyclicSpan.self = cyclicSpan;
    const deepData: Record<string, unknown> = {};
    let cursor = deepData;
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const cyclicBreadcrumb: Record<string, unknown> = { data: deepData };
    cyclicBreadcrumb.self = cyclicBreadcrumb;

    const event = initArgs.beforeSend(cyclicEvent);
    const breadcrumb = initArgs.beforeBreadcrumb(cyclicBreadcrumb);
    const span = initArgs.beforeSendSpan(cyclicSpan);

    expect(event).toEqual({ environment: "production", self: "[circular]" });
    expect(breadcrumb.self).toBe("[circular]");
    expect(span).toEqual({ description: "safe", self: "[circular]" });
    expect(JSON.stringify(breadcrumb)).toContain("[truncated]");
    expect(() => JSON.stringify([event, breadcrumb, span])).not.toThrow();
  });
});
