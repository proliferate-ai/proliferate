# Support loop

Status: authoritative operator procedure for the
[customer loop](../../specs/codebase/systems/engineering/customer-loop/README.md).
The contract lives in that spec; this page is the step-by-step.

```text
receipt → issue → read the bundle → find the owning spec → fix + pinning test → notify → close
```

Applies to the hosted deployment. Self-managed deployments that set
`SUPPORT_SLACK_WEBHOOK_URL` get the same receipt and can run the same loop
against their own tracker.

## Required tools and permissions

- Slack access to the support receipt channel.
- `gh` authenticated against `proliferate-ai/proliferate` with issue write.
- For step 3 only: the private-bundle read permissions described in
  [`../debugging/support-reports.md`](../debugging/support-reports.md).
- Sentry access for the relevant projects.

## Procedure

1. **Receipt.** Every completed report posts one Slack receipt. It carries
   the report id, kind, urgent/notify flags, `Release`, `Sessions`, `Sentry`
   pairs, a `Sentry query`, and a `File issue` link. If any of those is
   missing, the source was missing on the report (fields are absent, never
   blank) — see failure modes below.
2. **Issue.** Click `File issue`. It opens a prefilled
   `support_report.yml` issue carrying the label `support:report`. Fill in
   the owning-system dropdown once you know it; leave the summary redacted.
   A report is *triaged* only once this issue exists (or the receipt thread
   records a deliberate decline). Duplicate of an open issue → comment the
   report id on the existing issue and close the new one as duplicate.
3. **Read the bundle.** Follow
   [`../debugging/support-reports.md`](../debugging/support-reports.md).
   Paste pointers (ids, links) into the issue; never content.
4. **Find the owning spec.** Locate the broken law under
   `specs/codebase/systems/`. Set the issue's `area:*` label to the owner,
   not the surface the reporter saw.
5. **Fix + pinning test.** The fix PR body's "Support and attribution" line
   reads `Closes #<N> · pinning test: <path>`. The test's name or docstring
   carries the issue number (`…_regression_issue_<N>` or `# proof: #<N>`).
6. **Notify.** If the receipt said `Notify requested: Yes`, email the
   reporter at `outreach_email ?? account_email` after the fix ships, and
   comment `notified <date>` on the issue. No automated outreach exists;
   the product never claims it notified anyone.
7. **Close.** Close the issue only after step 6 (or when notify was not
   requested).

## Verification

- `gh issue list --label support:report --state open` is the triage queue.
- A closed `support:report` issue has a linked merged PR and, when notify
  was requested, a `notified <date>` comment.
- Weekly: counts of captured (Slack receipts) / triaged (issues opened) /
  fixed (closed with PR) / notified.

## Failure modes

| Symptom | First response |
| --- | --- |
| Receipt has no `Release` | Client did not send `clientReleaseId` (`support_report_require_client_release` is off). Recover the version from `diagnostics.json` in the bundle. |
| Receipt has no `Sessions` | Reporter did not bind a session (report from Settings/sidebar, not a chat). Use the `Sentry query` and the request id instead. |
| No receipt at all | `SUPPORT_SLACK_WEBHOOK_URL` unset or Slack delivery failed — both log at ERROR to Sentry with `support_report_id`. The report is still durable; find it by id. |
| `File issue` link opens an empty form | Template renamed or field ids changed; the link is built in `server/proliferate/server/support/domain/message.py` and must match `.github/ISSUE_TEMPLATE/support_report.yml`. |

## Secrets policy

Shared rules from [`README.md`](README.md) apply. Additionally: an issue is
public to everyone with repo access — report ids, session ids, and Sentry
event ids are allowed; report text, diagnostics, attachments, S3 keys, and
presigned URLs are not.
