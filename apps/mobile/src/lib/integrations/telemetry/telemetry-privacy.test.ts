import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SentryTypes from "@sentry/react-native";

const mocks = vi.hoisted(() => ({
  sentryInit: vi.fn(),
  sentrySetUser: vi.fn(),
  sentryWrap: vi.fn((component: unknown) => component),
  sentryAddBreadcrumb: vi.fn(),
  sentryWithScope: vi.fn(),
  sentryCaptureException: vi.fn(),
  posthogConstructor: vi.fn(),
  posthogClient: {
    register: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    screen: vi.fn(),
    startSessionRecording: vi.fn(),
    startSessionReplay: vi.fn(),
  },
}));

vi.mock("@sentry/react-native", () => ({
  init: mocks.sentryInit,
  setUser: mocks.sentrySetUser,
  wrap: mocks.sentryWrap,
  addBreadcrumb: mocks.sentryAddBreadcrumb,
  withScope: mocks.sentryWithScope,
  captureException: mocks.sentryCaptureException,
}));

vi.mock("posthog-react-native", () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      mocks.posthogConstructor(...args);
      return mocks.posthogClient;
    }
  },
}));

type SentryInitOptions = Parameters<typeof SentryTypes.init>[0];

const EMAIL_SENTINEL = "private-person@example.com";
const NAME_SENTINEL = "Private Person";
const IP_SENTINEL = "203.0.113.42";
const BODY_SENTINEL = "private-request-body";
const COOKIE_SENTINEL = "private-cookie";
const AUTH_SENTINEL = "private-authorization-token";
const FRAME_SENTINEL = "private-frame-context";

function expectNoPrivateSentinels(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of [
    EMAIL_SENTINEL,
    NAME_SENTINEL,
    IP_SENTINEL,
    BODY_SENTINEL,
    COOKIE_SENTINEL,
    AUTH_SENTINEL,
    FRAME_SENTINEL,
  ]) {
    expect(serialized).not.toContain(sentinel);
  }
}

async function loadInitializedSentry(): Promise<{
  adapter: typeof import("./sentry");
  options: SentryInitOptions;
}> {
  vi.resetModules();
  const adapter = await import("./sentry");
  adapter.initializeMobileSentry({
    environment: "production",
    release: "proliferate-mobile@1.2.3+abcdef123456",
    sentry: {
      enabled: true,
      dsn: "https://public@sentry.example/1",
      tracesSampleRate: 0.25,
    },
  });
  expect(mocks.sentryInit).toHaveBeenCalledOnce();
  return {
    adapter,
    options: mocks.sentryInit.mock.calls[0]![0] as SentryInitOptions,
  };
}

describe("mobile telemetry privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs and exercises every Sentry privacy callback", async () => {
    const { adapter, options } = await loadInitializedSentry();

    expect(options.environment).toBe("production");
    expect(options.release).toBe("proliferate-mobile@1.2.3+abcdef123456");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0.25);
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
    expect(options.enableNativeCrashHandling).toBe(true);

    const frame = {
      filename: "src/screens/workspace.tsx",
      abs_path: "/private/var/mobile/Containers/Data/app/workspace.tsx",
      function: "renderWorkspace",
      context_line: FRAME_SENTINEL,
      pre_context: [FRAME_SENTINEL],
      post_context: [FRAME_SENTINEL],
      vars: { private_value: FRAME_SENTINEL },
    };
    const event = {
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      transaction: "/workspace/:workspaceId",
      user: {
        id: "user-123",
        email: EMAIL_SENTINEL,
        name: NAME_SENTINEL,
        ip_address: IP_SENTINEL,
      },
      request: {
        data: { private_value: BODY_SENTINEL },
        cookies: `session=${COOKIE_SENTINEL}`,
        headers: {
          authorization: `Bearer ${AUTH_SENTINEL}`,
          "x-safe-header": "safe-header",
        },
        url: `/workspace/123?token=${AUTH_SENTINEL}`,
      },
      exception: {
        values: [
          {
            type: "TypeError",
            value: "relative failure",
            stacktrace: { frames: [{ ...frame }] },
            raw_stacktrace: { frames: [{ ...frame }] },
          },
        ],
      },
    };

    const beforeSend = options.beforeSend as (
      sentryEvent: unknown,
      hint: unknown,
    ) => unknown;
    const scrubbedEvent = beforeSend(event, {});
    expect(scrubbedEvent).toMatchObject({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      transaction: "/workspace/:workspaceId",
      user: { id: "user-123" },
      exception: {
        values: [
          {
            type: "TypeError",
            value: "relative failure",
            stacktrace: {
              frames: [
                {
                  filename: "src/screens/workspace.tsx",
                  function: "renderWorkspace",
                },
              ],
            },
            raw_stacktrace: {
              frames: [
                {
                  filename: "src/screens/workspace.tsx",
                  function: "renderWorkspace",
                },
              ],
            },
          },
        ],
      },
    });
    expectNoPrivateSentinels(scrubbedEvent);

    const scrubbedFrames = (
      scrubbedEvent as {
        exception: {
          values: Array<{
            stacktrace: { frames: Array<Record<string, unknown>> };
            raw_stacktrace: { frames: Array<Record<string, unknown>> };
          }>;
        };
      }
    ).exception.values[0]!;
    for (const scrubbedFrame of [
      scrubbedFrames.stacktrace.frames[0]!,
      scrubbedFrames.raw_stacktrace.frames[0]!,
    ]) {
      expect(scrubbedFrame.context_line).toBeUndefined();
      expect(scrubbedFrame.pre_context).toBeUndefined();
      expect(scrubbedFrame.post_context).toBeUndefined();
      expect(scrubbedFrame.vars).toBeUndefined();
    }

    const beforeSendTransaction = options.beforeSendTransaction as (
      transaction: unknown,
    ) => unknown;
    const scrubbedTransaction = beforeSendTransaction({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      transaction: "/workspace/:workspaceId",
      user: { id: "user-123", email: EMAIL_SENTINEL, name: NAME_SENTINEL },
      request: { data: BODY_SENTINEL },
    });
    expect(scrubbedTransaction).toMatchObject({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      transaction: "/workspace/:workspaceId",
      user: { id: "user-123" },
    });
    expectNoPrivateSentinels(scrubbedTransaction);

    const beforeSendSpan = options.beforeSendSpan as (span: unknown) => unknown;
    const scrubbedSpan = beforeSendSpan({
      description: `/workspace/:workspaceId?token=${AUTH_SENTINEL}`,
      data: { email: EMAIL_SENTINEL, request_body: BODY_SENTINEL },
      op: "http.client",
    });
    expect(scrubbedSpan).toMatchObject({
      description: "/workspace/:workspaceId",
      op: "http.client",
    });
    expectNoPrivateSentinels(scrubbedSpan);

    const beforeBreadcrumb = options.beforeBreadcrumb as (
      breadcrumb: unknown,
      hint: unknown,
    ) => unknown;
    const scrubbedBreadcrumb = beforeBreadcrumb(
      {
        category: "ui.click",
        message: `/workspace/:workspaceId?token=${AUTH_SENTINEL}`,
        data: { email: EMAIL_SENTINEL, token: AUTH_SENTINEL },
      },
      {},
    );
    expect(scrubbedBreadcrumb).toMatchObject({
      category: "ui.click",
      message: "/workspace/:workspaceId",
    });
    expectNoPrivateSentinels(scrubbedBreadcrumb);

    adapter.setMobileSentryUser("user-123");
    expect(mocks.sentrySetUser).toHaveBeenCalledWith({ id: "user-123" });
    adapter.clearMobileSentryUser();
    expect(mocks.sentrySetUser).toHaveBeenLastCalledWith(null);
  });

  it("constructs PostHog with session replay source-disabled", async () => {
    vi.resetModules();
    const adapter = await import("./posthog");
    adapter.initializeMobilePostHog({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      posthog: {
        enabled: true,
        apiKey: "phc_test",
        apiHost: "https://us.i.posthog.com",
      },
    });

    expect(mocks.posthogConstructor).toHaveBeenCalledOnce();
    const [apiKey, options] = mocks.posthogConstructor.mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(apiKey).toBe("phc_test");
    expect(options.host).toBe("https://us.i.posthog.com");
    expect(options.enableSessionReplay).toBe(false);
    expect(typeof options.before_send).toBe("function");
    expect(options.captureAppLifecycleEvents).toBe(false);
    expect(Object.keys(options).filter((k) => /replay|record/i.test(k))).toEqual([
      "enableSessionReplay",
    ]);

    // A second initialization is a no-op: the idempotency guard stands.
    adapter.initializeMobilePostHog({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      posthog: { enabled: true, apiKey: "phc_test", apiHost: "https://us.i.posthog.com" },
    });
    expect(mocks.posthogConstructor).toHaveBeenCalledOnce();

    adapter.trackMobilePostHogScreenView("work");
    expect(mocks.posthogClient.capture).toHaveBeenCalledOnce();
    expect(mocks.posthogClient.capture).toHaveBeenCalledWith("mobile_screen_viewed", {
      screen: "work",
      surface: "mobile",
    });

    expect(mocks.posthogClient.screen).not.toHaveBeenCalled();
    expect(mocks.posthogClient.startSessionRecording).not.toHaveBeenCalled();
    expect(mocks.posthogClient.startSessionReplay).not.toHaveBeenCalled();
  });

  it("identifies PostHog with the authenticated user id only", async () => {
    vi.resetModules();
    const adapter = await import("./posthog");
    adapter.initializeMobilePostHog({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      posthog: {
        enabled: true,
        apiKey: "phc_test",
        apiHost: "https://us.i.posthog.com",
      },
    });

    expect(mocks.posthogClient.register).toHaveBeenCalledWith({
      app: "proliferate-mobile",
      surface: "mobile",
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
    });

    adapter.identifyMobilePostHogUser("user-123");
    expect(mocks.posthogClient.identify).toHaveBeenCalledOnce();
    expect(mocks.posthogClient.identify).toHaveBeenCalledWith("user-123");
    expectNoPrivateSentinels(mocks.posthogClient.identify.mock.calls);

    adapter.resetMobilePostHogUser();
    expect(mocks.posthogClient.reset).toHaveBeenCalledOnce();
  });

  it("keeps disabled and uninitialized adapters inert", async () => {
    vi.resetModules();
    const sentry = await import("./sentry");
    sentry.initializeMobileSentry({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      sentry: { enabled: true, dsn: null, tracesSampleRate: 0.25 },
    });
    sentry.setMobileSentryUser("user-123");

    vi.resetModules();
    const posthog = await import("./posthog");
    posthog.initializeMobilePostHog({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      posthog: {
        enabled: false,
        apiKey: "phc_test",
        apiHost: "https://us.i.posthog.com",
      },
    });
    posthog.initializeMobilePostHog({
      environment: "production",
      release: "proliferate-mobile@1.2.3+abcdef123456",
      posthog: { enabled: true, apiKey: null, apiHost: "https://us.i.posthog.com" },
    });
    posthog.trackMobilePostHogScreenView("home");
    posthog.identifyMobilePostHogUser("user-123");
    posthog.resetMobilePostHogUser();

    expect(mocks.sentryInit).not.toHaveBeenCalled();
    expect(mocks.sentrySetUser).not.toHaveBeenCalled();
    expect(mocks.posthogConstructor).not.toHaveBeenCalled();
    expect(mocks.posthogClient.register).not.toHaveBeenCalled();
    expect(mocks.posthogClient.capture).not.toHaveBeenCalled();
    expect(mocks.posthogClient.identify).not.toHaveBeenCalled();
    expect(mocks.posthogClient.reset).not.toHaveBeenCalled();
    expect(mocks.posthogClient.screen).not.toHaveBeenCalled();
    expect(mocks.posthogClient.startSessionRecording).not.toHaveBeenCalled();
    expect(mocks.posthogClient.startSessionReplay).not.toHaveBeenCalled();
  });
});
