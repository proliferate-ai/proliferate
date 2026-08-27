# Sentry

Sentry is the exception and release surface: it answers "did it crash, in which build, for which session" and nothing else. It is never a success condition for a product request, never an analytics store, and never the alert-evaluation source — structured logs → CloudWatch → Grafana own alerting ([README](README.md) L3); Sentry contributes exception evidence and the `report_critical` bridge. Everything below is ground truth for the ruled configuration; every difference from `main` today is a row in [Delta vs prod](#delta-vs-prod).

## The account shape

One org, `proliferate`, five projects — ruled 2026-08-26, superseding the eight-project layout. A process inside a shared project is distinguished by its `surface` tag (and by `component` when the canonical-metadata split lands), never by more projects.

| Project | Receives from | Surfaces inside |
| --- | --- | --- |
| `server` | the control plane (API, Celery workers, beat) | `cloud_api` |
| `desktop` | the desktop app | `desktop_renderer`, `desktop_native` |
| `web` | the hosted web client | `web` |
| `mobile` | the mobile app (severed, inert) | `mobile` |
| `rust-runtime` | the runtime binaries | `anyharness_runtime`, `proliferate_worker`, `proliferate_supervisor` |

Live provider state — alert rules, integrations, keys, saved searches — is mutable and discovered, never owned; a checked-in claim about it is a statement of intent. Issue-alert policy (new issue, regression, volume spike; where they route) belongs to the [alerting spec](alerting.md). Discovery procedure: [operating Sentry](../../../guides/operating/analytics/sentry.md).

## Emitters

Seven inits, one rule: hosted-product mode plus a nonempty DSN, or the SDK never initializes and the component runs unaffected.

| Emitter | Gate | Scrubber |
| --- | --- | --- |
| Server (API + background) | `TELEMETRY_MODE=hosted_product` + `SENTRY_DSN` | the closed-catalog projector (below) — not a scrubber, a rebuild |
| Desktop renderer | hosted mode + `VITE_PROLIFERATE_SENTRY_DSN` | `scrub.ts` before-send event/transaction/span/breadcrumb |
| Desktop native | hosted mode + `PROLIFERATE_DESKTOP_SENTRY_DSN` (runtime or baked) | before-send event/breadcrumb/log scrubbers (the worker's module, mirrored) + `send_default_pii=false` |
| Hosted web | telemetry enabled + `VITE_PROLIFERATE_SENTRY_DSN` | shared client scrubbers |
| Mobile | telemetry enabled + `EXPO_PUBLIC_PROLIFERATE_SENTRY_DSN` | shared client scrubbers; screenshot/view-hierarchy off |
| AnyHarness | `ANYHARNESS_SENTRY_DSN` | before-send + scrubbed transport factory; child-agent stderr target excluded entirely |
| Worker + Supervisor | `PROLIFERATE_TARGET_SENTRY_DSN` | before-send event/breadcrumb/log scrubbers |

Source owners:

```text
server/proliferate/integrations/sentry/{__init__,client,privacy}.py
server/proliferate/middleware/{request_telemetry,logging}.py
apps/desktop/src/lib/integrations/telemetry/{client,config,sentry,scrub}.ts
apps/desktop/src-tauri/src/telemetry.rs (+ telemetry/scrub.rs)
apps/web/src/browser/telemetry/{install-web-telemetry,sentry-event-filter,web-telemetry}.ts
apps/mobile/src/lib/integrations/telemetry/{config,sentry}.ts
apps/packages/product-client/src/domain/telemetry/scrub.ts
apps/packages/product-client/src/hooks/telemetry/lifecycle/use-telemetry-session-selection.ts
anyharness/crates/anyharness/src/telemetry.rs (+ telemetry/scrub.rs)
anyharness/crates/proliferate-worker/src/logging.rs (+ logging/scrub.rs)
anyharness/crates/proliferate-supervisor/src/logging.rs
```

## The law: closed catalogs, allowlist never scrub

The server does not sanitize events; it rebuilds them. `privacy.py` projects a new outbound event from a closed catalog of allowed paths, so an unlisted key is structurally absent, not redacted. Validation runs at two boundaries that see different data: pre-SDK public ingress in `client.py` validates the caller's original Python objects (a user id must be a canonical UUID or the scope user becomes `None`; a tag or extra must match a validated catalog row or it drops; a non-`Exception` becomes a generic one; callers cannot set fingerprints), and the serialized-callback boundary (`before_send` + `before_send_transaction` + `before_breadcrumb`) revalidates the SDK's already-serialized shapes structurally and fails closed on anything unexpected. Attachments are cleared and read back; the only synthesized fingerprint is the Stripe webhook-drop key.

Initialization installs exactly eight integrations (Atexit, Celery, Dedupe, Excepthook, Logging, Threading, Starlette, FastAPI) with default and auto-enabling integrations off, and disables trace propagation, Spotlight, client reports, session tracking, logs, metrics, profiling, local variables, source context, request bodies, and query-source capture. Middleware spans are off; the only five span ops the server produces are `http.server`, `websocket.server`, `queue.task.celery`, `queue.process`, `queue.publish`.

Every other emitter installs an explicit before-send scrubber (paths, bearer tokens, query strings, sensitive-key values, frame context) — the closed catalog is server-side law, the scrubbers are client-side defense. AnyHarness additionally excludes direct child-agent stderr from every Sentry signal type via its dedicated tracing target, and a handled runtime problem may emit exactly one bounded incident whose `urn:…:incident:<uuid>` receipt tells downstream layers not to re-capture ([README](README.md) L7).

Never send: email, display name, prompt or transcript content, terminal output, file contents, repository names, raw file paths, request bodies, cookies, authorization headers, tokens, secrets, environment values, provider responses. Correlation identifiers are diagnostic metadata, not permission to copy user content.

Replay is deliberately narrow: web and mobile pin both replay rates to zero; desktop renderer replay is source-disabled (no build or runtime flag can start it); server and Rust components install no replay integration. Re-enablement anywhere requires the separately reviewed privacy proof the prior spec recorded, unchanged.

## Identity on every event

**Release** is `<component>@<version>+<12-hex-sha>` per emitter, stamped at build; unstamped local builds omit the SHA and never claim production identity. Release construction belongs to [delivery](../ci-cd/release-delivery.md).

**Environment** is the closed set `local · staging · production · dogfood` (ruled 2026-08-26). The server admits exactly these (plus `trusted-beta`, production's former name, only until the in-field 0.4.x desktop fleet rotates — dated in `privacy.py`); an unresolvable environment is absent from the event, never guessed from the host. Terraform injects `production` for the hosted server; shipped binaries default to `production`; dev builds default to `local`.

**The correlation spine** ([README](README.md) L1) rides as tags. Server-side the vocabulary is `request_context.py` ContextVars flushed to Sentry at request teardown — request id, sanitized `http_method`/`http_route` (a bounded route template, never a raw-id path), org/tenant, cloud workspace/target/sandbox (logical target and provider sandbox must stay distinct), support report, and the UUID session family (`session_id`, `interaction_id`, `command_id`, `anyharness_workspace_id`). The user is id-only and cleared at teardown so identity cannot bleed across requests.

**`session_id` is bound, never threaded — and admitted, or the bind evaporates.** Three binds, one per leg: the server binds from the request path (`/sessions/<uuid>`) or an explicit `with_correlation_context(...)` at job/proxy entry; the runtime records it as a span field at the session entry points and a dedicated layer maps the nearest enclosing span's validated value onto each Sentry event (canonical lowercase UUID only — custom client-supplied ids stay local); the clients tag it from the session-selection store when a session gains focus and clear it on close. A signal raised doing session work carries the session's id on all three legs; `session_id:<uuid>` tag search in any project returns that session's slice of the story.

## report_critical — the one bridge to alerting

`report_critical(...)` emits a fatal Sentry event tagged `critical_failure=true` **and** the `CRITICAL_FAILURE` structured-log marker in the same call — the only sanctioned way an application failure becomes a page-worthy alert, because the log marker is what the Grafana rule selects. Reserve it for real paging conditions.

## How you check it

- Org: `https://proliferate.sentry.io` — five project inboxes; triage happens here (no aggregation queue, by ruling).
- One session's story: tag search `session_id:<uuid>` in the relevant project; the [link scheme](README.md) builds this URL from the id.
- A deployment's health: filter by `release` + `environment` + `surface` together — one alone is not evidence.
- Delivery proof is live evidence: a rule existing in the UI proves nothing; a test notification received does ([alerting spec](alerting.md)).

## Instrumenting a new feature

Choose by what actually happened, never `raise` to flag a non-failure:

| Situation | Use | Effect |
| --- | --- | --- |
| The operation genuinely failed | let the exception propagate | auto-captured `proliferate-server` issue |
| An anomaly the user did not feel | `capture_server_sentry_exception(..., level="warning", tags={"domain": ..., "action": ...})` | tracked issue, request still succeeds |
| A page-worthy "must never happen" | `report_critical(...)` | fatal event + the `CRITICAL_FAILURE` marker that drives the alert path |

Grouping is the exception type plus catalog tags — raise a distinct type for a distinct anomaly. Emit on threshold, in code, never per call ([README](README.md) L6). New tag/extra keys are added as validated catalog rows with a test, never passed ad hoc at a call site.

## Failure behavior

- A missing DSN or non-hosted mode never prevents a component from starting or handling work; local logs remain the fallback.
- Provider delivery is diagnostic; it is never a product request's success condition. An incident receipt proves the runtime owned the capture attempt, not that Sentry persisted it.
- Upload scripts skip when provider upload configuration is incomplete; a green build alone does not prove a provider release or debug file exists.
- The Rust workspace's `sentry`, `sentry-anyhow`, and `sentry-tracing` must resolve to a single `sentry-core`. A version split captures into a clientless Hub and silently drops every runtime ERROR (production incident 2026-06-14 → 2026-07-15); the `tracing_error_reaches_the_sentry_client` tests in AnyHarness, Worker, and Supervisor fail on any new divergence.

## Delta vs prod

Temporary — deleted at convergence. Structural differences between this document and `main` today:

| Spec says | Prod today | The change |
| --- | --- | --- |
| `http_route` rides as a bounded route-template tag | set on every request, silently dropped by the catalog | #2255 |
| runtime ERRORs carry `session_id` | runtime events stop at org/user/sandbox/target | #2256 |
| clients tag the active session; desktop-native scrubs before send | no client session tag; desktop-native is the one unscrubbed emitter | #2257 |
| environment set `local · staging · production · dogfood` | code defaults still say `trusted-beta`/`development`; catalog admits `Production` | #2258 |
| operational read key: `~/.proliferate-local/observability-keys.env` backed by a 1Password entry + re-mint runbook line | the Aug-21 keys file died in an Aug-22 wipe; no read token exists on the working machine | re-mint + custody (ruled 2026-08-26); update the operating guide when done |

## Build list

Dependency-ordered; each row names the delta it discharges.

- [ ] #2255, #2256, #2257, #2258 merge (rows 1–4).
- [ ] Re-mint `SENTRY_READ_TOKEN` into the ruled custody (row 5); record the re-mint line in [operating Sentry](../../../guides/operating/analytics/sentry.md).
- [ ] Live gate, once deployed: one synthetic `report_critical` in staging → issue tagged `critical_failure=true` and the Slack rule fires; one runtime ERROR inside a session → `session_id:` search finds it in `rust-runtime`; one renderer exception with a session open → same search in `desktop`.
- [ ] Remove `trusted-beta` from the admission catalog once the desktop fleet has rotated past 0.4.x baked defaults.
