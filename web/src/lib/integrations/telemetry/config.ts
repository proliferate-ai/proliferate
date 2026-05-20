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

export interface WebTelemetryConfig {
  environment: string;
  release: string;
  sentry: {
    enabled: boolean;
    dsn: string | null;
    tracesSampleRate: number;
    enableLogs: boolean;
  };
  posthog: {
    enabled: boolean;
    apiKey: string | null;
    apiHost: string;
    sessionRecordingEnabled: boolean;
  };
}

export function getWebTelemetryConfig(): WebTelemetryConfig {
  const sentryDsn = import.meta.env.VITE_PROLIFERATE_SENTRY_DSN?.trim() || null;
  const posthogKey = import.meta.env.VITE_PROLIFERATE_POSTHOG_KEY?.trim() || null;
  const telemetryDisabled = envFlagEnabled(
    import.meta.env.VITE_PROLIFERATE_TELEMETRY_DISABLED,
    false,
  );

  return {
    environment:
      import.meta.env.VITE_PROLIFERATE_ENVIRONMENT?.trim()
      || (import.meta.env.DEV ? "development" : "production"),
    release:
      import.meta.env.VITE_PROLIFERATE_RELEASE?.trim()
      || "proliferate-web@0.1.0",
    sentry: {
      enabled: !telemetryDisabled && sentryDsn !== null,
      dsn: sentryDsn,
      tracesSampleRate: envFloat(
        import.meta.env.VITE_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE,
        1.0,
      ),
      enableLogs: envFlagEnabled(
        import.meta.env.VITE_PROLIFERATE_SENTRY_ENABLE_LOGS,
        true,
      ),
    },
    posthog: {
      enabled: !telemetryDisabled && posthogKey !== null,
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
