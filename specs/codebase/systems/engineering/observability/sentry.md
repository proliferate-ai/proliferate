# Sentry

Sentry is Proliferate's hosted exception, crash, trace, and diagnostic
breadcrumb destination. This document describes current code behavior; exact
projects, alert rules, integrations, and notification channels are mutable
provider state and are not repository law.

## Component behavior

| Source component | Applies when | Data and identity | No-op behavior |
| --- | --- | --- | --- |
| Server API and server background processes | `TELEMETRY_MODE=hosted_product`, the SDK is installed, and `SENTRY_DSN` is nonempty | Scrubbed exceptions, traces, log breadcrumbs, `proliferate-server` release, environment, `surface=cloud_api`, telemetry mode, user id, and allowlisted request/product correlation tags | Initialization and capture helpers return without sending when any gate is absent. |
| Desktop renderer | The runtime resolves to `hosted_product`, build/runtime telemetry is not disabled, and `VITE_PROLIFERATE_SENTRY_DSN` is nonempty | Scrubbed React errors, traces, product breadcrumbs, id-only user, Desktop release/environment, surface and telemetry-mode tags, and error replay | Local-dev/self-managed/disabled routing or a missing DSN leaves the renderer SDK uninitialized. |
| Desktop native shell | Native telemetry mode is `hosted_product` and `PROLIFERATE_DESKTOP_SENTRY_DSN` is available at runtime or baked into the build | Native tracing failures and stack traces with Desktop-native release/environment and surface/runtime tags | Other modes or a missing DSN retain console/file logging without Sentry. |
| Hosted Web | Telemetry is not disabled and `VITE_PROLIFERATE_SENTRY_DSN` is nonempty | Scrubbed React errors, traces, breadcrumbs, id-only user, Web release/environment, and `surface=web` | The SDK remains uninitialized when disabled or unconfigured. |
| Hosted Mobile | Telemetry is not disabled and `EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN` is nonempty | Scrubbed React Native errors, native crashes, traces, breadcrumbs, id-only user, Mobile release/environment, and `surface=mobile` | The SDK remains uninitialized when disabled or unconfigured. |
| AnyHarness runtime | Hosted deployment/launch supplies `ANYHARNESS_SENTRY_DSN` | Rust tracing failures and stack traces, AnyHarness release/environment, runtime surface/environment, and available user/org/sandbox/target identity | A missing DSN preserves console/file logging without Sentry. Supported self-managed deployment leaves the Proliferate vendor DSN unset. |
| Managed Worker and Supervisor | Hosted bootstrap supplies `PROLIFERATE_TARGET_SENTRY_DSN` | Scrubbed Rust events/logs/breadcrumbs, component-specific release, environment, runtime surface, and available user/org/sandbox/target identity | A missing DSN preserves normal tracing without Sentry. |

Source owners:

```text
server/proliferate/integrations/sentry.py
server/proliferate/middleware/request_telemetry.py
server/proliferate/utils/logging.py
apps/desktop/src/lib/integrations/telemetry/{client,config,sentry,scrub}.ts
apps/desktop/src-tauri/src/telemetry.rs
apps/web/src/lib/integrations/telemetry/{config,sentry}.ts
apps/mobile/src/lib/integrations/telemetry/{config,sentry}.ts
anyharness/crates/anyharness/src/telemetry.rs
anyharness/crates/proliferate-worker/src/logging.rs
anyharness/crates/proliferate-supervisor/src/logging.rs
server/proliferate/server/cloud/runtime/bootstrap.py
```

## Releases and environments

Each emitter uses its own component release. Production delivery stamps the
component version and 12-character source SHA; local or unstamped fallbacks do
not claim production artifact identity. The server also validates an override
before accepting it as a `proliferate-server` release. Worker and Supervisor
have separate emergency release overrides because one target-wide release
cannot identify both binaries.

Release construction and immutable artifact identity belong to
[Delivery](../delivery/README.md). Sentry project names only route provider
events; they are not release component names.

Environment comes from the component's configured Sentry environment. It is
separate from the release and from provider project routing. Operators must
filter by all three when validating a deployment.

Client source maps and native debug files are uploaded only when their release
workflow has complete upload credentials and project metadata. Desktop and Web
Vite builds use hidden source maps when upload is enabled and delete the local
map files after upload. The Desktop release workflow uploads Desktop-native
and AnyHarness debug files. Mobile's upload script skips when its upload
environment is incomplete. Provider release/debug-file presence is still live
evidence and must be discovered rather than inferred from a checked-in
workflow.

## Privacy and replay

The server, renderer clients, Worker, and Supervisor disable default PII and
scrub sensitive keys and values before sending. The client scrubbers remove
frame source context and variables, redact request bodies/cookies, reduce users
to `id`, and sanitize URLs, paths, breadcrumbs, transactions, and spans. Server
scrubbing redacts request data and cookies, removes user IP addresses, and
sanitizes headers, URLs, messages, breadcrumbs, tags, and extras.

Do not send email, display name, prompt or transcript content, terminal output,
file contents, repository names, raw file paths, request bodies, cookies,
authorization headers, tokens, secrets, environment values, or provider
responses. Correlation identifiers are diagnostic metadata, not permission to
copy user content into Sentry.

Replay defaults are deliberately narrow:

- Web and Mobile set normal and error replay rates to zero. Mobile also
  disables screenshot and view-hierarchy attachment.
- Desktop renderer sets normal session replay to zero. Error replay uses
  `VITE_PROLIFERATE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE` (default `1.0`) only
  when hosted vendor telemetry is enabled; all text and inputs are masked and
  `[data-telemetry-block]` / `[data-telemetry-mask]` are honored.
- Server and Rust runtime components do not initialize a replay integration.

Known current privacy gaps: Desktop-native and AnyHarness attach stack traces
but do not install explicit before-send event/breadcrumb scrubbers, and Desktop
renderer error replay can retain identifier-bearing route metadata despite
text/input masking. Callers must keep user content and secrets out of tracing
fields. Worker and Supervisor do have explicit event, breadcrumb, and log
scrubbers.

## Correlation

The server's request telemetry binds a generated request id, sanitized HTTP
route/method, id-only authenticated user, and known allowlisted correlation
fields. Current allowed context includes organization/tenant, support report,
cloud workspace/target/sandbox, AnyHarness workspace, session, interaction,
command, and worker identifiers. Request teardown clears the Sentry user to
prevent cross-request identity leakage.

Server background work restores the same correlation context where its owner
propagates it. `report_critical(...)` emits both a fatal Sentry event tagged
`critical_failure=true` and a structured log containing the same stable marker.

Non-debug server logs are JSON. Each record includes timestamp, level, logger,
message, canonical `release_id`, version, available Git SHA, correlation
context, and scalar extras. In the hosted deployment those logs are the source
for CloudWatch/Grafana evaluation; Sentry is the exception/trace source. The
two surfaces correlate through release and request/product identifiers rather
than by copying full evidence bodies between systems.

[Issue Lifecycle](../issue-lifecycle/README.md) owns polling or receiving this
provider evidence, deduplicating it, routing it into canonical issues, and
following up with reporters. Observability does not own tracker state.

## Failure behavior

- Missing DSNs or disabled/non-hosted telemetry must not prevent the component
  from starting or handling work.
- Capture helpers normalize non-exception values and scrub extras before send.
- Upload scripts skip when optional provider upload configuration is
  incomplete; a successful build alone does not prove a provider release or
  debug file exists.
- Provider delivery is diagnostic and must not become a product request's
  success condition.
- Local file or structured logs remain the primary fallback when Sentry is
  absent or unavailable.

Use the [Sentry operating procedure](../../../../developing/operating/analytics/sentry.md)
to discover current provider state and verify delivery without exposing
credentials.
