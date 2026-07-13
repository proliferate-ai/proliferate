# Support system

Status: authoritative target contract for Proliferate's closed-loop support,
issue-resolution, attribution, and changelog pipeline.

The currently shipped private capture path remains defined in
[`support-reporting.md`](support-reporting.md). This document owns what happens
after a report completes and how support, Sentry, Grafana, GitHub, product
releases, and the public changelog fit together.

The exact standalone tracker database and API are owned by
[`issue-tracker/SPEC.md`](https://github.com/pablonyx/issue-tracker/blob/main/SPEC.md).
This document owns the cross-system boundary. The tracker spec wins for tracker
internals; this spec wins for Proliferate capture/release behavior and the
end-to-end product outcome.

## Product outcome

The support system is this complete loop:

```text
Sentry exceptions ----\
Grafana alerts --------+-> issue tracker -> agent/human work -> linked PRs
Support reports -------/                                      |
                                                               v
                               public changelog <- release manifest <- release
                                      |
                                      v
                             consented credit / later outreach
```

It is not enough for an alert to exist in Grafana, a group to exist in Sentry,
or a report to reach Slack. The system is complete only when:

- every actionable source event is represented in the issue tracker exactly
  once;
- the event carries its authenticated user and component release when the
  source knows them;
- duplicate events and reports converge on one issue;
- agents can list, poll, claim, update, and link PRs through a stable API;
- merged PRs are grouped deterministically into a release manifest;
- consented reporters/requesters can be credited in the PR and changelog;
- an optional editorial headline and media can appear above generated feature
  and fix lists.

## Ownership

| System | Owns |
| --- | --- |
| Proliferate support domain | Authenticated report capture, immutable report intent, private message/diagnostics/attachments, completion, user/contact resolution. |
| `issue-tracker` | Issues, occurrences, reporters, status, claims, audit/poll events, PR relationships, consent-safe attribution projection. |
| Sentry | Exception bodies, stack traces, grouping, event identity, event user, release tag, source deeplinks. |
| Grafana/CloudWatch | Alert rules, firing notifications, metric/log evaluation, structured log bodies and source queries. |
| GitHub | PR title, labels, checks, author, state, merge SHA, raw product release. |
| Proliferate release tooling | Tag range, merged-PR set, deterministic category, release manifest. |
| `landing` | Editorial copy/media and rendered public changelog MDX. |

The standalone tracker is a durable production component, not a disposable
prototype. Future Proliferate workflows may consume its poll/API contracts,
but workflow execution does not replace tracker business state.

## Core invariants

1. Source replay is harmless and cannot create duplicate occurrences.
2. One issue may affect many users and many releases.
3. Observed user and release belong to occurrences, not the canonical issue
   row; the issue keeps only one resolution-component routing value.
4. Cross-component defects use one issue per component and may share PRs.
5. Sentry/Grafana/support evidence stays in its owning private source; the
   tracker stores identifiers, a safe issue summary, and links.
6. Missing user/release metadata is visible but never causes event loss.
7. Claiming is separate from issue status.
8. A merged PR is not automatically a solved issue.
9. Public credit is opt-in and separate from private notification intent.
10. No email, internal user ID, report ID, report body, diagnostics, or log body
   is copied into public GitHub or changelog content.
11. Generated release/changelog output is deterministic and idempotent.

## Release identity

Every deployable source uses:

```text
<component>@<version>+<12-character-git-sha>
```

The component must identify the process that emitted the event. Server release
identity must never be reused for AnyHarness, worker, or supervisor events.

Required component names:

```text
proliferate-server
proliferate-litellm
proliferate-web
proliferate-mobile
proliferate-desktop
proliferate-desktop-native
anyharness
proliferate-worker
proliferate-supervisor
```

Sentry project names are routing names, not release components.
`proliferate-cloud` project events emitted by the control-plane server use
`proliferate-server`; the `proliferate-target` project distinguishes
AnyHarness, worker, and supervisor by their release IDs.

Version/build sources are fixed:

| Component | Version source | Build SHA |
| --- | --- | --- |
| `proliferate-server` | root `VERSION` | deployed server image commit |
| `proliferate-litellm` | root `VERSION` | deployed LiteLLM image commit |
| `proliferate-web` | root `VERSION` | deployed Vercel/GitHub commit |
| `proliferate-mobile` | `apps/mobile/app.config.ts`, which must equal `apps/mobile/package.json` | EAS build commit |
| `proliferate-desktop`, `proliferate-desktop-native` | `apps/desktop/package.json`, which must equal Tauri config and `apps/desktop/src-tauri/Cargo.toml` | desktop artifact build commit |
| `anyharness`, `proliferate-worker`, `proliferate-supervisor` | `anyharness/sdk/package.json`; release input and `runtime-v<semver>` must match it | runtime artifact build commit |

The public product version remains root `VERSION` and `proliferate-vX.Y.Z`.
Runtime/desktop/mobile versions may differ from it; the release ID always uses
the emitting artifact's version and build SHA.

Every production build path receives those tracked values explicitly. In
particular, `release-runtime.yml`, `_deploy-e2b.yml`/`build-template.mjs`,
`release-cloud-template.yml`, `release-desktop.yml`, and `server-ci.yml`'s
`self-hosted-release-assets` path all use the tracked runtime version and
current build SHA for AnyHarness, worker, or supervisor. A no-version E2B hotfix
keeps the tracked semver and changes the SHA, but it is lane-scoped operational
work and cannot attest a globally shipped target component by itself. Desktop,
runtime, server, and mobile artifact releases require the version/tag behavior
in the CI/CD spec; no lane invents a tag or falls back to Cargo metadata.

Production builds fail closed when their release input is absent. They must not
fall back to a stale package constant such as `0.1.0`.

One release ID must identify one immutable artifact set. Mutable upstream
images/packages are resolved and pinned before build. A retry reuses the
already-built artifact; it may not rebuild different bytes under the same
`component@version+sha`. If the immutable artifact is unavailable or a rebuild
produces a different digest, the release fails and requires a new commit (and a
new version where the lane requires one). The self-hosted bundle consumes the
canonical runtime artifacts rather than silently recompiling target binaries
under a server release.

The runtime workflow must apply `PROLIFERATE_BUILD_VERSION` and a compile-time
SHA stamp to AnyHarness, worker, and supervisor. Supervisor therefore needs the
same build-stamp path already used by AnyHarness/worker; Cargo `0.1.0` is not an
acceptable production fallback. A shared `PROLIFERATE_TARGET_SENTRY_RELEASE`
override is removed because it cannot distinguish processes. If emergency
overrides remain, their exact component-specific names are
`ANYHARNESS_SENTRY_RELEASE`, `PROLIFERATE_WORKER_SENTRY_RELEASE`, and
`PROLIFERATE_SUPERVISOR_SENTRY_RELEASE`.

Every structured production log emits the exact field `release_id`; every
authenticated request/job binds the privacy-safe `user_id` field. Sentry uses
the same release ID and sets `user.id` (a temporary allowlisted `user_id` tag
fallback exists only during migration).

## Tracker data contract

The agreed tracker schema is deliberately small:

```text
issues
  canonical kind, source key/link, title/description
  one resolution component
  status: tbd | not_done | spam | solved
  claim lease
  investigation/resolution
  solved release ID

issue_occurrences
  id, issue_id, event_key, user_id, occurred_at, release_id

issue_reporters
  issue/report/user identity
  private outreach override
  notify intent
  public-credit consent/name

events
  append-only audit timeline and poll cursor

pull_requests + issue_pull_requests
  many-to-many issue/PR relation and bot-attribution projection state

sync_sources
  source cursor, last attempt, last success, last error
```

There is no tracker deployments table. The canonical occurrence `release_id`
and issue `solved_release_id` are sufficient for the current fix/regression
contract together with Git ancestry stored in audit attestations. One issue has
one `resolution_component`; a cross-component defect is represented by one
issue per component, and those issues may link to the same PR. The exact DDL,
constraints, indexes, migration mapping, and regression rules are in the
tracker spec.

### Status semantics

| Status | Meaning |
| --- | --- |
| `tbd` | Newly ingested and not evaluated. |
| `not_done` | Valid issue/feature that is still unresolved. |
| `spam` | Noise, invalid input, or intentionally discarded. |
| `solved` | Resolution is complete. |

`claimed_by`/claim expiry represents in-progress work. An open or merged fix PR
leaves the issue `not_done`. For a PR-linked code change, `solved` requires the
trusted production-release workflow to attest the issue's component release
and the tracker to verify every fix merge SHA is in that component head. The
general agent key cannot set `solved_release_id`. An issue without a fix PR may
be solved with a resolution note.

## Sentry ingestion

The tracker covers these organization projects:

```text
anyharness
proliferate-cloud
proliferate-desktop
proliferate-desktop-native
proliferate-mobile
proliferate-server
proliferate-target
proliferate-web
```

The current unresolved-group poll remains useful for reconciliation, but group
summaries are not occurrence coverage. The event adapter must fetch every new
production error event per project, with overlap pagination and a per-project
watermark.

Mapping:

```text
canonical issue key   sentry:<project>:<groupID>
target issue key      sentry:proliferate-target:<component-or-unknown>:<groupID>
occurrence key        sentry:<project>:<eventID>
user                  event.user.id, then temporary allowlisted user_id tag
time                  event.dateCreated
release               event release tag
```

Only a canonical allowlisted release is stored. Malformed release becomes null
and increments `invalid_release`; target events then use the `unknown`
component key. The same normalizer is used by polling and direct support-event
resolution.

An immutable event with conflicting `event.user.id` and fallback `user_id` tag
is still retained, but with null user plus a `user_identity_conflict` health
counter and sanitized audit event. For a non-target project, a release whose
component conflicts with the fixed project map is retained with null release
plus `release_component_conflict`; the project map still owns the issue.
These are terminal metadata warnings, so they do not poison the per-project
watermark or hide later valid events.

`eventID` is the exact Sentry response field, not its separate internal `id`.
Each project has an independent health/cursor row and `(dateCreated, eventID)`
watermark. Polling uses a ten-minute overlap and full cursor pagination.

The production environment allowlist is mandatory per project. Values are
trimmed/casefolded; the initial accepted values are `production` and
`trusted-beta`. Missing, staging, or unknown values are counted and excluded,
not silently treated as production.

Only the allowlisted fields enter the tracker. Stack traces, event messages,
breadcrumbs, IPs, emails, attachments, and raw payloads remain in Sentry.
Missing user/release values are stored as null and counted in health output.

Upstream telemetry must set the privacy-safe internal `user.id` for
authenticated work and propagate user identity into correlated background work.
Rust emitters currently using only a `user_id` tag must migrate to Sentry user
context; the adapter fallback prevents loss during that migration. Startup,
infrastructure, and genuinely anonymous events do not invent users.

The target project may group equivalent events from different processes, so
its canonical issue key includes the release component. Missing release uses
the literal `unknown` key and awaits explicit deduplication; first-seen order
never chooses a component.

## Grafana ingestion and log enrichment

A poll of current firing rules is not a complete delivery guarantee: a short
alert can start and resolve between polls. Therefore:

- a Grafana webhook contact point is the primary alert delivery path;
- `Max Alerts = 0`, HMAC-SHA256, signature header
  `X-Grafana-Alerting-Signature`, and timestamp header
  `X-Grafana-Alerting-Timestamp` protect complete delivery;
- the current firing-rule poll remains a five-minute reconciliation and health
  path;
- webhook and poll use the same deterministic keys.

The signature is lowercase hex HMAC of `<unix-timestamp>:<raw-body>`. The
tracker enforces a 1 MiB body limit, five-minute skew, and constant-time
comparison. `truncatedAlerts > 0` rejects the whole delivery. Poll and webhook
health have separate rows, and a daily annotated canary tests the webhook
without creating a business issue.

Every production rule carries exact `proliferate_rule_uid` and
`proliferate_component` labels. Log-backed rules also carry
`proliferate_log_group`, `proliferate_log_filter_pattern`, and optional
`proliferate_log_region`. The adapter never guesses the UID from
`generatorURL`. For a structurally valid alert with a fingerprint/start time
but missing or invalid rule identity, webhook and poll create a generic
`grafana:invalid:<fingerprint>` configuration issue and keyed system
occurrence with null component/user/release, record only a safe reason code,
and increment `invalid_rule_identity`. This terminal warning cannot poison
valid siblings in a grouped delivery. Polling indexes provisioned rules from
`/api/v1/provisioning/alert-rules`, reads active instances from
`/api/alertmanager/grafana/api/v2/alerts`, joins by the UID label, and uses the
v2 `fingerprint` directly.

Mapping:

```text
canonical issue key   grafana:<stable-rule-uid>
invalid-config issue  grafana:invalid:<fingerprint>
log occurrence key    grafana:<rule-uid>:cw:<eventId>
system occurrence     grafana:<rule-uid>:<fingerprint>:<starts-unix-ms>
invalid occurrence    grafana:invalid:<fingerprint>:<starts-unix-ms>
```

`fingerprint` is Grafana's label-set fingerprint returned by the webhook and v2
poll endpoint, so simultaneous alert instances cannot collide. It is not part
of a structured-log occurrence key: the same CloudWatch `eventId` returned for
two simultaneous instances of one rule must attach only once.

The adapter uses fully paginated CloudWatch `FilterLogEvents`, continuing even
when an empty page has `nextToken`. It parses exact structured fields `user_id`
and `release_id`; malformed release becomes null plus `invalid_release` health.
`eventId` is the provider event pointer. Repeated tokens,
overflow of the 10,000-event alert-window cap, or partial pages fail enrichment
rather than silently truncate. Every valid non-canary alert instance always
upserts one system occurrence with null user/release; matching structured-log
occurrences are additional evidence. Webhook, poll, and resolved delivery use
the same key. The annotated health canary updates only webhook health.

Because CloudWatch delivery can lag, both webhook and poll upsert a durable
enrichment window. A one-minute worker queries immediately, two minutes after
firing/resolved delivery, and ten minutes after resolution. Pending windows
live in the `grafana:enrichment` sync cursor until the final successful query;
absence from two polls closes a window whose resolved webhook was missed. A
resolved webhook upserts that same required system occurrence and closes the
window, so resolved-only recovery and ordinary resolution are identical and
idempotent. Late log matches append occurrences without deleting the null alert
occurrence.

Grafana clients must surface HTTP/auth failures as failed runs. A healthy run
with zero firing alerts still advances `last_success_at`; cursor time is not a
health signal.

Every Sentry project, Grafana poll, and support feed runs every five minutes
and is stale after ten. Grafana enrichment and GitHub attribution run every
minute and are stale after two. The webhook canary runs daily and is stale
after 26 hours. A newer failed attempt degrades its own row immediately.

The issue tracker is not a log warehouse. Full log bodies remain in
CloudWatch/Grafana.

## Support feed

Report capture adds the current client `releaseId` to the immutable report
intent. The `support_report` row gains immutable `client_release_id` and a
server-produced, scrubbed `tracker_summary` capped at 240 characters; raw user
text remains only in the private case object. `telemetry_refs_json` normalizes
Sentry references to `{project, eventId}` pairs. Proliferate exposes only
completed reports through:

```http
GET /internal/support/reports?cursor=<opaque>&limit=50
Authorization: Bearer <support-feed-key>
```

The feed includes:

```text
report id, submission time, and completion time
owner user id
kind: bug | feature
bounded sanitized internal summary (not the raw message)
client release ID
notify intent
credit consent/name
explicit outreach override, when present
private case reference
Sentry `{project, eventId}` references
```

It excludes diagnostic/attachment bodies, object keys, signed URLs, and raw
logs. Private case evidence is fetched later through an audited support-service
boundary.

The response is ordered by `(completed_at, id)` and gives every item its own
opaque commit cursor in addition to page `nextCursor`/`hasMore`. Empty cursor
starts from the oldest historical completion. The tracker processes items
sequentially:

1. Resolve every project/event reference through the same production
   environment/user/release/component normalizer as polling; transient Sentry
   failure defers the support item.
2. If retained references resolve to one canonical Sentry source key, upsert
   that Sentry issue and every resolved referenced event even when the normal
   poll has not reached them, then attach.
3. With zero retained references or more than one canonical source key, create
   a standalone `support:<report-id>` issue. Multiple keys require explicit
   later deduplication; adapter order never chooses one.
4. Insert `support:<report-id>` as the occurrence key.
5. Insert the reporter consent/contact record.
6. Commit the item and its item cursor together.

The tracker never commits the page cursor ahead of an item. A failure cannot
skip a report, including reports sharing one timestamp. Historical completed
reports are backfilled and count-reconciled through this same feed.
New production reports require a canonical client release before completion;
legacy malformed values ingest as null with `invalid_release` health.
A fresh Sentry `404` is retried until 30 minutes after support completion so a
client-captured event cannot race ingestion. Only then may retention/unavailable
use the standalone path; auth, timeout, and `5xx` always fail the item and
preserve its cursor position.

## Issue API

The machine surface uses a dedicated Bearer API key stored in AWS Secrets
Manager. It is separate from employee/web authentication. Mutations also
require `X-Run-Id` so audit events identify the workflow/agent run.

```text
GET    /v1/issues
GET    /v1/issues/{id}
GET    /v1/issues/poll?cursor=&limit=
POST   /v1/issues/{id}/claim
POST   /v1/issues/{id}/release-claim
PATCH  /v1/issues/{id}
POST   /v1/issues/{id}/deduplicate
POST   /v1/issues/{id}/prs
POST   /v1/attribution/query
POST   /v1/releases/attest
GET    /v1/ops
```

List/poll use opaque cursors; mutations have documented conflict outcomes.
Claim is an atomic lease acquire/renew/takeover after expiry. Deduplication
moves occurrences, reporters, and PR relationships to one root and redirects
future source ingest without adding a duplicate status value. `fix` wins a
join collision. If only one side has a resolution component, the root inherits
it; different known components cannot merge. Other mutations reject a
duplicate shell with its root ID. Moving occurrences into a solved root reruns
regression checks for each one; unresolved work, a qualifying recurrence, or
an unshipped fix PR reopens and clears the solved release. Adding a fix link to
a solved issue performs the same containment revalidation.
Spam/non-spam issues cannot be deduplicated until status is corrected; for two
non-spam issues, `not_done` wins over `tbd`.

`POST /v1/releases/attest` uses a second release-workflow-only Bearer secret,
not the general agent key; that key may also call the read-only attribution
batch query. It accepts actual production component release IDs,
component heads, deployed time, matrix-complete artifact-set proofs, and the
merged PR set. The tracker rejects duplicate component/PR identities,
canonicalizes array order before hashing, verifies GitHub ancestry, and solves
only matching-component issues with at least one fix relationship whose
complete fix-PR set shipped. Related-only links are attribution/context. The
attestation is stored in issue audit events; there is no deployments table.
Disabled or skipped lanes are not attestations.

The service has stable DNS and trusted TLS before other production services or
agents depend on it. Human routes never trust `X-Human-User` supplied by a
machine token.

The issue detail response exposes source identifiers, users, releases, safe
links, reporter credit/notify choices, PRs, and audit events. It does not expose
reporter email or private source bodies to the general agent API.

## PR metadata and attribution

The existing PR contract remains authoritative:

- title format: `<type>(<scope>): <plain-English change>`;
- exactly one `release:*` label;
- at least one `area:*` label.

There is no version number on an ordinary PR; the successful release boundary
assigns it. Agent defaults are deterministic:

- bug fix: `fix(<scope>): ...` plus `release:fix`;
- feature: `feat(<scope>): ...` plus `release:minor-feature` unless the issue
  explicitly describes a launch-level surface, in which case
  `release:large-feature` requires human confirmation;
- measured performance-only work: `perf(<scope>): ...` plus
  `release:performance`;
- `area:*` labels come from actual changed paths and all affected areas are
  applied; component alone is not guessed into an area label.

An ambiguous feature size or path-to-area result blocks PR finalization for
human choice rather than selecting a plausible label silently.

Agents link PRs through the tracker rather than embedding support data in the
PR body. The tracker stores the many-to-many relationship and maintains one
bot-authored projection comment:

```md
<!-- proliferate-attribution:v1 digest=<sha256> -->

Support attribution

- Reported by @alice
- Suggested by Sam Rivera
```

Attribution rules:

- bug reporters render as `Reported by`;
- feature requesters render as `Suggested by`;
- only `credit_consent=true` rows appear;
- duplicate display names render once;
- no internal ID, email, support ID, private message, or telemetry identity
  enters GitHub;
- only the configured bot's versioned marker is trusted;
- the tracker remains canonical and the comment is a public projection.

Consented names are NFC-normalized, whitespace-collapsed, capped at 200
characters, control-free, and deduped with Unicode casefold. If one name is
both a bug reporter and feature requester on the same PR, `reported` wins.
Credits have a fixed role/name sort. PR titles and names are rendered through
CommonMark/MDX text escaping; consent never permits raw markup or JSX.

The marker digest is SHA-256 of canonical JSON containing PR identity and the
normalized/sorted credits. Reporter/link/dedup changes append durable
`attribution.refresh_requested` events; a cursor-backed worker retries GitHub
projection and deletes an obsolete comment when no public credits remain.

Notification intent is not public-credit consent. A user may choose either,
both, or neither.

## Release manifest

The existing raw product-release generator may retain its operational
train/hotfix boundary. The polished boundary is the previous successfully
published versioned product Release containing an asset named exactly
`release-manifest.json` with media type `application/json` and a valid v1
manifest. A failed tag or partial train never advances it. The first run uses
one explicit configured base SHA.

Nightly and hotfix finalizers share repository-wide concurrency group
`public-release-finalizer` with `cancel-in-progress: false`. Under that lock
the finalizer re-reads the latest valid boundary, requires its head to be an
ancestor of the candidate head, and recomputes the range. A candidate already
equal to the boundary is an
idempotent no-op; an older or divergent candidate is rejected. Publication is
the compare-and-set: only the locked run may attach the manifest and advance
the boundary.

PR category mapping for the polished changelog is:

| PR label | Manifest category |
| --- | --- |
| `release:large-feature` | `feature` |
| `release:minor-feature` | `feature` |
| `release:performance` | `feature` |
| `release:fix` | `fix` |
| `release:docs` | `omit` |
| `release:maintenance` | `omit` |
| `release:skip` | `omit` |

All merged PRs remain present in the manifest, including `omit` items, so the
range is auditable. Only `feature` and `fix` render publicly. Omit items always
use `components: []` and never force or claim a production deployment.

The existing deploy-surface detector is translated explicitly. Per-PR changed
paths narrow the possible set; a broad surface never means every listed
component automatically changed.

| Detector surface | Possible release components / rule |
| --- | --- |
| `server` | `proliferate-server` |
| `litellm` | `proliferate-litellm` |
| `web` | `proliferate-web` |
| `mobile` | `proliferate-mobile` |
| `desktop` | renderer paths → `proliferate-desktop`; native paths → `proliferate-desktop-native`; bundled runtime paths → `anyharness` |
| `runtime` | crate paths → `anyharness`, `proliferate-worker`, and/or `proliferate-supervisor` |
| `e2b` | the same target component(s) promoted into the cloud template from canonical runtime artifacts |
| `workers` | no component attestation today; the lane is a configured no-op and cannot prove a user-visible change shipped |

Shared build/workflow files take the union. A public PR with an ambiguous
mapping fails finalization and requires an explicit reviewed mapping override
in the release run; overrides are recorded in the raw release ledger.

The checked-in v1 component-to-production-lane matrix is not caller-supplied:

| Component | Required production lanes |
| --- | --- |
| `proliferate-server` | `hosted-server`, `self-hosted-release` |
| `proliferate-litellm` | `hosted-litellm`, `self-hosted-release` |
| `proliferate-web` | `hosted-web` |
| `proliferate-mobile` | `mobile-production` |
| `proliferate-desktop` | `desktop-updater` |
| `proliferate-desktop-native` | `desktop-updater` |
| `anyharness` | `runtime-artifacts`, `e2b-production`, `desktop-updater`, `self-hosted-release` |
| `proliferate-worker` | `runtime-artifacts`, `e2b-production`, `self-hosted-release` |
| `proliferate-supervisor` | `runtime-artifacts`, `e2b-production`, `self-hosted-release` |

The disabled hosted `workers` surface is not a production lane in v1. Enabling
it requires adding `hosted-workers` to the checked-in worker matrix before it
can contribute shipment proof. Nightly/hotfix must expose, execute, and gate
their detected `litellm` surface through `_deploy-litellm.yml`; merely detecting
it cannot produce a release claim.

Each lane returns an `artifactSetDigest`: lowercase SHA-256 of its canonical,
sorted immutable provider artifact references/checksums. Containers use OCI
digests, Vercel/EAS/E2B use immutable provider deployment/build IDs, and
desktop/runtime/self-hosted assets use published checksums. Release tooling
derives the required lanes from the matrix, verifies provider results, and
rejects a missing, extra, mutable, or duplicate lane proof.

Each component promotion creates one successful GitHub Deployment in
environment `production/<component>`. Its immutable payload contains
`schemaVersion=1`, `component`, `releaseId`, full `headSha`, and the verified
sorted lane proofs, including each lane's canonical immutable references and
digest. The tracker attestation request and public manifest carry only the lane
and digest; the tracker fetches the Deployment payload and recomputes each
digest from those references.
The payload is evidence, not authority for which lanes are required. The
Deployment ID and its first successful status's `created_at` are the durable
attestation identity/time. Retries add/reuse status on that Deployment; they
never substitute the current clock. A component spanning several required
lanes is promoted only after all those lanes succeed with the same release
ID/head and immutable artifact set. A prior Deployment for the same release ID
with different artifact digests is a hard failure.

Release planning unions newly detected surfaces with outstanding public
feature/fix surfaces since the last valid manifest. Successful component
deployments can therefore be carried forward across an attribution/finalizer
outage, while a skipped component is forced into a later plan. This prevents a
failed public boundary from stranding a PR without adding a tracker deployment
table.

After actual production lanes complete, finalization:

1. paginates the full base-to-head Git history and associated merged PRs (no
   250-commit cap), verifies reachability/base branch, and deduplicates by
   `(repository, number)`;
2. requires exactly one recognized `release:*` label on every PR;
3. maps each PR's changed paths through the same deploy-surface detector used
   by release planning, while assigning `components: []` to `omit` items;
4. requires every component of a public feature/fix PR to have a verified
   successful `production/<component>` GitHub Deployment whose lane proofs
   exactly match the checked-in matrix—disabled/skipped lanes do not count;
5. obtains credits from the tracker, failing closed if the query fails;
6. calls the tracker release-attestation endpoint with the verified deployment
   IDs, stable timestamps, actual component heads, and artifact-set digests;
7. validates and publishes the immutable `release-manifest.json` asset.

If any public item is not actually shipped, finalization creates no manifest
and the public boundary remains unchanged so the PR is reconsidered next time.

Manifest contract:

```json
{
  "schemaVersion": 1,
  "release": {
    "tag": "proliferate-v0.3.26",
    "version": "0.3.26",
    "date": "2026-07-13",
    "baseTag": "proliferate-v0.3.25",
    "baseHead": "40-character-previous-head-sha",
    "head": "40-character-release-head-sha",
    "deployedAt": "2026-07-13T12:34:56Z",
    "components": [
      {
        "component": "proliferate-server",
        "releaseId": "proliferate-server@0.3.26+9affc0f0d489",
        "headSha": "40-character-component-head-sha",
        "deploymentId": 123456789,
        "deployedAt": "2026-07-13T12:30:00Z",
        "artifacts": [
          {"lane": "hosted-server", "artifactSetDigest": "64-character-sha256"},
          {"lane": "self-hosted-release", "artifactSetDigest": "64-character-sha256"}
        ]
      }
    ]
  },
  "items": [
    {
      "repository": "proliferate-ai/proliferate",
      "number": 123,
      "url": "https://github.com/proliferate-ai/proliferate/pull/123",
      "title": "Fix workspace reconnect",
      "mergeSha": "40-character-merge-sha",
      "mergedAt": "2026-07-12T18:00:00Z",
      "releaseLabel": "release:fix",
      "category": "fix",
      "components": ["proliferate-server"],
      "credits": [
        {"displayName": "@alice", "role": "reported"}
      ]
    }
  ]
}
```

[`release-manifest.schema.json`](release-manifest.schema.json) is the
machine-readable contract and rejects unknown fields recursively. Public
credits contain only display name and `reported | suggested`; they never
contain consent flags, emails, user IDs, report IDs, or private text.
Components sort by name, lane proofs by lane, items by repository/PR number,
and credits by the normalization rule above. Serialization recursively sorts
object keys, uses two-space indentation, UTF-8, LF, and one final newline.

Semantic validation additionally requires one entry per component, one entry
per `(repository, number)`, tag/version agreement, release-ID component/SHA
agreement, exact matrix-derived lane proofs, label/category agreement, at least
one component for public items, zero components for omit items, every public
item component to exist in `release.components`, and at most one entry per
normalized public credit name (`reported` wins a mixed-role collision).

Publishing is immutable: an identical existing asset is a no-op; differing
bytes fail. Component `deployedAt` is the first successful GitHub Deployment
status time; release `deployedAt` is the maximum component time, and `date` is
its UTC date.

A no-version hotfix sends a trusted component attestation only when it satisfies
the full component lane matrix. In v1 that means `web` only; E2B, LiteLLM, and
disabled workers may remain operational raw-ledger hotfixes but cannot solve a
component issue alone. No no-version hotfix creates a public manifest or
changelog boundary, and desktop is never a no-version lane.

## Public changelog generation

The landing repository's existing frontmatter and MDX contract remain in
place:

```text
title
summary
version
date
kind: Release | Feature | Fix | Update
tags
```

Automation consumes the manifest on branch `changelog/v<version>` and creates
or updates one draft PR titled `docs(changelog): publish v<version>`. It scans
every changelog file for both frontmatter `version` and the generated body
version marker. Exactly one union match is updated regardless of filename; a
match whose two values disagree fails. No match creates
`content/changelog/v<version>.mdx`, and multiple union matches fail. It never
auto-merges public copy. The changelog index sorts by `date` descending and
then semantic `version` descending, so same-day nightly/hotfix entries have a
stable release order.

New files receive deterministic defaults:

```yaml
title: Proliferate v0.3.26
summary: 'Features and fixes shipped in Proliferate v0.3.26.'
version: 0.3.26
date: '2026-07-13'
kind: Release
```

`tags` is omitted. After creation, `version` and `date` remain machine-owned and
must match the manifest. Reruns preserve human-owned `title`, `summary`, `kind`,
optional `tags`, and the editorial body.

The MDX body has two ownership regions:

1. an optional human-owned headline/introduction/media region;
2. a machine-owned Features/Fixes block surrounded by stable markers.

The existing `<ChangelogMedia>` component supplies Mux video, static image, or
local video support. No changelog schema change is required for headline media.

```mdx
# Optional editorial copy is represented by the entry title/body

{/* generated:release-version:0.3.26 */}

<ChangelogMedia
  playbackId="optional-mux-id"
  alt="Description of the highlighted feature"
  aspectRatio="1024 / 643"
/>

{/* generated:release-items:start */}
## Features

- **Feature title.** Suggested by @person.

## Fixes

- **Fix title.** Reported by Sam Rivera.
{/* generated:release-items:end */}
```

Reruns update only the generated block and preserve editorial content and
media. Empty sections are omitted. Items retain manifest order and render
`Reported by` before `Suggested by`. The public changelog renders neither PR
numbers nor PR URLs; the manifest and raw GitHub Release remain the audit
ledger. PR titles and credit names become escaped MDX text nodes, never raw
string-built JSX/HTML. If there are no feature/fix items, the automation does
not open a landing PR.

The version marker must occur exactly once and agree with frontmatter. The
generated start/end markers must each occur exactly once and be ordered. A
missing, duplicate, or mismatched marker fails instead of creating a second
entry or overwriting editorial content.

## Privacy and contact

- The issue tracker may store `user_id`, an explicit outreach-email override,
  notification intent, and consented public credit name for a support report.
- Account email remains owned by Proliferate and is resolved by user ID at
  notification-draft time unless an explicit outreach override exists.
- Telemetry-only affected users are not reporters and are never automatically
  contacted.
- Public attribution never derives from telemetry user identity.
- Private evidence is accessed through source-specific audited credentials and
  is never copied to public release/changelog artifacts.

Email delivery is intentionally not part of the current tracker schema. The
stored reporter fields are sufficient input for a later idempotent notification
outbox and Customer.io sender.

## Migration exceptions

The following are known implementation differences, not alternate contracts:

- the tracker currently stores Sentry groups rather than event occurrences;
- the tracker currently creates Grafana issues per firing window and stores no
  structured log attribution;
- all six currently provisioned Grafana rules lack the required UID/component
  labels; none has the log-enrichment annotations, and no webhook health canary
  exists;
- the support feed endpoint/key do not exist and production sync is disabled;
- release identity is not deterministic on every component: server release is
  reused for target processes, mobile can fall back, supervisor has no runtime
  build stamp, and structured logs do not consistently emit `release_id`;
- target binaries are rebuilt through multiple paths instead of promoting one
  immutable artifact set, and mutable dependencies/tags can change bytes on a
  retry under the same release ID;
- nightly/hotfix detect `litellm` without exposing, deploying, or gating that
  lane, and runtime changes do not currently refresh the self-hosted target
  bundle required by the lane matrix;
- several Rust Sentry emitters set only a `user_id` tag instead of user context;
- the tracker still has the prototype status machine and single PR columns;
- current machine tokens can enter human mutation routes;
- no release manifest or support-credit projection comment exists; the landing
  generator is not yet invoked by a production release finalizer;
- the existing `specs/tbd/support-system-alignment.md` is a historical audit
  and includes superseded ownership recommendations.

Implementation must migrate forward; it must not preserve old and new paths as
parallel production behavior.

## Acceptance gates

### Source correctness

- A Sentry `trusted-beta` canary with known user/release arrives once and survives
  replay.
- Exact `eventID`, multi-page overlap, normalized production-environment
  filtering, and user-context/tag fallback have fixtures.
- A user-context/tag conflict and a release-component conflict are retained
  with the ambiguous field null; a following good event still advances the
  contiguous project watermark.
- Every configured Sentry project reports independent success/failure health.
- A Grafana test alert reaches the webhook, enriches structured logs, and is
  not duplicated by the poll reconciler.
- Simultaneous label-set instances, `truncatedAlerts`, webhook-down/poll-up
  health, provisioning/v2 UID join, CloudWatch empty-page pagination, and
  delayed post-resolution enrichment are covered.
- An identity-invalid alert is quarantined without blocking a valid grouped
  sibling; a resolved-only delivery creates the missed system occurrence; and
  a poll-only firing seeds durable enrichment.
- Firing with an immediate structured-log match and then resolving still has
  exactly one alert-level system occurrence plus the log occurrence.
- Firing and resolving the annotated health canary creates no issue,
  occurrence, or enrichment window.
- One CloudWatch `eventId` returned for simultaneous instances of the same rule
  produces one structured-log occurrence.
- A completed support report appears through the feed and links to its Sentry
  issue when a reference exists.
- Sentry-first/support-first ordering, multiple canonical source keys
  (including one target group split across components), same-timestamp item
  cursors, fresh-404 grace, shared normalization, replay, and historical count
  parity are covered.
- A retryable/transactional source failure prevents cursor advancement past
  that item; a terminal metadata conflict is committed as a warning and does
  not poison later source items.
- Healthy zero-item runs update `last_success_at`.

### Issue/API correctness

- All four statuses and legal transitions are enforced in Postgres/domain
  code.
- Two agents cannot hold the same active claim.
- Poll replay is at-least-once and consumer-safe.
- General agent responses never contain reporter email or private evidence.
- Many issues may link to one PR and one issue may link to many PRs.
- Deduplication redirects later source events to the root.
- Deduplication inherits the one known component and reruns recurrence checks
  on moved occurrences before preserving a solved root.
- Deduplication rejects spam/non-spam merges and cannot swallow unresolved work
  into a spam root.
- The general agent key cannot set a shipped release; release attestation uses
  its separate key and verifies component/commit ancestry.
- Release attestation rejects duplicate component/PR identities and hashes
  canonically sorted components, lane proofs, and PRs, so reordered replay is
  one audit fact.

### Attribution/release correctness

- A non-consenting reporter never appears in GitHub, the manifest, or MDX.
- A consenting bug reporter renders as `Reported by`; a feature requester as
  `Suggested by`.
- Mixed roles, Unicode/name normalization, stable digests, projection retry,
  and malicious Markdown/MDX text are covered.
- The same release inputs produce byte-identical manifests.
- The checked-in lane matrix rejects missing/extra proof, every artifact proof
  is provider-verified, and a different artifact digest for an existing
  component release ID fails. The LiteLLM lane is actually run and gated.
- Omit items carry `components: []`; public items cannot reference an
  unattested component.
- Full paginated PR collection, exact release-label validation, actual
  component deployment, schema validation, and immutable-asset mismatch all
  fail closed without advancing the public boundary.
- Concurrent nightly/hotfix finalizers serialize, re-read the boundary under
  the lock, reject stale/divergent heads, and publish exactly one
  `release-manifest.json` range.
- The same manifest updates the same landing branch/PR without duplicating an
  entry or overwriting editorial content.
- Landing discovery catches a frontmatter/body-version mismatch globally, and
  same-day entries sort by semantic version after date.
- Landing build/render verification passes before the draft PR is considered
  ready.

### Regression correctness

- A delayed occurrence whose source time predates the solve boundary is
  historical and does not reopen.
- A new post-boundary occurrence reopens any non-release-solved issue that has
  no release proof, including a migrated no-fix solve.
- A recurrence in the solved release or a descendant build SHA reopens once.
- A recurrence from an ancestor build SHA is recorded without reopening.
- Equal-version no-version hotfix ancestry is handled; divergent, different
  component, or missing release metadata creates a review event rather than a
  false automatic regression.
