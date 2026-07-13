# Support system end-to-end execution handoff

Status: non-authoritative execution handoff.

Last read-only production audit: 2026-07-13, `us-east-1`.

The accepted contracts are
[`support-system.md`](../codebase/features/support-system.md),
[`release-manifest.schema.json`](../codebase/features/release-manifest.schema.json),
and the standalone tracker's `SPEC.md`. Those contracts win over this file.
This file records how to get from the deployed prototype to that accepted end
state without losing the current dirty work, source events, or rollback path.

## Resume brief

The next lead agent owns the entire closed loop:

```text
Sentry events -----\
Grafana alerts -----+-> issue tracker -> agent/human work -> linked PRs
Support reports ----/                                      |
                                                            v
                            public changelog <- manifest <- production release
```

Do not redesign the data model or endpoints. Preserve and checkpoint the
accepted specs, create the isolated worktrees below, implement in dependency
order, deploy dark, migrate with a fresh RDS snapshot, enable each source
separately, and finish with the three controlled production canaries plus one
real versioned manifest-to-landing run.

Do not stop at any of these partial states:

- Sentry groups exist but individual events, users, and releases do not.
- Grafana rule summaries exist but signed delivery and log evidence do not.
- A support endpoint exists but historical completed reports are absent.
- The REST API works but agent, release, Grafana, and human auth are conflated.
- PR labels or comments exist but production shipment is not attested.
- A manifest is generated without immutable artifact proof.
- Landing MDX is generated without one idempotent draft PR and build proof.

Email sending is deliberately later. Preserve `notify_me`, the explicit
outreach override, and public-credit consent now; do not add an email table,
outbox, or automatic sender during this program.

## Final endpoints

These are the target machine boundaries:

| Purpose | Target |
| --- | --- |
| Tracker base URL | `https://issues.proliferate.com` |
| Tracker health | `GET /healthz` |
| Agent issue API | `/v1/issues...` on the tracker base |
| Agent event poll | `GET /v1/issues/poll?cursor=&limit=50` |
| Tracker operations health | `GET /v1/ops` |
| Grafana signed delivery | `POST /v1/ingest/grafana` |
| Product support feed, logical route | `GET /internal/support/reports?cursor=&limit=50` |
| Product support feed, hosted URL | `https://app.proliferate.com/api/internal/support/reports` |
| Existing authenticated report creation | `POST https://app.proliferate.com/api/v1/support/reports` |
| Landing release branch | `changelog/v<version>` |
| Landing draft PR title | `docs(changelog): publish v<version>` |

The hosted product mounts server routes beneath `/api`, so the logical
`/internal/support/reports` route is externally reached as
`/api/internal/support/reports`. Do not replace it with
`/api/v1/support/reports/poll`, and do not add a public `/poll/support` route.
The tracker pulls the private completed-report feed every five minutes.

`https://issues.proliferate.com` is the operational hostname selected by this
handoff. It is not provisioned yet. Changing it requires an explicit operator
decision because the value enters Grafana, agent configuration, secrets, and
runbooks.

The exact tracker surface is:

```text
GET    /v1/issues
GET    /v1/issues/{id}
GET    /v1/issues/poll?cursor=&limit=50
POST   /v1/issues/{id}/claim
POST   /v1/issues/{id}/release-claim
PATCH  /v1/issues/{id}
POST   /v1/issues/{id}/deduplicate
POST   /v1/issues/{id}/prs
POST   /v1/attribution/query
POST   /v1/releases/attest
GET    /v1/ops
POST   /v1/ingest/grafana
```

There is no general create-issue endpoint. Controlled production lifecycle
tests must use issues created by synthetic support/Sentry/Grafana canaries.

## Non-negotiable contract snapshot

The tracker finishes with these seven business tables:

```text
issues
issue_occurrences
issue_reporters
events
pull_requests
issue_pull_requests
sync_sources
```

`issue_occurrences` remains exactly six columns:

```text
id, issue_id, event_key, user_id, occurred_at, release_id
```

Do not add source, component, version, Git SHA, environment, correlation ID, or
an evidence JSON blob to that table. Source is namespaced into `event_key`;
component/version/SHA are contained by a valid `release_id`; full evidence
remains in Sentry, Grafana/CloudWatch, or the private support case.

Canonical event identities are:

```text
Sentry issue              sentry:<project>:<groupID>
Sentry target issue       sentry:proliferate-target:<component-or-unknown>:<groupID>
Sentry occurrence         sentry:<project>:<eventID>
Grafana issue             grafana:<stable-rule-uid>
Grafana invalid issue     grafana:invalid:<fingerprint>
Grafana log occurrence    grafana:<rule-uid>:cw:<eventId>
Grafana alert occurrence  grafana:<rule-uid>:<fingerprint>:<starts-unix-ms>
Support issue             support:<report-id>
Support occurrence        support:<report-id>
```

The only issue statuses are:

```text
tbd | not_done | spam | solved
```

Claim lease fields represent in-progress work and are separate from status.
An open or merged fix PR does not solve an issue. The general key cannot set a
shipped release. A code-linked issue is solved only by trusted production
attestation after all fix PR merge SHAs are contained by the component head.
An issue with no `fix` relationship may be solved by the general agent with a
non-empty resolution note and no `solved_release_id`.

`issue_reporters` stores the explicit report/user, private outreach override,
notify intent, and opt-in public credit name. Telemetry users do not become
reporters. Notify and credit consent are independent. There is no deployments
table and no email-delivery table in v1.

Every Sentry project, Grafana poll, and support feed runs every five minutes
and is stale after ten. Grafana enrichment and GitHub attribution run every
minute and are stale after two. The signed webhook health canary runs daily and
is stale after 26 hours. Grafana webhook and poll always have separate health
rows. A newer failed attempt degrades its own row immediately; a healthy
zero-item run advances `last_success_at`.

## Read order and authority

Before touching Proliferate code, read:

1. repository `AGENTS.md` and [`specs/README.md`](../README.md);
2. [`support-system.md`](../codebase/features/support-system.md);
3. [`support-reporting.md`](../codebase/features/support-reporting.md);
4. [`server/README.md`](../codebase/structures/server/README.md) and the
   focused server guides for every touched layer;
5. the frontend README and telemetry guide for web/mobile/desktop telemetry;
6. the AnyHarness, worker, and supervisor structure docs for their emitters;
7. [`ci-cd.md`](../developing/deploying/ci-cd.md) for workflows and releases.

Before touching the tracker, read:

1. `/Users/pablohansen/issue-tracker/SPEC.md`;
2. its `README.md` and `docs/deep-dive.md`;
3. its current migration, domain, API, jobs, clients, and tests.

Before touching landing, inspect its current `README.md`, `CLAUDE.md`,
`lib/changelog.ts`, changelog MDX/frontmatter conventions, and build scripts.

[`support-system-alignment.md`](support-system-alignment.md) is a historical
audit. It is useful context but is not a contract.

## Live starting state

The following facts were verified read-only on 2026-07-13. Re-run the audit
before mutation because resource revisions and counts can change.

### Tracker infrastructure

- EC2 `i-022f01951cdf2409e` is a running `t4g.small` at the temporary public IP
  `3.82.192.52`. It is not an Elastic IP.
- It has no instance profile. IMDSv2 is required.
- The app security group is `sg-0c52345019f262743`: public 443 and SSH only
  from the recorded operator /32.
- RDS `issue-tracker-db` is private PostgreSQL 16.14, `db.t4g.micro`, 20 GiB,
  single-AZ, with seven-day backups.
- The RDS volume and EC2 root volume are unencrypted; RDS deletion protection
  is off. These are production-hardening gaps and increase the importance of
  the two quiescent cutover snapshots. Track encryption/deletion-protection as
  explicit infrastructure work; do not mistake API auth for at-rest hardening.
- Caddy serves a short-lived internal certificate for the bare IP. Public
  verification fails unless the client uses `-k`.
- The host has no tracker CloudWatch log group.
- There are no issue-tracker/support/Grafana secrets in Secrets Manager or
  Parameter Store. Prototype credentials remain in host/local `.env` files.
- This AWS account has no Route53 zone. `proliferate.com` DNS is managed in
  Cloudflare.

### Tracker data and source coverage

- Current status counts were 75 `new`, 6 `dismissed`, and 1 `merged` with zero
  claims. These are prototype statuses, not the accepted enum.
- Current source counts were 77 Sentry issues, 5 Grafana issues, and 0 support
  issues.
- Production support storage already had five `request.json` objects and five
  `complete.json` markers. Therefore support is not merely unverified; it is
  missing from the tracker.
- `GET https://app.proliferate.com/api/internal/support/reports?limit=1`
  returned 404 during the audit.
- Support objects expire after 30 days. Historical feed/backfill work is
  time-sensitive.
- `/poll/new-issues` exists in the prototype; `/poll/events` is absent. Neither
  is the final poll contract.
- The Grafana cursor was about 3.5 days old at audit time. The prototype cannot
  distinguish a healthy empty poll from failure in the required way.

### Product deployment and metadata gaps

- The active hosted production service is cluster `proliferate-prod`, service
  `proliferate-prod-server`, two of two tasks running at task definition
  revision 112 during the audit.
- The server had canonical
  `SENTRY_RELEASE=proliferate-server@0.3.26+3c2bbf20e215`.
- `CLOUD_RUNTIME_SENTRY_RELEASE` and `CLOUD_TARGET_SENTRY_RELEASE` incorrectly
  carried that same server release.
- another runtime release value used a 40-character SHA without the canonical
  versioned release format.
- live `SERVER_VERSION` and `ANYHARNESS_VERSION` values still exposed stale
  `0.1.0` values in part of the runtime configuration.
- `SUPPORT_TRACKER_ENABLED=true` in the hosted task refers to the prototype
  GitHub/Linear support path. It does not mean the private feed is connected.
- all six relevant ECR repositories allowed mutable tags. Release proof must
  capture immutable digests/provider IDs before a tag can move.
- none of the nine `production/<component>` GitHub Deployment environments had
  a deployment.

### Grafana and logs

- AMG workspace `g-e532d030d8` (`proliferate-ops`, Grafana 10.4) is active.
- Six rules exist: ALB 5xx, API p95, ECS CPU, critical failure, analytics
  ingest errors, and server error rate.
- All six have only a severity label. None has
  `proliferate_rule_uid`, `proliferate_component`, log annotations, or a health
  canary annotation.
- There is no signed tracker webhook contact point.
- No Alertmanager v2 instances were firing during the audit.
- The current `issue-tracker-sync` token metadata expires 2026-08-06. The
  short-lived provisioner token observed during the audit expires
  2026-07-13; assume it is unusable and mint a new bounded token when an
  approved provisioning window starts.
- Across 1,075,982 relevant CloudWatch records over seven days, exact
  top-level `user_id` appeared only 106 times and exact top-level `release_id`
  appeared zero times. Grafana enrichment is not ready until producers change.

## Preserve the dirty donors first

Do not implement from the three current checkouts.

| Repository | Dirty donor | Important state |
| --- | --- | --- |
| Proliferate | `/Users/pablohansen/.codex/worktrees/385e/proliferate` | Detached at `bdd11aa5...`; contract docs plus unrelated support, infra, CI, generated SDK, and release WIP; nothing staged. |
| Tracker | `/Users/pablohansen/issue-tracker` | `main` at `14ef09d...`; five intended contract/config docs modified; `api/uv.lock` untracked; nothing staged. |
| Landing | `/Users/pablohansen/landing` | Divergent dirty `docs/self-hosting-launch-pass` branch with extensive docs/launch edits and changelog WIP. |

The Proliferate Git repository has about 150 registered worktrees. Never run
`git worktree prune`. In any donor, never run `git add -A`, `git clean`,
reset, pull, merge, rebase, or a checkout that overwrites local files.

### Checkpoint the contracts

Branch names were free at audit time; verify again before creating them.

For Proliferate, attach the detached donor to
`codex/support-system-spec`. Review and stage only the intended contract docs:

```text
specs/README.md
specs/codebase/features/README.md
specs/codebase/features/support-reporting.md
specs/codebase/features/release-manifest.schema.json
specs/codebase/features/support-system.md
specs/developing/debugging/support-reports.md
specs/developing/deploying/ci-cd.md
specs/tbd/README.md
specs/tbd/support-capture-v1.md
specs/tbd/support-system-alignment.md
specs/tbd/support-system-end-to-end-handoff.md
```

Explicitly exclude all product code, workflows, scripts, infrastructure, and
`specs/developing/reference/env-vars.yaml` from this checkpoint unless each
hunk is independently reviewed for the same commit. Run:

```bash
set -euo pipefail
PROLIFERATE_DONOR=/Users/pablohansen/.codex/worktrees/385e/proliferate

git -C /Users/pablohansen/.codex/worktrees/385e/proliferate switch -c codex/support-system-spec
git -C "$PROLIFERATE_DONOR" add -N -- \
  specs/codebase/features/release-manifest.schema.json \
  specs/codebase/features/support-system.md \
  specs/tbd/support-system-alignment.md \
  specs/tbd/support-system-end-to-end-handoff.md
git -C "$PROLIFERATE_DONOR" add -p -- \
  specs/README.md \
  specs/codebase/features/README.md \
  specs/codebase/features/support-reporting.md \
  specs/codebase/features/release-manifest.schema.json \
  specs/codebase/features/support-system.md \
  specs/developing/debugging/support-reports.md \
  specs/developing/deploying/ci-cd.md \
  specs/tbd/README.md \
  specs/tbd/support-capture-v1.md \
  specs/tbd/support-system-alignment.md \
  specs/tbd/support-system-end-to-end-handoff.md
git -C "$PROLIFERATE_DONOR" diff --cached --name-status
git -C "$PROLIFERATE_DONOR" diff --cached --check
```

Commit only after the staged file/hunk list is exactly the reviewed subset of
the eleven paths above. A skipped path must be an explicit review decision,
not an untracked-file accident. Record the SHA as `PROLIFERATE_SPEC_SHA`.

For the tracker, create `codex/support-system-spec` and stage only:

```text
Caddyfile
README.md
SPEC.md
docs/deep-dive.md
infra/README.md
```

Leave `api/uv.lock` untracked. Record the commit as
`TRACKER_SPEC_SHA`. Use the same explicit discipline:

```bash
set -euo pipefail
TRACKER_DONOR=/Users/pablohansen/issue-tracker

git -C "$TRACKER_DONOR" switch -c codex/support-system-spec
git -C "$TRACKER_DONOR" add -p -- \
  Caddyfile README.md SPEC.md docs/deep-dive.md infra/README.md
git -C "$TRACKER_DONOR" diff --cached --name-status
git -C "$TRACKER_DONOR" diff --cached --check
```

Open one spec-only PR in each repository and merge both before creating
implementation branches. Fetch the merged `origin/main`, record the merge
SHAs, and require both checkpoint commits to be ancestors of their respective
`origin/main`. Do not stack implementation PRs on an unmerged spec branch.

### Preserve useful implementation WIP selectively

The current donors include useful seeds but none is automatically accepted:

- Proliferate PR metadata WIP:
  `.github/pull_request_template.md`, `.github/workflows/pr-metadata.yml`,
  `.github/workflows/ci.yml`, and new `scripts/ci-cd/pr-metadata*.mjs` files.
- Proliferate-to-landing workflow seed:
  `.github/workflows/publish-landing-changelog.yml`.
- Landing generator seed:
  `scripts/generate-release-changelog.mjs`,
  `scripts/generate-release-changelog.test.mjs`, the `lib/changelog.ts`
  same-day semantic-version sort, and the `test:changelog` package script.
- Existing support capture/UI/server changes overlap this program but may
  represent separate work. Port only reviewed hunks.

Use `git diff`/`git show` and `apply_patch` to port reviewed logic into clean
worktrees. Never copy a donor directory wholesale.

## Isolated worktree layout

Use exactly this root:

```text
/Users/pablohansen/support-system-e2e/
```

Create these base worktrees:

| Path | Initial branch | Repository | Owner |
| --- | --- | --- | --- |
| `issue-tracker-core` | `codex/support-t1-core` | issue-tracker | Tracker schema, API, adapters, attribution, deployment |
| `proliferate-integration` | `codex/support-system-integration` | official Proliferate | Merge/test only |
| `proliferate-product` | `codex/support-p1-feed` | official Proliferate | Support feed, producer metadata, Grafana configuration |
| `proliferate-release` | `codex/support-r1-pr-metadata` | official Proliferate | PR metadata, immutable release proof, manifest/finalizer |
| `landing-changelog` | `codex/support-l1-changelog` | landing | Manifest consumer and changelog PR |

Creation sequence:

1. checkpoint, review, and merge both spec-only PRs;
2. fetch each remote without pulling a dirty donor;
3. verify the two recorded spec commits are ancestors of current `origin/main`;
4. create all three Proliferate worktrees independently from that updated
   `origin/main`;
5. create `issue-tracker-core` from updated tracker `origin/main`;
6. create `landing-changelog` from landing `origin/main`;
7. require empty `git status --porcelain` in every new worktree.

Illustrative commands, after assigning the two real 40-character SHAs (do not
paste angle-bracket placeholders into a shell):

```bash
set -euo pipefail
PROLIFERATE_SPEC_SHA='replace-with-reviewed-40-character-sha'
TRACKER_SPEC_SHA='replace-with-reviewed-40-character-sha'
test "${#PROLIFERATE_SPEC_SHA}" -eq 40
test "${#TRACKER_SPEC_SHA}" -eq 40

mkdir -p /Users/pablohansen/support-system-e2e

git -C /Users/pablohansen/proliferate fetch origin main
git -C /Users/pablohansen/proliferate merge-base --is-ancestor \
  "$PROLIFERATE_SPEC_SHA" origin/main
git -C /Users/pablohansen/proliferate worktree add \
  -b codex/support-system-integration \
  /Users/pablohansen/support-system-e2e/proliferate-integration origin/main

git -C /Users/pablohansen/proliferate worktree add \
  -b codex/support-p1-feed \
  /Users/pablohansen/support-system-e2e/proliferate-product origin/main
git -C /Users/pablohansen/proliferate worktree add \
  -b codex/support-r1-pr-metadata \
  /Users/pablohansen/support-system-e2e/proliferate-release origin/main

git -C /Users/pablohansen/issue-tracker fetch origin main
git -C /Users/pablohansen/issue-tracker merge-base --is-ancestor \
  "$TRACKER_SPEC_SHA" origin/main
git -C /Users/pablohansen/issue-tracker worktree add \
  -b codex/support-t1-core \
  /Users/pablohansen/support-system-e2e/issue-tracker-core origin/main

git -C /Users/pablohansen/landing fetch origin main
git -C /Users/pablohansen/landing worktree add \
  -b codex/support-l1-changelog \
  /Users/pablohansen/support-system-e2e/landing-changelog origin/main
```

If a branch/path now exists, inspect it; do not delete or force-recreate it.
Always verify `remote.origin.url` because the official product repo and landing
repo both contain “proliferate” in their names.

Use `PROFILE=support-product` in the product lane and
`PROFILE=support-e2e` in the integration lane. Never use default-port
multi-worktree shortcuts.

## Agent ownership and merge discipline

Use no more than three implementation subagents at once:

1. tracker owner in `issue-tracker-core`;
2. product/telemetry owner in `proliferate-product`;
3. release owner in `proliferate-release`.

The coordinator owns `proliferate-integration` and does not edit a lane while
another agent owns it. Landing starts when one implementation slot is free.
No two agents write the same worktree.

The coordinator is also the sole production operator for O1. Implementation
agents may prepare reviewed commands and inspect read-only state, but they do
not independently change AWS, Cloudflare, Grafana, GitHub Deployments, ECS,
the tracker host, RDS, secrets, or production canaries. The coordinator runs a
single mutation at a time, records its evidence, and checks the stop conditions
before continuing. If the current source IP cannot use the existing SSH `/32`,
the Cloudflare zone/API-token owner is unknown, or the AWS caller is not the
expected account, stop and obtain that access explicitly.

File ownership:

- `server/infra/main.tf` belongs to the product lane until product/Grafana
  deployment work lands.
- `.github/workflows/**` and `scripts/ci-cd/**` belong to the release lane.
  A product deployment change that touches a workflow must be explicitly
  coordinated first.
- tracker migration/domain/API/client/job files have one tracker owner because
  their transaction and cursor semantics overlap heavily.
- landing changes remain in the landing repository; do not vendor landing
  source into Proliferate.

Merge product into the integration branch first, release second. Run the
integrated profile there. Landing stays a separate PR and consumes only a
versioned validated manifest.

## Dependency and PR sequence

The physical worktrees are stable; create sequential scoped branches/PRs from
them as earlier PRs merge. Each implementation PR targets that repository's
`main`. After a PR merges, require a clean lane, fetch `origin/main`, switch the
lane to the next named branch from the new `origin/main`, and delete neither
the prior branch nor its worktree. T1, T2, and T3 are three tracker PRs, not one
large PR. The integration branch is local coordination only: merge each
already-reviewed Proliferate PR SHA into it for the full-profile test; do not
use it as a GitHub PR base.

| ID | Branch | Repository | Scope | Depends on |
| --- | --- | --- | --- | --- |
| T1 | `codex/support-t1-core` | tracker | Final schema, domain, statuses, claims, dedup, regression, exact API/auth, web/MCP cleanup | merged tracker spec |
| P1 | `codex/support-p1-feed` | Proliferate | Immutable report `releaseId`/summary/Sentry refs and private completed-report feed | merged product spec |
| P2 | `codex/support-p2-telemetry` | Proliferate | Nine component releases, Sentry users, structured `user_id`/`release_id` logs | P1 merged |
| R1 | `codex/support-r1-pr-metadata` | Proliferate | PR title/label enforcement; port and finish existing WIP | merged CI/CD spec |
| L1 | `codex/support-l1-changelog` | landing | Strict manifest consumer, same-day ordering, idempotent draft PR | manifest schema |
| T2 | `codex/support-t2-ingestion` | tracker | Sentry event, support feed, Grafana webhook/poll/enrichment, independent health | T1, P1, P2 merged/deployed as applicable |
| P3 | `codex/support-p3-grafana` | Proliferate | Exported Grafana rules, required labels/annotations/contact point/canary tooling | T2 webhook dark-deployed |
| T3 | `codex/support-t3-release` | tracker | Many-to-many PR projection and release attestation | T1 merged, release proof contract |
| R2 | `codex/support-r2-proof` | Proliferate | Canonical immutable artifacts, lane digests, GitHub component Deployments | P2 merged |
| R3 | `codex/support-r3-finalizer` | Proliferate | Locked public finalizer, tracker calls, strict manifest, landing dispatch | T3, R2, L1 merged |
| O1 | no code branch | operations | Snapshot, migration, dark deploy, source enablement, backfill, canaries | T1-T3 and P1-P3 merged/deployed |

PR titles and labels in the official repo must follow `ci-cd.md`: one
`release:*` and every applicable `area:*` label. Never guess feature size or
area when the detector is ambiguous.

## Wave 1: tracker foundation

Implement with all external integrations disabled.

### Migration

Do not edit `0001_init.py`. Use forward-only expand/contract revisions, for
example:

```text
0002_support_system_v1_expand.py
0003_support_system_v1_contract.py
```

The expand revision must:

- create `issue_occurrences`, `pull_requests`, and
  `issue_pull_requests`;
- expand `issues`, `issue_reporters`, `events`, and source-health storage to
  the exact accepted shape;
- introduce independent `sync_sources` rows;
- preserve legacy fields only for the bounded migration window;
- map statuses to `tbd | not_done | spam | solved`;
- normalize valid legacy single-PR URLs into the many-to-many model;
- move duplicate occurrences/reporters/PR links to roots before conversion;
- create a deterministic synthetic occurrence for each legacy aggregate issue
  whose provider event cannot be recovered;
- retain all audit history;
- demote code-linked `shipped` issues unless the same immutable production and
  ancestry proof required for live attestation can be reconstructed;
- seed eight Sentry rows plus Grafana webhook/poll/enrichment, support feed,
  and GitHub attribution health rows.

Legacy status conversion is exact:

```text
new                         tbd
triaged                     not_done
awaiting-merge              not_done
merged                      not_done
needs-human                 not_done
shipped                     solved only with the proof below; otherwise not_done
dismissed                   manual audit, then spam or tbd
duplicate                   move relationships to root, then solved shell
```

A code-linked `shipped` issue stays solved only if matrix-complete immutable
production proof and PR ancestry can be reconstructed; otherwise demote it to
`not_done`. A no-fix `shipped` issue may stay solved only with a migration
resolution note and a `migration.solved` audit fact whose stable boundary is
the trustworthy shipped time, or migration start if no trustworthy time
exists. Duplicate issues move occurrences, reporters, and PR relationships to
their canonical root before becoming immutable solved shells. Every
`dismissed` row requires recorded human review; never bulk-guess spam.

Resolve a legacy Sentry project's slug before constructing its source key.
Never invent one. Historical reporters are reconstructed from completed
product reports by `report_id`; a prototype email string is not a `user_id`.

The contract revision runs only after every reader/job uses v1. It removes
prototype release/email tables, single-PR fields, aggregate-source fields,
legacy `sync_cursors`, old reporter contact fields, and old constraints.
Temporary expand compatibility is acceptable; parallel old/new production
behavior at completion is not.

### Domain and API

All adapters call one transaction-level operation:

```text
upsert issue by source_key
follow duplicate root
insert occurrence by event_key
optionally insert reporter by report_id
append allowlisted audit event
commit
```

It distinguishes `created`, `attached`, `replayed`, and
`idempotency_conflict`. Immutable occurrence comparison is exactly
`issue_id`, `user_id`, `occurred_at`, and `release_id`.

Implement centrally:

- canonical release parsing and component allowlist;
- exact status transitions;
- two-hour claim lease, heartbeat, expiry, and atomic takeover;
- ordered-lock deduplication, no chains/cycles, component/status conflicts;
- `fix` winning a duplicate PR-link collision;
- solved-root and post-solve recurrence revalidation;
- regression time-boundary evaluation before release comparison: at-or-before
  the solve boundary is historical; a post-boundary non-release solve reopens;
  an equal release or descendant build reopens; an ancestor build remains
  historical; component mismatch, missing/unresolvable/divergent SHA, and
  semver/ancestry contradiction record `regression.needs_review`;
- bounded privacy-safe audit payloads;
- durable attribution-refresh events.

Replace prototype API semantics with the exact endpoint table above:

- claim identity comes only from required `X-Run-Id`, not a body `run_id`;
- `PATCH` accepts only `status`, `note`, and optional
  `resolutionComponent`;
- it never accepts `solvedReleaseId`;
- a no-fix issue may accept `solved` with a non-empty note and no shipped
  release; a fix-linked issue returns `release_attestation_required`;
- PR link input is repository, number, and `fix | related`;
- v1 permits only `proliferate-ai/proliferate`;
- list order is `(updated_at DESC, id DESC)`;
- poll order is `events.id ASC`;
- limits are 1 through 100 and cursors are opaque;
- the general agent API never returns reporter email or source bodies;
- keep MCP only as a thin adapter over these domain operations;
- remove prototype email routes/views and old lifecycle meanings.

Auth boundaries:

- one general agent Bearer key;
- one separate release-workflow Bearer key, valid only for release attestation
  and read-only attribution query;
- Grafana HMAC, not Bearer auth, on its ingest route;
- human web auth separate from machine keys;
- `X-Run-Id` on every mutation;
- never trust a caller-supplied `X-Human-User`.

T1 is gated on fresh and production-snapshot migrations, constraint tests,
status/claim races, dedup and regression tests, poll replay, the full auth
matrix, `uv run pytest -q`, and tracker web lint/build.

## Wave 2: product support feed

Add an immutable `client_release_id` and bounded scrubbed
`tracker_summary` to the support-report row. The summary is at most 240
characters and never substitutes for the private report body.

Keep current `owner_user_id`, `kind`, `notify_me`, `credit_consent`,
`credit_name`, timestamps, and the explicit user outreach override.

Normalize Sentry references to:

```json
{
  "sentryEvents": [
    {"project": "proliferate-desktop", "eventId": "..."}
  ]
}
```

Legacy `sentryEventIds` without projects are insufficient. Backfill their
projects through bounded Sentry lookup where possible. Do not guess.

Every web/mobile/desktop report intent sends its canonical `releaseId`.
Production completion rejects missing/malformed new release IDs. Legacy rows
remain feedable with null release plus a visible warning.

The feed:

- is mounted as the private logical `/internal/support/reports` route;
- uses a dedicated Bearer key with constant-time comparison;
- returns only completed reports;
- orders by `(completed_at, id)`;
- starts at the oldest completion for an empty cursor;
- reads `limit + 1` and allows 1 through 100, default 50;
- emits an opaque cursor for every item plus `nextCursor`/`hasMore`;
- never exposes message, diagnostics, attachments, object keys, signed URLs,
  account email, or log bodies.

Use a versioned authenticated opaque cursor around the tuple so tampering is
rejected. A page/item shape must include report ID, submitted/completed time,
owner user, bug/feature kind, safe summary, release, notify/credit choices,
explicit outreach override, private case reference, and Sentry pairs.

P1 is gated on same-timestamp pagination, cursor replay/tamper tests, user-key
rejection, historical completed-count parity, payload privacy snapshots, the
server migration/unit suite, and regenerated owned SDK/OpenAPI output.

Deploy the feed dark before the tracker receives its token.

## Wave 3: release/user/log producers

Every emitting process uses:

```text
<component>@<semver>+<12-character-git-sha>
```

Required components:

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

Fix all production build paths named by the accepted contract. Missing
version/SHA fails a production build. Mobile cannot fall back to `0.1.0`.
Supervisor gets the runtime build stamp. AnyHarness, worker, and supervisor
receive separate component-specific releases; remove the shared target
release override.

Every structured production log has exact top-level `user_id` and
`release_id` fields, using null/absence only when work is genuinely
anonymous/system. Test final serialization, not just in-memory logging fields.

Sentry uses `user.id` for authenticated work. Clear it at request/session end
to prevent cross-user leakage. Background jobs explicitly carry the internal
user. Rust's `user_id` tag is a temporary adapter fallback only.

Promote one canonical runtime artifact set into E2B, desktop, and self-hosted
consumers. A retry cannot rebuild different bytes beneath the same release ID.

P2 is gated on each component constructor, version-file invariants,
missing-input failures, Sentry set/clear behavior, background propagation,
top-level JSON snapshots, and immutable retry tests.

Ship correct producers before declaring source ingestion healthy.

## Wave 4: dark tracker deployment

Before source activation, provision:

1. an Elastic IP allocated in account `157466816238`, attached to
   `i-022f01951cdf2409e`, and recorded as the tracker ingress;
2. Cloudflare DNS for `issues.proliferate.com` pointed at that EIP (this AWS
   account has no Route53 zone, so verify the Cloudflare zone owner and a
   least-privilege DNS token before starting);
3. public CA TLS in Caddy with `local_certs` removed;
4. an EC2 instance profile with least-privilege
   `secretsmanager:GetSecretValue`, log-read `logs:FilterLogEvents`, tracker
   log-shipping `logs:CreateLogStream`, `logs:PutLogEvents`, and
   `logs:DescribeLogStreams`, plus SSM managed-instance permissions;
5. a CloudWatch log group/retention for tracker service logs;
6. managed, rotated credentials for agent, release, support feed, Grafana
   webhook, Sentry, Grafana, GitHub, database, and human web auth;
7. checked-in `infra/deploy.sh`, an idempotent bootstrap/deploy entry point
   that accepts an immutable revision and explicit Alembic target, loads
   runtime secrets without a durable production host `.env`, and defaults all
   external writers off;
8. a verified SSM managed-instance path. Keep SSH key access as break-glass,
   restricted to the coordinator's current `/32`; do not rely on that mutable
   IP as the normal deployment path.

Use one shared support-feed secret ARN injected into the product ECS task and
read by the tracker role. GitHub Actions should know its ARN, not its value.
Exact secret names and KMS key are implementation-owned but must be recorded
in the deployment runbook. Do not print values.

Deploy v1 with all source schedules, Grafana contact delivery, GitHub
projection, and release attestation disabled. Health/API/auth may be tested.

Before migration:

- detach/disable the Grafana contact point, disable every source and release
  writer, enter maintenance, and make all tracker mutations return maintenance
  failure;
- stop old `api`, `web`, `beat`, and `worker` while keeping only a static
  maintenance/health response if needed;
- capture final `alembic current`, every table/status/source count, duplicate
  graph, PR count, and a sanitized checksum/export;
- create and wait for a `pre-expand` RDS snapshot only after the database is
  quiescent;
- run the exact expand revision once, then start the expand-compatible v1 API
  with mutations and external writers still disabled;
- verify v1 reads/auth/counts against the expanded schema;
- quiesce again, capture final counts, and create a second `pre-contract`
  snapshot before the exact contract revision;
- run the contract revision once, start the complete v1 stack still dark, and
  verify before enabling one source at a time.

Use an expand migration, deploy/read verification, a second quiescent snapshot,
and only then the contract migration. Do not run a destructive migration while
the old workers or mutating API are live.
The current compose command automatically runs `alembic upgrade head` before
the API. That is unsafe for a two-stage cutover. Either:

1. ship only the expand revision with the v1 readers, validate it, then add the
   contract revision in a later deploy; or
2. remove automatic migration from API startup and make the deploy run one
   explicit target revision exactly once.

Do not put expand and contract at the same reachable `head` while retaining
the current auto-upgrade startup command.

Dark-deploy gates:

- public TLS works without `-k` from an unrelated client;
- only `/healthz` is unauthenticated;
- the agent key cannot attest releases or enter human routes;
- the release key cannot mutate general issues;
- missing `X-Run-Id` rejects mutations;
- old credentials fail after rotation;
- migration counts reconcile;
- source rows exist but are explicitly disabled/not-yet-run.

## Wave 5: source ingestion

### Sentry first

Replace group summaries with per-project error-event polling across all eight
projects. Each project has its own health row, fixed allowlist, fixed poll end,
ten-minute overlap, complete cursor pagination, and
`(dateCreated,eventID)` watermark.

Use exact `eventID`, not Sentry's internal `id`. Use the fixed project/component
map. `proliferate-target` includes component-or-unknown in its issue key.
`production` and `trusted-beta` are initially accepted after normalization.

Missing metadata is retained null and counted. User-context/tag or
release-component conflict is retained with the ambiguous field null and a
sanitized warning; it cannot poison the following good event. HTTP/auth/page
failure cannot advance the watermark or `last_success_at`.

Enable one trusted-beta project first, then all eight. Backfill within provider
retention, reconcile prototype unresolved groups, and replay the overlap.

### Support second

The tracker calls the real product feed. Process each item sequentially:

1. resolve every Sentry pair with the same normalizer as polling;
2. treat timeout/auth/5xx as retryable and stop the page;
3. retry a fresh 404 until 30 minutes after support completion;
4. upsert every retained referenced Sentry event before attachment, even when
   the regular Sentry poll has not seen it;
5. attach to one canonical Sentry key only when all retained references agree;
6. create `support:<report-id>` for zero or multiple canonical keys, append
   safe `support.multiple_sentry_groups` audit for multiple keys, and derive
   standalone `resolution_component` from a valid report release;
7. insert `event_key=support:<report-id>` using the owner user ID, submission
   time, and client release, then insert the reporter in the same transaction;
8. commit the item and its item cursor atomically.

Sentry-first and support-first order converge. A failed item cannot skip later
same-timestamp reports. Reconcile every completed product report before
retention removes old objects.

### Grafana third

Implement signed primary webhook, five-minute reconciliation poll, and durable
one-minute CloudWatch enrichment:

- raw body at most 1 MiB;
- HMAC-SHA256 of `<timestamp>:<raw-body>`, lower hex, constant-time compare;
- exact headers `X-Grafana-Alerting-Signature` and
  `X-Grafana-Alerting-Timestamp`;
- at most five-minute timestamp skew;
- reject `truncatedAlerts > 0`;
- process valid siblings independently, but persist every identity-invalid
  alert as issue `grafana:invalid:<fingerprint>` with occurrence
  `grafana:invalid:<fingerprint>:<starts-unix-ms>`, a safe reason audit fact,
  and degraded source health;
- join provisioned rules and Alertmanager v2 instances by the exact UID label;
- use the provider fingerprint; never parse `generatorURL` or reimplement it;
- query logs from two minutes before `startsAt` through two minutes after
  `endsAt` (or current time while firing), with immediate, +2 minute, and final
  +10 minute enrichment;
- fully paginate `FilterLogEvents`, including empty pages with `nextToken`;
- repeated token or 10,000-event cap fails enrichment;
- use exact CloudWatch `eventId` for log occurrence identity;
- always create one alert-level null occurrence for a valid non-canary
  instance; log occurrences are additional;
- resolved-only and poll-only paths converge;
- an alert absent from two consecutive reconciliation polls is provisionally
  resolved and still receives its final enrichment window;
- the annotated daily health canary updates health only.

Export all six live rules before editing and preserve their UIDs. Check
normalized provisioning definitions into Proliferate. Add required labels and
log annotations, then a signed contact point to
`https://issues.proliferate.com/v1/ingest/grafana` with Max Alerts zero.

Do not activate the contact point until the webhook is dark-deployed with
trusted TLS and all six definitions validate.

## Wave 6: agent API and GitHub attribution

Exercise the production API against controlled support canary issues:

1. list and replay a list cursor;
2. poll and replay an event cursor;
3. race two claims;
4. renew and release the winner;
5. transition `tbd -> not_done`;
6. link an approved test/implementation PR as `related`;
7. on a separate controlled issue, link `fix` and verify an agent solve returns
   `release_attestation_required`;
8. deduplicate two controlled support reports for the same canary;
9. verify later source replay follows the root;
10. verify duplicate-shell mutation returns `409 duplicate_issue`;
11. inspect `/v1/ops`.

Do not mutate a real customer issue and do not invent a manual-create endpoint.
After evidence, mark canonical canary roots `spam` with an audit reason except
the one fix-linked attestation canary reserved below. Retain solved duplicate
shells: they reject ordinary mutation with `409 duplicate_issue` and cannot
transition directly to spam. Never delete audit/occurrence rows.

GitHub projection:

- tracker fetches PR fields from GitHub;
- relationships are many-to-many;
- reporter/link/kind/dedup changes enqueue durable refresh audit events;
- the one-minute worker coalesces and advances only after GitHub success;
- only the configured bot's versioned marker is touched;
- zero credits deletes an obsolete bot comment;
- only explicit consent appears;
- NFC/whitespace/control/length/casefold rules are enforced;
- `reported` wins a mixed role;
- display spelling comes from the earliest `(submitted_at, report_id)` row;
- credits sort by role, casefolded name, then UTF-8 display name;
- CommonMark text is escaped;
- batch attribution returns every requested PR, including empty credit arrays.

The projection digest covers exactly `schemaVersion`, repository, PR number,
and normalized/sorted credits in canonical JSON. Persist the digest only after
GitHub confirms the comment mutation. A failed mutation leaves the refresh
event pending and the old stored digest unchanged.

No internal user ID, email, report ID/body, diagnostics, or telemetry identity
may enter a PR comment.

## Wave 7: immutable production proof and attestation

The manifest finalizer is blocked until every shipped component has immutable
matrix-complete proof.

1. Check in the exact component-to-lane matrix from the contract.
2. Make nightly/hotfix actually expose, execute, and gate LiteLLM.
3. Promote canonical runtime artifacts; do not rebuild target binaries in
   downstream lanes.
4. Return a provider-backed `artifactSetDigest` from every required lane.
5. Reject missing, extra, duplicate, or mutable proof.
6. After all required lanes succeed for a component, create/reuse one GitHub
   Deployment in `production/<component>` with the exact v1 payload.
7. Preserve the first successful deployment-status timestamp across retries.
8. Hard-fail if a release ID is ever associated with different artifact
   digests.
9. Union newly detected surfaces with outstanding public surfaces since the
   last valid manifest.

The disabled hosted worker surface is not proof. In v1 only web can produce a
matrix-complete no-version attestation. No no-version hotfix creates or
advances a manifest/changelog boundary. E2B-, LiteLLM-, and disabled-worker
lane hotfixes remain only in the raw release ledger and cannot independently
solve component issues.

The checked-in required lane matrix is:

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

The disabled hosted `workers` surface contributes no lane in v1. Do not accept
a caller-supplied matrix; the release workflow and tracker both derive this
checked-in policy.

The tracker release endpoint stays disabled until it verifies:

- release-only auth and schema version;
- unique component and PR identities;
- tag/version/head agreement;
- successful `production/<component>` Deployment;
- matching immutable payload and first-success time;
- exact checked-in lane matrix and recomputed digests;
- component/release-ID/SHA agreement;
- all fix PRs merged and ancestral to the component head;
- canonical digest and idempotent replay;
- solve only matching-component issues.

Merged code or raw release notes alone never solve an issue.

## Wave 8: manifest and landing

The public finalizer wraps the existing raw release ledger:

- `release:large-feature`, `release:minor-feature`, and
  `release:performance` map to `feature`;
- `release:fix` maps to `fix`;
- `release:docs`, `release:maintenance`, and `release:skip` map to `omit`;
- one repository-wide `public-release-finalizer` concurrency group;
- `cancel-in-progress: false`;
- re-read the latest valid manifest boundary under the lock;
- use one explicitly reviewed initial base SHA for the first run;
- require ancestor relation; equal head is no-op, old/divergent head fails;
- paginate the full commit/associated-PR range with no 250 cap;
- verify every associated PR is merged into the selected release branch and
  its merge SHA is reachable from candidate `head`;
- require exactly one recognized `release:*` label on every PR;
- use the same path detector as deploy planning;
- keep omit entries with `components: []`;
- require deployed components for public entries;
- fail closed if tracker attribution is unavailable;
- call tracker attestation with actual verified results;
- validate JSON Schema and semantic invariants;
- canonicalize and attach exact `release-manifest.json` as
  `application/json`;
- identical existing bytes are no-op; different bytes fail;
- publication under the lock is the only public-boundary advance.

Before activation, run a complete historical dry run with no publication.
Choosing the first public base SHA is the one unavoidable human release
decision; derive a candidate from the intended previous public version and ask
the operator before enabling the finalizer.

Finish the landing WIP by adding full strict-schema validation, all semantic
rules, global frontmatter/body marker union discovery, fail-closed mismatch
handling, parser-safe MDX text, deterministic rerun, and build/render proof.
Preserve human title, summary, kind, tags, editorial copy, and media. Own only
version, date, and the generated block. Generated public list items contain no
PR number or PR URL. New files use the exact deterministic frontmatter from
the accepted contract (`title`, quoted `summary`, `version`, quoted `date`,
`kind: Release`) with `tags` absent. Omit-only releases create no PR.

After an immutable manifest asset exists, create/update exactly:

```text
branch: changelog/v<version>
draft PR: docs(changelog): publish v<version>
```

Never auto-merge editorial content.

## Local verification matrix

### Tracker

```bash
cd /Users/pablohansen/support-system-e2e/issue-tracker-core
docker compose up -d db redis
cd api
uv sync --extra dev
uv run alembic upgrade head
uv run pytest -q
cd ../web
pnpm install --frozen-lockfile
pnpm lint
pnpm build
```

Also test a scrubbed production snapshot, migration count reconciliation,
concurrent claims, source page/item failure, delayed enrichment, auth matrix,
private-field absence, and full replay behavior. A fresh database test alone is
not enough.

### Proliferate product

```bash
cd /Users/pablohansen/support-system-e2e/proliferate-product/server
uv run pytest -q

cd /Users/pablohansen/support-system-e2e/proliferate-product
make setup PROFILE=support-product
make build
make run PROFILE=support-product
```

Run focused support migrations/tests, owned SDK generation, web/mobile/desktop
typechecks, telemetry serializer tests, and targeted Rust crate tests before
the broad server/runtime checks. Follow each area doc's commands.

### Release and landing

```bash
cd /Users/pablohansen/support-system-e2e/proliferate-release
node --test scripts/ci-cd/*.test.mjs

cd /Users/pablohansen/support-system-e2e/landing-changelog
pnpm install --frozen-lockfile
pnpm test:changelog
pnpm build
```

Validate workflow YAML, shell, JSON Schema, byte-for-byte deterministic
fixtures, malicious title/name escaping, full pagination, concurrency-boundary
tests, immutable-asset mismatch, and a landing rerun that preserves editorial
content.

### Integrated local profile

Merge product then release into `proliferate-integration` and run:

```bash
cd /Users/pablohansen/support-system-e2e/proliferate-integration
make setup PROFILE=support-e2e
make build
make run PROFILE=support-e2e
```

Point a local tracker at the local private product feed, exercise all three
source fixtures, and store an evidence bundle before production cutover.

## AWS and production runbook

No mutation happens until the implementation tests pass and the identity
preflight is recorded.

### Read-only preflight

```bash
set -euo pipefail
readonly EXPECTED_AWS_ACCOUNT=157466816238
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION="$AWS_REGION"
export PRODUCT_API=https://app.proliferate.com/api
export TRACKER_URL=https://issues.proliferate.com

actual_account="$(aws sts get-caller-identity --query Account --output text)"
test "$actual_account" = "$EXPECTED_AWS_ACCOUNT"
test "$AWS_REGION" = us-east-1

export TRACKER_SSH_HOST="$(aws ec2 describe-instances \
  --instance-ids i-022f01951cdf2409e \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
test -n "$TRACKER_SSH_HOST"
test "$TRACKER_SSH_HOST" != None
export TRACKER_AUDIT_URL="https://$TRACKER_SSH_HOST"

aws ec2 describe-instances \
  --instance-ids i-022f01951cdf2409e \
  --query 'Reservations[0].Instances[0].{State:State.Name,Role:IamInstanceProfile.Arn,PublicIp:PublicIpAddress,SecurityGroups:SecurityGroups}'

aws rds describe-db-instances \
  --db-instance-identifier issue-tracker-db \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Encrypted:StorageEncrypted,Public:PubliclyAccessible,MultiAZ:MultiAZ,Backups:BackupRetentionPeriod,DeletionProtection:DeletionProtection}'

aws grafana describe-workspace --workspace-id g-e532d030d8
aws grafana list-workspace-service-accounts \
  --workspace-id g-e532d030d8 \
  --query 'serviceAccounts[].{id:id,name:name,role:grafanaRole}'
aws grafana list-workspace-service-account-tokens \
  --workspace-id g-e532d030d8 \
  --service-account-id 2 \
  --query 'serviceAccountTokens[].{id:id,name:name,createdAt:createdAt,expiresAt:expiresAt}'
curl -skSf --connect-timeout 10 --max-time 30 \
  "$TRACKER_AUDIT_URL/healthz" | jq -e '.ok == true'
curl -fsS --connect-timeout 10 --max-time 30 \
  "$PRODUCT_API/health" | jq -e .
```

The `-k` health check is only a prototype audit. After DNS/TLS cutover, this
must pass without `-k`:

```bash
set -euo pipefail
curl -fsS --connect-timeout 10 --max-time 30 \
  "$TRACKER_URL/healthz" | jq -e '.ok == true'
```

### Current host inspection and deploy controls

Current access is:

```bash
set -euo pipefail
SSH_OPTS=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o ConnectTimeout=10
  -i ~/.ssh/issue-tracker.pem
)
ssh "${SSH_OPTS[@]}" \
  "ec2-user@$TRACKER_SSH_HOST" \
  'docker ps --filter label=com.docker.compose.project=issue-tracker --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"'
```

After the Elastic IP is attached, replace `TRACKER_SSH_HOST` with that stable
address. Prefer the verified SSM managed-instance path for deployment. Do not
run the current Compose command merely to inspect state: its host `.env`
currently causes secret-derived interpolation warnings. Do not read or print
that file; replace it with instance-role/Secrets Manager loading before deploy.

Add checked-in `infra/deploy.sh` before cutover. It must
take an immutable commit/image and explicit migration target, reject a dirty
host checkout or wrong AWS identity, show the planned revision, stop on any
failed health/migration check, and default every external writer off.

The reviewed invocation contract is:

```bash
./infra/deploy.sh --maintenance on --writers disabled
./infra/deploy.sh \
  --revision "$TRACKER_REVISION" \
  --migration-target "$ALEMBIC_TARGET" \
  --writers disabled \
  --api-mode read-only
```

`TRACKER_REVISION` must be a reviewed 40-character commit or immutable image
digest and `ALEMBIC_TARGET` must equal the named expand or contract revision;
`--api-mode` is `read-only` for expanded-reader verification and `normal` only
after the contract migration. The script rejects `head`, empty values, and
mutable tags. The coordinator runs it through SSM and waits for command
success. An SSH invocation using the same script is break-glass only.

The tracker needs separately controllable switches for:

```text
Sentry schedules
support feed schedule
Grafana poll
Grafana enrichment
GitHub attribution worker
release attestation acceptance
```

The webhook is activated by attaching its Grafana contact point. Disabled
sources must be visible as disabled/not-yet-run; they must not appear healthy.
Document the final environment-variable names in tracker operations docs.

Remove the current automatic `alembic upgrade head` startup before cutover.
`infra/deploy.sh` is the only production migration/deploy entry point; direct
Compose migration is a break-glass procedure documented inside that script.
It must use remote `set -euo pipefail`, validate the checked-out commit/image
and exact revision ID, and run only one Alembic process. The ordered operator
sequence is below; it is not permission to run against the prototype today.

### Snapshot and maintenance gate

First assign reviewed concrete identifiers. Placeholder text, `head`, mutable
tags, and empty values must fail before any remote command:

```bash
set -euo pipefail
TRACKER_REVISION='replace-with-reviewed-40-character-commit-or-image-digest'
EXPAND_REVISION='replace-with-reviewed-expand-revision-id'
CONTRACT_REVISION='replace-with-reviewed-contract-revision-id'

test -n "$TRACKER_REVISION"
test -n "$EXPAND_REVISION"
test -n "$CONTRACT_REVISION"
test "$EXPAND_REVISION" != head
test "$CONTRACT_REVISION" != head
case "$TRACKER_REVISION$EXPAND_REVISION$CONTRACT_REVISION" in
  *replace-with-*) exit 64 ;;
esac
```

The coordinator then enters maintenance and disables all writers/contact
delivery. `infra/deploy.sh --maintenance on --writers disabled` must stop
`api`, `web`, `worker`, and `beat`, retain only the static maintenance/health
surface, and print no secret. Capture final counts only after it succeeds.

Create the quiescent pre-expand snapshot:

```bash
set -euo pipefail
pre_expand_snapshot="issue-tracker-v1-pre-expand-$(date -u +%Y%m%dT%H%M%SZ)"

aws rds create-db-snapshot \
  --db-instance-identifier issue-tracker-db \
  --db-snapshot-identifier "$pre_expand_snapshot" \
  --region "$AWS_REGION"

aws rds wait db-snapshot-available \
  --db-snapshot-identifier "$pre_expand_snapshot" \
  --region "$AWS_REGION"

aws rds describe-db-snapshots \
  --db-snapshot-identifier "$pre_expand_snapshot" \
  --query 'DBSnapshots[0].{Status:Status,Arn:DBSnapshotArn,Created:SnapshotCreateTime}'
```

Run the reviewed deploy command through SSM with `EXPAND_REVISION`, writers
disabled, and API read-only. Verify schema/auth/counts. Re-enter maintenance,
capture another final count/checksum set, then create the second snapshot:

```bash
set -euo pipefail
pre_contract_snapshot="issue-tracker-v1-pre-contract-$(date -u +%Y%m%dT%H%M%SZ)"

aws rds create-db-snapshot \
  --db-instance-identifier issue-tracker-db \
  --db-snapshot-identifier "$pre_contract_snapshot" \
  --region "$AWS_REGION"
aws rds wait db-snapshot-available \
  --db-snapshot-identifier "$pre_contract_snapshot" \
  --region "$AWS_REGION"
aws rds describe-db-snapshots \
  --db-snapshot-identifier "$pre_contract_snapshot" \
  --query 'DBSnapshots[0].{Status:Status,Arn:DBSnapshotArn,Created:SnapshotCreateTime}'
```

Only then run the same deploy command with `CONTRACT_REVISION`, still with all
writers disabled. Record both snapshot ARNs, both count sets, deploy command
IDs, and post-migration `alembic current`.

The concrete remote commands are:

```bash
set -euo pipefail

./infra/deploy.sh --maintenance on --writers disabled
./infra/deploy.sh \
  --revision "$TRACKER_REVISION" \
  --migration-target "$EXPAND_REVISION" \
  --writers disabled \
  --api-mode read-only

# After expanded-reader verification, maintenance and pre-contract snapshot:
./infra/deploy.sh --maintenance on --writers disabled
./infra/deploy.sh \
  --revision "$TRACKER_REVISION" \
  --migration-target "$CONTRACT_REVISION" \
  --writers disabled \
  --api-mode normal
```

The coordinator submits these through `aws ssm send-command`, waits with
`aws ssm wait command-executed`, and requires `get-command-invocation` status
`Success` before advancing. Shell variables are interpolated into the command
only after the validation block; the SSM document must never include secret
values. Use this helper for one reviewed command at each gate:

```bash
run_tracker_ssm() {
  local reviewed_command="$1"
  local parameters command_id status
  parameters="$(jq -cn --arg command \
    "set -euo pipefail; cd /home/ec2-user/issue-tracker; $reviewed_command" \
    '{commands:[$command]}')"
  command_id="$(aws ssm send-command \
    --instance-ids i-022f01951cdf2409e \
    --document-name AWS-RunShellScript \
    --parameters "$parameters" \
    --region "$AWS_REGION" \
    --query 'Command.CommandId' --output text)"
  test -n "$command_id"
  aws ssm wait command-executed \
    --command-id "$command_id" \
    --instance-id i-022f01951cdf2409e \
    --region "$AWS_REGION"
  status="$(aws ssm get-command-invocation \
    --command-id "$command_id" \
    --instance-id i-022f01951cdf2409e \
    --region "$AWS_REGION" --query Status --output text)"
  test "$status" = Success
  printf '%s\n' "$command_id"
}
```

For example, after the pre-expand snapshot, pass the exact expanded-reader
deploy invocation shown above. Do not combine maintenance, either snapshot,
and both migrations into one SSM command.

Do not run an in-place downgrade. The rollback unit is the manual snapshot plus
the exact expand-compatible application revision: pre-expand for an expand
failure, and pre-contract for a contract/post-contract failure.

### Safe secret use

Do not put secret values in docs, command history, logs, PR bodies, or tool
output. Standardize new Secrets Manager values as JSON objects with named
fields. Load only the required field with xtrace disabled:

```bash
set -euo pipefail
set +x
umask 077

load_secret_field() {
  local secret_id="$1"
  local field="$2"
  aws secretsmanager get-secret-value \
    --secret-id "$secret_id" \
    --region "$AWS_REGION" \
    --query SecretString --output text |
    jq -er --arg field "$field" '.[$field]'
}

ISSUE_TRACKER_AGENT_TOKEN="$(load_secret_field \
  'replace-with-agent-secret-id' agentToken)"
ISSUE_TRACKER_RELEASE_TOKEN="$(load_secret_field \
  'replace-with-release-secret-id' releaseToken)"
SUPPORT_FEED_TOKEN="$(load_secret_field \
  'replace-with-support-feed-secret-id' supportFeedToken)"
GRAFANA_TOKEN="$(load_secret_field \
  'replace-with-grafana-api-secret-id' grafanaToken)"

GRAFANA_URL="https://$(aws grafana describe-workspace \
  --workspace-id g-e532d030d8 \
  --region "$AWS_REGION" \
  --query workspace.endpoint --output text)"
test "$GRAFANA_URL" != https://None
```

Unset all token variables after testing. Verify rotated old tokens fail. Never
enable shell xtrace in a shell holding these variables.

### Read-only service checks

```bash
set -euo pipefail

curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $ISSUE_TRACKER_AGENT_TOKEN" \
  "$TRACKER_URL/v1/ops" | jq -e .

curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $SUPPORT_FEED_TOKEN" \
  --get --data-urlencode limit=1 \
  "$PRODUCT_API/internal/support/reports" |
  jq -e '{items:(.items|length),nextCursorPresent:(.nextCursor != null),hasMore}'

curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/v1/provisioning/alert-rules" |
  jq -e '[.[] | {uid,title,labels,annotations}]'

curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/v1/provisioning/contact-points" |
  jq -e '[.[] | {uid,name,type,settingKeys:(.settings|keys),secureFields:(.secureFields // {} | keys)}]'

curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/alertmanager/grafana/api/v2/alerts" |
  jq -e '[.[] | {fingerprint,startsAt,endsAt,status:.status.state,labels}]'
```

Never print full contact-point settings: they may contain `url` or `token`.

Verify every component deployment against the candidate manifest, not merely
the first 100 deployment objects:

```bash
set -euo pipefail
MANIFEST='replace-with-local-path-to-reviewed-release-manifest.json'
test -s "$MANIFEST"
jq -e '.schemaVersion == 1' "$MANIFEST" >/dev/null

for component in \
  proliferate-server proliferate-litellm proliferate-web proliferate-mobile \
  proliferate-desktop proliferate-desktop-native anyharness \
  proliferate-worker proliferate-supervisor
do
  expected_head="$(jq -er --arg component "$component" \
    '.release.components[] | select(.component == $component) | .headSha' \
    "$MANIFEST")"
  expected_release="$(jq -er --arg component "$component" \
    '.release.components[] | select(.component == $component) | .releaseId' \
    "$MANIFEST")"

  deployments="$(gh api --paginate -X GET \
    repos/proliferate-ai/proliferate/deployments \
    -f environment="production/$component" -f per_page=100 | jq -s 'add')"
  deployment_id="$(jq -er --arg sha "$expected_head" \
    '[.[] | select(.sha == $sha)] | sort_by(.created_at) | last | .id' \
    <<<"$deployments")"

  latest_status="$(gh api --paginate -X GET \
    "repos/proliferate-ai/proliferate/deployments/$deployment_id/statuses" \
    -f per_page=100 | jq -s 'add | sort_by(.created_at) | last')"
  test "$(jq -r '.state' <<<"$latest_status")" = success

  jq -n --arg component "$component" \
    --arg releaseId "$expected_release" \
    --argjson deploymentId "$deployment_id" \
    --arg deployedAt "$(jq -r '.created_at' <<<"$latest_status")" \
    '{component:$component,releaseId:$releaseId,deploymentId:$deploymentId,deployedAt:$deployedAt,state:"success"}'
done

node scripts/ci-cd/verify-production-deployments.mjs \
  --manifest "$MANIFEST" \
  --repository proliferate-ai/proliferate
```

`verify-production-deployments.mjs` is an R2 deliverable. It fetches each full
Deployment payload, requires `schemaVersion=1`, component/release/head match,
recomputes each artifact digest from immutable provider references, enforces
the checked-in lane matrix, and rejects a prior same-release deployment with
different digests. The summary loop is an independent status check, not a
substitute for that validator.

### Support feed replay and parity

Replay the same cursor and compare canonical bytes:

```bash
set -euo pipefail

first="$(curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $SUPPORT_FEED_TOKEN" \
  --get --data-urlencode limit=50 \
  "$PRODUCT_API/internal/support/reports")"
jq -e '(.items | type == "array") and (.items | length > 0) and
  (.hasMore | type == "boolean")' <<<"$first" >/dev/null

cursor="$(jq -er '.items[-1].cursor | select(type == "string" and length > 0)' \
  <<<"$first")"
test -n "$cursor"

a="$(curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $SUPPORT_FEED_TOKEN" \
  --get --data-urlencode "cursor=$cursor" --data-urlencode limit=50 \
  "$PRODUCT_API/internal/support/reports")"

b="$(curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $SUPPORT_FEED_TOKEN" \
  --get --data-urlencode "cursor=$cursor" --data-urlencode limit=50 \
  "$PRODUCT_API/internal/support/reports")"

jq -e '(.items | type == "array") and (.hasMore | type == "boolean")' \
  <<<"$a" >/dev/null
jq -e '(.items | type == "array") and (.hasMore | type == "boolean")' \
  <<<"$b" >/dev/null
a_hash="$(jq -cS . <<<"$a" | shasum -a 256 | awk '{print $1}')"
b_hash="$(jq -cS . <<<"$b" | shasum -a 256 | awk '{print $1}')"
test -n "$a_hash"
test "$a_hash" = "$b_hash"
```

Page from the empty cursor until `hasMore=false`. Compare the set/count of
feed report IDs with product database rows in `completed` state and tracker
`issue_reporters.report_id` after ingestion. The existing five production
completions must be accounted for. Count parity, not an S3 object count alone,
is the acceptance check.

### API operational proof

Use a unique run ID and a canary issue created by the support canary:

```bash
set -euo pipefail
export RUN_ID="support-e2e/$(date -u +%Y%m%dT%H%M%SZ)"
export CANARY_ISSUE_ID='<controlled-support-issue-id>'

curl -fsS --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $ISSUE_TRACKER_AGENT_TOKEN" \
  "$TRACKER_URL/v1/issues?status=tbd&limit=50" | jq -e .

curl -fsS --connect-timeout 10 --max-time 30 -X POST \
  -H "Authorization: Bearer $ISSUE_TRACKER_AGENT_TOKEN" \
  -H "X-Run-Id: $RUN_ID" \
  "$TRACKER_URL/v1/issues/$CANARY_ISSUE_ID/claim" | jq -e .

curl -fsS --connect-timeout 10 --max-time 30 -X PATCH \
  -H "Authorization: Bearer $ISSUE_TRACKER_AGENT_TOKEN" \
  -H "X-Run-Id: $RUN_ID" \
  -H 'Content-Type: application/json' \
  --data '{"status":"not_done","note":"controlled support-system canary"}' \
  "$TRACKER_URL/v1/issues/$CANARY_ISSUE_ID" | jq -e .

curl -fsS --connect-timeout 10 --max-time 30 -X POST \
  -H "Authorization: Bearer $ISSUE_TRACKER_AGENT_TOKEN" \
  -H "X-Run-Id: $RUN_ID" \
  "$TRACKER_URL/v1/issues/$CANARY_ISSUE_ID/release-claim" | jq -e .
```

Run the documented two-client claim race and cursor replay. Use only controlled
issues for dedup/status/PR tests. Verify mutation without `X-Run-Id` and
cross-key access fail.

### CloudWatch evidence

For a configured log-backed alert window:

```bash
set -euo pipefail
aws logs filter-log-events \
  --log-group-name '<annotated-log-group>' \
  --filter-pattern '<annotated-filter-pattern>' \
  --start-time '<window-start-ms>' \
  --end-time '<window-end-ms>' \
  --region "$AWS_REGION" |
  jq -e '{
    events: [.events[] | . as $event |
      (try ($event.message | fromjson) catch {}) as $body |
      {
        eventId: $event.eventId,
        timestamp: $event.timestamp,
        canary_id: ($body.canary_id // null),
        user_id: ($body.user_id // null),
        release_id: ($body.release_id // null)
      }
    ],
    nextTokenPresent: (.nextToken != null)
  }'
```

This prints only allowlisted evidence fields. If raw log bodies are ever needed
for incident investigation, write them with `umask 077` directly to the
restricted evidence location outside agent/tool output; never paste them into
a PR, tracker occurrence, or this document.

## Controlled production canaries

Canary writes require an explicit operator go-ahead after the dark-deploy
gates. They are not part of the read-only audit.

P3 must add a checked-in operator harness at
`scripts/ops/support-system-canary.mjs`; acceptance must not depend on an
undocumented click path. It wraps AWS/Grafana/product/tracker calls, supports
`--dry-run`, refuses the wrong AWS account/region or non-canary user, redacts
tokens, and writes mode-`0600` JSON evidence. It does not add a public canary
or manual tracker-create endpoint. Product telemetry is emitted by a one-off
ECS task using the exact deployed server image and a checked-in canary command,
so the real Sentry/logger/release initialization runs.

Its stable operator interface is:

```bash
set -euo pipefail
CANARY_ID="support-e2e-$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/support-e2e.XXXXXX")"
chmod 700 "$EVIDENCE_DIR"

node scripts/ops/support-system-canary.mjs baseline \
  --canary-id "$CANARY_ID" --out "$EVIDENCE_DIR/baseline.json"
node scripts/ops/support-system-canary.mjs sentry \
  --canary-id "$CANARY_ID" --out "$EVIDENCE_DIR/sentry.json"
node scripts/ops/support-system-canary.mjs support \
  --canary-id "$CANARY_ID" --sentry-result "$EVIDENCE_DIR/sentry.json" \
  --out "$EVIDENCE_DIR/support.json"
node scripts/ops/support-system-canary.mjs grafana-data \
  --canary-id "$CANARY_ID" --out "$EVIDENCE_DIR/grafana-data.json"
node scripts/ops/support-system-canary.mjs grafana-health \
  --canary-id "$CANARY_ID" --out "$EVIDENCE_DIR/grafana-health.json"
node scripts/ops/support-system-canary.mjs verify \
  --canary-id "$CANARY_ID" --baseline "$EVIDENCE_DIR/baseline.json" \
  --out "$EVIDENCE_DIR/verification.json"
```

`baseline` records tracker poll cursor, source-health rows, issue/occurrence
counts, ECS task definition/image, and active Grafana rule revisions.
`sentry` returns exact project/event ID and one-off ECS task ARN. `support`
uses the existing authenticated report-create/upload/complete flow and returns
report ID/completion time. `grafana-data` returns rule UID, fingerprint, log
group, and window; it also restores the metric/input to nonfiring.
`grafana-health` triggers the annotated signed-delivery canary without making a
row. `verify` polls from the baseline cursor and resolves issue IDs from the
known event/report/rule identities; it waits at most 12 minutes for
Sentry/support and 20 minutes for Grafana's resolution plus final enrichment,
then fails nonzero with the last sanitized state. Add a `cleanup` subcommand
that disables inputs and marks only eligible canonical roots spam; it retains
duplicate shells and the reserved release-attestation issue.

Preconditions:

- AWS identity/region reverified;
- a fresh RDS snapshot exists;
- public tracker TLS works without `-k`;
- tracker role and managed secrets are live; no production secret remains in
  host `.env`;
- migration and historical support backfill reconcile;
- six Grafana rules and contact point validate;
- no email path is enabled;
- baseline issue/occurrence/source-health counts are recorded.

Use a synthetic internal `trusted-beta` account, a unique `canary_id`, a real
canonical deployed release, and `notify=false`, `credit=false`,
`urgent=false`. Do not invent or publish a credit name.

### Sentry canary

Trigger one deliberately instrumented exception through a real authenticated
product path so the SDK, request context, and deployed release stamp are
exercised. Wait one poll interval.

Require:

- one exact Sentry occurrence with expected `user_id` and `release_id`;
- correct project/group/component issue key;
- independent source health success;
- poll replay and overlap create no second occurrence.

Raw Sentry API injection is useful for adapter testing but does not replace
this producer-path canary.

### Grafana data and health canaries

Emit one pre-agreed structured error through a real product request/job, or an
approved pre-provisioned canary stream, with exact top-level `user_id`,
`release_id`, and `canary_id`. Let the dedicated rule fire and resolve.

Require:

- one canonical issue;
- exactly one alert-level null occurrence;
- exactly one CloudWatch log occurrence;
- UID/fingerprint and user/release match;
- poll replay adds nothing;
- final +10-minute enrichment adds no duplicate.

Separately fire the annotated health canary. It must update
`grafana:webhook` health but create no issue, occurrence, or enrichment
window.

### Support canary

Submit and complete one real product report through the authenticated support
flow. Use the synthetic account, canonical client release, all outreach/credit
flags false, and—when testing correlation—the Sentry canary's explicit
`{project,eventId}` reference.

Require:

- the feed exposes it exactly once;
- it attaches to the Sentry issue when the single reference resolves;
- one support occurrence and one reporter record exist;
- notify/credit values remain false;
- feed/tracker replay is idempotent;
- no private body/email/diagnostics/attachment enters tracker or GitHub.

After evidence, transition canary-created issues to `spam` with a deterministic
audit reason, except the reserved release-attestation issue. Duplicate shells
remain solved and immutable. Do not delete audit evidence. Return the canary
metric/rule to nonfiring and wait for resolved delivery.

## Release and changelog production proof

Before enabling the first publication, the operator records these reviewed
values in the release evidence (never guess them):

```text
FIRST_PUBLIC_VERSION=<operator-approved semver>
FIRST_PUBLIC_TAG=proliferate-v<FIRST_PUBLIC_VERSION>
INITIAL_PUBLIC_BASE_SHA=<operator-approved 40-character ancestral SHA>
ATTESTATION_CANARY_ISSUE_ID=<controlled non-customer issue>
ATTESTATION_CANARY_PR=<approved low-risk PR number>
ATTESTATION_COMPONENT=<component actually changed and shipped by that PR>
```

The first version and initial public base SHA are the one explicit human
release decision. The canary issue is created from the controlled support flow,
linked to the approved PR as `fix`, and kept `tbd`/`not_done` until that PR is
merged and its component is actually shipped in `FIRST_PUBLIC_VERSION`. Do not
spam it during Wave 6 cleanup. Release attestation must move it to `solved`,
set the matching `solved_release_id`, and record the deterministic attestation
fact. Preserve that solved row through manifest and landing proof. If no safe
PR/release can be designated, the program has not proven the solve loop and is
not complete.

Before the first publication:

1. run a historical finalizer dry run and retain the manifest/diff;
2. obtain the reviewed initial public base SHA;
3. verify all required `production/<component>` Deployments and provider
   digests independently;
4. verify tracker attribution batch response, including empty arrays;
5. run JSON Schema and semantic validation;
6. run landing generation/build against the exact bytes;
7. keep the finalizer disabled if any proof is absent.

For the first real versioned release:

- capture raw release tag/head and all component deployment IDs;
- verify the reserved fix PR is merged and its merge SHA is ancestral to the
  attested component head;
- capture the manifest asset checksum and media type;
- call/replay tracker attestation and compare canonical digest/results;
- verify the reserved issue changed to solved only through that attestation;
- rerun the finalizer and require a no-op;
- verify one `changelog/v<version>` branch and one draft PR;
- rerun landing generation and require no duplicate/no editorial changes;
- record the landing build URL/result.

The program is not end-to-end complete until this real versioned release path
has succeeded.

If a positive production attribution projection is tested, use an approved
draft/implementation PR and a real internal reporter who explicitly opts into
the exact public display name. Otherwise test only the empty-credit and comment
deletion paths in production and keep the positive path in the integration
suite. Never fabricate consent for a canary.

## Stop conditions

Stop before source/canary activation if:

- TLS still needs `-k`;
- no tracker instance role or managed secret wiring exists;
- the migration snapshot/count evidence is absent;
- source health is stale or errored;
- the support feed exposes raw message, email, diagnostics, attachments, keys,
  URLs, or logs;
- a cursor advances past a failed page/item;
- Grafana accepts missing/bad HMAC, stale timestamp, or truncated delivery;
- a canary duplicates;
- known user/release arrives null or mismatched;
- server release is stamped onto a target component;
- CloudWatch pagination repeats a token or exceeds its cap;
- one source's healthy run clears another source's failure.

Stop release attestation/finalization if:

- any required `production/<component>` Deployment is missing/non-successful;
- tag, head, version, merge ancestry, lane matrix, provider reference, or
  artifact digest disagrees;
- an ECR tag moved before immutable proof was captured;
- attribution query fails;
- an existing manifest asset has different bytes;
- candidate and public boundary are stale or divergent.

## Rollback

Before the contract migration, most failures roll back by disabling the one
source/contact point, stopping worker/beat, and deploying the previous app
revision while leaving expand-only tables for inspection.

T1 must ship `infra/restore-smoke.sh` and `infra/promote-restored-db.sh`.
Before cutover, perform a full isolated
restore rehearsal from the quiescent snapshot, not merely a tabletop review:

```bash
set -euo pipefail
SOURCE_DB=issue-tracker-db
RESTORE_SNAPSHOT='replace-with-reviewed-snapshot-id'
REHEARSAL_DB="issue-tracker-restore-$(date -u +%Y%m%d%H%M%S)"
EXPAND_READER_REVISION='replace-with-previous-immutable-revision'

source_db_json="$(aws rds describe-db-instances \
  --db-instance-identifier "$SOURCE_DB" \
  --region "$AWS_REGION" --query 'DBInstances[0]')"
db_subnet_group="$(jq -er '.DBSubnetGroup.DBSubnetGroupName' \
  <<<"$source_db_json")"
db_parameter_group="$(jq -er '.DBParameterGroups[0].DBParameterGroupName' \
  <<<"$source_db_json")"
read -r -a db_security_groups <<<"$(jq -er \
  '[.VpcSecurityGroups[].VpcSecurityGroupId] | join(" ")' \
  <<<"$source_db_json")"

aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "$REHEARSAL_DB" \
  --db-snapshot-identifier "$RESTORE_SNAPSHOT" \
  --db-instance-class db.t4g.micro \
  --db-subnet-group-name "$db_subnet_group" \
  --db-parameter-group-name "$db_parameter_group" \
  --vpc-security-group-ids "${db_security_groups[@]}" \
  --no-publicly-accessible \
  --region "$AWS_REGION"

aws rds wait db-instance-available \
  --db-instance-identifier "$REHEARSAL_DB" --region "$AWS_REGION"
restore_endpoint="$(aws rds describe-db-instances \
  --db-instance-identifier "$REHEARSAL_DB" --region "$AWS_REGION" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
test -n "$restore_endpoint"

./infra/restore-smoke.sh \
  --db-endpoint "$restore_endpoint" \
  --revision "$EXPAND_READER_REVISION" \
  --db-secret-id 'replace-with-tracker-db-secret-id' \
  --expected-counts 'replace-with-private-pre-contract-count-file'
```

The smoke script runs through SSM on the tracker instance, loads credentials
through its role, starts the prior immutable expand-compatible app as a
separate Docker project bound only to loopback, disables migrations/writers,
checks health/auth/schema and count/checksum parity, then removes that isolated
app. It never changes the production DB secret or endpoint. Retain sanitized
results, then tear down only the exact recorded rehearsal database:

```bash
case "$REHEARSAL_DB" in
  issue-tracker-restore-*) ;;
  *) exit 64 ;;
esac
test "$REHEARSAL_DB" != issue-tracker-db
aws rds delete-db-instance \
  --db-instance-identifier "$REHEARSAL_DB" \
  --skip-final-snapshot --region "$AWS_REGION"
aws rds wait db-instance-deleted \
  --db-instance-identifier "$REHEARSAL_DB" --region "$AWS_REGION"
```

Never delete or alter `issue-tracker-db` during the drill.

After the destructive contract migration:

1. disable all new writers/contact delivery;
2. enter maintenance and stop tracker web/worker/beat/API;
3. do not Alembic-downgrade in place;
4. restore the recorded `pre-contract` snapshot to a newly named RDS instance
   using the captured subnet group, parameter group, and security groups;
5. verify counts/schema on the restored instance;
6. use reviewed `infra/promote-restored-db.sh` to create a new database-secret
   version pointing at the restored endpoint, without printing credentials;
7. deploy the recorded expand-compatible immutable tracker revision with all
   writers disabled and verify through the stable tracker hostname;
8. reattach Grafana and enable old/source behavior one source at a time only
   after verification;
9. preserve the failed database and old secret version for forensics/rollback;
10. rotate/revoke any exposed credential and record the final secret version.

For a product ECS regression, roll back to the recorded prior task definition
while preserving the forward-compatible database. Never delete canary evidence;
mark it spam.

## Evidence bundle

Store a private, timestamped evidence bundle containing:

- repository/branch/commit SHAs and clean statuses;
- contract/schema checksums;
- AWS caller/account/region and resource revisions;
- pre/post migration schema and counts;
- RDS snapshot ARN;
- secret ARNs/names and IAM policy ARNs, never values;
- DNS/TLS verification;
- tracker image/code revision and service status;
- source `/v1/ops` snapshots before/after each activation;
- historical support parity report;
- Sentry/Grafana/support canary identifiers and row-count assertions;
- Grafana rule UID/config summary and contact-point safe summary;
- component Deployment IDs and artifact digests;
- attestation digest/result;
- manifest SHA-256 and GitHub release asset identity;
- landing branch/PR/build result;
- replay/no-op proofs;
- rollback rehearsal result.

Keep raw support/Sentry/log evidence in its private source. The bundle contains
IDs, safe summaries, counts, and hashes only.

## Definition of done

The lead agent may call the program complete only when all are true:

- every T/P/R/L PR above is merged to its protected default branch with green
  required CI, deployed SHAs descend from those merges, and all five
  implementation/integration worktrees are clean;
- the final tracker has exactly the seven contracted business tables and no
  prototype release/email/single-PR lifecycle;
- all exact API/auth boundaries work at trusted
  `https://issues.proliferate.com`;
- every mutation is attributable to `X-Run-Id`;
- all eight Sentry projects have independent fresh checkpoints;
- a known-user/release Sentry canary arrived once and survived replay;
- every historical completed support report is reconciled;
- a support canary preserved release, user, notify, and consent data and linked
  to its Sentry issue when applicable;
- all six Grafana rules have required labels; log-backed rules have required
  annotations;
- signed webhook, poll, delayed enrichment, resolved recovery, and no-row
  health canary all pass;
- no provider/auth failure can masquerade as zero work;
- claim, dedup, status, and recurrence behavior pass the complete contract
  suite;
- consent-safe PR projection is idempotent and contains no private identifiers;
- all nine component releases and required lane proofs are canonical and
  immutable;
- release attestation solves only fully shipped matching-component issues;
- a real versioned release published byte-stable `release-manifest.json`;
- finalizer replay was a no-op;
- the same manifest created/updated exactly one landing draft PR without
  altering editorial content;
- stable DNS/TLS, managed secrets, tracker IAM/logging, and old-credential
  revocation are complete;
- legacy routes/jobs/status semantics are gone;
- snapshot restore rollback is documented and smoke-tested;
- tracker `docs/deep-dive.md` and operations docs describe the deployed v1,
  not the prototype.

Only after this should a separate contract add thank-you email drafting and an
idempotent Customer.io/outbox sender.
