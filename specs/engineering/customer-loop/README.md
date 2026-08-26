# Customer Loop

Status: target. The capture half describes `main`; everything after the Slack receipt is the build. Grade C — see [Known gaps](#known-gaps).

Read before touching: [product support](../../systems/support/README.md) (the capture system this loop consumes — never re-spec it here), [observability](../observability/README.md), [`guides/debugging/support-reports.md`](../../../guides/debugging/support-reports.md), `server/proliferate/server/support/domain/message.py`, `server/proliferate/server/support/notifications.py`.

## 1. Purpose

The customer loop is the engineering system that turns a customer-reported problem into a shipped, proven fix and closes the loop with the person who reported it:

```text
report → triage → fix → test → notify-the-reporter
```

It is cross-cutting: it owns no product state and no product surface. The product `support` system ends at durable capture plus a Slack receipt; this system starts at that receipt. It rides two sibling engineering systems rather than duplicating them — the alerting/fix loop (a support report is one more signal on the same triage board as a Sentry alert) and the testing convention *any issue found → a test case for it*.

The property that governs every design choice below is **legibility keyed by session id**: a report must land in the same one-story-per-session view (runtime replay, Sentry, Honeycomb) that an engineer or a triage agent already reads for a failing run. A report that cannot be joined to its session is a message, not evidence.

The 2026-08 cull retired the prior issue tracker (`issues.proliferate.com`, `scripts/issues.py`, the support feed, the Grafana receiver). Nothing in this spec resurrects it. GitHub Issues in this repository is the interim intake; the parked `proliferate-ai/support-ops` repo is a reference prototype only, never a dependency.

## 2. Owned state

None inside the product. Deliberately:

- The report itself (`support_report` row, private S3 bundle, queue) is
  owned by [product support](../../systems/support/README.md).
- Triage state (open / duplicate / fixed / notified) lives in the interim
  intake — a GitHub issue carrying the label `support:report` — not in a
  product table. A GitHub issue is the loop's unit of work; its number is
  the loop's id.
- The fix's proof lives with the owning system as a pinning test (§9 and
  the testing spec), not with this loop.

The only artifact this system writes is documentation and glue: the issue template, the receipt field plan it asks support to emit, and the triage runbook.

> [!decision] PABLO DECIDES: where triage state lives past the interim.
> Options: (a) GitHub Issues stays the intake indefinitely — one place for
> customer reports, Sentry-derived issues, and tier-3 release failures
> (`tests/release/src/report/issue-filer.ts` already files there);
> (b) Linear via the integration gateway once grants exist; (c) a rebuilt
> internal tracker. Recommendation: (a) for at least the launch window —
> zero platform code, agents can read and write it through `gh`, and the
> demo agent's "read alerts + replays, open a PR" loop already speaks
> GitHub. Revisit only if the issue volume outgrows labels.

## 3. Public surface

There is no API. The loop's surface is three human/agent-facing contracts:

- **The receipt** — the Slack completion receipt support emits
  (`build_support_report_plan`). This spec fixes the *minimum field set* it
  must carry for the loop to be one step from triage (§5, law 2). The code
  stays in support; the field list is a consumed contract recorded here.
- **The intake** — `.github/ISSUE_TEMPLATE/support_report.yml` plus the
  `support:report` label. A report becomes an issue through a prefilled
  `issues/new?template=support_report.yml&…` link on the receipt; the body
  holds privacy-safe metadata only (§5, law 3).
- **The closeout** — the PR that fixes a support issue references it
  (`Closes #N`), names the pinning test it added, and the merge is the
  trigger for reporter notification (§5, law 5).

Operators read `guides/operating/support-loop.md` (※ new, lands with the minimum-tonight PR) for the step-by-step; this document is the contract.

## 4. Consumes

- **Product support** — `support_report` capture facts and projections:
  `client_release_id`, `tracker_summary` (the 240-char redacted summary),
  `telemetry_refs_json` (`sentryEvents[{project,eventId}]`,
  `posthogSessionId`), `workspace_refs` session-id claims, server-derived
  correlation (`primaryTenantId`, `ownerUserId`, cloud workspace/target
  ids, `requestId`), `notify_me`, and the `outreach_email ?? account_email`
  contact rule. Support's Emits section is the authority on these.
- **Observability** — Sentry events tagged `support_report_id` and
  `request_id` (server), the per-component Sentry projects, and (target)
  the session-id tag and Honeycomb session view the observability spec
  defines. This loop never sets tags itself.
- **Alerting / fix loop** — the triage board and the demo agent's
  fix-from-signal path; a `support:report` issue is one signal type on it.
- **Testing** — the tier definitions and the "issue → test" naming rule;
  this loop only requires that the rule be followed at closeout.
- **GitHub** (vendor leaf) — Issues in `proliferate-ai/proliferate`; the
  `gh` CLI for operators and agents. No server-side GitHub credential is
  used by this loop (the `SUPPORT_GITHUB_*`/`SUPPORT_LINEAR_*` plumbing died
  with the tracker and does not come back).
- **Slack** (capability `notifications`) — the receipt channel only. Slack
  is a projection, never the queue.

## 5. Laws

1. **Capture is not the loop.** A completed report with a Slack receipt is
   a *captured* report. It is *triaged* only when a `support:report` issue
   exists for it (or it was deliberately declined on the receipt thread),
   *fixed* only when a PR closing that issue merged with its pinning test,
   and *closed* only when the reporter was told (or `notify_me` was false).
   Each state has one observable artifact; no state is inferred.
2. **One step from receipt to triage.** The receipt must carry, in safe
   form, everything triage needs to open the session story without a
   database query: report id, kind, urgency, client release id, the
   session ids the reporter bound, Sentry project/event pairs, the
   copy-pasteable Sentry query `support_report_id:<id>`, and a prefilled
   file-an-issue link. What it must never carry is unchanged from support's
   rules: no S3 keys, presigned URLs, bodies, prompts, tool output, or
   secrets.
3. **Issues carry pointers, never content.** A `support:report` issue body
   contains ids and links (report id, release id, session ids, Sentry
   query, PostHog session id) and the redacted `tracker_summary` at most.
   The private bundle is read through the runbook by an authorized human
   or agent; it is never pasted into a public issue.
4. **Session id is the join key.** Every artifact in the loop — receipt,
   issue, Sentry search, replay link, fix PR — names the session id(s)
   when the reporter bound one. Where the product cannot yet join (Sentry
   events lack a session tag; Honeycomb has no session view) the gap is
   listed in the observability spec, not papered over here.
5. **Every fix ships with its test, and the test names its origin.** A PR
   that closes a `support:report` issue adds or extends a pinning test in
   the owning system whose name or docstring carries the issue number
   (`…_regression_issue_<N>` or `# proof: #<N>`); the PR body's
   "Support and attribution" line names the test path. The testing spec
   owns the tier and location; this law only makes the origin greppable.
6. **Bugs are filed against the owning spec, not the discovering
   surface.** (Organization Standard.) The issue's `area:*` label and the
   fix PR's spec link point at the system that owns the broken law, even
   when the reporter saw it in the chat surface.
7. **Notification is a human decision until an approval queue exists.**
   `notify_me` is capture intent. The interim closeout is a manual email
   to `outreach_email ?? account_email`, recorded as a comment on the
   issue before it is closed. The product never claims it notified anyone
   automatically.
8. **Nothing in this loop may block capture.** Receipt enrichment, link
   building, and label logic run after the report is durable and inside
   the existing best-effort receipt call; any failure logs at ERROR to
   Sentry and leaves `slack_notified_at` null, exactly as today.

## 6. Emits

- The `support:report` GitHub issue (opened by a human or agent from the
  receipt link), consumed by the alerting/fix loop's triage board and by
  the demo triage agent.
- The closeout comment on that issue (fix PR link, pinning test path,
  reporter-notified timestamp), consumed by whoever audits "did we tell
  them".
- Weekly counts derived from the label — captured / triaged / fixed /
  notified — consumed by the founder's weekly note. No dashboard.

## 7. Fences

- **Product support** owns capture, consent, the queue, S3 custody,
  redaction, the receipt code, and the report row. This loop asks for
  receipt fields through support's spec (a bucket-2 spec-gap change on
  support's Emits), never by editing support's laws.
- **Observability** owns Sentry tags, releases, environments, fingerprints,
  and the session-id correlation contract. This loop links; it never tags.
- **Alerting / fix loop** owns the triage board, severity, and the agent
  that fixes from signals. A support issue is an input to it.
- **Testing** owns tiers, placement, and naming; this loop only requires
  the origin marker.
- **GitHub product system** (`specs/systems/github`) owns
  the GitHub App, installations, and PR authorship for agent runs. The
  loop's use of Issues is operator/agent `gh` usage, outside that system.
- **Not this system:** `instance_support_email/url` (self-managed operator
  routing — a product support availability concern); model-capability
  "support" stores in chat; the retired tracker and everything named
  `tracker_*` except the `tracker_summary` column support still writes.

## 8. Code map

```text
.github/ISSUE_TEMPLATE/support_report.yml           the intake (※ new)
guides/operating/support-loop.md                    the triage runbook (※ new)
guides/debugging/support-reports.md                 how to read a private bundle (existing; owned by support)
server/proliferate/server/support/domain/message.py the receipt field plan (owned by support; this spec fixes the field set)
.github/pull_request_template.md                    the closeout line ("Support and attribution")
```

Everything else this loop touches belongs to a fence above.

## 9. Proof

- `server/tests/unit/test_support_message_plan.py` (※ new with the
  receipt change) — the receipt carries session ids, Sentry pairs, the
  Sentry query string, the release id, and the file-issue link when
  present; never S3 keys, presigned URLs, or the report body; every field
  is absent, not blank, when its source is missing.
- `scripts/test_check_docs.py` — the runbook and this README are in the
  required-docs set; links resolve.
- The issue template renders with the fields in §3 and applies
  `support:report` (`gh api` smoke in the runbook, not CI).
- Grep gate: no surviving reference to `issues.proliferate.com`, `/tracker`,
  or `support_feed` outside tombstone prose.
- The staging smoke support already requires (create a real report, confirm
  the Slack message) is extended by one click: the receipt's file-issue
  link opens a correctly prefilled issue.

## Minimum tonight

The smallest set that lets Pablo triage what is actually broken tomorrow morning, each a separate small PR, none touching `server/proliferate/server/cloud/`:

1. **Receipt enrichment** — extend `build_support_report_plan` with:
   `Release` (`client_release_id`), `Sessions` (bound session ids, first 5),
   `Sentry` (project:eventId pairs, first 5), `Sentry query`
   (`support_report_id:<id>`), and `File issue` (the prefilled template
   URL). Amend product support's Emits line in the same PR. Unit test per
   §9. No new configuration.
2. **Intake template** — `.github/ISSUE_TEMPLATE/support_report.yml` with
   fields `report_id`, `release`, `sessions`, `sentry_query`, `summary`
   (redacted), `kind`, `urgent`, labelled `support:report` +
   `release:fix`. Create the `support:report` label.
3. **Runbook** — `guides/operating/support-loop.md`: receipt → issue →
   read the bundle (link to the debugging guide) → find the owning spec →
   fix + pinning test → notify → close. One page.
4. **PR template line** — the "Support and attribution" block returns in
   loop form: `Closes #N · pinning test: <path>` (E5 removed the tracker
   version).

Explicitly not tonight: reporter email automation, a server-side GitHub credential, any new table or endpoint, Sentry session tagging (observability spec owns it), dashboards.

## Target

- Sentry events across every component carry the session id tag the
  observability spec defines; the receipt's Sentry link becomes a
  session-scoped search, and Honeycomb's session view is the third link.
- The demo triage agent reads `support:report` issues alongside Sentry
  alerts and session replays, proposes a fix PR with the pinning test, and
  comments on the issue — the same agent, one more signal type.
- Reporter notification through an approval queue (Customer.io
  transactional, per the parked support-ops design) fired by the fix PR
  merge; `notify_me` becomes a real promise.
- Weekly loop numbers (captured / triaged / fixed / notified, median
  report-to-fix) from the label, printed into the weekly note.

> [!decision] PABLO DECIDES: reporter notification channel.
> Options: (a) Customer.io transactional send behind an approval queue
> (the support-ops design; needs a provider integration);
> (b) plain email from the server via the existing `email` capability;
> (c) manual only, indefinitely. Recommendation: (c) tonight → (a) when
> the fix loop is agent-driven, because an agent closing issues must not
> be able to email customers without a human gate.

> [!decision] PABLO DECIDES: who triages the `support:report` label daily.
> Recommendation: the demo triage agent on a schedule, with Pablo as the
> approver on every outbound action, until launch week ends.

## Known gaps

- [ ] Receipt lacks release id, session ids, Sentry pairs, and any link
      beyond the optional internal admin URL (minimum tonight, item 1).
- [ ] No intake template or label; reports are triaged from Slack memory
      (item 2).
- [ ] No runbook for the loop; the debugging guide covers bundle reading
      only (item 3).
- [ ] `support_report_require_client_release` defaults off, so
      `client_release_id` may be null on real reports; the receipt shows
      the field as absent and the runbook says how to recover the release
      from the bundle.
- [ ] Sentry events do not carry a session id; joining a report to Sentry
      goes through `support_report_id`/`request_id` only (observability
      spec gap, referenced not owned).
- [ ] No automated reporter notification (law 7 interim).
