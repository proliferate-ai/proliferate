// Browser deployment/build configuration for the Web host. The single hosted
// deployment's API base URL is the only value the thin host needs; product
// defaults (repo selection, dev token login) now live in ProductClient.
export const webEnv = {
  apiBaseUrl: import.meta.env.VITE_PROLIFERATE_API_BASE_URL ?? "http://localhost:8000",
} as const;
