import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initMock: vi.fn(),
  withSentryReactRouterV7RoutingMock: vi.fn((component: unknown) => component),
  reactRouterIntegrationMock: vi.fn(() => "react-router-integration"),
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
});
