/// <reference types="vite/client" />

// Product-owned build-time env typing.
//
// `assets.d.ts` (the `assets.d.ts` split's product part) carries the asset-module
// ambient declarations; this file carries the product part of the env split. The
// host-only telemetry vars (Sentry/PostHog/anonymous-telemetry/release) stay in
// the Desktop host's own `assets.d.ts` (consumed only by retained
// `lib/integrations/telemetry/**`). These are the build-time flags the moved
// product reads directly; `import.meta.env.DEV`/`PROD`/`MODE` come from
// `vite/client`. Interface declarations merge with `vite/client`'s `ImportMetaEnv`.
interface ImportMetaEnv {
  readonly VITE_REQUIRE_AUTH?: string;
  readonly VITE_DEV_DISABLE_AUTH?: string;
  readonly VITE_PROLIFERATE_WEB_BASE_URL?: string;
  readonly VITE_PROLIFERATE_ENVIRONMENT?: string;
  readonly VITE_PROLIFERATE_BOOT_DIAGNOSTICS?: string;
  readonly VITE_PROLIFERATE_GOAL_FIXTURE?: string;
  readonly VITE_PROLIFERATE_ACTIVITY_FIXTURE?: string;
  readonly VITE_PLAYGROUND_REPLAY_WORKSPACE_PATH?: string;
  readonly VITE_ANYHARNESS_DEV_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
