import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";
import packageJson from "../../../../package.json";

function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function envFloat(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed;
}

export interface DesktopTelemetryConfig {
  environment: string;
  release: string;
  sentry: {
    enabled: boolean;
    dsn: string | null;
    tracesSampleRate: number;
    enableLogs: boolean;
    replaysOnErrorSampleRate: number;
  };
  posthog: {
    enabled: boolean;
    apiKey: string | null;
    apiHost: string;
    sessionRecordingEnabled: boolean;
  };
}

export function getDesktopTelemetryConfig(): DesktopTelemetryConfig {
  const sentryDsn = import.meta.env.VITE_PROLIFERATE_SENTRY_DSN?.trim() || null;
  const posthogKey = import.meta.env.VITE_PROLIFERATE_POSTHOG_KEY?.trim() || null;

  return {
    environment:
      import.meta.env.VITE_PROLIFERATE_ENVIRONMENT?.trim()
      || (import.meta.env.DEV ? "development" : "trusted-beta"),
    release:
      import.meta.env.VITE_PROLIFERATE_RELEASE?.trim()
      || `proliferate-desktop@${packageJson.version}`,
    sentry: {
      enabled: sentryDsn !== null,
      dsn: sentryDsn,
      tracesSampleRate: envFloat(
        import.meta.env.VITE_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE,
        1.0,
      ),
      enableLogs: envFlagEnabled(
        import.meta.env.VITE_PROLIFERATE_SENTRY_ENABLE_LOGS,
        true,
      ),
      replaysOnErrorSampleRate: envFloat(
        import.meta.env.VITE_PROLIFERATE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE,
        1.0,
      ),
    },
    posthog: {
      enabled: posthogKey !== null,
      apiKey: posthogKey,
      apiHost:
        import.meta.env.VITE_PROLIFERATE_POSTHOG_HOST?.trim()
        || "https://us.i.posthog.com",
      sessionRecordingEnabled: envFlagEnabled(
        import.meta.env.VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED,
        false,
      ),
    },
  };
}

export function isBuildTelemetryDisabled(): boolean {
  return envFlagEnabled(import.meta.env.VITE_PROLIFERATE_TELEMETRY_DISABLED, false);
}

export function getAnonymousTelemetryEndpoint(): string {
  return (
    import.meta.env.VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT?.trim()
    || buildProliferateApiUrl("/v1/telemetry/anonymous")
  );
}

export function getClientDailyActivityEndpoint(): string {
  return buildProliferateApiUrl("/v1/analytics/client-daily-activity");
}
