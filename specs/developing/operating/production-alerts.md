# Production Grafana alerts

Status: authoritative for the six production Grafana alert rules, their stable
identity, and the dedicated dark issue-tracker webhook contact point.

Use this runbook to understand what each production alert detects, where to
look first when it fires, and how to reproduce or roll back the rule-identity
overlay and the tracker contact point. The end-to-end support boundary is owned
by [`../../codebase/systems/engineering/issue-lifecycle/support-loop.md`](../../codebase/systems/engineering/issue-lifecycle/support-loop.md);
the frozen slice contract is
[`../../codebase/systems/engineering/issue-lifecycle/grafana-rules-delivery.md`](../../codebase/systems/engineering/issue-lifecycle/grafana-rules-delivery.md).

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
- For live export/apply/restore (Phase 2 only): the ephemeral Grafana Admin
  service-account token minted immediately before the operation and stored at
  `~/.proliferate-local/ops/grafana-admin.token` with mode `0600`. It is never
  the runtime Viewer credential.
- AWS access to read `issue-tracker/app.grafanaWebhookSecret` at apply time.

Secrets policy: never paste the Admin token, the Viewer token, the webhook
Bearer credential, workspace URLs, or request bodies into chat, issues, PRs, or
docs. Share only rule UIDs, metadata names, checksums, and contact-point setting
names. The operator script redacts URLs, authorization values, credentials, and
bodies from all console output.

## The six rules

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

### ECS CPU saturation (cfrmh7d7od8g0c)

- Detects: ECS service CPU above 90% for 15 minutes.
- Severity: critical. Component: proliferate-server.
- Look first at task count, autoscaling activity, and any runaway request
  pattern or background loop.
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

The other five rules deliberately have no log lookup metadata:

- ALB, latency, and CPU are metric alerts without one exact log identity.
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
template (target match, exactly six known UIDs, approved labels/annotations,
log annotations only on `bfrmh7e7x2k8wd`, and a secret reference with no secret
value). With `--snapshot` it detects UID/title drift against a captured export.

### export / apply / restore (live, Phase 2)

```bash
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs export  --receipt <private-path>
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs apply   --receipt <private-path>
GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs restore --receipt <private-path>
```

These are live Grafana operations and are **gated on slice A acceptance**. They
refuse to touch the network unless `GRAFANA_ALERTING_LIVE=1` is set, so no live
call happens by accident. Order:

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

All live output is bounded to UIDs, metadata names, checksums, and contact-point
setting names.

## Health check is manual for now

There is no scheduled Grafana canary, Lambda, workflow, or seventh business
rule. To confirm delivery health, an operator runs `check` and, in Phase 2,
inspects the bounded read-back from `export`/`apply`. A daily automated canary
is deliberately out of scope for this slice.

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

Live acceptance (Phase 2, gated on slice A): record one bounded receipt proving
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
| Live command refuses to run | `GRAFANA_ALERTING_LIVE=1` is unset (expected until Phase 2) or slice A is not yet accepted. |
| Receipt path rejected | Use an absolute path outside the Git worktree in a non-world/group-writable directory. |

## Final report

Report the environment, the six rule UIDs, metadata names, before/after query
checksums, the notification-policy checksum, whether the tracker contact point
exists and is unreferenced, and the receipt path (never its contents). State
explicitly that no Admin token, Viewer token, webhook credential, workspace URL,
or request body was shared.
