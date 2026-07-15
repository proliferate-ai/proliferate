import packageJson from "../../../../package.json";

declare const process: {
  env: {
    EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT?: string;
    EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST?: string;
    EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY?: string;
    EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED?: string;
    EXPO_PUBLIC_PROLIFERATE_RELEASE?: string;
    EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN?: string;
    EXPO_PUBLIC_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE?: string;
    EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED?: string;
  };
};
declare const __DEV__: boolean | undefined;

function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function envFloat(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

export interface MobileTelemetryConfig {
  environment: string;
  release: string;
  sentry: {
    enabled: boolean;
    dsn: string | null;
    tracesSampleRate: number;
  };
  posthog: {
    enabled: boolean;
    apiKey: string | null;
    apiHost: string;
    sessionReplayEnabled: boolean;
  };
}

export function getMobileTelemetryConfig(): MobileTelemetryConfig {
  const sentryDsn = process.env.EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN?.trim() || null;
  const posthogKey = process.env.EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY?.trim() || null;
  const telemetryDisabled = envFlagEnabled(
    process.env.EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED,
    false,
  );

  return {
    environment:
      process.env.EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT?.trim()
      || (typeof __DEV__ !== "undefined" && __DEV__ ? "development" : "production"),
    release:
      process.env.EXPO_PUBLIC_PROLIFERATE_RELEASE?.trim()
      // EAS build profiles are expected to set EXPO_PUBLIC_PROLIFERATE_RELEASE
      // to a canonical `proliferate-mobile@<semver>+<12-hex-sha>` string; this
      // fallback only fires in local dev and derives the version from the
      // package.json (kept in sync with app.config.ts) instead of a stale
      // hardcoded literal.
      || `proliferate-mobile@${packageJson.version}`,
    sentry: {
      enabled: !telemetryDisabled && sentryDsn !== null,
      dsn: sentryDsn,
      tracesSampleRate: envFloat(
        process.env.EXPO_PUBLIC_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE,
        1.0,
      ),
    },
    posthog: {
      enabled: !telemetryDisabled && posthogKey !== null,
      apiKey: posthogKey,
      apiHost:
        process.env.EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST?.trim()
        || "https://us.i.posthog.com",
      sessionReplayEnabled: envFlagEnabled(
        process.env.EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED,
        false,
      ),
    },
  };
}
