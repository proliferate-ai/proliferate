# PR-E5 — Tracker Cull (C7)

Status: draft for founder approval → freeze as `delivery/engineering-cull/delivery-spec-tracker-cull.md`.
The largest and most careful PR in the ladder: touches a server domain + config. Full current-law discipline: fresh-context review, integration tests re-proven. Ruled by Pablo 2026-08-25 ([[Cull and Rulings Queue]] C7); support's redesign is a step-3 spec — this PR only removes the tracker and the support verticals whose sole consumer it is.

## Intent

Delete the issue-tracker loop end to end: the client tooling, the Grafana→tracker delivery, the support→tracker projection and feed, the lifecycle docs, and the PR-template linkage. Support's **capture path survives untouched** (modals, durable client queue, report routes, S3 custody, redaction, Slack receipt).

## Scope — deleted

### Tracker tooling
- `scripts/issues.py`, `scripts/test_issues.py`

### Grafana → tracker delivery
- `server/infra/observability/grafana/issue-tracker-contact.json`
- The tracker contact-point slice of `scripts/ops/grafana-alerting.mjs` (+ its test coverage): the create/restore/verify logic around `CONTACT_REL`, `WEBHOOK_SECRET_REF` (`issue-tracker/app.grafanaWebhookSecret`), and the "url is the tracker ingest url" assertions. **The five alert rules and their SNS/Slack delivery are untouched** — only the tracker receiver dies. Alerts continue to Slack.

### Support → tracker verticals (sole consumer is the tracker)
- `server/proliferate/server/support/domain/tracker_intent.py` (single import site: `support/service.py:36` — remove the projection calls and any fields that exist only to feed it)
- `server/proliferate/server/support/feed/**` (api, service, models, access, errors, domain/cursor) and its router mount
- Feed store surface in `server/proliferate/db/store/support_reports.py` (`SupportFeedReportRow` + feed queries); table columns stay (data is inert, no destructive migration this week)
- Config: `support_feed_bearer_token` (`config.py:329`) + its row in the supported-env-var catalog
- Tests: `server/tests/integration/test_support_feed.py`, `test_support_feed_deploy_render.py`; feed/tracker references inside `test_e2b_deploy_render.py` trimmed (file survives)

### Docs
- `specs/codebase/systems/engineering/issue-lifecycle/` (README.md, support-loop.md) — whole tree
- `guides/debugging/issue-triage.md` — whole file (it is the tracker's runbook)
- `guides/debugging/support-reports.md` — the "Quick access from a tracker issue" section; the capture/S3 runbook survives
- `guides/operating/production-alerts.md` — tracker-ingestion references
- `.github/pull_request_template.md` — the "Support and attribution" tracker-linkage block
- Same-PR tombstones: AGENTS.md router row for issue-lifecycle; `Engineering Broadly` (vault) issue-loop references are Pablo's to edit, flagged not blocked

## Scope — kept (explicitly)

`support/` capture path: `api.py` routes, `service.py` (minus tracker projection), `upload_lifecycle.py`, `storage.py`, `redaction.py`, `notifications.py` (Slack receipt), `report_records.py`, all three DB models, client modals + durable queue + desktop bridge · `support_report_internal_base_url` (admin link in the Slack receipt — the admin surface lives outside this repo) · `provisioning_observability.py`, `event_logging.py` (unrelated).

## Outside the repo (founder/ops follow-ups, not PR gates)

1. Decommission the deployed `issues.proliferate.com` service (separate deployment) and its Sentry ingestion hooks on the tracker side.
2. Delete the `issue-tracker/app.grafanaWebhookSecret` secret from the secret store.
3. Grafana live state: run the alerting script's restore path (or manual) to drop the tracker contact point from both workspaces — checked-in JSON deletion alone does not mutate the live workspace.

## Acceptance

- Grep-gates → 0 (excluding tombstones): `issues.proliferate.com` · `tracker_intent` · `support_feed` · `SupportFeed` · `issue-tracker` under `scripts/` and `server/infra/` · `scripts/issues`
- Support capture proof: the report-creation integration tests green; one manual end-to-end report (modal → S3 objects present → Slack receipt) recorded in the PR.
- Grafana rule integrity: `grafana-alerting.mjs` self-test green; the five-rule + SLI checksums unchanged.
- `check_docs.py` green; PR template renders without the removed block.
- Fresh-context review completed (noted in PR description).

## Revert

Plain revert restores code and docs. Live Grafana contact point and the external service are runbook items either way — revert does not resurrect them, which is acceptable: alerts deliver via SNS/Slack regardless.


---

## Implementation notes (recorded at implementation, 2026-08-25)

1. **Deploy/terraform plumbing (scope extension, raised not silent):** the
   spec's deleted list did not name `.github/workflows/_deploy-server.yml` or
   `server/infra/main.tf`, but the `SUPPORT_FEED_*` secret plumbing and the
   entire `SUPPORT_TRACKER_*`/`SUPPORT_GITHUB_*`/`SUPPORT_LINEAR_*` env,
   secret, variable, and IAM surface feed nothing in server code (no config
   keys read them; the reconciler they were built for never shipped). Under
   the deletion-completeness law — and because the spec's own `support_feed`
   grep-gate cannot reach 0 otherwise — that plumbing was deleted with the
   loop. The task-definition render now actively STRIPS inherited retired
   entries and its fail-closed assert REJECTS them, so old task revisions
   cannot resurrect them by inheritance.
2. **`tracker_intent.py`:** deleted as a module; its three pure functions
   (`parse_client_release_id`, `normalize_telemetry_refs`,
   `build_tracker_summary`) are capture-owned (stored on the report row,
   enforced at completion, asserted by the surviving capture integration
   tests) and moved verbatim to `domain/report_intent.py`. The
   `tracker_summary` column keeps being written — columns stay, and the
   surviving capture test pins its redaction guarantee.
3. **Grafana restore path:** with the contact-point tooling deleted, the
   script can no longer remove a live tracker receiver; ops follow-up 3 is
   manual (Grafana UI / Alertmanager config API), as the runbook's
   "Retired" section now states.
4. **Fourth ops follow-up:** `terraform apply` for `server/infra/main.tf`
   (removes the tracker variables and the `support-tracker-secret-parameters`
   IAM policy from live state). **Fifth:** delete the lingering SSM
   parameters the old deploy wrote if they exist
   (`/proliferate/<env>/support/github-app-private-key`,
   `/proliferate/<env>/support/linear-api-key`).
5. **Checker edit (founder review):** `scripts/check_docs.py`
   `REQUIRED_READMES` row for the deleted `issue-lifecycle/README.md` removed
   in the same PR; `lints/server/ratchets.toml` config.py ratchet shrunk
   627→623 (the checker itself flags stale entries).
