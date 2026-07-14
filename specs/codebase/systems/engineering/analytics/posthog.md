# PostHog

Status: current system contract

PostHog is the hosted-product vendor path for client analytics and optional
session replay. It is separate from first-party anonymous telemetry and is not
initialized by the Server API.

## Applicability And Data Contract

| Concern | Current behavior |
| --- | --- |
| Deployment modes | Desktop initializes PostHog only in `hosted_product`. Web and Mobile initialize their adapters when the build has a key and telemetry is not disabled; those are current hosted-product clients. Local-dev and self-managed Desktop do not initialize PostHog. |
| Source components | Desktop `apps/desktop/src/lib/integrations/telemetry/{client,config,posthog}.ts`; Web `apps/web/src/lib/integrations/telemetry/{config,posthog}.ts`; Mobile `apps/mobile/src/lib/integrations/telemetry/{config,posthog}.ts`. |
| Identity and data | Distinct id is the authenticated user UUID; identify properties are email and optional display name. Captured data is the fixed event surface below plus scrubbed low-cardinality properties and registered app/surface/environment/release context. |
| Destination | The configured PostHog host, defaulting to `https://us.i.posthog.com`. |
| Enable, disable, or no-op | A missing API key makes each adapter inert. Web/Mobile also honor their public telemetry-disable setting; Desktop additionally requires hosted-product routing. Replay has a separate false-by-default gate. |
| Privacy and replay | Autocapture and automatic page views are off. Payload scrubbers remove sensitive values. Replay is off by default; enabled Desktop/Web replay masks inputs and honors block/mask selectors, and Mobile masks text, images, and sandboxed views. |
| Known gap | When Desktop or Web replay is explicitly enabled, recorded page metadata can contain route ids even though capture-event URL properties are stripped. Mobile replay also requires the optional native replay dependency in the build. |

## Desktop

Desktop initializes with:

```text
autocapture=false
capture_pageview=false
capture_pageleave=false
person_profiles=identified_only
session recording disabled unless explicitly enabled
```

When `VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED` is true, the
`loaded` callback explicitly starts Desktop recording. Inputs are masked and
`[data-telemetry-mask]` / `[data-telemetry-block]` are respected. Those controls
do not remove identifier-bearing workflow or workspace route segments from
recorded page metadata.

Only these Desktop product events reach PostHog:

```text
chat_session_created
chat_prompt_submitted
workspace_created
cloud_workspace_created
support_report_submitted
desktop_keychain_access_failed
```

Other typed product events may become Sentry breadcrumbs when vendor telemetry
is enabled, but are dropped before PostHog. Sign-out calls `reset(true)`.
Support submissions may include the current PostHog distinct id and session id
as correlation references.

## Web

Web captures one explicit `web_page_viewed` event with `surface=web` and a
normalized route token. Raw path ids are never used as that event's `route`.
It disables autocapture and automatic pageview/pageleave capture. Before-send
scrubbing removes URL-shaped PostHog properties including `$current_url`,
`$pathname`, `$host`, `$referrer`, and `$referring_domain`.

Web replay is disabled by default. When enabled, it masks inputs, honors the
block/mask selectors, and does not record request headers or bodies. This does
not remove the known rrweb page-URL gap described above. Sign-out calls
`reset(true)`.

## Mobile

Mobile captures `mobile_screen_viewed` with a typed screen and
`surface=mobile`. SDK-generated app lifecycle capture is disabled so OAuth
callback deep links are not emitted as automatic app-open events. Replay is
disabled by default; when enabled, logs and network telemetry remain disabled.
Sign-out resets the client.

## Configuration

Desktop/Web:

```text
VITE_PROLIFERATE_POSTHOG_KEY
VITE_PROLIFERATE_POSTHOG_HOST
VITE_PROLIFERATE_POSTHOG_SESSION_RECORDING_ENABLED
VITE_PROLIFERATE_TELEMETRY_DISABLED
VITE_PROLIFERATE_ENVIRONMENT
VITE_PROLIFERATE_RELEASE
```

Mobile:

```text
EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY
EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST
EXPO_PUBLIC_PROLIFERATE_POSTHOG_SESSION_REPLAY_ENABLED
EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED
EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT
EXPO_PUBLIC_PROLIFERATE_RELEASE
```

For a named Desktop development profile, runtime config is:

```text
~/.proliferate-local/dev/profiles/<name>/app/config.json
```

`telemetryDisabled` there is read once at startup. Relaunch after changing it.
See the [PostHog operating procedure](../../../../developing/operating/analytics/posthog.md).
