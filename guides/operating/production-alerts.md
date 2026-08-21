# Production Grafana alerts

Status: authoritative for the five production Grafana alert rules, their
stable identity, and the dedicated dark issue-tracker webhook contact point,
on the OLD workspace (`proliferate-ops`, g-e532d030d8). See
[below](#the-new-workspace-proliferate-ops-rebuild) for the NEW workspace
(`proliferate-ops-rebuild`, g-48655e6419), which uses a different (simpler,
tracker-free) delivery design per the 2026-08-20 overnight execution spec's
D2 revision.

`ECS CPU > 90% for 15m` (`cfrmh7d7od8g0c`) was retired as a paging rule on
2026-08-21: infra symptom, not a product promise. It is no longer in the
allowlist on either workspace, but it is still queryable on the Production
Overview dashboard in the new workspace.

Use this runbook to understand what each production alert detects, where to
look first when it fires, and how to reproduce or roll back the rule-identity
overlay and the tracker contact point. The end-to-end support boundary is owned
by [`../../specs/codebase/systems/engineering/issue-lifecycle/support-loop.md`](../../specs/codebase/systems/engineering/issue-lifecycle/support-loop.md).

## Fixed production target

```text
AWS account:       157466816238
AWS region:        us-east-1
Grafana workspace: g-e532d030d8 (proliferate-ops)
Grafana version:   10.4
```

The operator script refuses to write if any of these differ.

## Required access

- Read access to the `proliferate-ops` Grafana workspace.
- For live export/apply/restore (never for offline `check`): the ephemeral
  Grafana Admin service-account token minted immediately before the operation
  and stored at `~/.proliferate-local/ops/grafana-admin.token` with mode `0600`.
  It is never the runtime Viewer credential.
- AWS access to read `issue-tracker/app.grafanaWebhookSecret` at apply time.
- AWS access to read `issue-tracker/sources.grafanaToken`: the dedicated Viewer
  service-account token the tracker uses for runtime Grafana polling. It is a
  read-only credential and is explicitly not the Admin token.

Secrets policy: never paste the Admin token, the Viewer token, the webhook
Bearer credential, workspace URLs, or request bodies into chat, issues, PRs, or
docs. Share only rule UIDs, metadata names, checksums, and contact-point setting
names. The operator script redacts URLs, authorization values, credentials, and
bodies from all console output.

## The five rules

Every rule carries the labels `proliferate_rule_uid` (its immutable UID),
`proliferate_component=proliferate-server`, and `severity`, plus a stable
`runbook_url` annotation pointing at its section below.

### ALB 5xx errors (dfrmh7bc4yqrkf)

- Detects: ALB 5xx responses above 10 in a 5-minute window.
- Severity: critical. Component: proliferate-server.
- Look first at the load balancer target health, recent server deploys, and the
  server error logs in `/ecs/proliferate-prod`.
- This is a metric alert with no single exact log identity, so it carries no log
  lookup metadata.

### API p95 latency (bfrmh7c7ecbnkb)

- Detects: API p95 latency above 5s sustained for 10 minutes.
- Severity: critical. Component: proliferate-server.
- Look first at downstream dependency latency (DB, provider calls), CPU/memory
  saturation, and recent deploys.
- Metric alert; no log lookup metadata.

### CRITICAL_FAILURE in prod logs (bfrmh7e7x2k8wd)

- Detects: the `CRITICAL_FAILURE` marker emitted by `report_critical(...)` in
  the production server logs.
- Severity: critical. Component: proliferate-server.
- Look first at CloudWatch log group `/ecs/proliferate-prod`, filter pattern
  `CRITICAL_FAILURE`, region `us-east-1`, and the correlated Sentry fatal event.
- This is the **only** rule that supports user/release enrichment, because it is
  the only one with one exact structured-log identity. Its structured lines
  carry `user_id` and `release_id`, so a firing alert can be tied to an
  authenticated user and a component release. It therefore carries the three log
  annotations `proliferate_log_group`, `proliferate_log_filter_pattern`, and
  `proliferate_log_region`.

The other four rules deliberately have no log lookup metadata:

- ALB and latency are metric alerts without one exact log identity.
- Analytics matches are plaintext and cannot yield user/release identity.
- The server-error metric combines server and worker groups; this slice does not
  invent a list-of-log-groups schema to enrich that broad rule.

### Analytics ingest errors (cfrmh7f2sbe2od)

- Detects: errors in the analytics ingestion path.
- Severity: critical. Component: proliferate-server.
- Look first at the analytics pipeline health and recent analytics schema or
  writer changes.
- No log lookup metadata (matches are plaintext, no user/release identity).

### Server error rate (cfrmh7fttw4jke)

- Detects: server error rate above 10 in a 10-minute window.
- Severity: warning. Component: proliferate-server.
- Look first at the server and worker logs together; this metric combines both
  groups.
- No log lookup metadata (broad rule spanning multiple log groups).

## Operator script

The repository artifacts are:

```text
server/infra/observability/grafana/production-alerts.json   # rule identity + metadata overlay
server/infra/observability/grafana/issue-tracker-contact.json  # dark contact-point template
scripts/ops/grafana-alerting.mjs                            # check / export / apply / restore
```

### check (offline, safe any time)

```bash
node scripts/ops/grafana-alerting.mjs check
node scripts/ops/grafana-alerting.mjs check --snapshot <exported-snapshot.json>
```

`check` needs no network. It validates the checked-in overlay and contact
template (target match, exactly five known UIDs, approved labels/annotations,
log annotations only on `bfrmh7e7x2k8wd`, and a secret reference with no secret
value). With `--snapshot` it detects UID/title drift against a captured export.

### export / apply / restore (live)

```bash
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs export  --receipt <private-path>
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs apply   --receipt <private-path>
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs restore --receipt <private-path>
```

These are live Grafana operations. `apply` requires the issue tracker to be
serving `https://issues.proliferate.com/v1/ingest/grafana`, because that is the
url the contact point it creates delivers to. All three refuse to touch the
network unless `GRAFANA_ALERTING_LIVE=1` is set, so no live call happens by
accident. Order:

1. `export` reads the live rules, contact points, and notification policy,
   normalizes them, captures the query checksums into a mode-`0600` rollback
   receipt outside Git, and refuses a public or worktree receipt path.
2. `apply` re-reads live, hard-rejects any UID/title/query mismatch (it never
   recreates a rule), overlays only the approved labels/annotations while
   preserving the query model byte-for-byte, **creates** the named
   `issue-tracker-webhook` contact point (resolving the Bearer credential from
   `issue-tracker/app.grafanaWebhookSecret` at execution time), and verifies the
   notification policy checksum is unchanged. Contact-point creation is
   **create-only**: `apply` refuses when the receiver already exists, because
   updating in place would require replaying a credential the tooling never
   retains. To re-apply, first run `restore` (which removes the
   tooling-created receiver), then `apply`.
3. `restore` replays the before-export rules from the receipt to the same
   target-locked workspace and removes only the tooling-created
   `issue-tracker-webhook` receiver (verifying the route tree and Slack
   receivers are untouched, and restoring the pre-removal config if that
   verification fails). It refuses a receipt claiming the receiver pre-existed
   E1 — exported secure fields are redacted markers and must never be
   replayed. The retained private receipt from the accepted E1 run is the
   rollback authority for the created receiver; credential rotation is a
   later, separately reviewed change.

The tracker contact point is created and removed through the Alertmanager
config API rather than the provisioning API, because AMG Grafana 10.4 returns
HTTP 500 (`no secrets configured for type 'webhook'`) for any webhook contact
point created through provisioning.

All live output is bounded to UIDs, metadata names, checksums, and contact-point
setting names.

## Delivery auth on Grafana 10.4

Live delivery auth is a dedicated static Bearer credential. The contact point
sets `authorization_scheme: Bearer` and the operator script resolves
`issue-tracker/app.grafanaWebhookSecret` at execution time; no other route uses
that credential. This is **not** the HMAC-SHA256 `X-Grafana-Alerting-Signature`
scheme that
[`support-loop.md`](../../specs/codebase/systems/engineering/issue-lifecycle/support-loop.md)
describes as the target contract. Grafana 10.4 does not support native HMAC
signing, so moving to the signed scheme is coupled to a separately tested
Grafana upgrade.

## Health check is manual for now

There is no scheduled Grafana canary, Lambda, workflow, or seventh business
rule. To confirm delivery health, an operator runs `check` and inspects the
bounded read-back from a live `export`/`apply`. A daily automated canary is
deliberately out of scope.

## How E2 activates the dark contact point

E1 creates the `issue-tracker-webhook` contact point and proves it exists, but
no notification policy references it, so it cannot deliver anything. E2 adds a
notification-policy route that sends the six rules' notifications to the tracker
contact point **in addition to** the existing Slack routes, then proves via live
read-back that delivery reaches `https://issues.proliferate.com/v1/ingest/grafana`
and that Slack routing is unchanged.

## How to disable tracker delivery without disabling Slack

Once E2 has activated the contact point:

1. Remove only the notification-policy route that targets `issue-tracker-webhook`.
   Leave the `slack-ops-alerts` (critical) and `slack-eng-triage` (warning)
   routes in place.
2. Optionally delete the `issue-tracker-webhook` contact point if it should no
   longer exist. Never touch the Slack receivers.
3. Read back the notification-policy checksum and confirm both Slack routes
   remain active.

Disabling tracker delivery is a notification-policy change, not a rule change:
the six rules keep firing and keep routing to Slack exactly as before.

## Verification

Automated (no live calls):

```bash
node --test scripts/ops/grafana-alerting.test.mjs
node scripts/ops/grafana-alerting.mjs check
```

Live acceptance (requires the tracker serving
`https://issues.proliferate.com`): record one bounded receipt proving
the six exact UIDs are present, every query checksum is unchanged before and
after, the approved labels/annotations read back, only `bfrmh7e7x2k8wd` has log
metadata, the tracker contact point exists and is unreferenced, the
notification-policy checksum is unchanged, critical still routes to
`slack-ops-alerts`, warning still routes to `slack-eng-triage`, and no tracker
issue or occurrence was created.

## Common failure modes

| Symptom | First response |
| --- | --- |
| `check` reports a target mismatch | Confirm you are pointed at account 157466816238 / us-east-1 / g-e532d030d8; do not force a write. |
| `check --snapshot` reports drift | A rule's UID or title changed live; reconcile the overlay before any apply, never recreate the rule. |
| Live command refuses to run | `GRAFANA_ALERTING_LIVE=1` is unset. It is unset by default; set it only for an intended live run. |
| Receipt path rejected | Use an absolute path outside the Git worktree in a non-world/group-writable directory. |

## Final report

Report the environment, the five rule UIDs, metadata names, before/after query
checksums, the notification-policy checksum, whether the tracker contact point
exists and is unreferenced, and the receipt path (never its contents). State
explicitly that no Admin token, Viewer token, webhook credential, workspace URL,
or request body was shared.

## The NEW workspace (proliferate-ops-rebuild)

`proliferate-ops-rebuild` (g-48655e6419) is the parallel replacement workspace
built 2026-08-20. It is a **separate target with a separate tool**:
`scripts/ops/grafana-rebuild-bootstrap.mjs` against
`server/infra/observability/grafana/production-alerts-rebuild.json`. It cannot
write to the OLD workspace and `grafana-alerting.mjs` cannot write to this one
(each hard-pins its own `TARGET`/`NEW_TARGET`). Do not delete the OLD workspace
until this one has been the production alert source for a burn-in period; it
is the rollback.

### Two things this workspace needed that a plain "re-apply the rules" does not cover

Discovered live 2026-08-21 (Lane A3), not previously documented:

1. **`unifiedAlerting.enabled` was `false`.**
   `aws grafana describe-workspace-configuration --workspace-id g-48655e6419`
   showed alerting disabled at the workspace level, which blocks the entire
   `/api/v1/provisioning/*` surface (rules, contact points, policies)
   regardless of data source state. Fixed with
   `aws grafana update-workspace-configuration --workspace-id g-48655e6419
   --configuration '{"unifiedAlerting":{"enabled":true},"plugins":{"pluginAdminEnabled":false}}'`.
   The workspace cycles through `UPDATING` for roughly three minutes.
2. **AMG has no usable native Grafana "email" contact-point type.**
   `POST /api/v1/provisioning/contact-points` with `type: "email"` returns
   HTTP 500 `no secrets configured for type 'email'` — AMG does not run an
   SMTP relay for you. The supported path is SNS: both this workspace's and
   the OLD workspace's IAM roles already carry an inline policy
   (`AmazonGrafanaSNSPublish-proliferate-ops-alerts`) scoped to
   `sns:Publish` on one specific existing topic,
   `arn:aws:sns:us-east-1:157466816238:grafana-proliferate-ops-alerts`, which
   already has exactly one CONFIRMED subscription: protocol `email`, endpoint
   `pablo@pablohansen.com`. This satisfies the 2026-08-20 overnight execution
   spec's D2 revision ("no issue tracker, no aggregation queue... default:
   Pablo's email") without minting anything new or waiting on a subscription
   confirmation click.

   Every AMG workspace ships a default placeholder contact point named
   `grafana-default-sns` (receiver `sns receiver`, `settings.topic` literally
   `arn:aws:sns:region:0123456789:SNSTopicName`) that the root notification
   policy already targets by default. The fix is to repoint that one
   `settings.topic` field at the real ARN above and leave everything else
   (route tree, receiver name) untouched — never create a second receiver or
   edit the route. `ensureContactRouting` in the bootstrap script does exactly
   this and is idempotent.

   Slack is an optional, separately gated additive path. Its webhook is read
   only from `SLACK_ALERTS_WEBHOOK_URL` in the protected local observability
   environment file; it is never checked in. Grafana regenerates a reserved
   matcher subtree whenever a standalone receiver is added, so a second
   receiver cannot provide an authored sibling fan-out safely. Instead, the
   Slack operation adds exactly one Slack integration beside the existing SNS
   integration inside `grafana-default-sns`; Grafana sends a notification to
   every integration in that contact point. The root/default policy, its full
   route tree, and the exact SNS integration remain unchanged. A partial
   standalone `grafana-rebuild-slack` receiver (pinned UID
   `dfvuf540l7ym8d`) is removed only after both its provisioning and receiver
   readbacks match that identity and the combined contact is written and
   verified, making interrupted migration safe to retry. Any loss, ambiguity,
   duplicate, UID mismatch, or drift fails closed before mutation.

### Repository artifacts

```text
server/infra/observability/grafana/production-alerts-rebuild.json   # rule identity + datasource/contact/dashboard wiring for the new workspace
server/infra/observability/grafana/production-overview-dashboard.json  # the one dashboard, checked in verbatim
scripts/ops/grafana-rebuild-bootstrap.mjs                            # check / apply / verify
```

### check / apply / verify

```bash
node scripts/ops/grafana-rebuild-bootstrap.mjs check
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-rebuild-bootstrap.mjs apply
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-rebuild-bootstrap.mjs verify
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-rebuild-bootstrap.mjs slack-apply
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-rebuild-bootstrap.mjs slack-verify
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-rebuild-bootstrap.mjs slack-test
```

- `check` is offline: validates the rule set still matches the shared
  five-rule allowlist in `grafana-alerting.mjs`, every checksum reproduces
  from its own queryModel, every CloudWatch query stanza points at the
  declared datasource uid, the contact point is `sns` with a real (non
  placeholder) topic ARN, and the notification policy receiver matches the
  contact point name.
- `apply` is live, idempotent, and additive-only: it creates the `ops-folder`
  folder, the CloudWatch datasource (auth type `default`, i.e. the workspace
  IAM role), the five alert rules (with their OLD-workspace UIDs preserved so
  identity is stable across both workspaces), repoints the default SNS
  contact point at the real topic if it is still on the placeholder, and
  creates the Production Overview dashboard. Anything already present and
  matching is left alone; anything present but drifted from the checked-in
  definition raises rather than silently overwriting.
- `verify` is live and read-only: reads every rule back and recomputes its
  checksum, confirms the root route receiver and the SNS topic wiring, and
  confirms the dashboard exists. Use this, not a clean `apply` exit code, as
  the proof that alerting actually works.
- `slack-apply`, `slack-verify`, and `slack-test` are separately live-gated
  and require `SLACK_ALERTS_WEBHOOK_URL` before any provider request.
  `slack-verify` throws on missing, duplicate, drifted, or incomplete migration
  state; it does not report partial boolean success. The test payload contains
  only the Slack integration, so it sends no duplicate SNS/email notification.
  Record only its success status and timestamp, never the webhook URL.
- Admin credential: a dedicated ADMIN-role service-account token for this
  workspace only, minted via `aws grafana create-workspace-service-account`
  (role `ADMIN`) + `create-workspace-service-account-token`, stored at
  `~/.proliferate-local/ops/grafana-admin-rebuild.token` (mode `0600`). This
  is a different file from the OLD workspace's
  `~/.proliferate-local/ops/grafana-admin.token`; do not confuse them. Data
  source creation and contact-point/policy writes need Admin — the existing
  `proliferate-read` (Viewer) and `proliferate-alerting` (Editor) service
  accounts for this workspace are not sufficient.

### Proving an alert would actually reach Pablo's email

`POST /api/alertmanager/grafana/config/api/v1/receivers/test` against the
`grafana-default-sns` receiver sends a real synthetic alert through Grafana's
actual SNS publish path (not a dry validation) and returns
`{"status":"ok"}` per receiver on success. A successful test publishes to the
real topic, which the confirmed subscription then emails. This was run once
live during the 2026-08-21 bootstrap with result `status: "ok"`; treat further
test notifications (e.g. to close out the D2 acceptance criterion) as
additional confirmations, not a first proof.

## Sign-in success rate (SLI)

Status: authoritative for the sign-in success-rate SLI alert rule, a separate
`sli-alerts` rule group from the six rules above. Built 2026-08-20/21 as part
of the observability overnight push (Lane D). This rule lives on the **NEW**
Grafana workspace, `proliferate-ops-rebuild` (`g-48655e6419`), not the OLD
workspace this runbook otherwise documents. See the accounts-and-wiring
context doc for that workspace's own state; the essentials are repeated here
so this runbook stays self-contained for on-call.

### What it measures

The token-exchange endpoints (`/auth/web/token`, `/auth/mobile/token`,
`/auth/desktop/token`) previously emitted no outcome log line at all, so
sign-in success/failure had no signal anywhere. `server/proliferate/auth/sign_in_observability.py`
adds exactly one: every successful or failed token exchange now emits a
structured JSON log line via `log_sign_in_success(surface)` /
`log_sign_in_failure(surface, failure_code=...)`, called from
`server/proliferate/server/accounts/identity/api.py` (`web_token`,
`mobile_token`) and `server/proliferate/server/accounts/desktop/api.py`
(`exchange_token`). Fields, stable and consumed by the metric filters below:

- `event`: always `"auth.sign_in.outcome"`
- `auth_sign_in_outcome`: `"success"` or `"failure"`
- `auth_sign_in_surface`: `"web"`, `"mobile"`, or `"desktop"`
- `auth_sign_in_failure_code`: the bounded `AuthFlowError.code` (failure only,
  e.g. `identity_auth_code_invalid`, `desktop_pkce_verification_failed`) --
  never the auth code, PKCE verifier, tokens, or the user's email.

### CloudWatch metric filters

Two Logs metric filters on `/ecs/proliferate-prod`, namespace `Proliferate/Prod`
(same namespace as `CriticalFailureCount`/`ServerErrorLines` above):

| Filter name | Pattern | Metric |
| --- | --- | --- |
| `sign-in-success` | `{ $.auth_sign_in_outcome = "success" }` | `SignInSuccessCount` |
| `sign-in-failure` | `{ $.auth_sign_in_outcome = "failure" }` | `SignInFailureCount` |

Live-verified 2026-08-21: two canary log events (`observability_canary_2026-08-21`,
`"canary": true`) were injected into
`observability-canary/sign-in-sli/2026-08-21` and both metrics registered a
real `Sum=1.0` datapoint via `aws cloudwatch get-metric-statistics`. Ignore
these two canary datapoints in triage; they are test artifacts, not real
sign-ins, and predate any rotated build shipping real traffic.

### Grafana alert rule

`Sign-in failures > 5 in 10m` (uid `ffvtx33lbo5c0e`, rule group `sli-alerts`,
folder `ops-folder`, severity `warning`): fires when `SignInFailureCount`
(Sum, 10m window) exceeds 5. Live-verified 2026-08-21: rule created via
`POST /api/v1/provisioning/alert-rules`, read back with the checksum matching
the checked-in definition, and evaluating (`health: "ok"`, `state: "inactive"`,
i.e. correctly not currently past threshold) per
`GET /api/prometheus/grafana/api/v1/rules`.

Delivery: this rule has no contact point or route of its own. The NEW
workspace's root notification policy has no child routes, so every rule
(including this one) routes to the workspace's one default receiver, which
Lane A3 repointed at the real, confirmed SNS topic
`arn:aws:sns:us-east-1:157466816238:grafana-proliferate-ops-alerts`
(subscription: protocol `email`, endpoint `pablo@pablohansen.com`, confirmed --
`aws sns get-subscription-attributes` shows `PendingConfirmation: false`).
Independently re-verified 2026-08-21 by sending a second, separate test
notification through that exact receiver
(`POST /api/alertmanager/grafana/config/api/v1/receivers/test`), result
`status: "ok"`. An alert on this rule, or on any of the five rules above once
they are live on this workspace, reaches Pablo's email today.

Repository artifacts:

```text
server/infra/observability/grafana/sli-alerts.json   # rule identity + query model, checksum-verified
scripts/ops/grafana-sli-alerts.mjs                   # check / apply / verify (this rule only)
```

`grafana-sli-alerts.mjs` never touches the `production-alerts` rule group, the
contact point, or the notification policy -- it assumes the `ops-folder`
folder and the CloudWatch data source already exist (Lane A3's job) and only
creates/verifies rules inside its own `sli-alerts` group:

```bash
node scripts/ops/grafana-sli-alerts.mjs check
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-sli-alerts.mjs apply
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-sli-alerts.mjs verify
```

`check` is offline: validates the target, the rule group, the runbook
annotation, and that the checksum reproduces from the query model. `apply` is
live and idempotent (creates only what is missing; a live rule that has
drifted from the checked-in definition fails loudly rather than being
overwritten). `verify` is live and read-only: reads the rule back, recomputes
its checksum, and reports per-rule health/state from the Prometheus-shaped
rules API.

### What to do when it fires

Look first at the correlated `auth.sign_in.outcome` log lines in
`/ecs/proliferate-prod` (filter `auth_sign_in_outcome = "failure"`), grouped by
`auth_sign_in_failure_code` and `auth_sign_in_surface`, to identify whether one
surface or one failure code dominates. A spike concentrated in one
`failure_code` usually points at a specific upstream cause (e.g. an expired
client secret, a clock-skew-sensitive PKCE check, or a revoked-refresh
cascade); a spike spread evenly across codes and surfaces more often points at
an infra-level problem (DB connectivity, a bad deploy) rather than the auth
logic itself.

### Independent re-verification (Lane D continuation, 2026-08-21 ~01:xx PDT)

Re-checked everything above from a fresh process, not by trusting the prior
agent's write-up:

- `aws logs describe-metric-filters --log-group-name /ecs/proliferate-prod`
  shows both `sign-in-success` and `sign-in-failure` live, same shapes as
  above. Neither the pre-existing `critical-failure`/`server-error-lines`
  filters nor these two are Terraform-managed (`server/infra/*.tf` has no
  matching resource for any of the four), so this is consistent with existing
  practice, not a new gap.
- `aws cloudwatch get-metric-statistics` for both `SignInSuccessCount` and
  `SignInFailureCount` over the last 6h returned a real `Sum=1.0` datapoint at
  `2026-08-21T00:30:00-07:00` for each (the canary pair) — the pipe carries a
  real, non-zero number end to end, not just a rule with no data behind it.
- `node scripts/ops/grafana-sli-alerts.mjs verify` (live, read-only): rule
  `ffvtx33lbo5c0e` checksum `match`, health `ok`, state `inactive`.
- Pulled the live alertmanager config directly
  (`GET /api/alertmanager/grafana/config/api/v1/alerts`): the root route's
  receiver is `grafana-default-sns`, and that receiver's one
  `grafana_managed_receiver_configs` entry (name `sns receiver`, uid
  `bfvtw9if8c3cwd`) has `settings.topic` =
  `arn:aws:sns:us-east-1:157466816238:grafana-proliferate-ops-alerts` — the
  same confirmed-subscription topic, not a different or drifted one. The
  nested `__grafana_autogenerated__` route tree all resolves to this same
  receiver, so a rule with no labels of its own (this one) inherits it.
- Fired a fresh, independent test notification for this exact rule (not
  reusing the prior agent's result) via
  `POST /api/alertmanager/grafana/config/api/v1/receivers/test`, alert labels
  `alertname: "Sign-in failures > 5 in 10m"`: HTTP 200,
  `receivers[0].grafana_managed_receiver_configs[0].status: "ok"`,
  `notified_at: "2026-08-21T08:02:55.226292503Z"`. This is proof that this
  specific rule's notification path, not just the workspace's default path in
  the abstract, reaches the SNS topic with Pablo's confirmed email
  subscription.
