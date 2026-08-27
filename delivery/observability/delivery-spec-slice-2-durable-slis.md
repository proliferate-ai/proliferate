# Delivery specification — observability slice O-2: SLIs that break durably (frozen)

Chain position: slice 2 of the observability build-out; requires O-1's stream (the triggers evaluate what O-1 ships) but merges independently — triggers over an empty dataset are dark, not wrong. Evidence of record: the observability system spec rewrite (branch `obs/system-spec`, delta row 14, §3 Flow 4), honeycomb.md §The five SLIs, Pablo's 2026-08-26 rulings (five SLIs including orphan rate; Honeycomb triggers as the evaluation path; Enterprise only if triggers fail the live check), and the collector's own finalization mechanic: `state/lifecycle.rs` synthesizes an `abandoned` terminal with `finalizer: Collector` for any operation whose producer dies — every `started` provably gets exactly one terminal, so orphan rate is a one-query trigger on abandoned outcomes, no join required.

## Intent

The five SLIs exist as checked-in intent, are applied and verified by tooling on the monitor lane, are evaluated durably by Honeycomb's own trigger engine, and fire into the alerting path — so an SLI breaking is something that *happens to you in Slack*, not something you discover by remembering to look.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

Open the Honeycomb `anyharness` dataset's Triggers page: the five triggers exist and `node scripts/ops/honeycomb-triggers.mjs verify` prints a green receipt matching the repo JSON. Breach one synthetically (the tool's `--synthetic-breach` sends bounded failed-terminal records to the dogfood dataset): the trigger fires and a message arrives in the ruled Slack channel; when the condition clears, it resolves. Falsifier: a trigger fires with no Slack delivery, `verify` reports drift the nightly lane does not surface, or trigger creation turns out to be plan-gated (that falsifies the evaluation-path ruling itself — stop and report, the Enterprise fork reopens). Precondition: `HONEYCOMB_CONFIG_KEY` minted; until then everything lands dark with `check` green offline.

## Scope

Spec sections of record: observability README §3 Flow 4 (an SLI breaks durably) · §4 cell 4 (destinations invariants: intent, receipts, drift) · honeycomb.md §The five SLIs + §The account.

- **Trigger intent** — `server/infra/observability/honeycomb/triggers/*.json`, one file per SLI: session-create success (`session.create` terminals, `outcome=failed` rate — `rejected` deliberately excluded from paging), agent-start success, time-to-first-output (`argument.first_output_ms` threshold on turn terminals), launch-selection validity (rejection-classification rate over `session.create`+`agent.start`), orphan rate (`outcome=abandoned` or `finalizer=collector` rate). Each file: query, threshold, evaluation frequency, recipient (the ruled Slack destination), disabled:false, and a checksum row. `product-sli-queries.json` is deleted in the same PR (superseded artifact; deletion-completeness).
- **Tooling** — `scripts/ops/honeycomb-triggers.mjs` with `check | apply | verify | --synthetic-breach`, mirroring the grafana operator-tool conventions: offline `check` (schema, checksums, closed recipient list), live verbs gated on `HONEYCOMB_CONFIG_KEY` + an explicit live flag, every console line redaction-safe, receipts written like the Grafana ones. Tests beside it like `grafana-*.test.mjs`.
- **Lane wiring** — the existing monitor lane (`grafana-monitors.yml`, PR #2263) grows a honeycomb job with the same trilogy: `check` on PR, apply+verify+receipt on merge, nightly drift; loud skip until the key exists.
- **Threshold values** land as the alerting spec's rows (this slice carries starting values marked as such; re-tuning is an alerting-spec edit, not a code change).

## Non-goals (deliberately out)

Honeycomb Enterprise / the SLO product (reopens only if the trigger path falsifies) · Grafana-computed burn rates · dashboards and boards curation · new emitters (O-1's) · any aggregation queue.

## Proof

- Tool tests: schema/checksum rejection, recipient allowlist, redaction of every console line, verify-mismatch detection, synthetic-breach payload boundedness (lifecycle-class, closed fields, dogfood-only).
- Intent tests: the five JSON files parse, checksum, and name only exported attributes (`proliferate.*` names cross-checked against the OTLP encoder's attribute list).
- Lane test: workflow YAML asserts the loud-skip path when the secret is absent.
- Live half, recorded in the PR when the key exists: apply receipt, verify receipt, one synthetic breach → Slack screenshot-by-link, one resolution.

## Discharges

Observability README delta row 14; honeycomb.md §The five SLIs; retires the parked `product-sli-queries.json`.
