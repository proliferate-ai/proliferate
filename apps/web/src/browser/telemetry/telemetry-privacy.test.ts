import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SentryTypes from "@sentry/react";

const mocks = vi.hoisted(() => ({
  sentryInit: vi.fn(),
  sentrySetUser: vi.fn(),
  sentryCaptureException: vi.fn(),
  sentrySetTag: vi.fn(),
  reactErrorHandler: vi.fn(() => vi.fn()),
  withSentryReactRouterV7Routing: vi.fn((component: unknown) => component),
  reactRouterV7BrowserTracingIntegration: vi.fn(() => ({ name: "routing" })),
  posthog: {
    __loaded: true,
    init: vi.fn(),
    register: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    startSessionRecording: vi.fn(),
    get_distinct_id: vi.fn(() => "distinct-123"),
    get_session_id: vi.fn(() => "session-123"),
  },
}));

vi.mock("@sentry/react", () => ({
  init: mocks.sentryInit,
  setUser: mocks.sentrySetUser,
  captureException: mocks.sentryCaptureException,
  setTag: mocks.sentrySetTag,
  reactErrorHandler: mocks.reactErrorHandler,
  withSentryReactRouterV7Routing: mocks.withSentryReactRouterV7Routing,
  reactRouterV7BrowserTracingIntegration:
    mocks.reactRouterV7BrowserTracingIntegration,
}));

vi.mock("posthog-js", () => ({
  default: mocks.posthog,
}));

type SentryInitOptions = Parameters<typeof SentryTypes.init>[0];
type SentryTransaction = Parameters<
  NonNullable<SentryInitOptions["beforeSendTransaction"]>
>[0];
type SentrySpan = Parameters<NonNullable<SentryInitOptions["beforeSendSpan"]>>[0];

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

async function loadInstalledOptions(): Promise<SentryInitOptions> {
  vi.resetModules();
  const { installWebTelemetry } = await import("./install-web-telemetry");
  installWebTelemetry();
  expect(mocks.sentryInit).toHaveBeenCalledOnce();
  return mocks.sentryInit.mock.calls[0]![0] as SentryInitOptions;
}

describe("web telemetry privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posthog.__loaded = true;
    vi.stubEnv("VITE_PROLIFERATE_SENTRY_DSN", "https://public@sentry.example/1");
    vi.stubEnv("VITE_PROLIFERATE_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_PROLIFERATE_ENVIRONMENT", "production");
    vi.stubEnv(
      "VITE_PROLIFERATE_RELEASE",
      "proliferate-web@1.2.3+abcdef123456",
    );
    vi.stubEnv("VITE_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE", "0.25");
    vi.stubEnv("VITE_PROLIFERATE_TELEMETRY_DISABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("installs and exercises every Sentry privacy callback", async () => {
    const options = await loadInstalledOptions();

    expect(options.environment).toBe("production");
    expect(options.release).toBe("proliferate-web@1.2.3+abcdef123456");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0.25);
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
    expect(mocks.posthog.register).toHaveBeenCalledWith({
      app: "proliferate-web",
      surface: "web",
      environment: "production",
      release: "proliferate-web@1.2.3+abcdef123456",
    });

    const frame = {
      filename: "src/screens/workspace.tsx",
      abs_path: "/Users/private/project/src/screens/workspace.tsx",
      function: "renderWorkspace",
      context_line: FRAME_SENTINEL,
      pre_context: [FRAME_SENTINEL],
      post_context: [FRAME_SENTINEL],
      vars: { private_value: FRAME_SENTINEL },
    };
    const event = {
      environment: "production",
      release: "proliferate-web@1.2.3+abcdef123456",
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
    } as unknown as Parameters<NonNullable<SentryInitOptions["beforeSend"]>>[0];

    const scrubbedEvent = options.beforeSend!(event, {});
    expect(scrubbedEvent).not.toBeNull();
    expect(scrubbedEvent).toMatchObject({
      environment: "production",
      release: "proliferate-web@1.2.3+abcdef123456",
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
      scrubbedEvent as unknown as {
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

    const transaction = {
      environment: "production",
      release: "proliferate-web@1.2.3+abcdef123456",
      transaction: "/workspace/:workspaceId",
      user: { id: "user-123", email: EMAIL_SENTINEL, name: NAME_SENTINEL },
      request: { data: BODY_SENTINEL },
    } as unknown as SentryTransaction;
    const scrubbedTransaction = options.beforeSendTransaction!(transaction, {});
    expect(scrubbedTransaction).toMatchObject({
      environment: "production",
      release: "proliferate-web@1.2.3+abcdef123456",
      transaction: "/workspace/:workspaceId",
      user: { id: "user-123" },
    });
    expectNoPrivateSentinels(scrubbedTransaction);

    const span = {
      description: `/workspace/:workspaceId?token=${AUTH_SENTINEL}`,
      data: { email: EMAIL_SENTINEL, request_body: BODY_SENTINEL },
      op: "http.client",
    } as unknown as SentrySpan;
    const scrubbedSpan = options.beforeSendSpan!(span);
    expect(scrubbedSpan).toMatchObject({
      description: "/workspace/:workspaceId",
      op: "http.client",
    });
    expectNoPrivateSentinels(scrubbedSpan);

    const scrubbedBreadcrumb = options.beforeBreadcrumb!(
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
  });

  it("passes only the authenticated user id to Sentry and PostHog", async () => {
    vi.resetModules();
    const { webProductTelemetry } = await import("./web-telemetry");

    webProductTelemetry.setUser({
      id: "user-123",
      email: EMAIL_SENTINEL,
      displayName: NAME_SENTINEL,
    });

    expect(mocks.sentrySetUser).toHaveBeenCalledWith({ id: "user-123" });
    expect(mocks.posthog.identify).toHaveBeenCalledWith("user-123");
    expectNoPrivateSentinels([
      mocks.sentrySetUser.mock.calls,
      mocks.posthog.identify.mock.calls,
    ]);

    webProductTelemetry.setUser(null);
    expect(mocks.sentrySetUser).toHaveBeenLastCalledWith(null);
    expect(mocks.posthog.reset).toHaveBeenCalledWith(true);
  });

  it("keeps telemetry uninitialized when keys are absent", async () => {
    vi.stubEnv("VITE_PROLIFERATE_SENTRY_DSN", "");
    vi.stubEnv("VITE_PROLIFERATE_POSTHOG_KEY", "");
    vi.resetModules();
    const { installWebTelemetry } = await import("./install-web-telemetry");

    expect(installWebTelemetry()).toEqual({});
    expect(mocks.sentryInit).not.toHaveBeenCalled();
    expect(mocks.posthog.init).not.toHaveBeenCalled();
  });

  it("keeps telemetry uninitialized when telemetry is disabled", async () => {
    vi.stubEnv("VITE_PROLIFERATE_TELEMETRY_DISABLED", "true");
    vi.resetModules();
    const { installWebTelemetry } = await import("./install-web-telemetry");

    expect(installWebTelemetry()).toEqual({});
    expect(mocks.sentryInit).not.toHaveBeenCalled();
    expect(mocks.posthog.init).not.toHaveBeenCalled();
  });

  it("still sends intentional product events with scrubbed properties", async () => {
    vi.resetModules();
    const { webProductTelemetry } = await import("./web-telemetry");

    webProductTelemetry.track({
      name: "workspace_opened",
      properties: { surface: "web", email: EMAIL_SENTINEL },
    } as Parameters<typeof webProductTelemetry.track>[0]);

    expect(mocks.posthog.capture).toHaveBeenCalledOnce();
    const [name, properties] = mocks.posthog.capture.mock.calls[0]!;
    expect(name).toBe("workspace_opened");
    expect(properties).toMatchObject({ surface: "web" });
    expectNoPrivateSentinels(properties);
  });

  // CP-C1PW tombstone: `VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED` is
  // retired. It survives only here, to prove every parser equivalence class of
  // a legacy build value is inert. The source scan proves no runtime reader
  // remains in app-owned code.
  describe.each([
    ["undefined", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["0", "0"],
    ["false", "false"],
    ["no", "no"],
    ["off", "off"],
    ["1", "1"],
    ["true", "true"],
    ["TRUE", "TRUE"],
    ["padded yes", " yes "],
    ["on", "on"],
    ["-1", "-1"],
    ["0.5", "0.5"],
    ["2", "2"],
    ["enabled", "enabled"],
    ["malformed", "malformed"],
  ])("retired recording variable = %s", (_label, value) => {
    it("initializes PostHog fail-closed and never starts a recorder", async () => {
      if (value !== undefined) {
        vi.stubEnv("VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED", value);
      }
      vi.resetModules();
      const { installWebTelemetry } = await import("./install-web-telemetry");
      installWebTelemetry();

      expect(mocks.posthog.init).toHaveBeenCalledOnce();
      const options = mocks.posthog.init.mock.calls[0]![1] as Record<string, unknown>;
      expect(options.disable_session_recording).toBe(true);
      expect(options.autocapture).toBe(false);
      expect(options.capture_pageview).toBe(false);
      expect(options.capture_pageleave).toBe(false);
      expect(Object.hasOwn(options, "session_recording")).toBe(false);
      expect(Object.hasOwn(options, "loaded")).toBe(false);
      expect(typeof options.before_send).toBe("function");
      expect(mocks.posthog.startSessionRecording).not.toHaveBeenCalled();
      expect(mocks.posthog.capture).not.toHaveBeenCalled();
      expect(mocks.posthog.register).toHaveBeenCalledWith({
        app: "proliferate-web",
        surface: "web",
        environment: "production",
        release: "proliferate-web@1.2.3+abcdef123456",
      });
    });
  });
});
