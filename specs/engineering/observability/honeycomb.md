# Honeycomb

The attempt-and-SLI surface. Part of [observability](README.md); this file is the capability detail for the diagnostics plane's export valve and what sits on top of it. Thresholds and routing for anything that fires remain [alerting](alerting.md)'s.

## What Honeycomb is for us

Honeycomb answers exactly two questions: **what happened in this attempt** (the lifecycle-record trace of one session's operations) and **are the promises holding** (the five SLIs). It is fed by exactly one pipe — the diagnostics collector's lifecycle-class OTLP export — and by nothing else: no OTel SDK is depended on by our code, deliberately (the only OTel package in the tree is an unused transitive `opentelemetry-api` pulled in by pyqwest); the hand-rolled encoder in `proliferate-diagnostics-collector/src/export/otlp.rs` is the entire client surface, and the compile-time export policy is the privacy ceiling no configuration can widen.

## One system, two read paths

The collector is **the** local logging system (README §1, runtime emitter cell): every runtime record — `detailed` free-text and `lifecycle` bounded — is admitted, ordered, and retained there, queryable at `/v1/records`, streamable at `/v1/tail`. Honeycomb is that store's export valve, opened only for the lifecycle class:

```text
LOCAL  (you, debugging)      collector holds everything · `proliferate logs` merges it with the file sinks · nothing leaves
PROD   (every install)       the same collector exports lifecycle-class records → OTLP → Honeycomb
                             detailed never leaves: it is the only payload shape that can carry free text,
                             and customer builds compile with EXPORT_POLICY = LifecycleOnly
```

The lightweight-for-the-end-user property is structural: an exported record is phase + one closed terminal outcome + closed safe-field arguments + the correlation ids. There is no field a prompt, a path, or a token could travel in.

## The account

Team `proliferate`. Environments `dogfood` (internal builds, `internal-dogfood-export` feature) and `production` (customer builds). Datasets are per-component, routed by `service.name` (`anyharness`, `desktop_tauri`, `desktop_renderer`, `desktop_worker`, `diagnostics_collector`); the `x-honeycomb-dataset` header is a no-op for OTLP and is not used. Keys: `HONEYCOMB_INGEST_KEY_PROD` (bakes into the desktop release; a repo secret once Pablo runs `gh secret set`), `HONEYCOMB_INGEST_KEY_DOGFOOD` (internal builds + local proof), `HONEYCOMB_CONFIG_KEY` (the triggers tool — dogfood-scoped: triggers + columns only; production trigger management needs a production-scoped config key, a Pablo mint). All keys live in `~/.proliferate-local/observability-keys.env`, 1Password as source of truth. Ingest keys cannot create datasets (`createDatasets=false`): the per-component dataset must exist in an environment before its first record lands, or the record bounces — creating one is a one-time Honeycomb-UI step per environment. API query execution is plan-gated and nothing here depends on it: evaluation happens in Honeycomb's own trigger engine.

## The export stages

| Stage | What | State |
| --- | --- | --- |
| 0 | lifecycle emitters in AnyHarness (`session.create`, `turn.execute`, `agent.start`, `model.request`) | built; `model.request` emitter lands in slice O-1 |
| 1 | dogfood proof: internal feature + env, real records in the `anyharness` dataset | proven 2026-08-21; env re-wiring rides O-1 |
| 2 | every install streams: the desktop release bakes `PROLIFERATE_DIAGNOSTICS_OTLP_{ENDPOINT,HEADERS}` from the repo secret; the release gate keeps asserting `lifecycle_only`; self-hosters keep the telemetry-mode off switch | slice O-1 |
| 3 | the server capability document serves the destination; capability off ⇒ the desktop host's collector supervisor (not the `supervisor` component) restarts the collector with no destination — export revocable org-wide without a client release; the baked value becomes the fallback | post-launch build item |

Until Stage 3, the kill switches are: rotate/revoke the ingest key (server-side, immediate for new sends), or the desktop telemetry mode (per-machine: any mode but hosted-product spawns the collector with no destination env — no queue, no task, nothing leaves).

## The five SLIs

Defined as checked-in trigger intent (`server/infra/observability/honeycomb/triggers/*.json`), applied and verified by `scripts/ops/honeycomb-triggers.mjs` (`check` offline in PR CI; `apply`/`verify` gated on the config key and its environment scope — dogfood live today, production once its key exists), evaluated by Honeycomb, firing into the alerting path and resolving when the condition clears. Each intent file names its recipient: the Slack recipient is created once by Pablo in the Honeycomb UI and its id is a checked-in constant; `verify` fails when the recipient is absent.

| SLI | Over | The promise |
| --- | --- | --- |
| session-create success | `anyharness.session.create` terminals, `failed` only (`rejected` is a product signal, not a page) | sessions come up |
| agent-start success | `anyharness.agent.start` terminals | harnesses launch |
| time-to-first-output | `proliferate.argument.first_output_ms` on `anyharness.turn.execute` terminals | the product feels alive |
| launch-selection validity | `session.create` + `agent.start` terminals with `launch_options_unavailable · launch_value_unsupported · agent_env_override_unsupported · route_auth_refused` classifications | configuration renders launchable |
| orphan rate | rate of `abandoned` outcomes (the collector finalizes a dead producer's open operations itself, `finalizer: collector`, so every `started` ends in exactly one terminal and no join is needed) | **a started a human never resolved is a bug by definition** — the protocol's one-started-one-terminal invariant, made a monitor |

`rejected` vs `failed` carries the pager split everywhere: rising `rejected` is a product or documentation problem for a digest; rising `failed` pages. Sign-in success deliberately stays in Grafana — it is log-sourced on the control plane and needs no pipe.

## How you check it

Open the `anyharness` dataset in the environment you care about; group by `proliferate.name` + `proliferate.lifecycle.phase` for the pulse; filter `proliferate.session_id = <id>` for one session's attempt trace (flow 5's Honeycomb link). Trigger state lives on the dataset's Triggers page; the receipts from the last `apply`/`verify` are the proof the intent matches. `dev.user` separates teammates in dogfood.

## Local proof (the O-1 acceptance path)

`~/.proliferate-local/dev/otlp-honeycomb.env` holds the dogfood endpoint + key; an internal build with `internal-dogfood-export` exports everything it admits; a customer-policy build exports lifecycle only. The 2026-08-21 proof — real `session.create`/`turn.execute`/`agent.start` records visible in dogfood with `record_class=lifecycle`, `privacy=operational` — is the template: the same check, per release, is the live half of slice O-1's gate.
