export const webEnv = {
  apiBaseUrl: import.meta.env.VITE_PROLIFERATE_API_BASE_URL ?? "http://localhost:8000",
  devAccessTokenLogin:
    import.meta.env.DEV && import.meta.env.VITE_PROLIFERATE_DEV_TOKEN_LOGIN === "true",
} as const;
