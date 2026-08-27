# Delivery specification — observability slice O-1: every install streams (frozen)

Chain position: slice 1 of the observability build-out (O-1 every install streams → O-2 durable SLIs → O-3 local tail, O-2/O-3 independent after O-1). Evidence of record: the observability system spec rewrite (branch `obs/system-spec`, delta rows 10–13), ruling R-X2 (collector-subset-by-label, lifecycle-only customer export — Cross-ADR Founder Rulings Ledger, 2026-08-20), the 2026-08-21 dogfood proof (real lifecycle records in the `anyharness` dataset), and Pablo's 2026-08-26 ruling: destination baked into the desktop release; self-hosters keep the off switch. Builders implement from this document without re-deriving the architecture.

## Intent

Every install's runtime lifecycle stream reaches Honeycomb — lifecycle-class only, correlated end to end (`session_id`, `install_id`, `user_id` when signed in), with the four product operations complete and time-to-first-output measurable. The dark leg turns on.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

Run a release-built desktop app signed in: create a session, send a prompt, get a reply. Within minutes the Honeycomb `anyharness` dataset (`production` environment) shows `anyharness.session.create`, `anyharness.agent.start`, and `anyharness.turn.execute` started+terminal pairs for that session, each carrying `proliferate.session_id`, `proliferate.install_id`, and `proliferate.user_id`, with `proliferate.argument.duration_ms` and `proliferate.argument.first_output_ms` on the turn terminal, and at least one `anyharness.model.request` pair from the launch probe. Falsifier: any `detailed`-class record or free-text attribute in the `production` environment, any record from a build whose telemetry mode is not hosted-product, or a packaged collector whose `--print-export-policy` is not `lifecycle_only`. Precondition: `HONEYCOMB_INGEST_KEY_PROD` minted as a repo secret — absent, the release bakes nothing and the workflow says so loudly.

## Scope

Spec sections of record: observability README §2 Data (the tuple, the lifecycle catalog rows) · §3 Flow 3 (a lifecycle record leaves the machine) · §4 cell 2 (runtime emitter) and cell 4 (destinations) · honeycomb.md (stages 1–2, the account, local proof).

- **Producer mechanics** (`proliferate-diagnostics-client/src/lifecycle.rs`): `LifecycleOperation` records its begin instant; `terminal(…)` auto-appends `duration_ms` for operations whose `safe_fields` list it; a new learned-argument path appends `first_output_ms` when the sink records first assistant output. `turn.execute` `safe_fields` gains `duration_ms` + `first_output_ms`; other operations unchanged (an addition is a privacy decision — deliberately not made here).
- **Emitters** (`anyharness-lib`): the turn sink stamps first-output elapsed once per turn; `begin_model_request(agent_kind, route)` emitted around the launch probe's real provider request (a probe runs per harness, outside any session — the record correlates on install + operation) (`domains/agents/launch_probe/attempt.rs`), classifications mapped from the probe's existing error taxonomy (`provider_rate_limit`, `provider_model_unavailable`, `provider_model_configuration_unsupported`, `network_connection`, `internal_error`). No new catalog names — launch-selection validity stays encoded in `session.create`/`agent.start` rejection classifications (the frozen 91-name contract does not change).
- **Identity stamps** (collector + desktop host): `--user-id` argument → config → `proliferate.user_id` resource attribute, absent when signed out, mirroring the `--install-id` seam exactly; the Tauri collector supervisor passes it from auth state at spawn and on the existing restart paths. Producer-supplied identity remains refused.
- **Destination** (release + config): `release-desktop.yml` bakes `PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT=https://api.honeycomb.io` + the ingest-key header into the desktop's collector-spawn environment from `HONEYCOMB_INGEST_KEY_PROD` (loud skip when the secret is absent); internal/dogfood builds wire `HONEYCOMB_INGEST_KEY_DOGFOOD` + the `internal-dogfood-export` feature as today; the packaged-collector `lifecycle_only` release gate is untouched and must stay green; export remains gated on hosted-product telemetry mode (the self-host off switch).
- **Verification pin, not build**: a test asserting `session_id` rides every lifecycle phase where the id exists at emit time (turn/agent-start started records; session.create terminal via `learn_session_id`) — already true in code, pinned so it stays true.

## Non-goals (deliberately out)

Stage 3 (server-served destination / org-wide kill switch — post-launch build item; until then the kill switches are key revocation and `PROLIFERATE_DIAGNOSTICS_EXPORT_DISABLED=1`) · SLI triggers (O-2) · the tail verb and link scheme (O-3) · new catalog operations of any kind · cloud-sandbox export (seam deferral) · server-side lifecycle producers.

## Proof

- Producer tests: `duration_ms` auto-appended on terminal for listed ops and absent for unlisted; `first_output_ms` appended once and only when learned; an argument outside `safe_fields` still drops.
- Probe emitter test: a stubbed probe failure maps each taxonomy branch to its classification; success emits `succeeded`.
- Collector stamp test: `--user-id` crosses the process seam to the resource attribute (mirror of `an_install_id_crosses_the_process_seam_to_the_real_collector`); absent when unset.
- Release workflow: dry-run asserts the spawn env carries the endpoint/header exactly when the secret exists; the `lifecycle_only` assertion stays.
- Phase-coverage pin: the session_id-on-every-phase test above.
- Live half, recorded in the PR: the honeycomb.md §Local proof procedure against dogfood — the same check Pablo repeats against production at the gate.

## Discharges

Observability README delta rows 10 (`model.request` emitter), 11 (`duration_ms`/`first_output_ms`), 12 (`--user-id` stamp), 13 (baked destination); honeycomb.md stages 1–2.
