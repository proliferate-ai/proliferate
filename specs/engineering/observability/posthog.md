# PostHog

PostHog is the hosted-product vendor path for client analytics. Session replay
is source-disabled on Web and Mobile. On Desktop it is start-gated to the
internal replay audience and never auto-starts. It is separate from
first-party anonymous telemetry and is not initialized by the Server API.

## Applicability And Data Contract

| Concern | Current behavior |
| --- | --- |
| Deployment modes | Desktop initializes PostHog only in `hosted_product`. Web and Mobile initialize their adapters when the build has a key and telemetry is not disabled; those are current hosted-product clients. Local-dev and self-managed Desktop do not initialize PostHog. |
| Source components | Desktop `apps/desktop/src/lib/integrations/telemetry/{client,config,posthog}.ts`; Web `apps/web/src/browser/telemetry/install-web-telemetry.ts`; Mobile `apps/mobile/src/lib/integrations/telemetry/{config,posthog}.ts`. |
| Identity and data | Distinct id is the authenticated user UUID, and identify calls send that UUID only with no email, display name, or other person properties. Captured data is the fixed event surface below plus scrubbed low-cardinality properties and registered app/surface/environment/release context. |
| Destination | The configured PostHog host, defaulting to `https://us.i.posthog.com`. |
| Enable, disable, or no-op | A missing API key makes each adapter inert. Web/Mobile also honor their public telemetry-disable setting; Desktop additionally requires hosted-product routing. Web and Mobile recording are source-disabled and have no gate to set. Desktop recording additionally requires an internal-audience sign-in and PostHog project-side replay enablement; there is no build or environment value that starts it. |
| Privacy and replay | Autocapture and automatic page views are off. Payload scrubbers remove sensitive values, and route-identifier redaction reduces every URL and rrweb `href`/`src` to a bounded route template. Web and Mobile recording are source-disabled and absent. Desktop recording masks all text and inputs and starts only for the internal audience. |
| Known gap | The route-id leak is closed at the payload level by `apps/packages/product-client/src/domain/telemetry/route-id-redaction.ts`, proven by unit tests over a synthetic rrweb payload. The live qualification (real recorder output from the running app, plus controlled provider arrival) has not been executed, which is why Desktop recording is limited to the internal audience and customer recording stays off. |

Widening recording to customers on any surface, and re-enabling Web or Mobile
recording at all, is a separate founder-approved source change that must first
satisfy the synthetic privacy qualification in
[`specs/areas/telemetry.md`](../../areas/frontend.md).

## Desktop

Desktop initializes with:

```text
autocapture=false
capture_pageview=false
capture_pageleave=false
person_profiles=identified_only
disable_session_recording=true
session_recording=<masking and route-redaction options>
```

Desktop recording never auto-starts. `disable_session_recording` is a literal
`true` at init, there is no `loaded` callback, and the Desktop source carries
no recording flag readable from a build or environment value. Recording begins
only when `client.ts` calls `startDesktopPostHogSessionReplay()` after
`isInternalReplayAudience(user.email)` returns true for the signed-in account,
and even then only if the PostHog project has replay enabled server-side
(posthog-js `_isRecordingEnabled` requires both). The audience is a closed
source-owned list in
`apps/packages/product-client/src/domain/telemetry/replay-audience.ts`; the
address is read locally and never transmitted.

The recorder is pinned to `maskAllInputs`, `maskTextSelector="*"` (all text
masked), `blockSelector="[data-telemetry-block]"`, no font collection, no
cross-origin iframes, no network headers or bodies, and a
`maskCapturedNetworkRequestFn` that drops every captured request.

Three recorder capabilities resolve local-config-first and fall back to the
PostHog project's remote flags response, so leaving them unset would hand the
provider a decision the source is supposed to own. Each is therefore a local
literal: `captureCanvas: { recordCanvas: false }` and
`enable_recording_console_log: false`. Canvas matters specifically because
`@xterm/addon-canvas` renders terminal output to a canvas and canvas frames are
captured as pixels, which text masking does not reach; console capture matters
because console arguments are arbitrary strings that route-id redaction
deliberately does not rewrite. Network header and body capture resolves
remote-OR-local rather than local-first and so cannot be pinned that way, but
`maskCapturedNetworkRequestFn` returning `null` drops every captured request
regardless of what the provider enables. URLs are
handled separately from masking, and entirely at the `before_send` boundary:
the scrubber reduces event properties, the rrweb Meta event `href`, and every
URL-valued DOM attribute inside `$snapshot_data`. The same reducer is also
wired as the recorder-boundary `maskAttributeFn`, but the pinned
`posthog-js@1.386.8` forwards only `maskAllInputs`, `maskTextSelector`, and
`blockSelector` to rrweb and never invokes the callback, so that boundary is
dormant forward-compatibility rather than live coverage.

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
See the [PostHog operating procedure](../../../guides/operating/analytics/posthog.md).
