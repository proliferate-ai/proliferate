# Catalog Convergence v1 — pins reach fleets without binary releases

*2026-07-06. Companion to `specs/tbd/self-hosting-v1.md` §4 (B4/B10, D6/D7): the API
is the version root and actively converges the fleet. This spec extends that exact
design to the agents catalog (`catalogs/agents/catalog.json`) so a harness version
pin bump (new Claude Code, new ACP sidecar) converges deployed runtimes without a
desktop release or E2B template rebuild. All current-state claims below were
verified against `main` on 2026-07-06 (4-agent research pass).*

## 0. The problem, precisely

The runtime's receiving machinery is fully built and never fires:

- `PUT /v1/catalogs/agents` exists (`api/router.rs:69` → `catalogs.rs:33`), calls
  `apply_fetched` (`domains/agents/catalog/sync.rs:131`) — converge-to-server apply
  (any version *difference* swaps, older included = rollback story).
- The applied-catalog poke (`app/mod.rs:466`) triggers
  `start_reconcile(installed_only=true)`; the installer detects `VersionDrift`
  (`installer/install_policy.rs:78`: `pinned != recorded`) and reinstalls pinned
  CLIs from catalog install specs (binary/archive/npm/git, SHA256-verified).
- The server serves the catalog: `GET /v1/catalogs/agents`
  (`server/proliferate/server/catalogs/api.py:13`, ETag-aware).

**But no transport connects them.** Verified missing on `main`:
- Heartbeat response (`runtime_workers/service.py:250`) carries
  `desiredVersions {worker, anyharness}` but **no `catalogVersion`** — despite
  `sync.rs:14-27`'s doc comment describing exactly that design.
- `proliferate-worker` has **zero catalog code** (no fetch, no push).
- Desktop has **no catalog sync hook** (auth-state has one; catalog doesn't).

Net effect today: a catalog.json pin bump reaches nobody until a new anyharness
binary ships (cloud: via worker self-update on the *binary* pin; desktop: full app
update). Every Claude Code CLI release is currently app-release-gated.

## 1. What already exists (don't rebuild)

| Piece | Status | Where |
|---|---|---|
| `/meta` version endpoint (server/desktop/runtime/worker versions, CI-stamped env pins) | ✅ landed | `server/proliferate/server/meta.py:46`, `version.py:52` |
| Heartbeat `desiredVersions` (worker + anyharness binary pins) | ✅ landed | `runtime_workers/service.py:250` |
| Worker binary self-update (download → sha256 → preflight → atomic swap → re-exec; cloud-only, desktop `self_update_enabled=false`) | ✅ landed | `proliferate-worker/src/self_update.rs` |
| Runtime catalog apply + reconcile + pin-drift reinstall | ✅ landed | `sync.rs`, `installer/` |
| Server catalog endpoint (ETag) | ✅ landed | `server/catalogs/api.py:13` |
| Supervisor update machinery (verify/stage; no orchestration yet) | ⚠️ partial (B10) | `proliferate-supervisor/` |
| Desktop updater against self-hosted `/desktop/updater/latest.json` | ❌ spec-only (B4-desktop) | `tauri.conf.json` hardcodes official CDN |
| `catalogVersion` anywhere in heartbeat | ❌ missing | — |
| Worker catalog fetch+push | ❌ missing | — |
| Desktop catalog sync | ❌ missing | — |
| Runtime endpoint exposing installed-vs-pinned versions | ❌ missing | `GET /v1/agents` returns installed versions only (`agents_contract.rs:241`) |

## 2. Principle (inherited from self-hosting §4)

**Everything the operator runs is downstream of the API version they control.**
The desktop and workers fetch the catalog from *their configured API server*, never
from a Proliferate-official source. A self-hosted server pinned at an older release
serves its older catalog; its fleet converges to that — correct by D6. Convergence
is `version != active` (both directions), matching `ingest_advertised_version`
(`sync.rs:124`) and the B-lane rollback story: revert the catalog PR, fleet rolls
back on the next heartbeat.

## 3. The five pieces

### P1 — Server: `catalogVersion` in the heartbeat response (S)

Add `catalog_version` to `WorkerHeartbeatResponse.desired_versions`
(`runtime_workers/service.py`, `models.py`). Value = `catalogVersion` of the
catalog the server serves (already parsed by `server/catalogs/service.py`; cache
the parsed version, don't re-read per heartbeat). No schema migration; wire-only.

### P2 — Cloud worker: fetch + push transport (S/M)

In `proliferate-worker` (`lifecycle/heartbeat.rs`, `cloud_client/`):
1. Add `catalog_version: Option<String>` to `HeartbeatResponse`
   (`cloud_client/mod.rs:78`).
2. On heartbeat: ask the runtime for its active catalog version (needs a tiny
   runtime read — either a `GET /v1/catalogs/agents/version` or reuse an existing
   status surface), compare.
3. On mismatch: `GET /v1/catalogs/agents` from the cloud (ETag-aware; keep the
   last ETag in worker memory) → `PUT /v1/catalogs/agents` to the runtime (existing
   transport bearer auth). `apply_fetched` + the reconcile poke do the rest.

This is verbatim the transport `sync.rs:14-27` already documents. Failure mode:
skip-and-retry-next-heartbeat; a malformed document is rejected by `apply_fetched`
validation and the runtime keeps its active catalog.

### P3 — Desktop: catalog sync hook (S/M)

Clone the `use-local-auth-state-sync.ts` pattern (trigger on runtime-healthy +
signed-in; guard on delta; fire-and-forget with retry on next trigger):
- Fetch `GET /v1/catalogs/agents` from the configured API server (downstream-of-API
  per §2; ETag/version guard so steady-state is a 304).
- Push raw document to the local runtime `PUT /v1/catalogs/agents`.
- Cadence: on app start + join the existing 60s mirror-sync poll tick
  (`GATEWAY_MIRROR_POLL_INTERVAL_MS`) with the version guard making the poll
  nearly free. Reuse the mirror-sync hook's structure; do not invent a scheduler.

Note: this makes the desktop's *bundled* catalog (`bundled-agent-catalog.ts` +
the runtime's `include_str!` copy) a first-boot fallback only — exactly the role
`sync.rs` already assigns it (`CatalogSource::Bundled` vs `Fetched`).

### P4 — Re-probe on agent/catalog update (S, pure Rust)

Today gateway probes fire on auth-state push, manual refresh, and
launch-if-stale — but not when a new catalog lands or a harness is reinstalled.
Extend the applied-catalog poke path: after `start_reconcile` completes (or
immediately alongside it), schedule `probe_and_record` per gateway-enrolled
harness at the current auth revision. Dedup guard: skip if a probe row for
(harness, revision) already exists AND the catalog swap didn't change that
harness's `gatewayPolicy` (compare old/new policy structs; probe on change).
This closes the loop for "new catalog widens codex's providers → codex's model
plan updates without waiting for an auth change."

### P5 — Desktop UI: read-only version + freshness block (M) — **BLOCKED, see §4**

Per-harness block in the agents settings page showing:
- installed CLI version vs catalog pin (native + agentProcess/ACP, from installer
  manifest) — "up to date" / "update pending (reconciling)" states,
- active catalog version + source (bundled/fetched) + applied-at,
- gateway probe freshness (already exposed: `source` + `probedAt` on
  `gateway-models`).

Runtime work: extend `AgentSummary` (`agents_contract.rs:241`) — which already
carries installed `native.version` / `agent_process.version` — with the catalog
pin values and active catalog version, OR add
`GET /v1/agents/{kind}/versions` returning
`{installed, catalogPin, catalogVersion, catalogSource, probeFreshness}`. Prefer
extending `AgentSummary`: the UI already fetches it.

Placement (post-#957 single-scroll layout): after `HarnessAuthDetailsSection`,
before `HarnessAllModelsSection`. Read-only in v1 — no "update now" button;
convergence is automatic and the block's job is trust ("you're on 2.1.181,
current"), not control.

## 4. Dependencies / sequencing (the mid-migration reality)

The `ux/agents-*` restructure and catalog-schema work are in flight. Verified
overlap map (2026-07-06):

| In-flight PR | Touches | Constraint on this spec |
|---|---|---|
| #963 catalog-driven harness settings | **schema.rs, validation.rs, settings.rs (new), catalog.json + validator, server agent_gateway full stack, HarnessPane** | P4/P5 rebase after; any schema field this spec needs must not race #963's `HarnessSettings` addition |
| #958 remove Agent Defaults | **schema.rs, validation.rs**, heavy desktop settings refactor | same — schema + UI rebase dependency |
| #957/#956 harness page restructure / overview removal | HarnessAuthSection/DetailsSection, single-scroll layout, sidebar readiness dots | **P5 hard-blocked until these land** — the block's placement targets the new layout |
| #962 opencode native coexist | route_auth render/materialize, HarnessAuthSection/Pane | UI-file rebase for P5 |
| #975 native visibility | catalog.json data only | no conflict |
| #942 open models (DeepSeek/GLM) | config.yaml, `provider_for_model` (adds deepseek/zhipu arms + tests), compose env | no structural conflict; see review note below |

**Sequencing:** P1 → P2 (cloud converges) can start now — they touch
server heartbeat + worker only, zero overlap with the agents-UI migration.
P3 next (desktop hook; small UI surface, no settings-page dependency).
P4 after #963 lands (it rewires catalog schema/service internals).
P5 last, after the full agents-UX stack lands.

**Agents-UX stack state (2026-07-06):** PR **#986** (`ux/agents-polish`) is
stacked on #963 (`agents/catalog-settings-chrome`), carrying all 9 mockbed
commits plus merges of #962 and #961 as dependencies; its diff shrinks
automatically as the stack lands underneath it. PR **#985** (mockbed) stays
untouched — close it once #986 is reviewed, since everything it contained now
lives on the stack. Merge order: **#957 → #960 → #962/#963 → #961 (independent,
any time) → #986 last.** P5 therefore lands after #986.

**Build state (2026-07-06):** F1 (rotation fix, from the fixes doc) + P1 + P2
are built, reviewed, and open as a stacked PR series:
**#987 → #988 → #989** (each based on the previous; #987 independently
mergeable). Live end-to-end verify per §6 pending.

**PR #942 review note (actionable today):** the Rust matcher is handled
(contrary to the earlier assumption) — the gap is prod deployment:
`_deploy-litellm.yml` maps only ANTHROPIC/OPENAI/XAI keys to SSM; without
`AGENT_GATEWAY_MANAGED_DEEPSEEK_API_KEY` / `_ZHIPU_API_KEY` wiring (secret refs
~lines 69/99/162 + secret-updates.json), prod probes 0 models from those
families and the PR is a no-op in prod. Also: models ship with zero catalog.json
presence → sparse UI rows for opencode/grok until enriched (acceptable, but note
the ids are `glm-4-plus`/`glm-4-flash` — the launch copy says "GLM 5.2"; align
one or the other before the affordability post).

## 5. Deferred / v2

- "Update now" button + per-harness manual reconcile trigger from the UI.
- Supervisor-orchestrated runtime *binary* swap (B10 proper — session-preserving;
  its verify/stage halves exist, orchestration doesn't).
- Desktop updater against self-hosted endpoints (B4-desktop, separate lane).
- Catalog delivery to SSH/self-managed targets beyond the worker path (rides
  worker parity work).
- Generalizing `provider_for_model` prefixes into catalog data
  (`providerPrefixes` map) — #942 shows an in-Rust arm per provider is workable;
  revisit when provider additions become routine rather than occasional.

## 6. Verification bar

- Bump a claude pin in catalog.json on a dev profile → within one heartbeat the
  cloud sandbox runtime reinstalls the CLI (check installer manifest + agent
  version in `GET /v1/agents`), with no binary redeploy.
- Same bump → desktop converges within one poll tick; `AgentSummary` shows
  installed == pin.
- Revert the catalog PR → fleet rolls back (converge-on-different, both
  directions).
- Widen codex `gatewayPolicy.providers` in a catalog push → codex model plan
  reflects it without an auth-state change (P4).
- Self-hosted server on an older release serves its older catalog; a desktop
  pointed at it converges *down* — downstream-of-API holds.
