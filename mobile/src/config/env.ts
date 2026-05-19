const env = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

declare const __DEV__: boolean | undefined;

const configuredApiBaseUrl = env.process?.env?.EXPO_PUBLIC_PROLIFERATE_API_BASE_URL?.trim();

function resolveApiBaseUrl() {
  if (configuredApiBaseUrl) return configuredApiBaseUrl;
  if (typeof __DEV__ !== "undefined" && __DEV__) return "http://127.0.0.1:8000";
  throw new Error("EXPO_PUBLIC_PROLIFERATE_API_BASE_URL is required for mobile builds.");
}

export const mobileEnv = {
  apiBaseUrl: resolveApiBaseUrl(),
  redirectUri: "proliferate://auth/callback",
} as const;
