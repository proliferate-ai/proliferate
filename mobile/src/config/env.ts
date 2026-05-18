const env = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

export const mobileEnv = {
  apiBaseUrl:
    env.process?.env?.EXPO_PUBLIC_PROLIFERATE_API_BASE_URL ?? "http://127.0.0.1:8000",
  redirectUri: "proliferate://auth/callback",
} as const;
