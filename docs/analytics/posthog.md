# PostHog

## Purpose
PostHog is Proliferate's hosted-product vendor analytics and optional replay
integration for first-party clients. It is separate from first-party anonymous
telemetry: anonymous telemetry covers OSS/self-managed installs, while PostHog
covers identified hosted-product usage.

PostHog is currently configured for:
- desktop hosted-product analytics and optional session recording
- web hosted-product route analytics; web session recording is kept disabled
  until URL metadata can be scrubbed safely
- mobile hosted-product screen analytics; replay startup is guarded behind env
  and requires the optional native replay package in the mobile build

Server/cloud API PostHog is not configured.

## Used For
- Capturing product analytics for hosted-product clients
- Identifying authenticated hosted-product users in PostHog
- Running opt-in replay with masking/blocking defaults where the SDK supports it
- Keeping vendor analytics separate from first-party anonymous telemetry

## Workflows
- Desktop vendor routing
  - trigger: desktop startup after runtime API config bootstrap
  - code path:
    - `desktop/src/main.tsx`
    - `desktop/src/lib/infra/proliferate-api.ts`
    - `desktop/src/lib/domain/telemetry/mode.ts`
    - `desktop/src/lib/integrations/telemetry/client.ts`
  - sends: no capture directly; resolves whether vendor telemetry is enabled
    for `hosted_product`
  - failure behavior:
    - `local_dev` and `self_managed` do not initialize PostHog
    - if telemetry is disabled, PostHog remains a no-op
- Desktop PostHog init and replay setup
  - trigger: `initializeDesktopTelemetry()` after runtime mode resolution
  - code path:
    - `desktop/src/lib/integrations/telemetry/client.ts`
    - `desktop/src/lib/integrations/telemetry/posthog.ts`
  - sends:
    - no product event directly
    - initializes PostHog with:
      - `autocapture=false`
      - `capture_pageview=false`
      - `capture_pageleave=false`
      - `person_profiles="identified_only"`
      - session recording disabled
      - `before_send` payload scrubbing, including query-string stripping
  - failure behavior:
    - if `VITE_PROLIFERATE_POSTHOG_KEY` is unset, the adapter is inert
    - replay never starts in the web adapter
- Desktop identified-user sync
  - trigger: auth state changes in the telemetry bootstrap flow
  - code path:
    - `desktop/src/providers/TelemetryProvider.tsx`
    - `desktop/src/hooks/telemetry/lifecycle/use-telemetry-bootstrap.ts`
    - `desktop/src/hooks/telemetry/lifecycle/use-telemetry-auth-identity.ts`
    - `desktop/src/lib/integrations/telemetry/client.ts`
    - `desktop/src/lib/integrations/telemetry/posthog.ts`
  - sends:
    - `posthog.identify(...)`
      - distinct id: `user.id`
      - properties:
        - `email`
        - `display_name`
    - `posthog.reset(true)` on sign-out
  - failure behavior:
    - outside `hosted_product`, user sync is a no-op
    - auth behavior is unchanged if vendor telemetry is disabled
- Desktop allowlisted event capture
  - trigger: existing `trackProductEvent(...)` calls from hooks/providers
  - code path:
    - `desktop/src/lib/integrations/telemetry/client.ts`
    - `desktop/src/lib/integrations/telemetry/posthog.ts`
  - sends: only these product events currently reach PostHog
    - `chat_session_created`
    - `chat_prompt_submitted`
    - `workspace_created`
    - `cloud_workspace_created`
  - failure behavior:
    - non-allowlisted product events are intentionally dropped before PostHog
    - allowed payloads are scrubbed before capture
- Web PostHog init, route capture, and identity sync
  - trigger: web app bootstrap inside `WebTelemetryProvider`
  - code path:
    - `web/src/main.tsx`
    - `web/src/providers/WebTelemetryProvider.tsx`
    - `web/src/lib/integrations/telemetry/config.ts`
    - `web/src/lib/integrations/telemetry/posthog.ts`
  - sends:
    - `web_page_viewed`
      - `surface="web"`
      - `route`: a normalized route name only, not raw URLs or IDs
    - `posthog.identify(...)`
      - distinct id: `user.id`
      - properties:
        - `email`
        - `display_name`
    - `posthog.reset(true)` on sign-out
  - failure behavior:
    - if `VITE_PROLIFERATE_POSTHOG_KEY` is unset, the adapter is inert
    - if telemetry is disabled, the adapter is inert
- Mobile PostHog init, screen capture, and identity sync
  - trigger: Expo app bootstrap inside `MobileTelemetryProvider`
  - code path:
    - `mobile/src/App.tsx`
    - `mobile/src/providers/MobileTelemetryProvider.tsx`
    - `mobile/src/hooks/telemetry/use-mobile-screen-telemetry.ts`
    - `mobile/src/lib/integrations/telemetry/config.ts`
    - `mobile/src/lib/integrations/telemetry/posthog.ts`
  - sends:
    - PostHog React Native app lifecycle events when the SDK is enabled
    - `mobile_screen_viewed`
      - `surface="mobile"`
      - `screen`: one of the typed mobile screen names
    - `posthog.identify(...)`
      - distinct id: `user.id`
      - properties:
        - `email`
        - `display_name`
    - `posthog.reset()` on sign-out
  - failure behavior:
    - if `EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY` is unset, the adapter is inert
    - if telemetry is disabled, the adapter is inert
- Replay masking and blocking
  - desktop/web:
    - desktop session recording defaults to disabled
    - when enabled, inputs are masked and `[data-telemetry-block]` /
      `[data-telemetry-mask]` selectors are respected
  - web:
    - session recording is disabled in code even if the env toggle is set,
      because the browser replay SDK can emit URL metadata independently of DOM
      masking
    - web event payloads are still scrubbed through `before_send`
  - mobile:
    - session replay defaults to disabled
    - automatic lifecycle capture is disabled so OAuth callback deep links are
      not sent as SDK-generated app-open events
    - when enabled, text inputs, images, and sandboxed views are masked; log
      and network telemetry capture are disabled locally
    - this repository does not install the native replay package by default, so
      enabling replay requires adding that native dependency to the mobile build

## Env Vars
Desktop and web Vite builds:
- `VITE_PROLIFERATE_POSTHOG_KEY`
- `VITE_PROLIFERATE_POSTHOG_HOST`
- `VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED`
- `VITE_PROLIFERATE_TELEMETRY_DISABLED`
- `VITE_PROLIFERATE_ENVIRONMENT`
- `VITE_PROLIFERATE_RELEASE`

Mobile Expo builds:
- `EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY`
- `EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST`
- `EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED`
- `EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED`
- `EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT`
- `EXPO_PUBLIC_PROLIFERATE_RELEASE`

Desktop runtime config, not env:
- `~/.proliferate/config.json`
- `~/.proliferate-local/config.json` in dev
  - supported fields relevant to PostHog routing:
    - `apiBaseUrl`
    - `telemetryDisabled`

No server PostHog env vars exist in the current implementation.

## Current Usage
- Desktop routing and allowlist seam:
  - `desktop/src/lib/integrations/telemetry/client.ts`
- Desktop PostHog adapter:
  - `desktop/src/lib/integrations/telemetry/posthog.ts`
- Desktop auth identity hook:
  - `desktop/src/hooks/telemetry/lifecycle/use-telemetry-auth-identity.ts`
- Web PostHog adapter and provider:
  - `web/src/lib/integrations/telemetry/posthog.ts`
  - `web/src/providers/WebTelemetryProvider.tsx`
- Mobile PostHog adapter and provider:
  - `mobile/src/lib/integrations/telemetry/posthog.ts`
  - `mobile/src/providers/MobileTelemetryProvider.tsx`
  - `mobile/src/hooks/telemetry/use-mobile-screen-telemetry.ts`
- Exact desktop product events currently captured:
  - `chat_session_created`
  - `chat_prompt_submitted`
  - `workspace_created`
  - `cloud_workspace_created`
- Exact web/mobile events currently captured:
  - `web_page_viewed`
  - `mobile_screen_viewed`
- Exact identity fields currently sent on identify:
  - `user.id`
  - `email`
  - `display_name`
- Known gaps:
  - server/cloud API PostHog remains intentionally absent
  - web/mobile currently capture coarse route/screen analytics, not the richer
    desktop typed product-event catalog
  - mobile replay requires native replay dependency support before recordings
    are expected to appear
  - direct `posthog.capture(...)` calls outside telemetry adapters would bypass
    the privacy guardrails, so app code should continue routing through the
    local telemetry helpers/providers
