# Support reporting

Status: target. This document describes the accepted destination for private support reporting and the consented Desktop diagnostic snapshot. The body is written in the ideal state. Every difference from `main` today is listed in [Current gaps](#current-gaps).

## System contract

Organization Standard anatomy for the `support` system; the body below is the laws-and-proof detail.

- **Owned state:** `support_report` (the durable capture pivot) and the
  private S3 object set under `SUPPORT_REPORT_S3_PREFIX`; the Desktop-side
  support upload queue and staged snapshot artifacts
  ([`db/models/support.py`](../../../server/proliferate/db/models/support.py),
  [`db/store/support_reports.py`](../../../server/proliferate/db/store/support_reports.py),
  `db/store/support_session_diagnostics.py`).
- **Public surface:** `POST /v1/support/reports`, `.../upload-targets`,
  `.../complete`, plus the `report-uploads` and `messages` compatibility
  routes; Python `proliferate.server.support.{api,service,models}`; the
  Desktop bridge's support commands.
- **Consumes:** `accounts` (reporter identity, `outreach_email`); S3 and
  Slack vendor leaves; the AnyHarness bounded session-window reads;
  capability `notifications` (Slack receipt); the Desktop diagnostics
  collector and export permit (owned by the desktop host seam).
- **Emits:** Slack completion receipt (alerting projection only; carries
  the field set the
  [customer loop](../../engineering/customer-loop/README.md) requires:
  report id, kind/urgent/notify, `client_release_id`, bound session ids,
  Sentry project/event pairs, the `support_report_id:<id>` Sentry query, and
  a prefilled file-an-issue link);
  `desktop.support_snapshot.prepare|submit` lifecycles; `tracker_summary`
  and `client_release_id` projections on the row.
- **Fences:** no issue triage, repair, release tracking or outreach (the
  issue-lifecycle loop was retired in the 2026-08 cull); support never
  publishes report content anywhere; secret scrubbing obeys
  [secret custody](../../engineering/security/secret-custody.md).

Support reporting captures private customer feedback and diagnostic evidence. It does not own issue triage, automated repair, release tracking, or reporter outreach. (The issue-lifecycle system that owned the downstream issue, attribution, release, and changelog contract was retired in the 2026-08 engineering cull; there is no downstream consumer today.)

## Product boundary

The product contract ends here:

```text
Desktop/Web report intent ---------------------> authenticated support API
Hosted Desktop explicit snapshot consent
  -> bounded native preparation
  -> durable scrubbed diagnostics.json --------> support_report + private S3 bundle
                                                  -> best-effort Slack receipt
```

Capture ends the system: there is no downstream handoff. Public issue projection, issue-queue state, resolution state, and notification-on-fix are outside this system. Legacy tracker columns and historical S3 objects do not grant authority to publish current report content.

## Availability and entry points

The server advertises one of three support capabilities:

```text
vendor    hosted Proliferate support; open the in-app feedback surface
operator  self-managed operator configured a URL or email; open that destination
none      no support destination; render no support action
```

Every support entry point must use that capability. Product UI must never route a self-managed user to vendor support. The sidebar and command/menu action use `deriveSupportMenuAction`; any direct modal opening outside that boundary is a migration exception.

The root render-crash recovery surface also derives this capability. Because a root crash makes the ordinary in-app vendor feedback subtree unavailable, its `Contact support` action uses a narrow hosted-vendor email fallback. Operator deployments keep their configured URL or email, and `none` renders no support action. The recovery surface never substitutes Proliferate vendor support for a self-managed deployment.

Hosted Desktop has two private in-app modals:

- **Send feedback** for bugs and operational feedback.
- **Submit a prompt** for feature ideas expressed as an agent prompt.

The modals are rendered inside the main app. There is no dedicated Tauri support webview window. Web retains its ordinary support path; neither Web nor Mobile can prepare a Desktop snapshot.

## Consent and scope

Both hosted Desktop modals offer the same choice:

```text
Include a diagnostic snapshot
May include the selected session's prompts, transcript, tool and terminal
output, file paths, and provider errors. Detected secrets are removed before
upload.
```

The choice is unchecked every time either modal opens. It is specific to one report, one selected scope, and one consent epoch. It is not remembered and is not granted by credit, outreach, urgency, notification, public-content, Sentry, PostHog, or anonymous-telemetry settings. Merely opening the modal, rendering or checking the choice, or changing scope performs no customer-detail read, collector export, native staging, or upload-intent mutation.

The scope control appears only after consent:

- **Current session** is the default only when the active UI session maps
  through the session directory to an exact materialized session in the
  selected bundled-local workspace.
- **Recent activity (15 minutes)** is always available and is the default when
  that mapping is unavailable. With no selected bundled-local workspace it
  collects native collector, fallback, and status evidence only and records
  that the session ledger was omitted.

There is no arbitrary date or workspace picker. Cloud, standalone, Supervisor-owned, remote, and merely most-recent alternate runtimes are never substituted. A binding or scope change supersedes the consent epoch and cancels in-flight preparation. Consent becomes durable only after the exact staged artifact and job are acknowledged by the queue.

The existing report fields remain unchanged. **Send feedback** accepts message or attachment content plus urgency, notification, and credit intent. **Submit a prompt** uses `kind=feature`, never sets urgency, and has no implied notify-on-merge promise. A report without snapshot consent declares diagnostics false and can complete with zero uploads. Urgency and notification remain capture intent, not an enforced response SLA or automatic fix notification. Client workspace references remain claims; the server derives trusted cloud correlation only from resources the reporter is authorized to access.

## Preparation and artifact

Only an explicit **Send** or **Save a copy…** action while consent remains true can start preparation. The main-window Desktop bridge passes the immutable consent epoch and exact workspace/session binding to a narrow native coordinator. Native validates caller, consent, disclosure version, identifiers, and binding before reading customer-detail sources.

One preparation fixes a native capture time and the preceding fifteen-minute window. It uses a move-only, native-only support permit and the same capacity-one export admission owner as internal diagnostic export. The permit is not a collector credential, cannot cross the bridge, and cannot authorize the internal-dogfood artifact purpose. The collector request covers renderer, Tauri, collector, bundled AnyHarness, and Desktop Worker detailed and lifecycle records without a session filter. Collector output remains accepted-order evidence; when the accepted collector cap returns only an oldest matching prefix, the manifest says coverage is uncertain and never claims the unseen newest edge.

Selected session evidence is collected separately through bounded, cancellable, local-only AnyHarness windows: one exact active summary even when that session predates the window, or at most three recent summaries updated inside it, plus at most 200 normalized events and 100 raw notifications per session inside the fixed window. It is never converted into collector records or lifecycle conclusions. Native also samples collector/supervisor health, bundled child-producer status, the finite active fallback families, and finite read-only legacy compatibility tails. It never globs, walks customer directories, follows symlinks, or accepts a renderer-supplied path.

Native assembles canonical `schemaVersion: 3` JSON with an explicit source, gap, omission, truncation, scrub, and degradation manifest. Optional evidence degrades in a deterministic fixed priority until the exact uncompressed bytes fit the existing 26,214,400-byte diagnostics cap. A valid no-evidence skeleton still succeeds. The artifact is atomically staged under an owner-only root with a durable job-bound opaque ID, exact size, and SHA-256; no path or capability is returned to JavaScript.

One serialized **Save a copy…** action owns preparation, the native archive, and settlement of exact staged-artifact deletion. Save and Send remain unavailable for that whole action. The user-chosen ZIP and cleanup confirmation are independent: cancelling the native save dialog is not an error, a written ZIP remains successful when deletion rejects, and deletion rejection means durable cleanup is unconfirmed rather than proving bytes remain. The archive is never enqueued as an attachment and is not removed by queue cleanup.

Cleanup-unconfirmed and an admitted preparation cancellation conservatively block further consented snapshot work for the same modal and client job. This does not add an in-session cleanup retry or guarantee later reconciliation. Clearing consent still permits the existing text-only Send path. Cleanup truth is internal-only here: it adds no user message, log, lifecycle record, metric, Sentry event, PostHog event, or other telemetry signal.

## Artifact contents at a glance

`diagnostics.json` is one canonical JSON document (`SupportSnapshotV3`). Read top to bottom it answers: what build produced this, what the user agreed to, what the evidence is, how healthy the pipeline was, and what is not in the file and why.

- Identity and build context: `schema_version` (3), `snapshot_id`,
  `generated_at`, and `app` (version, release, platform, runtime version and
  status).
- Consent and selection: the disclosure version the user saw, when consent
  was granted, the chosen scope, the exact fifteen-minute
  `source_time_from`/`source_time_to` window, and the bound workspace and
  session identifiers. Everything in the file must be attributable to this
  grant.
- Evidence, organized by source family:
  - `records`: accepted-order collector records (lifecycle, warnings, errors,
    and detail from renderer, Tauri, collector, bundled AnyHarness, and
    Desktop Worker);
  - `session_ledger`: per selected session, one summary, at most 200
    normalized events, and at most 100 raw notifications;
  - `fallback_evidence`: bounded per-component file tails;
  - `legacy_evidence`: read-only legacy compatibility tails.
- Pipeline health: `collector` export metadata and `producer_health`, so a
  missing record is distinguishable as "producer was down" versus "did not
  happen".
- The manifest: per-source read/included byte accounting, gaps, omissions,
  truncation reasons, per-category scrub counts (counts only, never values),
  the limits in force, and `removed_by_tier` degradation accounting. Absence
  is always explained, never silent.

### Window timestamp spelling

`begin_preparation` reads the raw UTC clock exactly once per preparation and truncates that read toward the start of the current millisecond. It never rounds, so the emitted instant is never later than the instant observed. That single truncated read owns all three window values: `captured_at`, `source_time_to`, and `source_time_from`, which is exactly 900 seconds earlier.

Every one of those values is spelled as UTC with a fixed three-digit millisecond fraction and a trailing `Z`, for example `2026-08-12T12:00:00.000Z`. The spelling is fixed-width regardless of the sub-second precision the platform clock happens to offer, so a whole-second read is `.000Z` rather than a bare `Z` and a nanosecond-precision read is truncated to three digits rather than carrying six or nine. `captured_at` and `source_time_to` are byte-for-byte identical, which is what the aggregate validator compares.

The permit does not normalize. `SupportExportPermit::issue` refuses any window that is not already exact, and `is_exact_support_window` stays strict: UTC offset zero, byte equality against a fixed-millisecond re-spelling, and exactly 900 seconds between the endpoints. The producer is the only place canonical spelling is created, so a drifting producer fails loudly at issuance instead of being silently repaired downstream.

Fixing the producer is not the same as the window being release-complete: it guarantees the spelling the coordinator itself creates, while any other component that stamps a support timestamp remains its own source of truth, so a released build is only correct once every such producer emits this same canonical spelling.

Degradation removes candidate groups from tier 8 upward until the exact uncompressed bytes fit the cap, oldest first within a tier, and a lifecycle started/terminal pair is admitted or removed atomically. The fixed tiers:

| Tier | Contents |
| --- | --- |
| 1 | Selected active-session summary and events (Current session scope) |
| 2 | Collector lifecycle, loss-summary, and WARN/ERROR records |
| 3 | Collector records correlated to the selection identifiers |
| 4 | Remaining collector records |
| 5 | Fallback file tails |
| 6 | Recent-activity session summaries and events |
| 7 | Raw session notifications |
| 8 | Legacy compatibility lines |

## Privacy

Support reports, diagnostics, and attachments are private by default. `publicContentConsent` remains false. A diagnostic snapshot deliberately preserves selected bounded non-secret prompts, transcript, tool and terminal output, file content and paths, ordinary URLs, provider responses and errors, and correlation metadata because those are the evidence the disclosure names.

A purpose-specific Rust scrub runs over every collector, fallback, legacy, and session value before staging. Structural rules remove secret keys and credential containers; bounded regex rules remove authorization and cookie values, access/refresh/identity tokens, API keys and provider credentials, passwords, private keys, secret environment values, signed-URL secrets, URL userinfo, and high-confidence opaque credentials. Matches become typed redaction markers without retaining a secret prefix, suffix, length, or hash. Home-directory prefixes normalize to `~`; non-secret paths and URL detail remain useful.

The artifact excludes the report message, email, account name, tenant/device identity, hostname, username, environment maps, keychain material, collector connection material, support permits, staging paths, presigned URLs, and Sentry/PostHog payloads. It is never copied into public issues, product telemetry, ordinary logs, or the local collector/fallback stores. A scrub or mandatory-manifest invariant that cannot prove all candidate values were bounded fails preparation closed.

## Durable job and queue

Both modals create the same `SupportReportJob` shape and dispatch it to the single upload queue owner. Snapshot intent is explicit:

```text
none
prepared(consent, opaque artifact ID, snapshot ID, size, SHA-256, manifest summary)
```

Missing or truthy legacy `includeLogs` is never new consent. Legacy jobs migrate to no snapshot and diagnostics false; an already-created server report whose immutable intent expected old diagnostics ends terminally with resubmit guidance rather than capturing new customer evidence.

Queue persistence is a checksummed, revisioned document plus write-ahead journal, serialized by one in-process owner. Each mutation writes the journal, writes the full target document, reads and verifies the target, and only then acknowledges. Hydration reconciles both documents before listening or draining. The queue keeps at most ten jobs and 2,097,152 canonical document bytes. A full queue rejects the new job visibly; it never uses truncating array operations or silently evicts old work. Existing message, attachment-count, filename, credit-name, and byte limits are validated before enqueue.

At startup, settled queue hydration supplies the complete bounded artifact and attachment reference set to native reconciliation. Verified references survive; missing or mismatched artifacts become visible terminal resubmit states; stale partials and proven-unreferenced staged files are removed. A corrupt or ambiguous queue blocks readiness rather than pretending it is empty. The modal closes only after `queued` or byte-identical `duplicate`; full, conflicting, or failed persistence keeps the report visible.

## Upload and stable retry

A prepared snapshot is staged before the first server create call. Every attempt rereads it by opaque ID, verifies native metadata, Blob size, and SHA-256, and holds that same bounded Blob through create, upload-target, PUT, and complete. The existing API receives one optional `application/json` `diagnostics.json` object; it is not a user attachment and does not change attachment counts. Target URLs may be refreshed, but the Desktop job's artifact bytes, size, checksum, snapshot ID, and preparation parent remain stable for all retries. A retry never recollects or silently substitutes newer evidence.

Report creation remains idempotent by authenticated user and `clientJobId`. Already-completed is successful cleanup. Auth/configuration and transient failures retain the exact queued bytes for a later attempt; invalid local payloads, upload conflicts, and rejected payloads are terminal. Queue removal is journalled before idempotent deletion of the artifact and attachments, so a cleanup failure cannot replay a completed upload or delete another job's data.

## Failure and lifecycle behavior

Unavailable collectors or child processes, capped or unreadable optional sources, malformed optional records, and session endpoint failures produce typed omissions or truncations while other evidence continues. They do not affect the active session, runtime, Worker, collector, support draft, attachments, or telemetry. Fatal consent, scrub, manifest, staging, or artifact verification failure keeps the modal open and lets the user retry or explicitly send without a snapshot; it never changes intent silently.

Native emits one `desktop.support_snapshot.prepare` lifecycle for each admitted preparation and one child `desktop.support_snapshot.submit` lifecycle for each admitted upload attempt. Every admitted operation has exactly one closed, typed terminal. Snapshot-missing, snapshot-mismatch, and legacy-consent-required paths happen before submit admission and emit no synthetic submit pair. Snapshot-missing and snapshot-mismatch make no server call. A migrated legacy job still attempts ordinary report creation with diagnostics false; only a server-side immutable-intent conflict concludes `consent_required_for_legacy_job`. Cancellation, timeout, window/app teardown, and retry are bounded; late results from a superseded consent epoch cannot enqueue.

Server-side `cloud-diagnostics.json` collection remains disabled and reports `cloudDiagnosticsStatus=not_applicable`. Session SQLite remains replay truth; the snapshot neither mutates it nor restores cloud diagnostics.

## HTTP contract

Clients authenticate only to Proliferate. They never receive AWS credentials.

Active endpoints:

```text
POST /v1/support/reports
POST /v1/support/reports/{reportId}/upload-targets
POST /v1/support/reports/{reportId}/complete
POST /v1/support/report-uploads                 legacy compatibility wrapper
POST /v1/support/messages                       zero-upload compatibility shim
```

There is no `/tracker` endpoint, and the private completed-report feed (`GET /internal/support/reports`) was removed with the issue-tracker loop in the 2026-08 engineering cull.

### Create

`POST /v1/support/reports` creates or returns the durable case file for the authenticated user and `clientJobId`.

The immutable create intent includes:

```text
message and source context
scope and workspace references
telemetry references
expected diagnostics boolean and attachment count
kind, urgent, notifyMe
creditConsent, creditName
private content-consent state
```

An idempotent retry returns the existing report without replacing the original message, intent, or object set.

After inserting the row, the server writes private `request.json`. It contains the message, capture intent, references, and server-derived correlation. It must not contain a presigned URL.

### Upload targets

`POST /v1/support/reports/{reportId}/upload-targets`:

- requires report ownership;
- validates diagnostics and attachment metadata;
- locks the expected object set and upload intent;
- returns short-lived presigned `PUT` targets;
- may be called again to refresh expired URLs and refreshed content metadata;
- rejects a changed object set, diagnostics intent, or attachment count.

The generic endpoint can accept refreshed content metadata on a re-issue. A consented Desktop snapshot always reissues its original staged size and SHA-256; it does not recapture. The latest target manifest is the completion contract.

### Complete

`POST /v1/support/reports/{reportId}/complete`:

- verifies every object key is inside the stored report prefix;
- requires exactly the stored object set;
- checks completion size/checksum claims against the latest manifest;
- independently verifies object size through S3 metadata;
- writes `complete.json`;
- marks the row completed;
- attempts one Slack completion receipt during the first successful completion
  transition.

The S3 `HEAD` response does not prove object SHA-256; the checksum comparison is client-claim consistency, while object size is independently verified.

Slack failure does not roll back a completed report. `slack_notified_at` is written only after the webhook call succeeds. A missing webhook or provider error is logged and leaves the timestamp null for later recovery.

## Persistence and private objects

The `support_report` row is the durable capture pivot. Current capture columns include owner/client identity, lifecycle, S3 location, source/scope/reference JSON, expected and actual object manifests, kind/credit/urgent/notify intent, request IDs, timestamps, and Slack receipt state.

Two immutable capture columns record the report's release and summary projection:

- `client_release_id` — the canonical `<component>@<semver>+<12-char-sha>`
  release the client was running. A missing or malformed value stores NULL and
  the report completes with a visible warning. `telemetry_refs_json` normalizes
  Sentry references to `{"sentryEvents": [{"project", "eventId"}]}`; project-less
  event IDs are insufficient to form a pair and are never guessed.
- `tracker_summary` — a server-produced, redacted, whitespace-collapsed summary
  capped at 240 characters. It is a safe internal projection and never a
  substitute for the private report body.

Default object layout:

```text
<SUPPORT_REPORT_S3_PREFIX>/<YYYY>/<MM>/<DD>/<reportId>/
  request.json
  diagnostics.json                                  optional
  attachments/<clientFileId>/<safeFileName>         optional
  complete.json
```

The bucket is private, blocks public access, uses server-side encryption, applies retention/lifecycle policy, and grants least-privilege server access.

Historical `tracker.json` and `cloud-diagnostics.json` objects may exist. The current server does not create them.

## Slack receipt

The Slack completion receipt contains operational metadata:

- report ID and optional internal report URL;
- sender identity needed for support operations;
- kind, urgent, notify, credit, diagnostics, and attachment summaries;
- safe context and correlation IDs.

It must not include S3 keys/prefixes, presigned URLs, diagnostic or attachment bodies, raw prompts/tool output, or secret values.

Slack is an alerting projection, not the queue or the source of delivery truth.

## Outreach address

Users may set `outreach_email` through `PATCH /v1/users/me`. An empty value clears it. The support contact rule is:

```text
outreach_email ?? account_email
```

Capture stores reporter identity and notify intent; it does not send an email. Only an authorized future outreach step may resolve and snapshot the address.

## Current gaps

These are the differences from the target state above that remain in the tree. The consented-capture pipeline is built and now has its consent surface: schema-3 snapshot assembly, the manifest, the second scrub, opaque staging, the checksummed v2 queue with its verified one-way migration, the shared native export permit with fixed support prepare/submit lifecycle operations, the SQL-bounded AnyHarness support windows with their generated SDK reads, and both modals' unchecked consent epoch, scope control, and **Save a copy…** action all exist. What remains is the legacy export that sits beside the pipeline.

- [ ] The legacy debug-bundle export is untouched by the snapshot work. It is
      no longer on the Desktop bridge and the upload path never calls it, but
      the Tauri command still assembles bounded log tails through the old
      generic scrub rather than the snapshot scrub, so the weaker rules stay
      reachable from the Help menu
      ([commands/diagnostics.rs](../../../apps/desktop/src-tauri/src/commands/diagnostics.rs),
      [bundle.rs](../../../apps/desktop/src-tauri/src/diagnostics/bundle.rs),
      [scrub.rs](../../../apps/desktop/src-tauri/src/diagnostics/scrub.rs)).

## Code map

```text
apps/packages/product-client/src/components/support/**
apps/packages/product-client/src/hooks/support/**
apps/packages/product-client/src/lib/access/{anyharness,browser}/**
apps/packages/product-client/src/lib/domain/support/**
apps/packages/product-client/src/lib/workflows/support/**
apps/packages/product-client/src/host/desktop-bridge.ts

apps/desktop/src/lib/access/tauri/{diagnostics,support,desktop-bridge}.ts
apps/desktop/src-tauri/src/commands/{diagnostics,support,support_snapshot}.rs
apps/desktop/src-tauri/src/diagnostics/**
apps/desktop/src-tauri/src/diagnostics_collector/**

anyharness/crates/anyharness-contract/src/v1/{events,sessions}.rs
anyharness/crates/anyharness-lib/src/api/**
anyharness/crates/anyharness-lib/src/domains/sessions/store/**
anyharness/sdk/src/client/sessions.ts

cloud/sdk/src/client/support.ts
cloud/sdk-react/src/hooks/support.ts

server/proliferate/server/support/**
server/proliferate/db/models/support.py
server/proliferate/db/store/support_reports.py

.github/workflows/_deploy-server.yml
server/infra/main.tf
specs/areas/env-vars.yaml
```

## Proof

Changes to this feature require focused proof for the guarantee they alter:

- modal and bridge tests must prove the exact disclosure is visible while
  unchecked, consent resets on every open, scope binding is exact, and no
  customer-detail source is touched before explicit Send or Save;
- capability tests must prove only the main-window coordinator can consume one
  support permit, support and internal export share one admission slot, and no
  permit or collector connection material crosses the bridge or enters bytes;
- AnyHarness route/store/SDK tests must prove SQL item bounds, response-byte
  bounds before JSON parsing, honest uncertainty, cancellation, active-session
  identity, ascending presentation order, and zero calls without a selected
  bundled-local workspace;
- adversarial Rust fixtures must prove credential, cookie, token, secret-env,
  private-key, signed-URL, provider-key, and opaque-secret canaries never
  survive JSON, ZIP, manifest, status, error, or lifecycle output; positive
  fixtures must prove disclosed non-secret customer evidence remains useful;
- golden manifest and generated cap fixtures must prove exact schema, honest
  gaps/omissions/status, deterministic ordering and degradation, and an exact
  uncompressed package no larger than 26,214,400 bytes;
- owned-file and crash fixtures must prove finite no-follow reads, atomic
  staging, exact size/SHA, partial cleanup, queue hydration before sweep, and
  preservation of every verified queued reference;
- queue tests must prove journal/readback acknowledgement, restart recovery,
  serialized concurrent mutations, byte-identical duplicate handling, conflict
  rejection, and explicit rejection of an eleventh or oversized job without
  evicting existing work;
- upload mocks must prove no-consent zero-diagnostics behavior and byte-identical
  staged retries: verification precedes create, one Blob is held through the
  whole attempt, missing/mismatched artifacts do not call the server, and the
  hosted API/Cloud SDK shapes remain unchanged;
- lifecycle tests must prove one typed terminal per admitted prepare/submit,
  no start before consent, a separate child submit for every retry, and no fake
  submit pair for pre-submit artifact or legacy-consent failures;
- existing Sentry, PostHog, anonymous telemetry, session replay, support API,
  capability, Slack, and cloud-diagnostics-disabled tests must remain green;
- completion tests must cover missing, duplicate, unknown, out-of-prefix,
  size-mismatched, and checksum-mismatched objects;
- Slack success, missing configuration, and provider failure must prove the
  correct `slack_notified_at` state;
- availability tests must cover `vendor`, `operator`, and `none` for every entry
  point;
- a staging smoke must create a real report, inspect safe DB/S3 summaries, and
  visibly confirm the Slack message.

Operator investigation is documented in [`../../../../../guides/debugging/support-reports.md`](../../../guides/debugging/support-reports.md).
