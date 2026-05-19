export const webEnv = {
  apiBaseUrl: import.meta.env.VITE_PROLIFERATE_API_BASE_URL ?? "http://localhost:8000",
} as const;
