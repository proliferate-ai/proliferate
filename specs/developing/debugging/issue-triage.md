# Issue triage

Status: authoritative for operating the production issue queue.

This runbook is how an operator, with no agent and no chat history, works the
production issue tracker end to end: see what is in the queue, claim an issue,
follow its evidence into the owning source, record a conclusion, and let go. It
covers the REST surface directly so it stays usable even when the shared agent
skill is not.

The tracker application is not changed by triage. You read issues, follow the
exact evidence each issue already carries, and write short conclusions back. You
do not create issues by hand, copy private evidence into notes, or reach into
provider systems by broad search.

## Interface and credential

Everything goes through the REST API at `https://issues.proliferate.com`. Machine
callers authenticate with `Authorization: Bearer <agentApiKey>` and every
mutation additionally sends a unique `X-Run-Id` header. The read routes reject a
missing or wrong key; the mutation routes also reject a missing run ID.

The `agentApiKey` lives in AWS Secrets Manager under `issue-tracker/app`. Read it
by reference, never by value: the helper fetches it fresh for each call and never
prints or stores it. Human web and release credentials do not work on agent
routes, and the agent key does not work on the human web surface. Those
boundaries are enforced server-side; do not try to cross them.

The nine routes are:

```
GET   /v1/issues
GET   /v1/issues/{id}
GET   /v1/issues/poll
GET   /v1/ops
POST  /v1/issues/{id}/claim
POST  /v1/issues/{id}/release-claim
PATCH /v1/issues/{id}
POST  /v1/issues/{id}/deduplicate
POST  /v1/issues/{id}/prs
```

## Helper

The safe helper is `scripts/issues.py` in this repository. The same file is
installed as the shared agent skill (see [Shared skill](#shared-skill)). It
exposes exactly these commands, which map onto the routes above:

```
python3 scripts/issues.py ops
python3 scripts/issues.py list   [--status S] [--kind K] [--cursor C] [--limit N]
python3 scripts/issues.py poll   [--cursor C] [--limit N]
python3 scripts/issues.py get    <id>
python3 scripts/issues.py claim  <id> --run-id <unique>
python3 scripts/issues.py release <id> --run-id <unique>
python3 scripts/issues.py patch  <id> --run-id <unique> [--status S] [--note N] [--component C]
python3 scripts/issues.py dedup  <id> --run-id <unique> --root-id <root> --note <why>
python3 scripts/issues.py link-pr <id> --run-id <unique> --repository <owner/name> --number <n> [--relationship fix]
```

`release`, `patch`, `dedup`, and `link-pr` map to `release-claim`, `PATCH`,
`deduplicate`, and `prs` respectively. The helper prints JSON to stdout and
diagnostics to stderr, exits nonzero on any non-2xx response, and refuses any
origin other than the canonical one.

## Source health

Start with source health when timing or coverage is in question:

```
python3 scripts/issues.py ops
```

`/v1/ops` reports each ingestion source as `healthy`, `stale`, `degraded`,
`not_yet_run`, or `disabled`. A disabled source is shown as disabled, never as
healthy, so you can tell "no issues" apart from "not ingesting". If a source is
stale or degraded, treat gaps in the queue for that source as unreliable until it
recovers, and do not read absence as resolution.

## Listing versus polling

Two read patterns, two different jobs.

- **List** (`GET /v1/issues`) is a snapshot of issues, newest activity first,
  ordered by `(updated_at DESC, id DESC)`. Filter with `--status` and `--kind`.
  It returns `items`, `hasMore`, and a `nextCursor`; pass that cursor back to page
  through the current snapshot. Use list to survey and pick work.
- **Poll** (`GET /v1/issues/poll`) is the append-only event feed, ordered by
  `events.id` ascending, and is how you follow what changed. It returns `events`,
  `hasMore`, and a `nextCursor`. Store the `nextCursor` and pass it back verbatim
  on the next call to continue exactly where you left off. The cursor is opaque —
  never edit or reconstruct it. Replaying the same cursor returns the same events
  with no duplicates and no skips; a short commit-visibility window means a
  just-written event may appear on the next poll rather than instantly.

## Claim, conflict, and release

Reading needs no claim. Any change starts with a claim.

1. `claim <id> --run-id <unique>`. Use one unique run ID for the whole unit of
   work; a ULID or `triage-<date>-<short>` is fine. The run ID is required and is
   recorded on every resulting audit event.
2. If someone else already holds the issue, the claim returns `409` with
   `already_claimed` (or `active_claim_conflict`). Stop; do not force it. Claims
   also expire on their own, so a stale hold clears without intervention.
3. `release <id> --run-id <same>` when you stop — whether you resolved the issue,
   handed it off, or found nothing. Never walk away from a held claim.

Two operators racing to claim the same issue produce exactly one winner; the
other gets a conflict.

## Status, notes, and dedup

- **Status and notes**: `patch <id> --run-id <run> --status <s> --note <n>`. Valid
  transitions are enforced server-side; an illegal transition returns `409`
  `invalid_transition`. Read the response rather than retrying blindly. A note is
  a short conclusion — the diagnosis, the exact source IDs, the links, and the
  next action. Notes never carry raw evidence.
- **Deduplicate**: `dedup <dup-id> --root-id <root-id> --note <why>` merges the
  duplicate into the root, moving its occurrences, reporters, and PR links across
  and keeping its audit history. Dedup is **exact-identity only**. Similar titles,
  similar stack traces, the same user, close timing, or a guessed shared cause are
  not merge authority. When identity is ambiguous, leave the issues separate and
  add a note for founder review.

## Following the evidence

`get <id>` returns safe issue detail: source key and URL, occurrence event keys
with user and release identity, safe reporter references, linked PRs, and audit
events. It never returns reporter emails, private source bodies, raw provider
payloads, or raw logs. Reach those through the exact IDs the issue already
carries — never by broad search across a provider.

### Sentry and E2B

Take the source key or an occurrence `eventKey`, go to that exact Sentry project
and event ID, and read the event through Sentry. From the event, take `user.id`,
the canonical release, and the relevant tags. Use a `sandbox_id` only if the event
itself contains one; there is no sandbox column on the tracker and you do not
enumerate a user's running sandboxes. E2B sandbox info, logs, or `connect` is for
that one exact sandbox, only while it is still running, and only when the
investigation is authorized.

### Support

Take the `reportId` or private reference from the issue and follow the existing
[support-report procedure](support-reports.md): derive the S3 object from the
report ID and open it with an authenticated AWS CLI. Open the exact encrypted
object or diagnostics only when a conclusion actually requires it. The tracker
note and any response never include a raw message body, attachment, diagnostics
archive, outreach address, or credential.

### Grafana and CloudWatch

Take the stable rule UID, find the exact provisioned rule and its runbook, and
use the occurrence firing window — plus the annotated group, filter, and region
when present — to run one bounded CloudWatch query. Do not widen to all log groups
and do not paste raw log lines into the tracker. A metric-only rule stops at
rule, dashboard, and runbook evidence.

### GitHub

Compare exact revisions and inspect the PR, then attach it with
`link-pr <id> --repository <owner/name> --number <n>`. The link must be backed by
an explicit issue reference or reviewed evidence; a similarly named PR is not
proof of a fix. The link is idempotent, so re-running it does not create
duplicates.

## Missing or expired evidence

Sources go stale and sandboxes expire. When the owning evidence is gone — an
expired E2B sandbox, a rotated log window, a source `/v1/ops` reports as
degraded — record that the evidence was unavailable and continue from whatever
durable identity remains (the Sentry event, the support report, the rule UID). Do
not guess a conclusion to fill the gap, and do not broaden the search to
reconstruct it.

## Credential rotation and revocation

The `issue-tracker/app.agentApiKey` is the entire local machine boundary. If it
may have been exposed, rotate or revoke it in AWS Secrets Manager; the next
helper invocation picks up the new value automatically because it fetches by
reference. After rotation, confirm that a request with the old key is rejected.
Nothing in the local ops environment holds a second durable copy of the key.

## Stopping without an orphaned claim

Before you finish: release every claim you took, confirm no secret or private
content landed in a note or in your output, and, if you hit a genuinely missing
REST capability, report it as a bounded gap rather than reaching around the API
with a browser or a direct database write.

## Shared skill

The same helper is packaged as a shared agent skill so a fresh agent discovers
one procedure. It is installed locally (outside this repository) at
`~/.agents/skills/triage-production-issue/`, with a Claude symlink at
`~/.claude/skills/triage-production-issue`. Codex discovers `~/.agents/skills`
directly. There is one source skill, not per-agent copies. This repository holds
the canonical `scripts/issues.py`; the local skill ships a copy of it.
