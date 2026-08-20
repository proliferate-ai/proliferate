import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileTelemetryConfig } from "./config";

const BASE_ENV = {
  EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT: "production",
  EXPO_PUBLIC_PROLIFERATE_RELEASE: "proliferate-mobile@1.2.3+abcdef123456",
  EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY: "phc_test",
  EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST: "https://ph.example",
  EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN: "https://public@sentry.example/1",
  EXPO_PUBLIC_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE: "0.25",
} as const;

// Every retired spelling of the deleted
// EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED build switch. This is
// legacy-rejection evidence, not a parser compatibility contract.
const LEGACY_REPLAY_VALUES: Array<string | undefined> = [
  undefined,
  "",
  " ",
  "0",
  "false",
  "no",
  "off",
  "1",
  "true",
  "yes",
  "on",
  " TRUE ",
  "-1",
  "0.5",
  "2",
  "null",
  "undefined",
  "enabled",
  "有効 — активирано 🚀",
];

const originalEnv = { ...process.env };

async function loadConfig(
  legacyValue: string | undefined,
  extra: Record<string, string> = {},
): Promise<MobileTelemetryConfig> {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("EXPO_PUBLIC_PROLIFERATE_")) delete process.env[key];
  }
  Object.assign(process.env, BASE_ENV, extra);
  if (legacyValue !== undefined) {
    process.env.EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED = legacyValue;
  }
  vi.resetModules();
  const { getMobileTelemetryConfig } = await import("./config");
  return getMobileTelemetryConfig();
}

describe("getMobileTelemetryConfig legacy replay switch rejection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("EXPO_PUBLIC_PROLIFERATE_")) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it.each(
    LEGACY_REPLAY_VALUES.map(
      (value, index) => [`#${index} ${JSON.stringify(value) ?? "absent"}`, value] as const,
    ),
  )(
    "ignores the retired replay switch spelled %s",
    async (_label, value) => {
      const config = await loadConfig(value);

      expect(config.posthog).toEqual({
        enabled: true,
        apiKey: "phc_test",
        apiHost: "https://ph.example",
      });
      expect(Object.keys(config.posthog).sort()).toEqual([
        "apiHost",
        "apiKey",
        "enabled",
      ]);
      for (const key of Object.keys(config.posthog)) {
        expect(key.toLowerCase()).not.toContain("replay");
        expect(key.toLowerCase()).not.toContain("record");
      }
      expect(
        Object.prototype.hasOwnProperty.call(config.posthog, "sessionReplayEnabled"),
      ).toBe(false);
      expect(JSON.stringify(config)).not.toMatch(/replay|record/i);

      expect(config.environment).toBe("production");
      expect(config.release).toBe("proliferate-mobile@1.2.3+abcdef123456");
      expect(config.sentry).toEqual({
        enabled: true,
        dsn: "https://public@sentry.example/1",
        tracesSampleRate: 0.25,
      });
    },
  );

  it("returns a deeply identical config for every legacy value", async () => {
    const baseline = await loadConfig(undefined);
    for (const value of LEGACY_REPLAY_VALUES) {
      expect(await loadConfig(value)).toEqual(baseline);
    }
  });

  it("keeps the supported telemetry-disable gate working", async () => {
    for (const value of LEGACY_REPLAY_VALUES) {
      const config = await loadConfig(value, {
        EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED: "true",
      });
      expect(config.posthog.enabled).toBe(false);
      expect(config.posthog.apiKey).toBe("phc_test");
      expect(config.sentry.enabled).toBe(false);
    }
  });

  it("keeps the missing-key gate and host default working", async () => {
    const config = await loadConfig("true", {
      EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY: "  ",
      EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST: "  ",
    });
    expect(config.posthog).toEqual({
      enabled: false,
      apiKey: null,
      apiHost: "https://us.i.posthog.com",
    });
  });
});
