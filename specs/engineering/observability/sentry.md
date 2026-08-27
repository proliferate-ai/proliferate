# Sentry

Sentry is Proliferate's hosted exception, crash, trace, and diagnostic breadcrumb destination. This document describes current code behavior; exact projects, alert rules, integrations, and notification channels are mutable provider state and are not repository law.

## Component behavior

| Source component | Applies when | Data and identity | No-op behavior |
| --- | --- | --- | --- |
| Server API and server background processes | `TELEMETRY_MODE=hosted_product`, the SDK is installed, and `SENTRY_DSN` is nonempty | Scrubbed exceptions, traces, log breadcrumbs, `proliferate-server` release, environment, `surface=cloud_api`, telemetry mode, user id, and allowlisted request/product correlation tags | Initialization and capture helpers return without sending when any gate is absent. |
| Desktop renderer | The runtime resolves to `hosted_product`, build/runtime telemetry is not disabled, and `VITE_PROLIFERATE_SENTRY_DSN` is nonempty | Scrubbed React errors, traces, product breadcrumbs, id-only user, Desktop release/environment, and surface and telemetry-mode tags | Local-dev/self-managed/disabled routing or a missing DSN leaves the renderer SDK uninitialized. |
| Desktop native shell | Native telemetry mode is `hosted_product` and `PROLIFERATE_DESKTOP_SENTRY_DSN` is available at runtime or baked into the build | Native tracing failures and stack traces with Desktop-native release/environment and surface/runtime tags | Other modes or a missing DSN retain console/file logging without Sentry. |
| Hosted Web | Telemetry is not disabled and `VITE_PROLIFERATE_SENTRY_DSN` is nonempty | Scrubbed React errors, traces, breadcrumbs, id-only user, Web release/environment, and `surface=web` | The SDK remains uninitialized when disabled or unconfigured. |
| Hosted Mobile | Telemetry is not disabled and `EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN` is nonempty | Scrubbed React Native errors, native crashes, traces, breadcrumbs, id-only user, Mobile release/environment, and `surface=mobile` | The SDK remains uninitialized when disabled or unconfigured. |
| AnyHarness runtime | Hosted deployment/launch supplies `ANYHARNESS_SENTRY_DSN` | Scrubbed Rust tracing failures and stack traces, AnyHarness release/environment, runtime surface/environment, and available user/org/sandbox/target identity | A missing DSN preserves console/file logging without Sentry. Supported self-managed deployment leaves the Proliferate vendor DSN unset. |
| Managed Worker and Supervisor | Hosted bootstrap supplies `PROLIFERATE_TARGET_SENTRY_DSN` | Scrubbed Rust events/logs/breadcrumbs, component-specific release, environment, runtime surface, and available user/org/sandbox/target identity | A missing DSN preserves normal tracing without Sentry. |

Source owners:

```text
server/proliferate/integrations/sentry/{__init__,client,privacy}.py
server/proliferate/middleware/request_telemetry.py
server/proliferate/middleware/logging.py
apps/desktop/src/lib/integrations/telemetry/{client,config,sentry,scrub}.ts
apps/desktop/src-tauri/src/telemetry.rs
apps/web/src/browser/telemetry/{install-web-telemetry,sentry-event-filter,web-telemetry}.ts
apps/mobile/src/lib/integrations/telemetry/{config,sentry}.ts
apps/packages/product-client/src/domain/telemetry/scrub.ts
anyharness/crates/anyharness/src/telemetry.rs
anyharness/crates/proliferate-worker/src/logging.rs
anyharness/crates/proliferate-supervisor/src/logging.rs
server/proliferate/server/cloud/runtime/bootstrap.py
```

## Releases and environments

Each emitter uses its own component release. Production delivery stamps the component version and 12-character source SHA; local or unstamped fallbacks do not claim production artifact identity. The server also validates an override before accepting it as a `proliferate-server` release. Worker and Supervisor have separate emergency release overrides because one target-wide release cannot identify both binaries.

Release construction and immutable artifact identity belong to [Delivery](../ci-cd/release-delivery.md). Sentry project names only route provider events; they are not release component names.

Environment comes from the component's configured Sentry environment. It is separate from the release and from provider project routing. Operators must filter by all three when validating a deployment.

Client source maps and native debug files are uploaded only when their release workflow has complete upload credentials and project metadata. Desktop and Web Vite builds use hidden source maps when upload is enabled and delete the local map files after upload. The Desktop release workflow uploads Desktop-native and AnyHarness debug files. Mobile's upload script skips when its upload environment is incomplete. Provider release/debug-file presence is still live evidence and must be discovered rather than inferred from a checked-in workflow.

## Privacy and replay

The server, renderer clients, AnyHarness, Worker, and Supervisor disable default PII and scrub sensitive keys and values before sending. The client scrubbers remove frame source context and variables, redact request bodies/cookies, reduce users to `id`, and sanitize URLs, paths, breadcrumbs, transactions, and spans.

The Server is not a scrubber. `sentry/privacy.py` builds a new outbound event from a closed catalog of allowed paths, so an unlisted key is structurally absent rather than redacted, and no sanitized route, URL, header, or message survives at all. Validation runs at two boundaries that see different data:

- **Pre-SDK public ingress** in `sentry/client.py` validates the caller's
  original Python objects before any SDK call. A user id must be a canonical
  UUID or the scope user is set to `None`; a tag or extra must match a
  validated catalog row or it is dropped; a non-`Exception` value becomes a
  generic `Exception("Unknown error")` rather than being stringified; callers
  cannot set a fingerprint.
- **The serialized-callback boundary.** One shared callable is registered as
  both `before_send` and `before_send_transaction`, and `_project_breadcrumb`
  as `before_breadcrumb` plus an embedded backstop. These see only the SDK's
  already-serialized JSON-compatible representation and cannot recover erased
  Python provenance, so they revalidate everything structurally and fail
  closed (return `None`) on any unexpected shape.

Attachments have no init kwarg; the event callback clears them by assigning `hint["attachments"] = []` on an exact `dict` hint and reading back an exact empty list, dropping the event if either step fails. The only emitted fingerprint is the adapter-synthesized `["billing", "stripe_webhook_drop", <drop_reason>]`.

Initialization installs exactly eight integrations — Atexit, Celery, Dedupe, Excepthook, Logging, Threading, Starlette, FastAPI — with `default_integrations=False` and `auto_enabling_integrations=False`, and disables ambient trace propagation, Spotlight, client reports, session tracking, logs, metrics, profiling, gen-AI span streaming, local variables, source context, request bodies, and DB/HTTP query-source capture. Middleware spans are off on both ASGI integrations. The only five span ops the Server produces are `http.server`, `websocket.server`, `queue.task.celery`, `queue.process`, and `queue.publish`; `queue.submit.celery` and every `middleware.starlette*` op are explicit negatives and never survive.

`environment` is a closed four-value catalog: `trusted-beta`, `staging`, `production`, `Production`. Release and environment are passed to `init` as exact empty strings when they do not validate. Under the pinned SDK, `""` is the no-discovery sentinel: only `None` triggers ambient `get_default_release()`, `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`, and the literal `production` default. Both event callbacks then remove the empty-string sentinel, so an unresolvable release or environment is absent from the outbound event rather than guessed from the host.

Do not send email, display name, prompt or transcript content, terminal output, file contents, repository names, raw file paths, request bodies, cookies, authorization headers, tokens, secrets, environment values, or provider responses. Correlation identifiers are diagnostic metadata, not permission to copy user content into Sentry.

AnyHarness marks direct child-agent stderr events with a dedicated tracing target that the Sentry layer ignores while console/file logging remains available locally. The exclusion applies to Sentry events, breadcrumbs, and structured logs. A startup failure retains at most eight lines and 1,024 UTF-8 bytes per line, writes that bounded tail to the excluded local diagnostic, and carries it in a domain-owned typed error for the initiating authenticated API response. Ordinary error formatting and API telemetry use a status-only summary. The response also carries the stable `AGENT_STARTUP_FAILED` code; `@anyharness/sdk` uses that structured problem to create a detached telemetry error whose message and metadata derive only from a validated code and HTTP status, with no original problem or cause chain. ProductClient applies that projection both at its explicit exception facade and its global React Query capture boundary while preserving the original detail for UI. Raw provider output is not a safe Sentry grouping key or exception message.

When a handled AnyHarness problem genuinely prevents an operation, the runtime may emit one error-level incident before returning the truthful non-5xx problem. The event uses a stable message and fingerprint plus bounded, allowlisted launch-selection metadata; it never uses the problem detail or raw provider output as its message. A runtime-minted incident UUID is returned in the existing RFC 7807 `instance` field as a capability receipt so callers can avoid reporting the same failure again. The receipt attests runtime ownership, not successful provider delivery.

Two exact, bounded fields are deliberately preserved through the scrubbers because they are deployment identity, not a raw process-environment map:

- The top-level Sentry `environment` field (for example `production`). The
  Server retains it only when it matches the closed four-value catalog. The
  shared ProductClient domain `scrubTelemetryEvent` envelope wrapper (used by
  the Web, Desktop, and Mobile adapters) snapshots only that top-level string,
  runs the recursive scrubber, then restores the snapshot scrubbed as text.
  Nested `environment`/`env` keys and raw environment maps stay redacted.
- The `runtime_env` tag on Worker and Supervisor events, whose only allowed
  live value is `e2b`. Every other env-like tag key stays redacted.

Outside the bounded handled-incident contract above, nothing beyond user ID, sandbox ID, target ID, bounded runtime environment, deployment environment, release version, and source revision is added to any event.

Replay behavior is deliberately narrow:

- Web and Mobile set normal and error replay rates to zero. Mobile also
  disables screenshot and view-hierarchy attachment.
- Desktop renderer replay is source-disabled and absent; no build or runtime
  configuration can enable it. Re-enablement requires a separately reviewed
  synthetic privacy proof of the exact route/surface block-and-mask policy,
  metadata policy, provider arrival, and absence of prompt, transcript,
  terminal, file, repository, path, token, workspace, session, and workflow
  identifiers.
- Server and Rust runtime components do not initialize a replay integration.

The known current privacy gap is that Desktop-native attaches stack traces but does not install an explicit before-send event/breadcrumb scrubber. Callers must keep user content and secrets out of tracing fields. AnyHarness, Worker, and Supervisor do have explicit event, breadcrumb, and log scrubbers.

## Correlation

The server's request telemetry binds a generated request id, sanitized HTTP route/method, id-only authenticated user, and known allowlisted correlation fields. Current allowed context includes organization/tenant, support report, cloud workspace/target/sandbox, AnyHarness workspace, session, interaction, command, and worker identifiers. Request teardown clears the Sentry user to prevent cross-request identity leakage.

Server background work restores the same correlation context where its owner propagates it. `report_critical(...)` emits both a fatal Sentry event tagged `critical_failure=true` and a structured log containing the same stable marker.

Non-debug server logs are JSON. Each record includes timestamp, level, logger, message, canonical `release_id`, version, available Git SHA, correlation context, and scalar extras. In the hosted deployment those logs are the source for CloudWatch/Grafana evaluation; Sentry is the exception/trace source. The two surfaces correlate through release and request/product identifiers rather than by copying full evidence bodies between systems.

Managed-cloud launch binds the logical cloud sandbox as AnyHarness `target_id` and the provider sandbox as `sandbox_id`; the two identifiers must remain distinct. A handled AnyHarness incident adds a fresh incident UUID and the bounded request/session selection context needed to connect its runtime event to the caller-visible RFC 7807 problem without copying user content.

No system currently polls or receives this provider evidence as issues; the issue-lifecycle system was retired in the 2026-08 engineering cull. Observability does not own tracker state.

## Failure behavior

- Missing DSNs or disabled/non-hosted telemetry must not prevent the component
  from starting or handling work.
- Capture helpers normalize non-exception values and scrub extras before send.
- Upload scripts skip when optional provider upload configuration is
  incomplete; a successful build alone does not prove a provider release or
  debug file exists.
- Provider delivery is diagnostic and must not become a product request's
  success condition.
- An AnyHarness incident receipt proves that the runtime owned the capture
  attempt; it does not prove that Sentry accepted or persisted the event.
- Local file or structured logs remain the primary fallback when Sentry is
  absent or unavailable.
- The Rust workspace's `sentry`, `sentry-anyhow`, and `sentry-tracing`
  dependencies must resolve to a single `sentry-core` instance. A version
  split links two `sentry-core` crates, the tracing layer then captures into a
  clientless Hub, and every runtime ERROR event is silently dropped while
  local logs still show the error (production incident 2026-06-14 to
  2026-07-15: a `sentry`-only bump left `sentry-tracing` behind; discovered by
  slice C's canary against the B2-deployed runtime and repaired as a B2
  amendment). The `tracing_error_reaches_the_sentry_client` tests in
  AnyHarness, Worker, and Supervisor fail on any new divergence.

Use the [Sentry operating procedure](../../../guides/operating/analytics/sentry.md) to discover current provider state and verify delivery without exposing credentials.

## Instrumenting a new feature

Recommendation for surfacing "this should/shouldn't happen" signals so they land as Sentry issues. Choose by what actually happened, not by convenience — do not `raise` to flag a non-failure.

| Situation | Use | Effect |
| --- | --- | --- |
| The operation genuinely failed | let the exception propagate | auto-captured as a `proliferate-server` issue |
| An anomaly the user didn't feel — latency budget exceeded, invariant violated, unexpected-but-recovered branch | `capture_server_sentry_exception(..., level="warning", tags={"domain": ..., "action": ...})` | tracked issue, request still succeeds |
| A page-worthy "must never happen" invariant | `report_critical(...)` | fatal Sentry event **and** the `CRITICAL_FAILURE` log marker that drives the Grafana/CloudWatch alert path |

Conventions that keep issues clean and countable:

- **Grouping is the exception type plus the catalog tags.** Callers cannot set
  a fingerprint on the Server; the only synthesized one is the Stripe
  webhook-drop key. Raise a distinct exception type for a distinct anomaly so
  one issue accrues occurrences instead of spawning thousands.
- **Emit on threshold, not per call.** For latency, measure and emit only when a
  budget is exceeded; the budget belongs in code, not in an alert rule.
- **Tag and extra keys come from the closed catalog** in `sentry/privacy.py`
  (`domain`, `action`, and the other validated rows). `anomaly`, `elapsed_ms`,
  and `budget_ms` are not catalog keys and are removed in transit. Surfacing a
  new slice means adding a validated row with a bounded validator and a test,
  not passing a new key at the call site.
- Obey [Privacy and replay](#privacy-and-replay): tags/extras carry identifiers
  and bounded scalars, never message/prompt/transcript content or secrets.

Reserve `report_critical` for real paging conditions; a `warning` anomaly that fires constantly trains everyone to ignore the fatal ones.
