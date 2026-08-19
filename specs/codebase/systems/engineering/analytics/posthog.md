# PostHog

PostHog is the hosted-product vendor path for client analytics. Session replay
is source-disabled on every client surface. It is separate from first-party
anonymous telemetry and is not initialized by the Server API.

## Applicability And Data Contract

| Concern | Current behavior |
| --- | --- |
| Deployment modes | Desktop initializes PostHog only in `hosted_product`. Web and Mobile initialize their adapters when the build has a key and telemetry is not disabled; those are current hosted-product clients. Local-dev and self-managed Desktop do not initialize PostHog. |
| Source components | Desktop `apps/desktop/src/lib/integrations/telemetry/{client,config,posthog}.ts`; Web `apps/web/src/browser/telemetry/install-web-telemetry.ts`; Mobile `apps/mobile/src/lib/integrations/telemetry/{config,posthog}.ts`. |
| Identity and data | Distinct id is the authenticated user UUID, and identify calls send that UUID only with no email, display name, or other person properties. Captured data is the fixed event surface below plus scrubbed low-cardinality properties and registered app/surface/environment/release context. |
| Destination | The configured PostHog host, defaulting to `https://us.i.posthog.com`. |
| Enable, disable, or no-op | A missing API key makes each adapter inert. Web/Mobile also honor their public telemetry-disable setting; Desktop additionally requires hosted-product routing. Desktop, Web, and Mobile recording are source-disabled and have no gate to set. |
| Privacy and replay | Autocapture and automatic page views are off. Payload scrubbers remove sensitive values. Desktop, Web, and Mobile recording are source-disabled and absent. |
| Known gap | No client PostHog recording gap remains: Desktop, Web, and Mobile cannot record, so none can expose route ids through recorded page URLs. |

Re-enabling recording on any surface is a separate reviewed source change that
must first satisfy the synthetic privacy qualification in
[`specs/frontend/telemetry.md`](../../../../frontend/telemetry.md).

## Desktop

Desktop initializes with:

```text
autocapture=false
capture_pageview=false
capture_pageleave=false
person_profiles=identified_only
disable_session_recording=true
```

Desktop session recording is source-disabled, not false-by-default. The Desktop
source carries no recording flag, recording options object, `loaded` callback,
or `startSessionRecording` call, so no build value, environment value, or
PostHog provider-side replay setting can start it.

Only these Desktop product events reach PostHog:

```text
chat_session_created
chat_prompt_submitted
workspace_created
cloud_workspace_created
support_report_submitted
desktop_keychain_access_failed
```

`desktop_keychain_access_failed` carries only the keychain `operation` and a
closed `failure_kind`; raw error text is never sent.

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

Web session recording is source-disabled, not false-by-default. The Web source
carries no recording flag, recording options object, `loaded` callback, or
`startSessionRecording` call, and its PostHog initialization passes
`disable_session_recording=true` unconditionally. No environment value, build
setting, or PostHog provider-side replay setting can enable it. Sign-out calls
`reset(true)`.

## Mobile

Mobile captures `mobile_screen_viewed` with a typed screen and
`surface=mobile`. SDK-generated app lifecycle capture is disabled so OAuth
callback deep links are not emitted as automatic app-open events. The raw
client is constructed directly, so there is no `PostHogProvider`, navigation
tracker, `captureScreens` option, or touch autocapture. Sign-out resets it.

Mobile session replay is source-disabled, not false-by-default. The constructor
receives literal `enableSessionReplay: false`, carries no `sessionReplayConfig`
and no `startSessionRecording`/`startSessionReplay` call, and reads no replay
build variable, so no Expo/EAS setting, GitHub environment value, optional
native replay package, or PostHog provider-side setting can start it.

## Configuration

Desktop and Web share the same variable names:

```text
VITE_PROLIFERATE_POSTHOG_KEY
VITE_PROLIFERATE_POSTHOG_HOST
VITE_PROLIFERATE_TELEMETRY_DISABLED
VITE_PROLIFERATE_ENVIRONMENT
VITE_PROLIFERATE_RELEASE
```

Mobile:

```text
EXPO_PUBLIC_PROLIFERATE_POSTHOG_KEY
EXPO_PUBLIC_PROLIFERATE_POSTHOG_HOST
EXPO_PUBLIC_PROLIFERATE_TELEMETRY_DISABLED
EXPO_PUBLIC_PROLIFERATE_ENVIRONMENT
EXPO_PUBLIC_PROLIFERATE_RELEASE
```

For a named Desktop development profile, runtime config is:

```text
~/.proliferate-local/dev/profiles/<name>/app/config.json
```

`telemetryDisabled` there is read once at startup. Relaunch after changing it.
See the [PostHog operating procedure](../../../../../guides/operating/analytics/posthog.md).
