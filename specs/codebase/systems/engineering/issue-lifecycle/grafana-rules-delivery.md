# Prepare Grafana Rules and Delivery

> [!important] Frozen contract
> Founder-approved on 2026-07-14 and grounded in Proliferate `origin/main` at
> `66f45bfbe2839ae1382133393844ba61dce035cd`, issue-tracker `origin/main` at
> `98ee54d8b20bca172c83b28f7b0beebea78c5ea1`, and a read-only production
> Grafana/CloudWatch audit on 2026-07-14. Implementation is authorized only
> after A is accepted and the access preflight is green.

- Current slice: **E1 - Prepare Grafana Rules and Delivery - frozen**
- Next slice: **E2 - Activate Grafana and Prove Log Investigation - frozen**

## Outcome

Make the six existing production alerts reproducible and useful to the tracker
without delivering anything to it yet.

```text
six existing rule UIDs and queries
-> stable rule identity + component + runbook metadata
-> one justified structured-log lookup contract
-> dedicated-auth tracker contact point, present but unreferenced
-> current Slack routing and alert behavior unchanged
```

The slice is complete only after live read-back proves that query behavior and
Slack routing did not change. A committed file or successful API write is not
enough.

## Preconditions

- A is live on schema `0003`, at `https://issues.proliferate.com`, with all
  source writers disabled.
- `issue-tracker/app.grafanaWebhookSecret` exists.
- `issue-tracker/sources.grafanaToken` contains a dedicated **Viewer** service
  account token for later tracker polling. The current Admin service-account
  token is not the runtime credential.
- P0 has proved the exact noninteractive Grafana Admin token mint/revoke path.
  Immediately before E1, the operator mints a token whose recorded remaining
  lifetime covers the scheduled E1+E2 acceptance and rollback window, stores
  it only at `~/.proliferate-local/ops/grafana-admin.token` with mode `0600`,
  and validates it without printing it. It is never the runtime Viewer
  credential.
- The access preflight has already proved the exact workspace, AWS account,
  secret references, and non-mutating Grafana reads. E1 does not pause to ask
  Pablo for a login or credential.

## Fixed production target

```text
AWS account:       157466816238
AWS region:        us-east-1
Grafana workspace: g-e532d030d8
Workspace name:    proliferate-ops
Grafana version:   10.4
```

The implementation refuses to write if any target differs.

## Exact rule contract

The existing UID, title, query/expression model, thresholds, datasource,
evaluation interval, and no-data/error behavior remain unchanged.

| UID | Existing title | Severity | Metadata added |
| --- | --- | --- | --- |
| `dfrmh7bc4yqrkf` | ALB 5xx > 10 in 5m | critical | identity, component, runbook |
| `bfrmh7c7ecbnkb` | API p95 Latency > 5s for 10m | critical | identity, component, runbook |
| `cfrmh7d7od8g0c` | ECS CPU > 90% for 15m | critical | identity, component, runbook |
| `bfrmh7e7x2k8wd` | CRITICAL_FAILURE in prod logs | critical | identity, component, runbook, exact log lookup |
| `cfrmh7f2sbe2od` | Analytics ingest errors | critical | identity, component, runbook |
| `cfrmh7fttw4jke` | Server error rate > 10 in 10m | warning | identity, component, runbook |

Every rule has these labels:

```text
proliferate_rule_uid=<the immutable UID above>
proliferate_component=proliferate-server
severity=<the existing value above>
```

Every rule has a stable `runbook_url` annotation targeting the owning anchor in
the production-alert runbook.

Only `bfrmh7e7x2k8wd` has these annotations:

```text
proliferate_log_group=/ecs/proliferate-prod
proliferate_log_filter_pattern="CRITICAL_FAILURE"
proliferate_log_region=us-east-1
```

The other rules deliberately have no log lookup metadata:

- ALB, latency, and CPU are metric alerts without one exact log identity.
- Recent analytics matches are plaintext and cannot yield user/release identity.
- The server-error metric combines server and worker groups. This slice does
  not invent a list-of-log-groups schema merely to enrich that broad rule.

## Repository changes

Expected Proliferate tree:

```text
server/infra/observability/grafana/
├── production-alerts.json       # normalized safe definitions for the six UIDs
└── issue-tracker-contact.json   # non-secret dark contact-point template
scripts/ops/
├── grafana-alerting.mjs         # check, export, and narrowly apply
└── grafana-alerting.test.mjs
specs/developing/operating/
└── production-alerts.md         # runbook, routed from the operating README
specs/codebase/systems/engineering/issue-lifecycle/
└── support-loop.md              # current truth after this slice lands
```

If the verified repository already has a more specific owning path, the
implementer reports that concrete contradiction before moving files. It does
not create a second Grafana ownership tree.

### Normalized rule file

`production-alerts.json` contains the complete safe rule definitions needed to
detect query drift and reproduce metadata. It contains no token, webhook
credential, private dashboard cookie, or unrelated exported
workspace object.

Normalization removes provider timestamps and ordering noise but preserves the
query/expression model byte-for-byte after canonical JSON serialization. The
file contains exactly the six allowed UIDs and no wildcard discovery behavior.

### Contact-point template

The contact point is dedicated to the tracker:

```text
method:           POST
url:              https://issues.proliferate.com/v1/ingest/grafana
maxAlerts:        0
sendResolved:     true
auth scheme:      Bearer
credential:       issue-tracker/app.grafanaWebhookSecret
```

The field name stays `grafanaWebhookSecret`, but its launch contract is a
dedicated static Bearer credential used by no other route. The production
workspace is Grafana 10.4, which supports webhook Authorization credentials
but not native HMAC signing. E1 does not perform the irreversible workspace
upgrade to Grafana 12.4 merely to add HMAC. Trusted TLS protects transport and
E2's exact occurrence identities make delivery replay idempotent. Native HMAC
is a later hardening change coupled to an independently tested Grafana upgrade.

The checked-in template names the secret reference but never contains the
value. E1 creates the contact point and proves it exists, but no notification
policy references it. Therefore E1 cannot deliver a business alert or health
canary to the tracker.

> [!note] Amendment (2026-07-15, coordinator-approved): creation surface
> The dedicated contact point is created and removed via the **Alertmanager
> config API** (`/api/alertmanager/grafana/config/api/v1/alerts`), not the
> provisioning API. AMG Grafana 10.4's provisioning API cannot create any
> webhook contact point: `POST /api/v1/provisioning/contact-points` returns
> HTTP 500 `{"message":"no secrets configured for type 'webhook'"}` even with
> zero credential fields in the body (a type-registry defect in this Grafana
> version, observed twice in Phase 2 and reproduced by a bounded live probe
> with a throwaway receiver and dummy credential, fully restored afterward).
> The Alertmanager path is proven on this workspace: POST of the full config
> with an appended webhook receiver (settings + `secureSettings`) returned
> 202, and read-back showed `secureFields.authorization_credentials=true`
> (server-side encrypted). The outcome is unchanged: a dedicated Bearer
> contact point, present but unreferenced.
>
> Route guarantee (as accepted live on 2026-07-15): Grafana regenerates its
> autogenerated routing subtree (`__grafana_autogenerated__`, one child per
> receiver) whenever a receiver is created or removed, so the full route tree
> is NOT byte-identical across a write. The verified rule is: the
> operator-authored route tree is byte-identical, and the autogenerated
> subtree changes by exactly one canonical child for `issue-tracker-webhook`
> (added on create, removed on restore) with no other autogenerated change.
> The operator script enforces this per write, verifies other receivers are
> untouched and the credential is stored encrypted, and restores the pre-write
> config on any verification failure.
>
> Contact-point semantics are **one-time create**: `apply` refuses when the
> tracker receiver already exists (updating in place would require replaying a
> credential the tooling never retains), and `restore` refuses a receipt that
> claims the receiver pre-existed E1. The retained private E1 receipt from the
> accepted run is the rollback authority for the created receiver. Credential
> rotation or receiver update is a later, separately reviewed change; it is
> not part of this slice's operator script.

### Operator script

The script exposes only these operations:

```bash
node scripts/ops/grafana-alerting.mjs check
node scripts/ops/grafana-alerting.mjs export --receipt <private-path>
node scripts/ops/grafana-alerting.mjs apply --receipt <private-path>
node scripts/ops/grafana-alerting.mjs restore --receipt <private-path>
```

It must:

1. verify the exact account, region, workspace ID, and six-rule allowlist;
2. export and normalize the live rules, contact points, and notification policy
   before any write;
3. create a mode-`0600` rollback receipt outside Git and refuse a public or
   worktree path;
4. reject a UID/title/query mismatch rather than recreating the rule;
5. overlay only approved labels and annotations;
6. create only the named tracker contact point (create-only: a pre-existing
   receiver is refused; run restore to remove the tooling-created receiver
   first, then re-run apply — see the creation-surface amendment);
7. leave the notification policy untouched;
8. read the webhook credential from its canonical secret reference at execution time;
9. redact URLs, authorization values, webhook credentials, and request bodies; and
10. perform live read-back and print only bounded UIDs, metadata names,
    checksums, and contact-point setting names.

## Runbook

`production-alerts.md` explains, in plain language:

- what each of the six rules detects;
- the owning component and stable UID;
- where an operator should look first;
- why only `CRITICAL_FAILURE` supports user/release enrichment;
- how to run check/export/apply/restore;
- how E2 will activate the dark contact point; and
- how to disable tracker delivery without disabling Slack alerts.

The health check is **manual for now**. This replaces the older proposal for a
daily scheduled Grafana canary. E1 adds no scheduler, Lambda, workflow, or
seventh persistent business rule.

## Verification

### Automated

- normalized output is stable across ordering/timestamp changes;
- exactly six known UIDs are accepted;
- title, UID, or query drift causes a hard failure;
- only `bfrmh7e7x2k8wd` may contain log annotations;
- contact-point serialization contains a secret reference but no secret;
- output redaction covers tokens, URLs, webhook credentials, and bodies;
- wrong account, region, or workspace is rejected; and
- apply cannot mutate the notification policy.

Run the repository's narrow test plus:

```bash
node --test scripts/ops/grafana-alerting.test.mjs
python3 scripts/check_docs.py
```

### Live acceptance gate

Record one bounded E1 receipt proving:

```text
six exact UIDs present
query checksum before == query checksum after for every UID
approved labels/annotations read back
only one rule has log metadata
tracker contact point exists and is unreferenced
notification-policy checksum before == after
critical still routes to slack-ops-alerts
warning still routes to slack-eng-triage
no tracker issue or occurrence was created
ephemeral Admin token remains valid only at its named 0600 path for E2
```

Do not begin E2 if any line is false.

## Rollback

1. Restore the private before-export through the same target-locked script.
2. Delete only the newly created, still-unreferenced tracker contact point if it
   did not exist before E1.
3. Read back all six query and policy checksums.
4. Confirm the existing Slack receivers and routes remain active.
5. Retain the redacted receipt; never copy the private export into Git.

## Non-goals

- activating tracker delivery;
- changing thresholds, queries, or alert inventory;
- replacing or testing Slack;
- storing raw CloudWatch logs in the tracker;
- adding multi-log-group enrichment;
- adding a seventh business rule or recurring health scheduler; or
- modifying issue-tracker ingestion code.
