/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROLIFERATE_API_BASE_URL?: string;
  readonly VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT?: string;
  readonly VITE_PROLIFERATE_ENVIRONMENT?: string;
  readonly VITE_PROLIFERATE_RELEASE?: string;
  readonly VITE_PROLIFERATE_TELEMETRY_DISABLED?: string;
  readonly VITE_PROLIFERATE_DEBUG_LATENCY?: string;
  readonly VITE_DEV_DISABLE_AUTH?: string;
  readonly VITE_REQUIRE_AUTH?: string;
  readonly VITE_PROLIFERATE_SENTRY_DSN?: string;
  readonly VITE_PROLIFERATE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_PROLIFERATE_SENTRY_ENABLE_LOGS?: string;
  readonly VITE_PROLIFERATE_POSTHOG_KEY?: string;
  readonly VITE_PROLIFERATE_POSTHOG_HOST?: string;
  readonly VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.jpeg" {
  const src: string;
  export default src;
}

declare module "*.gif" {
  const src: string;
  export default src;
}

declare module "*.webp" {
  const src: string;
  export default src;
}

declare module "*.mp3" {
  const src: string;
  export default src;
}
