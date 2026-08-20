
Status: Current-system context pack, prepared overnight 2026-08-19 → 2026-08-20 for ADR design work.
Repository: `/Users/pablohansen/proliferate`. Grounded against the overnight research pin `8532f52b226413458721b46839fc78b852b69373` and verified against `main` at `d0b7b585b71b5f064eb8ba290090d95e31d2ac5c` (2026-08-20 04:35 UTC).
Read this in about 20 minutes. Every claim about code carries a `file:line` pointer; every claim about a live provider carries the run that measured it. §8 is general external-system knowledge, clearly separated from claims about this codebase.

# 1. Executive summary

Proliferate already runs six separate observability systems: Sentry (exceptions), PostHog (product analytics), CloudWatch/Grafana (hosted logs, metrics, alerts), a Desktop-local diagnostics collector (memory-only, feeds Support snapshots and an internal Honeycomb export), and a production issue tracker. None of these form one control plane. Each has a different owner, a different identity scheme, and a different proof surface, and several provider states are simply unread: not broken, unknown.

Overnight 2026-08-19 an "Observability Control Plane" program (`ADRs/Observability/Control Plane 2026-08-19/`) ran a three-lane live-provider audit, froze ten scoped specs (CP-00 through CP-09), and shipped nine of them as merged PRs before morning:

- Session replay is now source-disabled on every client surface: Desktop Sentry (#2083), Desktop PostHog (#2093), Web PostHog (#2096), Mobile PostHog (#2097).
- Server Sentry transport now enforces privacy at the transport boundary rather than trusting scrubbers alone (#2087, "CP-S2B").
- Client-side vendor privacy leaks (email/display-name surviving the shared scrubber) are closed (#2064, "CP-S2A").
- Support's Slack-notification receipt, which unconditionally recorded success even when Slack was unconfigured or failed, now records the truth (#2061, "CP-S1").
- Support's Save-copy flow, which silently dropped cleanup failures, now surfaces them (#2084, "CP-U1").
- A read-only Grafana metadata inventory now exists (#2085, "CP-G0").

What did not ship: `observe doctor`/`observe issue` (the proposed unified read-only operator CLI, CP-00A/09, spec only, no code), the full issue lifecycle (evidence to dedup to claim to fixing PR to recovery, CP-08B/09, spec only), and CP-D1 (profile-managed debug runtime activation, meant to close a real collector-restart delivery gap in the dev-only activation path, still an unopened spec, see §7).

Two independent findings should reset the reader's prior model. First, most "is this system working" questions are currently unknown, not green: Sentry/PostHog live event state, Grafana's live dashboards/rules/routes, and Honeycomb's live dataset freshness were all found unauthorized, unread, or empty during the overnight audit (§6). Second, two Postgres tables (`agent_model_snapshot`, `agent_catalog_override`) are live in production with no ORM model pointing at them and no drop migration, a direct side effect of the unrelated launch-options cutover (#2070) that merged the same day (§3, §7).

# 2. High-level architecture

```mermaid
flowchart TB
    subgraph SRC["Source surfaces"]
        DESK["Desktop (renderer + Tauri native)"]
        WEB["Web"]
        MOB["Mobile"]
        SRV["Server"]
        AH["AnyHarness"]
        WRK["Desktop Worker"]
        SUP["Supervisor"]
    end

    subgraph SENTRY["Sentry (exceptions)"]
        SDK["8 named SDK initializers<br/>no shared 'component' field"]
    end

    subgraph PH["PostHog (product analytics)"]
        CAT["25-event typed catalog<br/>autocapture + replay off"]
    end

    subgraph LOCAL["Desktop-local diagnostics"]
        COLL["Memory-only collector<br/>authenticated loopback"]
        SNAP["Consented support snapshot"]
        OTLP["Feature-gated OTLP export<br/>internal builds only"]
    end

    subgraph HOSTED["Hosted logs / metrics"]
        CW["CloudWatch log groups + 3 custom metrics"]
        GRAF["AWS Managed Grafana<br/>6 checked-in rules"]
    end

    subgraph EVID["Evidence + response"]
        HC["Honeycomb (dogfood only)"]
        SUPPORT["Support DB + object store"]
        ISSUE["Issue tracker<br/>scripts/issues.py"]
    end

    DESK -- exceptions --> SDK
    WEB -- exceptions --> SDK
    MOB -- exceptions --> SDK
    SRV -- exceptions --> SDK
    AH -- exceptions --> SDK
    WRK -- exceptions --> SDK
    SUP -- exceptions --> SDK

    DESK -- typed events --> CAT
    WEB -- typed events --> CAT
    MOB -- typed events --> CAT

    DESK -- diagnostics --> COLL
    AH -- diagnostics (inherited fd) --> COLL
    WRK -- diagnostics (inherited fd) --> COLL
    COLL -- consent + scrub --> SNAP
    COLL -- accepted non-secret records --> OTLP
    OTLP --> HC

    SRV -- stdout --> CW
    WRK -- stdout --> CW
    AH -- stdout --> CW
    CW -- metric filters --> GRAF

    SDK -.-> ISSUE
    GRAF -.-> ISSUE
    SNAP --> SUPPORT
    SUPPORT -.-> ISSUE
```

Structural facts worth internalizing:

- **Four planes, one shared rule, no shared code.** Each destination gets a different minimum shape (exception/stack for Sentry, typed event for PostHog, small operation-result for central logs, richer record for the local collector), but the intended shared discipline is just `timestamp` + `component` + `environment` + `release` (`Control Plane 2026-08-19/01 - Shared Instrumentation Contract.md:17-24`). Today no Sentry initializer actually sets a field literally named `component`; the eight surfaces (Server, Web, Desktop renderer, Desktop native, Mobile, AnyHarness, Worker, Supervisor) use a `surface` tag and/or a component-prefixed release string instead.
- **The local collector never touches disk.** Retention is one bounded in-memory ring; the only disk writers in that subtree are the outage-only fallback log, the support artifact store, and (once shipped) the dogfood config plane's key file.
- **Internal OTLP export to Honeycomb is compiled out of every customer binary.** It rides a non-default Cargo feature (`internal-dogfood-export`); the release workflow greps every packaged binary for the endpoint env-var literal and fails the bundle if it's present (`.github/workflows/release-desktop.yml:438`).
- **The alert-evaluation source is CloudWatch/Grafana, not Sentry.** `specs/OBSERVABILITY.md:37-38` states this explicitly; Sentry is diagnostic, never a product request's success condition.

# 3. Data models

## The diagnostics wire contract (`ProducerRecordV1`)

Everything inside the local-collector plane rides one record type (`anyharness/crates/proliferate-diagnostics-protocol/src/v1/types.rs:261`):

- schema `1.1` (accepts producer minors 1.1/1.0, never forward-compatible);
- producer identity: source timestamp, monotonic `producer_sequence` per (component, `producer_boot_id`), closed `ComponentV1` enum (`DesktopRenderer | DesktopTauri | DiagnosticsCollector | Anyharness | DesktopWorker | Server`), release, environment;
- the correlation spine: mandatory `operation_id`, optional `parent_operation_id`, `trace_id`, plus workspace/session/turn/item/request/target/prompt/workflow IDs, all skip-serialized when absent;
- `record_class`: `detailed` XOR `lifecycle`; any other combination rejects at ingest;
- `privacy == secret` rejects outright, record-level and per-argument.

The collector's own state (`anyharness/crates/proliferate-diagnostics-collector/README.md:81`) is a process-local arena: accepted records in total order, a retention cursor, a lifecycle table, per-producer sequence state, health counters, all bounded under a 50 MiB RSS ceiling. It is entirely lost on every collector restart: a new boot ID and generation number replace it, which is exactly why the restart/reconnect path matters (§4, §7).

## Harness launch-options states (`HarnessLaunchOptionsState`)

The newly-cutover launch-options system (`#2070`, merged same day as the observability work, unrelated to it but relevant to §7 and §9) exposes a 6-state machine (`anyharness/crates/anyharness-lib/src/domains/agents/launch_options/types.rs:99-105`):

```
Detecting | Refreshing | Observed | ObservedEmpty | LastGoodAfterFailure | FailedWithoutObservation
```

`specs/OBSERVABILITY.md:10-25` names the five events this system is supposed to emit (`agent.launch_options_probe.completed`, `agent.launch_options.served`, `session.launch_selection.validated`, `session.initial_config.apply`, `session.live_config.changed`), each with a closed safe-field list (no selected values, model IDs, provider output, or paths). None of these states or events has a Grafana panel, alert, or dashboard today (§7), and the cutover already caused one production incident same-day, hotfixed by PR #2103 ("send raw target-observed control ids at session create").

## Orphaned Postgres tables (`agent_model_snapshot`, `agent_catalog_override`)

Confirmed live and orphaned:

- Both tables were created by earlier migrations (`server/alembic/versions/a9c0d1e2f3b4_agent_gateway_litellm_schema.py:254-300` creates `agent_catalog_override`; `server/alembic/versions/b7c1e4d9f082_agent_model_snapshot_rekey.py:1` renames `agent_catalog_snapshot` to `agent_model_snapshot`).
- PR #2070 deleted the `AgentModelSnapshot`/`AgentCatalogOverride` ORM classes entirely (no remaining reference anywhere under `server/proliferate/`, confirmed by direct grep).
- PR #2094's body states this explicitly: *"deleting the `AgentModelSnapshot`/`AgentCatalogOverride` ORM classes left 227 [wall-clock defaults, down from 230]... Both alembic migration files remain untouched under `alembic/versions/` — history stays replayable; only the test asserting an ORM equivalence that no longer holds was removed."* (quoted verbatim from the PR)
- Net effect: the tables are live in a production database today, nothing in the ORM metadata describes them, and no downgrade/drop migration exists. This is schema drift by omission, not by accident, and it is a decision item (§9).

## Support report row (CP-07)

```
support_report_id, created_at, environment, client release,
message + user-selected options,
snapshot included / scope / hash / size / coverage gaps,
stable failure stage + reason when unsuccessful,
safe session/trace reference when available,
submission status + receipt,
reporter-update opt-in + delivery state
```

`server/proliferate/server/support/service.py:477` is the exact boundary where report completion and Slack-notification truth used to diverge (fixed by #2061).

## Issue evidence row (CP-08B/09, spec, not yet built)

```
issue ID, status, severity, owner, timestamps
environment, affected component, release
bounded symptom + customer impact
immutable evidence references (provider + occurrence time, bodies stay at source)
claim + investigation conclusion
fixing PR + deployed release
recovery signal + verified recovery time
reporter follow-up state
audit history
```

The only piece of this that exists in code today is `scripts/issues.py:1` and `scripts/issues.py:295`: read commands (`list`, `poll`, `get`, `ops`) and mutation commands (`claim`, `release`, `patch`, `dedup`, `link-pr`) behind one shared credential; read and write authority are not separated yet.

## PostHog's live 25-event catalog

`apps/packages/product-client/src/lib/domain/telemetry/events.ts:56` is the shared typed source. The 25 names actually shipping in production: `agent_seed_hydrated`, `agent_seed_hydration_failed`, `app_update_available`, `app_update_check_started`, `app_update_download_started`, `app_update_install_failed`, `app_update_install_succeeded`, `auth_sign_in_failed`, `auth_signed_in`, `auth_signed_out`, `chat_pending_prompt_deleted`, `chat_pending_prompt_edited`, `chat_pending_prompt_steered`, `chat_pending_prompts_reordered`, `chat_prompt_submitted`, `chat_session_created`, `cloud_workspace_created`, `cloud_workspace_deleted`, `desktop_keychain_access_failed`, `desktop_minversion_block`, `runtime_connection_state_changed`, `screen_viewed`, `support_report_submitted`, `workspace_created`, `workspace_selected`. No session, agent, or workspace ID rides any of them.

# 4. Key flows end to end

## Unexpected failure to Sentry

```mermaid
sequenceDiagram
    participant Code as Product code
    participant SDK as Surface Sentry SDK
    participant Scrub as before-send scrubber
    participant Sentry as Sentry (hosted)
    Code->>SDK: exception / capture_exception
    SDK->>Scrub: before-send hook
    Scrub-->>SDK: scrubbed event (or dropped)
    SDK->>Sentry: queued send (async, SDK-owned buffer)
    Note over SDK,Sentry: Only Server exposes an explicit app-shutdown flush.<br/>No surface exposes accepted/dropped/source-resolved state.
```

Coverage is uneven: Server redacts sensitive-looking keys and bearer/JWT/path patterns (`server/proliferate/integrations/sentry.py:23`) but leaves some exception-frame context under-covered; Desktop-native has no explicit scrubber at all (`specs/OBSERVABILITY.md:143-145`, a documented, still-open gap); Worker and Supervisor lack the equivalent transaction-envelope coverage AnyHarness has. The one exception path that must never reach Sentry, child-agent stderr, is explicitly tagged and diverted (`specs/OBSERVABILITY.md:161-164`).

## Intentional product event to PostHog

Shared emitter (`trackProductEvent`) to host `ProductEvent` to per-surface adapter to identify + scrub to capture. Desktop allow-lists exactly six event names at its adapter boundary (`apps/desktop/src/lib/integrations/telemetry/client.ts:40`); Web forwards a broader arbitrary host-bound set (`apps/web/src/browser/telemetry/web-telemetry.ts:51`); Mobile emits only `mobile_screen_viewed`. Journey semantics are still incomplete: core-value has `chat_session_created` and `chat_prompt_submitted` but no first-output, usable-session, or turn-completed edge anywhere in the catalog.

## Local diagnostic to collector to Support / Honeycomb

```mermaid
flowchart LR
    R["Renderer sink<br/>filter/bound/batch"] -->|ingest_renderer_diagnostics| SUP["Tauri supervisor"]
    AHc["AnyHarness (inherited fd)"] -->|/v1/ingest| SUP
    WRKc["Desktop Worker (inherited fd)"] -->|/v1/ingest| SUP
    SUP --> COLL["Collector arena<br/>memory-only"]
    COLL -->|consent + 2nd scrub| SNAP["Support snapshot"]
    SNAP --> SAVE["Save copy (local ZIP)"]
    SNAP --> SEND["Send / submit"]
    COLL -->|internal builds only| EXP["OTLP exporter"]
    EXP --> HCd["Honeycomb (dogfood env)"]
```

Restart is survivable for the bundled child path: the supervisor's own tests exercise a killed collector restarting with a new generation and boot ID, and the child bridge re-acquires the new generation over the fd bridge (`apps/desktop/src-tauri/src/diagnostics_collector/supervisor_recovery_tests.rs:90-198`), while a `desktop.collector.restart` lifecycle record with a death certificate (trigger, exit code/signal, restart count) is always emitted (`apps/desktop/src-tauri/src/diagnostics_collector/supervisor/death_certificate.rs:68-91`). This part of the "collector dies and nobody notices" defect class is already closed for production bundled runs.

It is not closed for the debug-only externally-launched runtime path (`make dev` / `ANYHARNESS_DEV_URL`), which has no inherited fd and instead does one-shot activation from an env snippet. The code says so directly: *"Without the path (an old app build's 3-line file) a collector restart still ends delivery until the runtime restarts. Debug builds only."* (`anyharness/crates/proliferate-diagnostics-client/src/bridge/activation.rs:100-101`). Even the fixed variant only self-heals if the host keeps rewriting the snippet file and the producer keeps re-reading it (`activation.rs:97-126`); this whole path is `#[cfg(debug_assertions)]`-only and never ships in a release bundle, so it cannot leak into customer builds, but it does mean dev-profile telemetry silently goes dark on any collector restart unless that specific refresh wiring is present. CP-D1 was written to give this path a supported, coherent activation story (see §7); it is not merged.

## Hosted log to CloudWatch to Grafana to alert to issue

```mermaid
flowchart LR
    SRVs["Server / Worker / gateway stdout"] -->|awslogs| CW["CloudWatch log groups"]
    CW -->|3 metric filters| M["CriticalFailureCount / ServerErrorLines / AnalyticsIngestErrors"]
    AWSm["ALB / ECS / RDS / SNS metrics"] --> GRAF["Grafana rules (6, checked-in)"]
    M --> GRAF
    GRAF -->|contact/policy| NOTIFY["Notification route (live state unverified)"]
    NOTIFY -.-> ISSUEt["Issue tracker (partial)"]
```

`report_critical(...)` writes the `CRITICAL_FAILURE` marker into the customer-facing Server log; a CloudWatch metric filter increments a counter (default zero, so the series stays populated); Grafana rule `bfrmh7e7x2k8wd` evaluates a five-minute sum (`specs/OBSERVABILITY.md:117`; rule source `server/infra/observability/grafana/production-alerts.json:1`). What happens after that (contact routing, actual Slack/PagerDuty delivery, resolution) was not verified live during the overnight audit because the canonical Grafana Viewer credential returned HTTP 401 and no local Admin token was available. No native CloudWatch alarm has a target configured (all 3 RDS alarms have actions disabled), so paging today runs entirely through Grafana, whose live state is unread.

# 5. What's built, merged, and deployed today vs. not

All PR states below are read live from GitHub, not inferred from the vault's mid-run notes (which had gone stale by morning; see the correction under CP-D1).

| Slice | What it does | PR | State |
| --- | --- | --- | --- |
| CP-S1 | Support Slack-notification receipt truth | [#2061](https://github.com/proliferate-ai/proliferate/pull/2061) | **Merged** 2026-08-19 12:18 |
| CP-S2A | Client vendor privacy closure (email/display-name leak) | [#2064](https://github.com/proliferate-ai/proliferate/pull/2064) | **Merged** 2026-08-19 12:19 |
| CP-C1S | Desktop Sentry session replay source-disabled | [#2083](https://github.com/proliferate-ai/proliferate/pull/2083) | **Merged** 2026-08-19 18:28 |
| CP-U1 | Support save-copy cleanup truth | [#2084](https://github.com/proliferate-ai/proliferate/pull/2084) | **Merged** 2026-08-19 18:35 |
| CP-G0 | Read-only Grafana metadata inventory | [#2085](https://github.com/proliferate-ai/proliferate/pull/2085) | **Merged** 2026-08-19 18:52 |
| CP-S2B | Server Sentry transport privacy enforcement | [#2087](https://github.com/proliferate-ai/proliferate/pull/2087) | **Merged** 2026-08-19 20:37 |
| CP-C1PD | Desktop PostHog session recording source-disabled | [#2093](https://github.com/proliferate-ai/proliferate/pull/2093) | **Merged** 2026-08-19 21:16 |
| CP-C1PW | Web PostHog session recording source-disabled | [#2096](https://github.com/proliferate-ai/proliferate/pull/2096) | **Merged** 2026-08-19 21:33 |
| CP-C1PM | Mobile PostHog session replay source-disabled | [#2097](https://github.com/proliferate-ai/proliferate/pull/2097) | **Merged** 2026-08-20 00:00 |
| CP-D0 | Debug activation guide correction | n/a | Superseded by CP-D1 before implementation, per its own review round 3 |
| CP-D1 | Profile-managed debug runtime activation (closes the dev-only collector-restart gap in §4) | none found | **Not merged, not open as a PR.** The overnight run's own notes claimed it was gated on open PR #2069; that PR number is real but now belongs to an unrelated topic's PR ("remove obsolete worktree retention policy", merged 2026-08-19). CP-D1 exists only as a frozen spec file (`Control Plane 2026-08-19/run-2026-08-19/specs/CP-D1 Profile-managed debug runtime activation.md`); treat the vault's PR reference as stale. |
| CP-00A / CP-09 | Unified `observe doctor` / `observe issue` read-only operator CLI | none | **Spec only**, no implementation started |
| CP-08B | Full issue lifecycle (evidence to dedup to claim to fixing PR to recovery) | none | **Spec only** |
| n/a | Harness launch-options cutover (unrelated program, but its production incident is a live example of the monitoring gap in §7/§9) | [#2070](https://github.com/proliferate-ai/proliferate/pull/2070) merged, hotfixed by [#2103](https://github.com/proliferate-ai/proliferate/pull/2103) | **Merged**, same-day prod incident and same-day fix |

Everything the founder authorized to ship overnight, shipped. What remains is exactly the connective-tissue layer: the unified operator CLI, the full issue lifecycle, and CP-D1.

# 6. Measured facts from the overnight live-provider audit

Recorded in `Control Plane 2026-08-19/run-2026-08-19/live-audit/*/verification-summary.md` and `.../provider-ui-readback/`.

- **Sentry:** a signed-in browser readback confirmed 8 active Proliferate projects with recent ingestion exist, but no authorized API/CLI read was ever completed, so grouping, ownership, alert rules, and freshness are still unverified at the repository level.
- **PostHog:** project `356553` is reachable and shows recent named events; the readback directly confirmed the (now-fixed) pre-patch email/display-name identity leak in captured events.
- **Honeycomb:** 7 datasets exist in the `dogfood` environment, but 4 of the core datasets showed zero logs over the prior 24 hours at read time. This is what "internal-only, dogfood" actually looks like in practice right now: not a steady stream, an intermittent one.
- **Grafana:** AWS confirms the `proliferate-ops` workspace is active; the canonical Viewer credential returned HTTP 401, and the browser path is blocked behind an IAM Identity Center username prompt. Net: live dashboards, rules, contacts, routes, and delivery history are all unread, not absent.
- **CloudWatch:** 16 log groups inventoried; exactly 3 live custom metrics exist (`CriticalFailureCount`, `ServerErrorLines`, `AnalyticsIngestErrors`), all undimensioned (no component/release label). 3 native RDS alarms exist; all have actions disabled.
- **Six checked-in Grafana rules** all treat "no data" as `OK` and "execution error" as alerting, which is safe only if a separate freshness signal exists, and none does yet.
- **None of the 8 Sentry surfaces sets a field literally named `component`.** Every surface uses `surface` and/or an embedded prefix in `release` instead, which is why cross-system joins are manual today.

# 7. Gaps

- **No unified read-only health command.** `observe doctor` is fully speced (CP-00A) but not built; today an operator strings together the self-hosted deploy doctor (`server/deploy/doctor.sh:1`, local-only), the Desktop diagnostics broker CLI (`apps/desktop/src-tauri-debug`, same-owner only), `scripts/issues.py`, and separate Grafana ops scripts: four different tools, four different credential models, no single "is the whole pipe healthy" answer.
- **No wired path from a production exception to a triaged, owned, recovery-verified ticket.** The full lifecycle in CP-08B/09 is spec only; the connectors that exist (Sentry/Grafana/Support to issue references) are partial and share read/write credentials.
- **Orphaned Postgres tables.** `agent_model_snapshot` and `agent_catalog_override` are live with no ORM model and no drop migration (§3). Nobody currently owns cleaning this up.
- **The dev-only collector-restart delivery gap is real but scoped.** It cannot reach a customer build (debug-only, `#[cfg(debug_assertions)]`), but it does mean a `make dev` profile can silently stop emitting diagnostics on any collector restart unless the newer env-snippet-refresh path is wired up (`activation.rs:100-101`). CP-D1 was written to fix this properly and remains unshipped.
- **The launch-options probe states have zero observability coverage.** `Detecting / Refreshing / Observed / ObservedEmpty / LastGoodAfterFailure / FailedWithoutObservation` and their five named events (`specs/OBSERVABILITY.md:10-25`) exist in code but appear in no Grafana panel, no alert, and no PostHog funnel, and this exact system had a same-day production incident (fixed by #2103) with no dashboard that would have shown it happening in real time.
- **Desktop-native Sentry still has no explicit scrubber:** a standing, documented gap (`specs/OBSERVABILITY.md:143-145`), unrelated to the CP program's replay fixes.
- **No duty owner or urgent route is named anywhere.** Both CP-00 and CP-07 list this as a required founder input that was never supplied (`Control Plane 2026-08-19/00 - Program Map and Execution Process.md:126-129`, `08 - Alerting and Paging.md:44`).
- **The "hosted vs. local" line for detailed telemetry is still a live decision, not a settled fact.** The program map itself flags it as open (§9, item 2).

# 8. Domain knowledge and best practices (general knowledge, not facts about our codebase)

Everything in this section is standard external-system knowledge: how Sentry, PostHog, and distributed tracing actually model the world, plus patterns a small team commonly uses to run production. None of it describes what Proliferate has built; §2 through §7 are the only sections above that make claims about this repository, and §5/§6 are the only ones grounded in a live measurement.

## How Sentry models the world

Sentry's object hierarchy, top to bottom: an **organization** contains **projects** (typically one project per deployable component or service); every captured event belongs to exactly one project and carries an **environment** tag (production, staging, dev) used purely for filtering, not for grouping.

A **release** is a version identifier, conventionally `<name>@<version>+<build>`, associated with the commit range that produced it. Attaching source maps or debug symbols to a release is what lets Sentry resolve a minified stack trace or a stripped Rust binary back to real file:line locations. Releases are also the unit release health measures (below).

An **event** is one occurrence: a single captured exception or message. An **issue** is a group of events sharing a fingerprint. The default grouping algorithm hashes normalized stack frames (function, module, filename), marking vendor and library frames as "not in-app" so grouping keys on the frames that are actually yours. When default grouping is wrong (too many issues for the same root cause, or one issue swallowing unrelated causes), a project can supply an explicit fingerprint:

```python
sentry_sdk.capture_exception(
    err,
    fingerprint=["model-timeout", error.provider, error.model_id],
)
```

That collapses every timeout from a given provider/model pair into one issue regardless of which call site or stack shape triggered it.

**Release health / session tracking** is a separate subsystem from error tracking. SDKs track "sessions" (an app launch, a page load, a request) independent of whether an error occurred, and report crash-free session rate and crash-free user rate per release. This is the standard metric for gating a rollout: a release with a normal error count but a crash-free rate that dropped from 99.8% to 97% is the thing to halt on, not raw issue count, because absolute counts are meaningless without a comparable install-base baseline.

**Alert rules** come in two kinds. Issue alerts fire on a new issue, a regression (a previously resolved issue reopening), or an occurrence-rate threshold within a project. Metric alerts fire on an aggregate, such as error rate over N minutes or crash-free rate below a threshold, and can page independently of whether any single issue looks alarming. Issue **ownership rules** (path-based or team-based) auto-assign new issues so they don't all land in one unowned queue, and issue **states** (unresolved, resolved, ignored/muted for N occurrences or N time) are what keeps a backlog from becoming permanent background noise.

## Relevant PostHog concepts

PostHog's raw unit is an **event** with arbitrary properties, captured via `capture(event, properties)`. A **person** is the identity an event resolves to; an anonymous `distinct_id` merges into an identified person the moment `identify()` runs, and person properties (persistent, e.g. plan tier) are distinct from event properties (per-occurrence, e.g. which button).

**Autocapture** instruments every click and page view automatically: high volume, low signal, and it captures DOM structure that can leak more than intended. The alternative, and the one considered best practice for a product with real privacy constraints, is a small typed catalog of intentional events with a stable naming convention (commonly `object_verbed`, e.g. `workspace_created`) and an explicit property schema per event, so a property's meaning can never silently change underneath existing dashboards.

A **funnel** is an ordered sequence of events with a conversion window; PostHog computes the drop-off between each step and the elapsed time. This is the standard tool for "how many people who did X went on to do Y within Z minutes," which is exactly the shape of an activation or core-value journey. **Cohorts** group persons by property or behavior for retention analysis. **Session replay** is a separate opt-in recording capability with its own masking configuration (input masking, block/mask by CSS selector) and should be treated as a distinct privacy surface from ordinary event capture, not a free extra.

## Tracing fundamentals

A **trace** represents one logical end-to-end operation (a request, a turn, a job). It is composed of **spans**: each span is one bounded unit of work with a name, a start and end time, a set of attributes, and a parent-child link to other spans, forming a tree.

```mermaid
flowchart TB
    T["trace: prompt_to_completion"] --> S1["span: receive_request (12ms)"]
    T --> S2["span: model_call (840ms)"]
    S2 --> S2a["span: provider_http (820ms)"]
    T --> S3["span: render_output (30ms)"]
```

Distributed propagation uses the **W3C Trace Context** standard: a `traceparent` header carries the trace ID, the calling span's ID, and sampling flags across a process or service boundary, so independently-instrumented services can reconstruct one shared tree.

**OTLP** (OpenTelemetry Protocol) is the vendor-neutral wire format, over gRPC or HTTP with protobuf or JSON, for exporting traces, logs, and metrics. Sending data to a given backend (Honeycomb, Grafana Tempo, or anything else) is just pointing an OTLP exporter at that backend's endpoint with its credentials; the instrumentation code itself never names a vendor.

**Sampling** decides which traces survive to the backend. Head-based sampling decides at trace start (keep a fixed 10% regardless of outcome); tail-based sampling waits until the whole trace is known and keeps traces by outcome (every trace with an error, every trace over a latency threshold, a small sample of the rest). Tail-based sampling needs a collector that buffers spans until a trace completes, which is a real infrastructure cost head-based sampling avoids.

The three primitives are not interchangeable: a span answers "how long did this bounded operation take and what happened inside it," a log answers "what happened at this instant," and a metric answers "how many, or how much, over time" as a pre-aggregated number. Reaching for a log where a span was the right shape loses duration and causality; reaching for a metric where a log was needed loses the specific instance that mattered.

## Best-practice patterns for a small team running production

**The error triage loop.** A new issue lands, gets auto-assigned by an ownership rule, and gets a triage decision within a fixed SLA (commonly "by next business day" for a small team): fix now, snooze for N occurrences, mark won't-fix with a recorded reason, or escalate.

```mermaid
flowchart LR
    A["new issue"] --> B["auto-assign by ownership rule"]
    B --> C{"triage within SLA"}
    C -->|fix now| D["ship a fix"]
    C -->|snooze N occurrences| E["revisit if it recurs"]
    C -->|won't fix| F["record a reason, close"]
    C -->|escalate| G["page or hand to owner"]
```

The loop only works if "unresolved" never becomes a place issues go to be silently ignored; an unbounded unresolved count trains the team to stop reading it, which is the failure mode this program's own alerting doc already names (§7).

**Release-health gates, not error-count gates.** Before widening a rollout from canary to full, the standard check is crash-free session rate and crash-free user rate against the previous release's own baseline, never an absolute error count in isolation. A release with more total errors than the last one because it also has more users is not a regression; a release with a lower crash-free rate at the same traffic almost always is.

**Alert-fatigue avoidance.** Page only for what a human must act on right now: a customer-facing SLO burning down fast, or a "must never happen" invariant breaking. Everything else (recoverable retries, expected degraded-mode fallbacks, slow capacity drift) belongs in a log or a daily/weekly digest issue, not a page. An alert without a named owner, a runbook, and a recovery condition should not exist; this is already the stated rule in this program's own alerting spec (`Control Plane 2026-08-19/08 - Alerting and Paging.md`, cited in §7), and it is standard practice well beyond this codebase.

**What to page vs. what to log, concretely:**

```text
page:   checkout is down for all customers
page:   the monitoring pipeline itself stopped emitting signal
log:    a retry succeeded on attempt 2
log:    a background job fell into an expected degraded-mode fallback
digest: capacity trending toward a threshold over the next two weeks
```

**Small-team-specific bias.** A two-person team cannot staff 24/7 on-call, so the highest-leverage investment is usually making failures recoverable by the system itself (retries, circuit breakers, graceful degradation) rather than paging a human for anything that resolves on its own within a few minutes. Paging should be reserved for genuinely unrecoverable, customer-visible breaks; everything below that line should degrade quietly and show up in a digest, not a phone buzzing at 3am.

# 9. Open design questions for Pablo

1. **Universal source identity now, or unify only at the query layer?** Making every Sentry initializer (8 surfaces) and every hosted log formatter emit a literal `component`/`environment`/`release` triple is a real rewrite across the whole surface area. Deferring it keeps every cross-system join manual indefinitely, and it's the single fact the overnight audit flagged as blocking almost every other claim ("no shared discriminator"; §2, §6).

2. **Detailed/lifecycle telemetry: stay client-only for launch, or approve a small hosted operational-event route?** Staying local preserves the current privacy stance (no prompts/transcripts/tool output ever leave the device) but starves Grafana and any future alerting of the richest signal available. A hosted route reopens exactly the "customer content in central telemetry" line the whole diagnostics protocol was built to avoid.

3. **Build the unified `observe` CLI before or after Grafana dashboards/alerting?** Building it first gives an early, trustworthy health surface but means alerting ships with no consumer to interrogate a page. Building it last risks shipping alerts nobody can actually triage without four separate tools.

4. **Issue-tracker scope: repair the existing Sentry/Grafana/Support connectors only, or commit to the full lifecycle (claim to investigation to fixing PR to deployed release to verified recovery)?** Connector repair is bounded and shippable soon; the full lifecycle is the actual "path from exception to owned ticket" the founder has asked about, but it's a materially bigger program (CP-08B/09 combined).

5. **Drop the orphaned `agent_model_snapshot`/`agent_catalog_override` tables now, or leave them as documented drift?** Dropping needs a reviewed migration and a rollback story; leaving them live risks a future schema/security audit flagging tables with no code owner and no ORM visibility.

6. **Ship CP-D1 now, or accept the dev-only collector-restart gap as tolerable risk?** It cannot reach production (debug-assertions-gated), but it does degrade the team's own dogfooding signal quality on any collector restart during local development.

7. **Name the launch-week duty owner and urgent route.** Every alerting/paging spec in the CP program (CP-00, CP-07) is blocked on this input and has been since the program was scoped.

8. **Give the launch-options probe states (`Detecting`/`ObservedEmpty`/etc.) a dashboard now, given today's same-day production incident, or fold them into the general Sentry/CI safety net until the "prompt-to-visible-completion" journey dashboards land?** The states already exist and already caused one incident; the question is purely sequencing against the rest of the Grafana buildout in §4/§6.

# Appendix: where this came from

- `ADRs/Observability/Control Plane 2026-08-19/00` through `10`: the ten frozen-draft slice specs (source of §2's shared-identity model, §4's journey framing, §7's gaps, and §9's open decisions).
- `ADRs/Observability/Control Plane 2026-08-19/run-2026-08-19/synthesized-current-system.md`: the independently-verified current-system synthesis this doc leans on most heavily for §2 through §4 and §6.
- `ADRs/Observability/Control Plane 2026-08-19/run-2026-08-19/RUN_RECORD.md`: overnight execution log; cross-checked against live `gh pr view` state rather than trusted as-is (it was stale on the CP-D1/#2069 point, corrected in §5).
- `specs/OBSERVABILITY.md`: canonical per-PR decision layer, still current and not superseded by the CP program.
- `ADRs/Observability/Observability ADR.md` (2026-08-14): the prior consolidated ADR for the local-diagnostics/Honeycomb/support-snapshot system; still accurate for anything not touched by the CP program.
- Direct repository reads: `anyharness/crates/proliferate-diagnostics-*`, `apps/desktop/src-tauri/src/diagnostics_collector/**`, `server/alembic/versions/*agent_*`, `server/proliferate/integrations/sentry.py`, `apps/packages/product-client/src/lib/domain/telemetry/events.ts`.
- Live GitHub state via `gh pr view` for every PR number cited in §5, checked 2026-08-20.
- §8 is standard Sentry/PostHog/OpenTelemetry documentation and common small-team operating practice, not sourced from this repository.
