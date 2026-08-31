# Grafana + logging

Status: current for the record shape, the signal path, and the checked-in intent files; the lane and the runtime homes land with the PRs named in the delta table. Grade B.

Read before touching: [README.md](README.md) (the observability system this capability belongs to — the canonical metadata tuple lives there), [alerting.md](alerting.md) (owns thresholds, severity, routing, runbooks — this document never restates them), `server/proliferate/middleware/logging.py`, `server/infra/observability/grafana/`, `scripts/ops/grafana-rebuild-bootstrap.mjs`, `.github/workflows/grafana-monitors.yml`.

## Contract

Grafana is the **monitor surface**: it evaluates rules over what CloudWatch logs and metrics contain and hands firings to destinations. It decides whether a condition holds, never what deserves an alert — thresholds, severities, and routing belong to [alerting](alerting.md). It is **intent-driven**: the repo JSON under `server/infra/observability/grafana/` is the truth, the live workspace is a projection of it, and a checked-in file is never evidence the projection happened — receipts are.

The logging half feeds it. **A production log record is one JSON line carrying the canonical correlation tuple; machines read JSON, people read text; markers — not levels, not prose — are the only contract between logging and alerting.**

## The record

One line, one event. In production every process emits JSON: `timestamp`, `level`, `logger`, `message`, `release_id`, the correlation tuple fields that are bound (README §canonical metadata), and bounded scalar extras. The server does this in `middleware/logging.py` (`JsonLogFormatter`; plain text only under `debug=true`). The runtime processes (anyharness, worker, supervisor) make one format decision per process: an explicit `PROLIFERATE_LOG_FORMAT` (`json` | `text`) wins; otherwise a non-`local` `PROLIFERATE_RUNTIME_ENV` — a cloud machine, where the reader is a log pipeline — selects JSON, and local stays human text.

**Markers, not levels.** An alert-worthy condition emits a named marker with a closed vocabulary (`CRITICAL_FAILURE`, `auth.sign_in.outcome`, the `background_relay` fields), and thresholds live in code, emitting one bounded record when breached. Rules select markers; no rule greps prose, and no rule computes a business threshold (a rule that encodes a threshold is invisible to tests).

**Fire and resolve.** Every rule has a firing condition and a clear condition; an alert that cannot resolve itself is a stuck alert and a bug in the rule.

**Levels, ruled once.** INFO is lifecycle narrative a person skims; WARN is degraded-but-serving; ERROR is a promise broken. The asymmetry between the planes is law, not accident: server ERRORs do not become Sentry events through logging — exceptions propagate to Sentry themselves and logs stay logs — while runtime `error!` forwards through the Sentry layer, because no exception mechanism crosses the process edge.

## The homes

Every process writes to one known place, so one tail can interleave a session's whole story:

```text
server (prod)        stdout → awslogs → /ecs/proliferate-prod (streams server·worker·beat), 30-day retention everywhere
server (local)       stdout, plain text (debug=true)
anyharness           <runtime_home>/logs/anyharness.log (suppressed when the bundled diagnostics producer holds authority)
worker               ~/.proliferate/worker/logs/worker.log        (10 MiB × 5, non-blocking)
supervisor           ~/.proliferate/supervisor/logs/supervisor.log (same bounds)
collector            the machine-legible copy: bounded records, query/tail API, support snapshots
```

## One evaluation engine

Grafana over the CloudWatch datasource is the only alert-evaluation engine. There are **zero CloudWatch alarms** (the parallel background alarm/filter family was checked-in-only config and was deleted; the three actionless console-orphan RDS alarms were deleted live). Exactly one metric filter survives, relabeled for what it is: `RelayHeartbeat` is the server deploy workflow's **deploy-gate sensor** — `_deploy-server.yml` reads it to prove a fresh relay tick before rolling the API — and no alarm may consume it. The one sanctioned exception to come is a single **dead-man's-switch outside Grafana** (who watches the watcher); its shape and destination are queued to [alerting](alerting.md), and background-plane monitors (worker/Beat running, broker reachability, queue depth) return as Grafana rules through that spec if the plane is ever enabled.

## The lane

Monitors are code. The whole loop (`.github/workflows/grafana-monitors.yml`):

```text
a PR edits rule/dashboard JSON or the operator tooling
  → PR CI runs the three offline checks (rebuild overlay · SLI overlay · old-workspace overlay) + the operator-tool tests
  → review is the taste gate
  → merge to main → apply + verify against the canonical workspace → the bounded read-back lands in the job summary as the receipt
  → nightly 09:17 UTC: live-vs-intent verify → red = drift
```

Apply is idempotent and refuses to overwrite drift silently (`grafana-rebuild-bootstrap.mjs`: creates what is missing, fails loudly on divergence). The live jobs are gated on the `GRAFANA_ADMIN_TOKEN` repo secret plus `GRAFANA_ALERTING_LIVE=1` and skip loudly when the secret is absent.

**The drift law.** UI edits are allowed — exploring in Grafana at 1am is healthy — but the repo is canonical. The nightly check going red means one of two fixes, chosen by a person: commit the live change back into the intent files, or let the apply lane revert it. Silent divergence is never a standing state.

**The workspace.** The canonical workspace is `proliferate-ops-rebuild` (`g-48655e6419`): it holds the five production rules, the sign-in SLI rule, the one dashboard, and the SNS + Slack contact wiring. The old workspace `proliferate-ops` (`g-e532d030d8`) is the rollback until a one-week burn-in passes with Slack delivery re-verified on the rebuild; it is then retired **with its JSON and its hard-pinned tooling in the same PR** (deletion-completeness).

## Banned

- `print` / `console.log` / `eprintln!` as a logging mechanism outside the formatter bootstrap paths.
- A rule that greps free text, or that computes a business threshold instead of selecting a marker.
- Secrets, request/response bodies, file contents, or prompts in any log line — the scrubbing law ([sentry.md](sentry.md)) applies to every sink.
- A log line as a success condition for a product request: every sink is best-effort and no-ops when unconfigured.
- A new CloudWatch alarm or metric filter (the deploy-gate sensor is the bounded exception; a second one needs this file amended).

## How you check it

The dashboard (`production-overview-dashboard.json`, uid in file) is the one overview. Rule state lives in the canonical workspace's alerting page. A session's log lines: CloudWatch Logs Insights over `/ecs/proliferate-prod` with `filter session_id = "<id>"` (the link scheme in README builds this from one id). Locally: the per-process files in the homes above until the one-tail command lands.

## Delta vs prod

| Spec says | Prod today | The change |
| --- | --- | --- |
| Apply + verify + receipt run on merge; drift checked nightly | apply is a human at a terminal; nothing diffs live vs intent | #2263 (`grafana-monitors.yml`) — armed once `GRAFANA_ADMIN_TOKEN` is re-minted (the Aug-22 wipe took the local tokens) |
| Zero CloudWatch alarms; one deploy-gate sensor filter | done live 2026-08-26 (3 RDS orphans deleted; background family was never provisioned); terraform matched in #2262 | #2262 merged closes the row |
| Worker + supervisor write to known log homes; runtime JSON in cloud mode | worker/supervisor were console-only; all runtime logs were text | #2264 |
| One canonical workspace | two workspaces carry the same five rules | burn-in, then the retirement PR (queued in the build list) |
| 30-day retention on every server log group | `/ecs/proliferate-staging` and `/ecs/proliferate-server` never expired | done live 2026-08-26 (recorded in #2262) |

## Build list

- [ ] Re-mint the rebuild workspace service-account token → repo secret `GRAFANA_ADMIN_TOKEN` + the 0600 local file (key custody per README) — arms #2263's apply and drift jobs.
- [ ] Burn-in week on the rebuild workspace with Slack delivery re-verified, then the retirement PR: old workspace rules deleted live, `production-alerts.json` + `grafana-alerting.mjs`'s hard pin removed, this file's workspace paragraph updated.
- [ ] The local one-tail command (interleave the homes, `--session <id>`) — design rides the operating-model block.
- [ ] Dead-man's-switch shape + destination — [alerting](alerting.md).
- [ ] `/ecs/proliferate-{server,gateway,web}` log groups: still referenced by ACTIVE task-definition families; delete the families' registrations or re-point them, then the groups (held in #2262).
