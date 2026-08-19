import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
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
    sessionRecordingEnabled: false,
  },
};

describe("desktop PostHog adapter", () => {
  beforeEach(() => {
    mocks.init.mockReset();
    mocks.register.mockReset();
    mocks.capture.mockReset();
    mocks.identify.mockReset();
    mocks.reset.mockReset();
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
