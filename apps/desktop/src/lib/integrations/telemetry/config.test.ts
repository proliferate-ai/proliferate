import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildProliferateApiUrlMock: vi.fn((path: string) => `https://self.example${path}`),
}));

vi.mock("@/lib/infra/proliferate-api", () => ({
  buildProliferateApiUrl: mocks.buildProliferateApiUrlMock,
}));

async function loadConfigModule() {
  vi.resetModules();
  return import("./config");
}

describe("getDesktopTelemetryConfig", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["zero", "0"],
    ["fractional", "0.5"],
    ["one", "1"],
    ["negative", "-0.1"],
    ["over one", "1.1"],
    ["boolean-looking", "true"],
    ["malformed", "not-a-number"],
  ] as const)(
    "ignores the retired replay setting when its legacy value is %s",
    async (_label, value) => {
      const baselineModule = await loadConfigModule();
      const baseline = baselineModule.getDesktopTelemetryConfig();

      if (value !== undefined) {
        vi.stubEnv("VITE_PROLIFERATE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE", value);
      }

      const config = await loadConfigModule();
      const configured = config.getDesktopTelemetryConfig();

      expect(configured).toEqual(baseline);
      expect(configured.sentry).not.toHaveProperty("replaysOnErrorSampleRate");
    },
  );

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["boolean-looking true", "true"],
    ["boolean-looking false", "false"],
    ["numeric true", "1"],
    ["numeric false", "0"],
    ["numeric fractional", "0.5"],
    ["numeric negative", "-1"],
    ["malformed", "not-a-boolean"],
  ] as const)(
    "ignores the retired PostHog recording setting when its legacy value is %s",
    async (_label, value) => {
      const baselineModule = await loadConfigModule();
      const baseline = baselineModule.getDesktopTelemetryConfig();

      if (value !== undefined) {
        vi.stubEnv("VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED", value);
      }

      const config = await loadConfigModule();
      const configured = config.getDesktopTelemetryConfig();

      expect(configured).toEqual(baseline);
      expect(Object.keys(configured.posthog).sort()).toEqual([
        "apiHost",
        "apiKey",
        "enabled",
      ]);
    },
  );
});

describe("getAnonymousTelemetryEndpoint", () => {
  beforeEach(() => {
    mocks.buildProliferateApiUrlMock.mockClear();
    vi.unstubAllEnvs();
  });

  it("defaults to the resolved API base URL", async () => {
    const config = await loadConfigModule();

    expect(config.getAnonymousTelemetryEndpoint()).toBe(
      "https://self.example/v1/telemetry/anonymous",
    );
    expect(mocks.buildProliferateApiUrlMock).toHaveBeenCalledWith(
      "/v1/telemetry/anonymous",
    );
  });

  it("prefers an explicit telemetry endpoint override", async () => {
    vi.stubEnv(
      "VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT",
      "https://collector.example/v1/telemetry/anonymous",
    );

    const config = await loadConfigModule();

    expect(config.getAnonymousTelemetryEndpoint()).toBe(
      "https://collector.example/v1/telemetry/anonymous",
    );
  });
});
