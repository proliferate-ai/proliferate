# Sentry Setup Runbook

Operational checklist for first-time Sentry setup. Reference doc is
`sentry.md` — that owns the canonical project list, env-var names, and privacy
posture. This doc is the click-through.

## 1. Org-level prep

In Sentry org `proliferate`:

1. **Settings → Integrations → Slack**: install. Authorize the Slack workspace.
   This enables routing alert actions to channels.
2. **Settings → Auth Tokens**: confirm a project-scoped auth token exists for
   release / debug-file uploads. Token already lives in GitHub secret
   `SENTRY_AUTH_TOKEN`.

## 2. Create projects

For each row below: **Projects → Create Project →** pick platform, name it
exactly as shown, copy the DSN from the suggested SDK init screen.

| Project slug | Platform | Owns errors from |
|---|---|---|
| `proliferate-server` | Python · FastAPI | server (`server/`) |
| `proliferate-desktop` | JavaScript · React | desktop renderer (`desktop/src/`) |
| `proliferate-desktop-native` | Rust | Tauri shell (`desktop/src-tauri/`) |
| `anyharness` | Rust | bundled + cloud AnyHarness runtime |
| `proliferate-target` | Rust | cloud supervisor + worker binaries |
| `proliferate-web` | JavaScript · React | hosted web app (`web/`) |
| `proliferate-mobile` | React Native | Expo mobile app (`mobile/`) |

After creating each project, paste its DSN into the corresponding row of the
hand-off table in section 5.

## 3. Slack integration per project

Once Slack is installed at org level, each project gets the same alert action
available. No per-project Slack install is required.

## 4. Alert rules

Create the following in each project: **Alerts → Create Alert → Issues**.

### Default rule (every project)

- **Conditions**:
  - A new issue is created
  - OR: The issue changes state from resolved to unresolved (regression)
- **Filters**:
  - The issue's level is equal to `error` or higher
  - The event's environment is equal to `production`
- **Actions**:
  - Send a Slack notification to workspace `proliferate`, channel
    `#proliferate-errors`
- **Frequency**: perform actions at most once every `30 minutes` for an issue
- **Name**: `prod errors → #proliferate-errors`

### High-priority escalation (server + target only)

For `proliferate-server` and `proliferate-target`, add a second rule:

- **Conditions**:
  - An issue is seen more than `25` times in `1 hour`
- **Filters**:
  - The event's environment is equal to `production`
- **Actions**:
  - Send a Slack notification to channel `#proliferate-errors` with the prefix
    `[burst]`
- **Frequency**: at most once every `1 hour` per issue
- **Name**: `prod burst → #proliferate-errors`

### Native-crash rule (desktop-native + target only)

For `proliferate-desktop-native` and `proliferate-target`:

- **Conditions**:
  - A new issue is created
- **Filters**:
  - The event's `mechanism.handled` is equal to `false`
  - The event's environment is equal to `production`
- **Actions**:
  - Send a Slack notification to `#proliferate-errors` with the prefix
    `[native crash]`
- **Name**: `prod native crash → #proliferate-errors`

Skip the high-priority and native-crash rules in client projects (`desktop`,
`web`, `mobile`) until baseline volume is known — the default rule covers them.

## 5. Hand-off table

After projects exist, paste DSNs here, then I'll wire them.

| Project | DSN target |
|---|---|
| `proliferate-server` | AWS Secrets Manager `proliferate/prod/server-app` key `SENTRY_DSN` (already set) |
| `proliferate-desktop` | GitHub var `VITE_PROLIFERATE_SENTRY_DSN` (already set) |
| `proliferate-desktop-native` | GitHub var `PROLIFERATE_DESKTOP_SENTRY_DSN` (already set) |
| `anyharness` | GitHub var `ANYHARNESS_SENTRY_DSN` (already set) |
| `proliferate-target` | AWS Secrets Manager `proliferate/prod/server-app` key `CLOUD_TARGET_SENTRY_DSN` (**new — needs to be added**) |
| `proliferate-web` | GitHub var `VITE_PROLIFERATE_SENTRY_DSN` for web build (**new var needed if web has its own deploy**) |
| `proliferate-mobile` | EAS env `EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN` (**new — needs to be set**) |

Also set these non-secret GitHub variables once projects exist (used by
`release-desktop.yml` and the mobile sourcemap script):

- `SENTRY_URL=https://sentry.io/`
- `SENTRY_WEB_PROJECT=proliferate-web`
- `SENTRY_DESKTOP_NATIVE_PROJECT=proliferate-desktop-native`
- `SENTRY_ANYHARNESS_PROJECT=anyharness`
- `SENTRY_MOBILE_PROJECT=proliferate-mobile`

## 6. Verification

After each project is created and the default rule is active:

1. **Test event**: Project → Settings → Debug → "Send a test event". Confirm
   it appears in Issues.
2. **Slack alert dry-run**: edit the test issue's `level` to `error` if needed,
   then resolve and re-trigger. Confirm a Slack message lands in
   `#proliferate-errors`.
3. **Release association** (server + clients only): confirm releases show up
   under Releases after the next prod deploy / desktop build.

## 7. Out of scope for this runbook

- PostHog setup — see `posthog.md`.
- Customer.io — see `customerio.md`.
- Slack channel + webhook creation — that's a Slack workspace admin task,
  separate from Sentry's Slack integration.
