import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  startSessionRecording: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: mocks,
}));

async function loadDesktopPostHog() {
  vi.resetModules();
  return import("./posthog");
}

const ENABLED_CONFIG = {
  environment: "production",
  release: "proliferate-desktop@1.2.3+abcdef123456",
  posthog: {
    enabled: true,
    apiKey: "phc_test",
    apiHost: "https://us.i.posthog.com",
  },
};

describe("desktop PostHog adapter", () => {
  beforeEach(() => {
    mocks.init.mockReset();
    mocks.register.mockReset();
    mocks.capture.mockReset();
    mocks.identify.mockReset();
    mocks.reset.mockReset();
    mocks.startSessionRecording.mockReset();
  });

  it("initializes once with recording disabled and no recording surfaces", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    expect(mocks.init).toHaveBeenCalledOnce();

    const [apiKey, options] = mocks.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(apiKey).toBe("phc_test");
    const { before_send: beforeSend, ...rest } = options;
    expect(rest).toEqual({
      api_host: "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      person_profiles: "identified_only",
      disable_session_recording: true,
    });
    const scrub = await import("./scrub");
    expect(beforeSend).toBe(scrub.scrubPostHogPayload);
    expect(Object.keys(options).sort()).toEqual([
      "api_host",
      "autocapture",
      "before_send",
      "capture_pageleave",
      "capture_pageview",
      "disable_session_recording",
      "person_profiles",
    ]);
    expect(mocks.startSessionRecording).not.toHaveBeenCalled();
  });

  it("captures typed product events through the scrubber", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    adapter.trackDesktopPostHogEvent("app_update_available", { version: "1.2.3" });

    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture.mock.calls[0]?.[0]).toBe("app_update_available");
  });

  it("identifies with the authenticated user id only", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    adapter.identifyDesktopPostHogUser("user-123");

    expect(mocks.identify).toHaveBeenCalledOnce();
    expect(mocks.identify).toHaveBeenCalledWith("user-123");
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain("user@example.com");
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain("Private Person");
  });

  it("keeps registered context and reset behavior unchanged", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog(ENABLED_CONFIG);

    expect(mocks.register).toHaveBeenCalledWith({
      app: "proliferate-desktop",
      surface: "desktop",
      environment: "production",
      release: "proliferate-desktop@1.2.3+abcdef123456",
    });

    adapter.resetDesktopPostHogUser();
    expect(mocks.reset).toHaveBeenCalledWith(true);
  });

  it("keeps identity and reset as no-ops before initialization", async () => {
    const adapter = await loadDesktopPostHog();

    adapter.identifyDesktopPostHogUser("user-123");
    adapter.resetDesktopPostHogUser();

    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("does not initialize without an enabled API key", async () => {
    const adapter = await loadDesktopPostHog();
    adapter.initializeDesktopPostHog({
      ...ENABLED_CONFIG,
      posthog: { ...ENABLED_CONFIG.posthog, apiKey: "" },
    });

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
