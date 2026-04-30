# PostHog

## Purpose
PostHog is Proliferate's desktop-only vendor analytics and optional session
replay integration. In the current telemetry model it is intentionally narrow:
only `hosted_product` desktop runs may use it, and it captures a small set of
conversation-adjacent product events plus identified-user replay when explicitly
enabled.

## Used For
- Capturing hosted-product desktop product analytics for a small allowlisted
  event set
- Identifying authenticated hosted-product desktop users in PostHog
- Running opt-in desktop session replay with masking/blocking on sensitive
  surfaces
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
      - optional session recording when enabled
  - failure behavior:
    - if `VITE_PROLIFERATE_POSTHOG_KEY` is unset, the adapter is inert
    - if session recording is disabled, replay never starts
- Desktop identified-user sync
  - trigger: auth state changes in the telemetry bootstrap flow
  - code path:
    - `desktop/src/providers/TelemetryProvider.tsx`
    - `desktop/src/hooks/telemetry/use-telemetry-bootstrap.ts`
    - `desktop/src/hooks/telemetry/use-telemetry-auth-identity.ts`
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
- Desktop replay masking and blocking
  - trigger: session recording enabled through build config
  - code path:
    - `desktop/src/lib/integrations/telemetry/posthog.ts`
    - blocked/masked surfaces under `desktop/src/components/**`
  - sends:
    - replay stream with:
      - `maskAllInputs=true`
      - `maskTextSelector="[data-telemetry-mask]"`
      - `blockSelector="[data-telemetry-block]"`
  - failure behavior:
    - if recording is disabled, no replay is captured
    - blocked surfaces remain excluded from replay even when recording is on

## Env Vars
Required in hosted-product desktop builds:
- `VITE_PROLIFERATE_POSTHOG_KEY`

Optional:
- `VITE_PROLIFERATE_POSTHOG_HOST`
- `VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED`
- `VITE_PROLIFERATE_TELEMETRY_DISABLED`

Runtime config, not env:
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
  - `desktop/src/hooks/telemetry/use-telemetry-auth-identity.ts`
- Exact events currently captured:
  - `chat_session_created`
  - `chat_prompt_submitted`
  - `workspace_created`
  - `cloud_workspace_created`
- Exact identity fields currently sent on identify:
  - `user.id`
  - `email`
  - `display_name`
- Replay protection currently wired:
  - blocked surfaces include workspace shells, settings, plugins, terminals,
    right-panel content, cloud workspace settings, chat view, and transcript
    list
  - masked surfaces include the chat composer and pending-prompt editing UI
- Known gaps:
  - PostHog is intentionally desktop-only; server/cloud API PostHog was removed
    in this branch
  - replay is intentionally narrow because most workspace surfaces are blocked
  - direct `posthog.capture(...)` calls outside the telemetry facade would
    bypass the allowlist, so app code should continue using
    `trackProductEvent(...)`
