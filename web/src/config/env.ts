export const webEnv = {
  apiBaseUrl: import.meta.env.VITE_PROLIFERATE_API_BASE_URL ?? "http://localhost:8000",
  defaultCloudRepo:
    import.meta.env.VITE_PROLIFERATE_DEFAULT_CLOUD_REPO
    ?? (import.meta.env.DEV ? "proliferate-ai/proliferate" : null),
  devAccessTokenLogin:
    import.meta.env.DEV && import.meta.env.VITE_PROLIFERATE_DEV_TOKEN_LOGIN === "true",
} as const;
