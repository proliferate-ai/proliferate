declare const process: {
  env: {
    EXPO_PUBLIC_PROLIFERATE_API_BASE_URL?: string;
    EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT?: string;
    EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST?: string;
    EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY?: string;
    EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED?: string;
    EXPO_PUBLIC_PROLIFERATE_RELEASE?: string;
    EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN?: string;
    EXPO_PUBLIC_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE?: string;
    EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED?: string;
    EXPO_PUBLIC_PROLIFERATE_DEV_REFRESH_TOKEN?: string;
  };
};
declare const __DEV__: boolean | undefined;

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_PROLIFERATE_API_BASE_URL?.trim();

function resolveApiBaseUrl() {
  if (configuredApiBaseUrl) return configuredApiBaseUrl;
  if (typeof __DEV__ !== "undefined" && __DEV__) return "http://127.0.0.1:8000";
  throw new Error("EXPO_PUBLIC_PROLIFERATE_API_BASE_URL is required for mobile builds.");
}

export const mobileEnv = {
  apiBaseUrl: resolveApiBaseUrl(),
  redirectUri: "proliferate://auth/callback",
  devRefreshToken: typeof __DEV__ !== "undefined" && __DEV__
    ? process.env.EXPO_PUBLIC_PROLIFERATE_DEV_REFRESH_TOKEN?.trim() || null
    : null,
} as const;
