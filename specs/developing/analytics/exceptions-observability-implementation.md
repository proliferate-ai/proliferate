# Exceptions Observability — Implementation Reference (2026-07)

End-to-end record of the exceptions-observability build: what was implemented, where it
lives, why each decision was made, and how an error flows through the system. Companion
docs: `sentry.md` (canonical project list / env vars / privacy posture),
`sentry-setup-runbook.md` (click-through setup), and
`specs/tbd/issue-autofix-system-v1.md` (the downstream consumer of everything here).

Source PRs (every code block below is verbatim from these diffs):

| PR | Branch | Scope |
|---|---|---|
| [#971](https://github.com/proliferate-ai/proliferate/pull/971) | `obs/server-log-context` | version+sha on every server log line; correlation context in background work; `report_critical` severity helper |
| [#970](https://github.com/proliferate-ai/proliferate/pull/970) | `obs/identity-tags` | org/user/sandbox/runtime-env identity tags on all Sentry surfaces |
| [#968](https://github.com/proliferate-ai/proliferate/pull/968) | `obs/release-sync` | Sentry release tags derived from real version sources, `<component>@<VERSION>+<sha>` in CI |
| [#969](https://github.com/proliferate-ai/proliferate/pull/969) | `obs/desktop-replay` | Sentry session replay on-error for desktop renderer, masked |

---

## 1. Problem statement

Before this work, Sentry was already initialized on every surface (server, desktop
renderer + native, all three Rust binaries) and the server already emitted JSON logs
with correlation IDs — but four things were missing:

1. **No version on log lines** — a CloudWatch log line couldn't be attributed to a deploy.
2. **No identity on E2B/Rust Sentry events** — a sandbox crash didn't say whose sandbox,
   which org, or whether it ran locally or in E2B.
3. **Release tags were hardcoded `@0.1.0`** on several components — Sentry's
   regression/"did the fix ship" views were meaningless.
4. **Nothing alerted anyone** — Sentry captured; nothing pushed.

Items 1–3 are closed by the four PRs. Item 4 is external configuration (Grafana Cloud,
Sentry alert rules, Slack webhook) — state recorded in §7.

## 2. Contracts (stable names — downstream consumers depend on these)

These names are load-bearing. The Grafana dashboard, Sentry alert rules, and the
issue-autofix system's sync jobs all reference them. Do not rename without a sweep.

**JSON log fields** (every production server log line):

| Field | Source | Purpose |
|---|---|---|
| `version` | `server_version()` — `SERVER_VERSION` env → `VERSION` file → `0.0.0-dev` | attribute logs to a deploy |
| `git_sha` | `SERVER_GIT_SHA` env (stamped by `_deploy-server.yml`) | exact commit |
| `critical_failure` | `report_critical()` log extra | page-worthy filter |
| `organization_id`, `user_id`, `request_id`, `session_id`, … | correlation contextvars | who/where |

**Log message marker:** `CRITICAL_FAILURE` (literal substring, CloudWatch-filterable).

**Sentry tags:**

| Tag | Surfaces | Values |
|---|---|---|
| `critical_failure` | server | `"true"` (only set by `report_critical`, with level=fatal) |
| `org_id` | all 3 Rust binaries | UUID via membership lookup (see §4.2 caveat) |
| `user_id` | all 3 Rust binaries | sandbox `owner_user_id` |
| `sandbox_id` | all 3 Rust binaries | E2B provider sandbox id |
| `runtime_env` | Rust binaries + desktop native | `local` \| `e2b` (default `local`) |
| `target_id` | anyharness runtime | from `ANYHARNESS_RUNTIME_TARGET_ID` |
| `organization_id` | desktop renderer | active org from org store, `"none"` when absent |

**Identity env vars** (server → sandbox processes; all on the `process_env.rs` strip
list so they never leak into user shells):
`PROLIFERATE_ORG_ID`, `PROLIFERATE_USER_ID`, `PROLIFERATE_SANDBOX_ID`,
`PROLIFERATE_RUNTIME_ENV`.

**Release format:** `<component>@<VERSION>` locally, `<component>@<VERSION>+<short_sha>`
in CI (12-char sha, matching `${GIT_SHA:0:12}`). Canonical statement lives in
`sentry.md` § Release Format.

## 3. PR #971 — server log context + severity

### 3.1 Files touched

```
server/proliferate/
├ utils/logging.py                          ◆ version/git_sha on every JSON record
├ middleware/request_context.py             ◆ bind_background_correlation_context helper
├ integrations/sentry.py                    ◆ report_critical()
├ background/
│ ├ correlation.py                          ★ NEW — CorrelatedTask Celery base
│ └ tasks/notifications.py                  ◆ send_slack uses CorrelatedTask
├ server/
│ ├ notifications.py                        ◆ producer passes correlation headers
│ ├ automations/worker/
│ │ ├ main.py                               ◆ scheduler loop binds worker_id
│ │ ├ cloud_executor.py                     ◆ per-run correlation binding
│ │ └ scheduler.py                          ◆ report_critical adoption
│ ├ billing/reconciler.py                   ◆ report_critical adoption
│ └ cloud/
│   ├ agent_gateway/worker.py               ◆ report_critical ×3
│   └ materialization/runner.py             ◆ report_critical ×2
server/tests/unit/test_logging_observability.py   ★ NEW — 239 lines
specs/developing/analytics/sentry.md        ◆ contract documentation
```

### 3.2 Version + git SHA on every log line

`server/proliferate/utils/logging.py` — computed once at configure time, not per-record:

```python
# Computed once at import/configure time — not per-record.
_SERVER_VERSION: str | None = None
_SERVER_GIT_SHA: str | None = None


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {..., "level": record.levelname, "message": record.getMessage()}
        if _SERVER_VERSION:
            payload["version"] = _SERVER_VERSION
        if _SERVER_GIT_SHA:
            payload["git_sha"] = _SERVER_GIT_SHA
        for key, value in get_correlation_context().items():
            payload[key] = value
        ...


def configure_server_logging() -> None:
    global _SERVER_VERSION, _SERVER_GIT_SHA
    _SERVER_VERSION = server_version()
    _SERVER_GIT_SHA = os.getenv("SERVER_GIT_SHA") or None
    ...
```

No CI change was needed: `.github/workflows/_deploy-server.yml` already stamped
`SERVER_GIT_SHA` into the ECS task env.

Resulting log line shape in CloudWatch (`/ecs/proliferate-server`):

```json
{"timestamp": "...", "level": "ERROR", "logger": "proliferate.cloud.materialization",
 "message": "...", "version": "0.3.6", "git_sha": "9affc0f0d489",
 "organization_id": "...", "user_id": "...", "request_id": "..."}
```

### 3.3 Correlation context in background work

**The gap:** `RequestContextMiddleware` + the `current_active_user` dependency populated
the correlation contextvars (`server/proliferate/middleware/request_context.py`) only on
the HTTP path. Automation runs and Celery tasks logged with no identity.

**Celery** — new base class, `server/proliferate/background/correlation.py`:

```python
_HEADER_KEYS = frozenset(_CORRELATION_VARS.keys())


class CorrelatedTask(Task):
    """Celery base task that binds correlation context from task headers."""

    abstract = True

    def __call__(self, *args: object, **kwargs: object) -> object:
        headers = getattr(self.request, "headers", None) or {}
        context_fields = {
            key: value for key, value in headers.items() if key in _HEADER_KEYS and value
        }
        with with_correlation_context(**context_fields):
            return super().__call__(*args, **kwargs)
```

Producer side (`server/proliferate/server/notifications.py`):

```python
celery_app.send_task(
    NOTIFICATIONS_SEND_SLACK_TASK,
    args=(payload,),
    queue=NOTIFICATIONS_QUEUE,
    task_id=task_id,
    headers=capture_correlation_context() or None,
)
```

Consumer opts in via `@celery_app.task(base=CorrelatedTask, name=...)`.

**Automation worker** (asyncio loop, not Celery) — per-run binding in
`server/proliferate/server/automations/worker/cloud_executor.py`:

```python
def _claim_correlation_fields(claim: AutomationRunClaimValue) -> dict[str, object | None]:
    """Correlation identity for a single automation run's unit of work."""
    return {
        "organization_id": claim.organization_id,
        "user_id": claim.user_id,
        "session_id": claim.anyharness_session_id,
        "sandbox_profile_id": claim.sandbox_profile_id,
        "cloud_workspace_id": claim.cloud_workspace_id,
        "cloud_target_id": claim.cloud_target_id_snapshot,
        "anyharness_workspace_id": claim.anyharness_workspace_id,
    }

# in execute_cloud_automation_run:
with with_correlation_context(**_claim_correlation_fields(claim)):
    await process_cloud_automation_run(claim, config=resolved)
```

The scheduler loop itself binds only `worker_id=f"automation-{args.role}"`
(`automations/worker/main.py`) — process identity. The per-run binding above is what
makes an individual org's failing automation attributable.

### 3.4 Severity convention — `report_critical`

`server/proliferate/integrations/sentry.py`:

```python
_report_critical_logger = logging.getLogger("proliferate.critical")


def report_critical(
    error: Any,
    *,
    tags: dict[str, str] | None = None,
    extras: dict[str, Any] | None = None,
    **context: Any,
) -> None:
    """Report a page-worthy failure to Sentry (level=fatal) and structured logs.

    Contract fields (stable for Grafana/Sentry alert rules):
    - Sentry tag: critical_failure=true, level=fatal
    - Log extra: critical_failure=True
    - Log message contains "CRITICAL_FAILURE" marker for CloudWatch filtering
    """
    merged_tags = dict(tags or {})
    merged_tags["critical_failure"] = "true"
    capture_server_sentry_exception(error, level="fatal", tags=merged_tags, extras=extras)

    log_extra: dict[str, Any] = {"critical_failure": True}
    if context:
        log_extra.update(context)
    if extras:
        log_extra.update(extras)
    _report_critical_logger.exception("CRITICAL_FAILURE: %s", str(error), extra=log_extra)
```

Design decision (aligned 2026-07-05): **explicit opt-in helper**, not log-level-based or
exception-class-based. Call sites declare page-worthiness; ambient/retryable errors stay
plain `logger.exception()`. Adopted at exactly 7 sites:

| File | Site | Tags |
|---|---|---|
| `server/automations/worker/scheduler.py` | after `FAILURE_ESCALATION_THRESHOLD` consecutive tick failures | `worker: automation_scheduler` |
| `server/billing/reconciler.py` | reconciler pass exception | `domain: billing, action: reconcile_loop` |
| `server/cloud/agent_gateway/worker.py` | enrollment backfill tick | `domain: agent_gateway, action: enrollment_backfill` |
| `server/cloud/agent_gateway/worker.py` | usage import tick | `domain: agent_gateway, action: usage_import` |
| `server/cloud/agent_gateway/worker.py` | LLM top-up tick | `domain: agent_gateway, action: llm_topup` |
| `server/cloud/materialization/runner.py` | after-commit task failure | `domain: cloud_materialization, label: <label>` |
| `server/cloud/materialization/runner.py` | fresh-session task failure | `domain: cloud_materialization, fn: <name>` |

Verification: 509 unit tests green (`cd server && DEBUG=true uv run pytest -q tests/unit`;
`DEBUG=true` needed locally so `Settings()` doesn't demand a prod `jwt_secret`).

## 4. PR #970 — identity tags on all Sentry surfaces

### 4.1 Files touched

```
anyharness/crates/
├ anyharness-lib/src/process_env.rs         ◆ strip list += 4 identity vars
├ anyharness/src/telemetry.rs               ◆ dynamic sentry_scope_tags()
├ proliferate-worker/src/logging.rs         ◆ identity tags in configure_scope
└ proliferate-supervisor/src/logging.rs     ◆ identity tags in configure_scope
apps/desktop/
├ src-tauri/src/sidecar.rs                  ◆ PROLIFERATE_RUNTIME_ENV=local to local runtime
├ src-tauri/src/telemetry.rs                ◆ runtime_env=local tag on native events
└ src/hooks/telemetry/lifecycle/
  ├ use-telemetry-organization-identity.ts  ★ NEW — organization_id tag from org store
  └ use-telemetry-bootstrap.ts              ◆ wires the new hook
server/proliferate/server/cloud/
├ runtime/bootstrap.py                      ◆ _identity_env() merged into 3 launch paths
└ materialization/sandbox_io/connect.py     ◆ org/user/sandbox resolution at launch
```

### 4.2 Server: identity into the E2B launch

`server/proliferate/server/cloud/runtime/bootstrap.py`:

```python
def _identity_env(
    *,
    organization_id: UUID | None = None,
    sandbox_id: str | None = None,
) -> dict[str, str]:
    """Identity env vars for observability (Sentry tags on all runtime surfaces)."""
    env: dict[str, str] = {"PROLIFERATE_RUNTIME_ENV": "e2b"}
    if organization_id is not None:
        env["PROLIFERATE_ORG_ID"] = str(organization_id)
    if sandbox_id:
        env["PROLIFERATE_SANDBOX_ID"] = sandbox_id
    return env
```

Merged into all three launch paths: `build_runtime_env` (anyharness runtime env),
`build_supervisor_config` `[process_env]` (worker + supervisor), and
`build_detached_supervisor_launch_command` exports.

**The org-resolution problem (commit 2 of the PR):** the first commit passed
`sandbox_record.organization_id` — which is **always `None`**: the `cloud_sandbox` table
(`server/proliferate/db/models/cloud/sandboxes.py`) has no organization column, only
`owner_user_id`, and the store factory (`server/proliferate/db/store/cloud_sandboxes.py`)
hardcodes `organization_id=None`. Rather than adding a DB column (out of scope), the org
is resolved at launch time in `connect.py` via the existing membership store
(`organizations_store.get_current_membership_for_user`), wrapped best-effort in
try/except so identity tagging can never fail a sandbox launch.

> **Known limitation:** a user with multiple orgs gets their *first active membership,
> ordered by org name*. The sandbox row carries no billing/org context to disambiguate.
> Acceptable for observability; NOT acceptable if this value ever gates access or routes
> org-level notifications. The clean fix is an `organization_id` column on
> `cloud_sandbox` — deferred.

Same commit adds `PROLIFERATE_USER_ID={owner_user_id}` (the sandbox always knows its
owner) — this is the field the issue-autofix system's ship-time affected-user query
keys on.

### 4.3 Rust: reading env and tagging scope

`anyharness/crates/anyharness/src/telemetry.rs` (runtime binary — worker and supervisor
carry the same logic inline in their `configure_scope` blocks):

```rust
fn sentry_scope_tags() -> Vec<(&'static str, String)> {
    let mut tags: Vec<(&'static str, String)> = vec![
        ("surface", "anyharness_runtime".to_string()),
        ("telemetry_mode", ANYHARNESS_TELEMETRY_MODE.to_string()),
    ];

    let runtime_env = std::env::var("PROLIFERATE_RUNTIME_ENV")
        .unwrap_or_else(|_| "local".to_string());
    tags.push(("runtime_env", runtime_env));

    if let Ok(org_id) = std::env::var("PROLIFERATE_ORG_ID") {
        if !org_id.trim().is_empty() {
            tags.push(("org_id", org_id));
        }
    }
    if let Ok(sandbox_id) = std::env::var("PROLIFERATE_SANDBOX_ID") {
        if !sandbox_id.trim().is_empty() {
            tags.push(("sandbox_id", sandbox_id));
        }
    }
    if let Ok(target_id) = std::env::var("ANYHARNESS_RUNTIME_TARGET_ID") {
        if !target_id.trim().is_empty() {
            tags.push(("target_id", target_id));
        }
    }
    tags
}
```

(`target_id` existed for bearer-token auth — `anyharness-lib/src/app/mod.rs` — but was
never Sentry-tagged before this.)

Strip list — `anyharness/crates/anyharness-lib/src/process_env.rs` — the identity vars
must never leak into user shells inside the sandbox:

```rust
const RUNTIME_PRIVATE_ENV: &[&str] = &[
    "PROLIFERATE_TARGET_SENTRY_DSN",
    "PROLIFERATE_TARGET_SENTRY_ENVIRONMENT",
    "PROLIFERATE_TARGET_SENTRY_RELEASE",
    "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE",
    "PROLIFERATE_ORG_ID",
    "PROLIFERATE_SANDBOX_ID",
    "PROLIFERATE_RUNTIME_ENV",
    "PROLIFERATE_USER_ID",
];
```

### 4.4 Desktop

`apps/desktop/src-tauri/src/sidecar.rs` passes `PROLIFERATE_RUNTIME_ENV=local` to the
locally-spawned runtime; `src-tauri/src/telemetry.rs` tags native events
`runtime_env=local`.

Renderer — new lifecycle hook, following the existing `use-telemetry-*` pattern
(`apps/desktop/src/hooks/telemetry/lifecycle/use-telemetry-organization-identity.ts`):

```typescript
// Owns the organization_id Sentry tag. Sets it whenever the active org is known.
export function useTelemetryOrganizationIdentity() {
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );

  useEffect(() => {
    if (activeOrganizationId) {
      setTelemetryTag("organization_id", activeOrganizationId);
    } else {
      setTelemetryTag("organization_id", "none");
    }
  }, [activeOrganizationId]);
}
```

**Skipped deliberately:** `org_id` on desktop-*native* (Rust/Tauri) events — the org
lives in the renderer's JS store; reaching it from Rust needs new Tauri IPC plumbing
that wasn't worth this lane. Native still gets `runtime_env=local`.

### 4.5 Identity availability matrix

| Surface | org_id | sandbox_id | user_id | runtime_env |
|---|---|---|---|---|
| anyharness runtime (E2B + local) | ✓ membership lookup | ✓ E2B provider id | ✓ | ✓ (default `local`) |
| proliferate-worker / -supervisor | ✓ | ✓ | ✓ | ✓ |
| desktop native (Rust) | ✗ needs IPC | n/a | n/a | ✓ (`local`) |
| desktop renderer (JS) | ✓ org store | n/a | ✓ existing `user.id` | n/a |

Verification: `cargo check` (workspace) + `cargo test -p anyharness -p anyharness-lib
-p proliferate-worker -p proliferate-supervisor` (831 pass); server
`test_anyharness_runtime.py` + `test_e2b_runtime.py` (17 pass); desktop tsc clean.

## 5. PR #968 — release sync

**Problem:** hardcoded fallback release strings that drift forever:

| Component | File | Old default | New source |
|---|---|---|---|
| Desktop renderer | `apps/desktop/src/lib/integrations/telemetry/config.ts` | `"proliferate-desktop@0.1.0"` | `package.json` version |
| Desktop native | `apps/desktop/src-tauri/src/telemetry.rs` | `"proliferate-desktop-native@0.1.0"` | `CARGO_PKG_VERSION` |
| AnyHarness runtime | `anyharness/crates/anyharness/src/telemetry.rs` | `"anyharness@0.1.0"` | `CARGO_PKG_VERSION` |
| Server | `server/proliferate/config.py` | `"proliferate-server@0.1.0"` | `server_version()` at init |
| Worker / supervisor | — | already `CARGO_PKG_VERSION` | unchanged |

The rule: **code defaults derive from a real version source; only CI appends the sha.**

Server init (`server/proliferate/integrations/sentry.py`):

```python
sentry_sdk.init(
    ...,
    release=settings.sentry_release or f"proliferate-server@{server_version()}",
)
```

CI stamping — `.github/workflows/_deploy-server.yml` (was `proliferate-server@<sha>`
with no version):

```bash
server_version="$(cat VERSION)"
short_sha="${GIT_SHA:0:12}"
--arg release "proliferate-server@${server_version}+${short_sha}"
```

`.github/workflows/release-desktop.yml` (was version-without-sha; also fixed the
`anyharness-sidecar@` name mismatch vs the binary's own `anyharness@` default):

```bash
desktop_version="$(node -p "require('./package.json').version")"
anyharness_version="$(grep '^version' ../../anyharness/crates/anyharness/Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')"
short_sha="${GITHUB_SHA:0:12}"

export VITE_PROLIFERATE_RELEASE="${VITE_PROLIFERATE_RELEASE:-proliferate-desktop@${desktop_version}+${short_sha}}"
export PROLIFERATE_DESKTOP_SENTRY_RELEASE="${PROLIFERATE_DESKTOP_SENTRY_RELEASE:-proliferate-desktop-native@${desktop_version}+${short_sha}}"
export ANYHARNESS_SENTRY_RELEASE="${ANYHARNESS_SENTRY_RELEASE:-anyharness@${anyharness_version}+${short_sha}}"
```

Intentional non-change: `cloud_runtime_sentry_release` / `cloud_target_sentry_release`
(`config.py`) default to empty → E2B binaries fall back to their compiled-in
`CARGO_PKG_VERSION` release. Correct, not a bug.

**Why this PR matters beyond hygiene:** the issue-autofix system's release watcher
matches `fix_commit_sha` into releases, and Sentry's regression detection compares
across releases — both are garbage if every event says `0.1.0`.

## 6. PR #969 — desktop replay on error

`apps/desktop/src/lib/integrations/telemetry/sentry.ts`:

```typescript
integrations: [
  ...,
  Sentry.replayIntegration({
    maskAllText: true,
    maskAllInputs: true,
    block: ["[data-telemetry-block]"],
    mask: ["[data-telemetry-mask]"],
  }),
],
replaysSessionSampleRate: 0,                                        // never ambient
replaysOnErrorSampleRate: config.sentry.replaysOnErrorSampleRate,   // default 1.0
```

Sample rate is env-overridable: `VITE_PROLIFERATE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE`
(added to `config.ts` + `.env.example`, default 1.0).

**Masking decision:** `maskAllText: true` — the app renders user code, prompts, and
transcripts; conservative masking was chosen over per-element allowlisting. The
`[data-telemetry-block]` / `[data-telemetry-mask]` selectors are the same ones already
applied for PostHog session recording across chat transcripts, terminals, settings, and
composer. Trade-off: replays show UI structure and interaction flow (which panel was
open, what was clicked before the crash) but not text content.

Gating unchanged: replay, like all vendor telemetry, only fires in `hosted_product` mode
(`apps/desktop/src-tauri/src/desktop_telemetry_mode.rs`). Behavioral verification
therefore requires a hosted build — steps documented in the PR body.

## 7. External systems (lane 5 — configuration, not code)

### Done and verified

- **Slack**: app "Proliferate Alerts" (App ID `A0BFD1Z5GV7`) in workspace Team
  Proliferate; incoming webhook → `#alerts`; verified via live POST (`ok`). The webhook
  URL is a secret (holders can post to the channel); it lives in the Slack app config,
  not in this repo.
- **AWS IAM**: user `grafana-cloudwatch-readonly` (account `157466816238`) with managed
  policy `CloudWatchReadOnlyAccess`, access key minted for the Grafana data source.
- **Prod log groups** (confirmed via `aws logs describe-log-groups`):
  `/ecs/proliferate-server`, `/ecs/proliferate-prod`, `/ecs/proliferate-prod-litellm`,
  `/ecs/proliferate-worker`, `/ecs/proliferate-gateway`, `/ecs/proliferate-llm-proxy`,
  `/ecs/proliferate-web`, `/ecs/proliferate-staging` — 30-day retention, ECS Container
  Insights on (`server/infra/main.tf`).

### Pending (human login required — blocks issue-autofix ingestion)

- **Grafana Cloud**: free-tier stack `https://pablosfsanchez.grafana.net` created via
  Google SSO on the personal Gmail (the proliferate.com Workspace blocks third-party
  OAuth). First login gated by reCAPTCHA. Remaining once through: CloudWatch data
  source → "Proliferate Ops" dashboard (6 panels: error rate by service,
  `CRITICAL_FAILURE` count, p95 latency, 5xx rate, ECS CPU/mem, live error tail
  filterable by org/user) → `slack-alerts` contact point → alert rules (5xx>10/5m,
  p95>5s/10m blanket, ECS CPU>90%/15m).
- **Sentry**: needs a real login to org `proliferate` (browser had a non-member account).
  Remaining: recon whether a `proliferate-server` project exists at all — repo variables
  carry DSNs only for desktop/anyharness/web, and `.env.production.example` ships
  `SENTRY_DSN=` empty, so **prod server events may currently go nowhere**; create the
  project + wire DSN if missing (see `sentry-setup-runbook.md`); alert rules: new fatal
  (`critical_failure=true`) issue → Slack, blanket p95>5s transaction alert → Slack.

## 8. End-to-end: what happens when something breaks

**Server request throws:**
```
exception → logger.exception → JSON line in CloudWatch /ecs/proliferate-server
            (version, git_sha, organization_id, user_id, request_id)
          → Sentry event, same identity via RequestTelemetryMiddleware
          → if report_critical site: level=fatal + critical_failure=true
          → [pending] Sentry alert rule → Slack #alerts
          → [pending] Grafana CRITICAL panel increments
```

**Automation run / Celery task throws:** identical, but identity comes from
`_claim_correlation_fields()` (automation) or the `CorrelatedTask` header round-trip
(Celery) instead of the HTTP middleware.

**E2B sandbox process panics / anyhow-errors:**
```
sentry panic hook / sentry_anyhow::capture_anyhow
  → Sentry event tagged org_id + user_id + sandbox_id + runtime_env=e2b + target_id,
    release=<component>@<VERSION>+<sha>
  → [issue-autofix v1] sync_sentry ingests; fix workflow can attach to the live
    sandbox by sandbox_id; ship-time affected-user query enumerates by user_id
  → logs stay in-sandbox (/home/user/anyharness.log, proliferate-supervisor.log),
    readable via the sandbox_exec.py tail commands — no shipping pipeline by decision
```

**Desktop renderer throws:** ErrorBoundary/global handler → Sentry event with `user.id`
+ `organization_id` + synced release + masked on-error replay.

**Desktop native panics:** sentry panic hook → `surface=desktop_native`,
`runtime_env=local` (no org — §4.4 limitation).

**Accepted blind spots** (decided 2026-07-05): self-managed/local-dev installs
(telemetry-mode gated dark by design); LiteLLM gateway internals (CloudWatch logs only);
Celery/background latency; streaming-turn latency (long-lived SSE/websocket turns appear
as one opaque transaction).

## 9. Deferred / follow-ups

- `organization_id` column on `cloud_sandbox` (fixes the multi-org first-membership wart, §4.2).
- Desktop-native org tag (needs Tauri IPC, §4.4).
- Grafana stack ownership: currently on a personal Gmail account — migrate to an
  org-owned account before using it as a design-partner reference.
- Latency instrumentation for the accepted blind spots, if/when they bite.
- E2B log shipping — explicitly not built; revisit only if live-attach investigation
  (issue-autofix §5.2) proves insufficient for post-mortem debugging of dead sandboxes.
- The workflow layer (auto-investigate, dedup, user notification) is owned by
  `specs/tbd/issue-autofix-system-v1.md` — nothing more gets built under this spec.
