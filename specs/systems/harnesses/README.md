# Harnesses

Status: current (grade B). System spec in the Organization Standard anatomy. The runtime system that owns *which coding agents exist and whether they can launch*: the supported-kind registry, the distribution catalog compiled into the binary, install/seed/reconcile of agent artifacts, credential detection and readiness, target-observed launch options and the probe that observes them, and the per-provider adapters (ACP extensions, live controls, transcript quirks). It hands the session engine a **resolved launch surface**; it never runs a session.

Today the code lives in `domains/agents/` and the docs call it "agents". The Organization Standard names the system **harnesses** (a harness is the thing you run; an agent is the thing a user talks to), and the target tree renames the folder. Depth references: [agents.md](agents-domain.md), [agent-distribution.md](distribution.md), [harnesses.md](harness-integrations.md) and the per-provider docs under [harnesses/](claude.md), [acp.md](../../areas/anyharness.md), [agent-mode-matrix.md](agent-mode-matrix.md), [MODELS.md](launch-options.md).

## 1. Purpose

Make "is Claude ready on this machine, and with which exact model and controls may I launch it?" a pure, side-effect-free question with one answer, and make "get it ready" a fenced, sha-verified, idempotent operation. The product outcome: a user installs the app and every supported harness converges to the catalog pin without a manual step; a cloud task environment does the same from a seed; session create can only ever launch an executable surface the target has actually observed.

## 2. Owned state

| State | Where | Written by |
| --- | --- | --- |
| Supported kinds (`claude`, `codex`, `cursor`, `opencode`, `grok`) and their static install/auth/launch metadata | [model.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/model.rs), [registry/](../../../anyharness/crates/anyharness-lib/src/domains/agents/registry/schema.rs) | compiled in (bundled registry) |
| Distribution catalog — pins, artifact specs, model catalog | [catalog/](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/schema.rs), [model_catalog.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/model_catalog.rs) | compiled in from `catalogs/agents/**` |
| `agent_model_registry_snapshots` | **vestigial**: table exists ([0044](../../../anyharness/crates/anyharness-lib/src/persistence/sql/0044_agent_model_registry_snapshots.sql)) but no domain code reads or writes it on `main`; drop with the next migration | nobody |
| Install manifests, downloads, seed archives, quarantine | [installer/](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/mod.rs) under `<runtime-home>` | this system, under [installer/lock.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/lock.rs) |
| `harness_launch_option_states` — target-observed model ids and control values per kind | [launch_options/store.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/launch_options/store.rs) | the launch probe only |
| Readiness overrides, path resolution, version facts | [readiness/](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs) | derived, not stored |

Not owned though co-located (see Fences): `auth/`, `auth_state.rs`, `route_auth/` — the runtime half of **agent_auth**.

## 3. Public surface

HTTP ([agents.rs](../../../anyharness/crates/anyharness-lib/src/api/http/agents.rs), [agent_launch_options.rs](../../../anyharness/crates/anyharness-lib/src/api/http/agent_launch_options.rs), [catalogs.rs](../../../anyharness/crates/anyharness-lib/src/api/http/catalogs.rs)):

| Route | Meaning |
| --- | --- |
| `GET /v1/agents`, `GET /v1/agents/{kind}` | resolved readiness per kind (`resolve_agent`, side-effect free) |
| `POST /v1/agents/{kind}/install` | fenced managed install of the catalog pin |
| `POST /v1/agents/{kind}/login/start`, `/login/terminal`, `GET|DELETE /v1/agents/login-terminals/{id}` | provider login flows (terminal-backed) |
| `POST /v1/agents/reconcile`, `GET /v1/agents/reconcile` | start/inspect the catalog-pin reconcile job |
| `GET /v1/agents/{kind}/launch-options`, `POST …/launch-options/refresh` | target-observed launch options; refresh pokes the probe |
| `GET /v1/catalogs/agents/version` | the compiled catalog version — binary convergence *is* catalog convergence |

Wire shapes: [agents.rs](../../../anyharness/crates/anyharness-contract/src/v1/agents.rs), [launch_options.rs](../../../anyharness/crates/anyharness-contract/src/v1/launch_options.rs), [catalogs.rs](../../../anyharness/crates/anyharness-contract/src/v1/catalogs.rs).

In-process: `AgentRuntime` ([runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs)) is the facade — it sequences concern services and owns no mechanism. Sessions obtain the resolved executable surface (`ResolvedAgent`) and the exact-validated `ResolvedLaunchIntent` inputs through it; the cloud surface flag `ANYHARNESS_RUNTIME_SURFACE` selects `RuntimeSurface::{Local,Cloud}`.

## 4. Consumes

- `integrations/agent_cli` ([launcher.rs](../../../anyharness/crates/anyharness-lib/src/integrations/agent_cli/launcher.rs),
  [executable.rs](../../../anyharness/crates/anyharness-lib/src/integrations/agent_cli/executable.rs),
  [model_discovery.rs](../../../anyharness/crates/anyharness-lib/src/integrations/agent_cli/model_discovery.rs)) — provider CLI mechanics.
- `integrations/acp` ([acp/](../../../anyharness/crates/anyharness-lib/src/integrations/acp/mod.rs)) —
  protocol helpers the adapters share.
- `anyharness-credential-discovery` crate — provider credential file parsing.
- `terminals` — login terminals run through
  [live/terminals/agent_login.rs](../../../anyharness/crates/anyharness-lib/src/live/terminals/agent_login.rs).
- `catalogs/agents/**` at build time (the registry + catalog data) and the
  desktop seed archive delivered through [desktop_host.md](../desktop-host/README.md).
- agent_auth — the resolved credential ladder and gateway plan the launch
  needs; this system *applies* what agent_auth *decides*.

## 5. Laws

**The bundled registry is the source of truth for supported kinds.** Catalog modules are distribution, presentation and compatibility only and cannot authorize executable values ([README.md](../../areas/anyharness.md), launch-option authority).

**Resolution never mutates.** `resolve_agent(...)` reports installed, compatible, credentialed state and nothing else; installation is a separate, fenced operation ([readiness/service.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs)).

**Managed install materializes exactly the catalog pin, sha-verified.** ACP-registry resolution is probe-time only; a drifted or unsigned artifact never reaches `Ready` ([installer/pinned.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/pinned.rs)).

**Launch options are observed, never defaulted.** Session create reloads the target observation, exact-validates the caller's opaque selection and stores `ResolvedLaunchIntent` atomically; omitted values stay omitted — no catalog default, alias, or first option fills them ([launch_options/validation.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/launch_options/validation.rs)).

**The probe is override-free.** [launch_probe/](../../../anyharness/crates/anyharness-lib/src/domains/agents/launch_probe/mod.rs) detects what the installed binary reports, under a lock, with backoff; it records contradictions rather than resolving them.

**Cursor never installs in cloud.** It is login-only with no headless credential path, so a cloud install could never reach `Ready` (`RuntimeSurface::Cloud` carve-out in [runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs)).

**Binary convergence is catalog convergence.** The active catalog is immutable for the runtime process lifetime; there is no document push or faster lane ([MANAGED_RUNTIME.md](managed-runtime.md)).

## 6. Emits

- `ResolvedAgentStatus` per kind — consumed by the client agent picker and
  onboarding, and by the seam heartbeat (readiness facts ride to the control
  plane).
- Reconcile job snapshots (`AgentReconcileJobSnapshot`) and install progress
  ([installer/progress.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/progress.rs)).
- Launch-option observations (`harness_launch_option_states`) — consumed by
  session create and by the worker's launch-options sync to the control plane
  ([launch_options_sync.rs](../../../anyharness/crates/proliferate-worker/src/launch_options_sync.rs)).
- Login-terminal lifecycle events (through the terminals stream).

## 7. Fences

| Not owned | Owner |
| --- | --- |
| Live session actors, ACP stdio connections, prompt execution | sessions ([session-engine.md](../sessions/session-engine.md)) |
| Credential vault, selections, `state.json` delivery, route-auth rendering, gateway plans — `domains/agents/{auth,auth_state.rs,route_auth}` | **agent_auth** (control-plane spec with a runtime section; today [AGENT_AUTH.md](../agent_auth/README.md)) |
| Virtual keys, LiteLLM, model gateway enrollment | model_gateway ([MODELS.md](launch-options.md)) |
| Catalog *generation* (`scripts/agent-catalog/**`) | release-delivery (engineering system) |
| Supervisor binary swaps, worker mailbox | managed_runtime ([MANAGED_RUNTIME.md](managed-runtime.md)) |
| Cowork/review/workflow session policy | their owning domains |

Declared edge: `agents → sessions` (baseline; the reverse `sessions → agents` is the intended direction and also present). Every other domain reaches harnesses through `AgentRuntime` or the readiness facade.

> [!decision] PABLO DECIDES: harness kinds. `AgentKind::all()` is
> `[Claude, Codex, Cursor, OpenCode, Grok]`; Cursor is login-only and
> cloud-excluded, Grok has a full adapter doc ([grok.md](grok.md)) but an open
> auto-probe defect (PRO-210) and no known headless credential path.
> Options: (a) keep all five; (b) drop Cursor and Grok from the registry (their
> readiness, portability and launch-option branches, plus `harnesses/grok.md`)
> after the usage check; (c) drop Grok only. Recommendation: (b) unless usage
> shows real Cursor sessions — the demo and the cloud lane both need headless
> credential paths, which only Claude/Codex/OpenCode have.

> [!decision] PABLO DECIDES: the agent_auth runtime half. `route_auth` (5.3K
> lines), `auth/` (3.5K) and `auth_state.rs` sit in `domains/agents`, but their
> laws (headless never holds human credentials; gateway plan per launch) belong
> to agent_auth. Options: (a) move them to `domains/agent_auth/` in Wave 3 and
> let the agent_auth spec own a runtime code map; (b) keep them here as an
> "auth application" section. Recommendation: (a) — the target tree already
> names `agent_auth/` in the runtime, and a single spec across both planes is
> how "identity once, capability per call" stays one law.

## 8. Code map

```text
anyharness/crates/anyharness-lib/src/domains/agents/    → target: systems/harnesses/
├── model.rs · model_catalog.rs             AgentKind, artifact specs, readiness models
├── registry/                               bundled kind registry, schema, validation, projection
├── catalog/                                distribution catalog: schema, artifact, sync, validation
├── installer/                              downloads, pinned, npm/managed_npm, seed/, reconcile/,
│                                           install_policy, lock, progress, off_runtime
├── readiness/                              resolve_agent, compatibility, overrides, paths, versions
├── launch_options/                         target-observed options: store, service, validation
├── launch_probe/                           override-free probe engine, phases, backoff, lock
├── portability/                            provider auth-file portability (codex)
├── live_ports.rs                           trait impls for live-defined ports
├── runtime.rs                              AgentRuntime facade
└── (auth/, auth_state.rs, route_auth/)     → agent_auth runtime section (fenced, see §7)
anyharness/crates/anyharness-lib/src/integrations/agent_cli/   provider CLI mechanics (consumed)
anyharness/crates/anyharness-lib/src/integrations/acp/         shared ACP helpers (consumed)
anyharness/crates/anyharness-lib/src/api/http/{agents,agents_contract,agents_errors,
    agent_launch_options,catalogs}.rs                           transport
anyharness/crates/anyharness-contract/src/v1/{agents,launch_options,catalogs}.rs
specs/areas/harnesses/{claude,codex,grok}.md               per-provider adapter docs
catalogs/agents/**                                              registry + catalog data (build input)
```

Client-plane presentation: [components/agents](../../../apps/packages/product-client/src/components/agents), [hooks/agents](../../../apps/packages/product-client/src/hooks/agents), [lib/domain/agents](../../../apps/packages/product-client/src/lib/domain/agents), [stores/agents](../../../apps/packages/product-client/src/stores/agents) (agent picker, install/login prompts, readiness badges).

## 9. Proof

- Install and seed: [installer/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/tests.rs),
  [pinned_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/pinned_tests.rs),
  [downloads_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/downloads_tests.rs),
  [auto_install_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/auto_install_tests.rs),
  [reconcile/execution_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/reconcile/execution_tests.rs),
  [seed/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/seed/tests.rs).
- Readiness: [readiness/service_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service_tests.rs),
  [route_aware_read_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/route_aware_read_tests.rs),
  [resolution_flip_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/resolution_flip_tests.rs).
- Catalog/registry: [catalog/artifact_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/artifact_tests.rs),
  [catalog/schema_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/schema_tests.rs),
  [registry/validation_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/registry/validation_tests.rs).
- Launch options and probe: [launch_options/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/launch_options/tests.rs),
  [launch_probe/runner_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/launch_probe/runner_tests.rs),
  [contradiction_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/launch_probe/contradiction_tests.rs),
  [api/http/agent_launch_options_tests.rs](../../../anyharness/crates/anyharness-lib/src/api/http/agent_launch_options_tests.rs).
- Release lanes: the managed-agent install/spawn scenarios under
  [tests/release](../../../tests/release) (see [the testing spec](../../engineering/testing/README.md)).

## Known gaps / follow-ups

- `domains/agents/auth` uses contract auth structs end-to-end (recorded
  migration exception in [domains.md](../../areas/anyharness.md)); resolves with
  the agent_auth move.
- The "agents" name is used for three things (this system, the client's
  "Agents" pane for delegated work, and sessions). The rename to harnesses
  removes one of the three.
