# Agent Distribution

Status: target. The body is written in the ideal state. Every difference from `main` today is listed in [Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and the label comes off when it is empty.

This document replaces `agent-catalog-readiness.md`, which was written as a migration playbook and had served its purpose.

## Purpose

Agent distribution answers five questions for the coding-agent harnesses
(claude, codex, opencode, cursor, grok): 
- What an agent is
- How it gets onto a machine
- How a machine knows it is current
- How the definitions / installation instructions themselves get updated
- What the product sees.

Everything downstream (auth selection, model pickers, session launch) consumes this platform's answers.

Boundaries: the auth split is declare vs apply. This platform owns
*declaring* a harness's auth vocabulary — the registry's per-harness auth
slots, env var names, discovery kinds, and login policy, plus the
catalog's probed auth contexts — and the readiness states computed from
them. *Applying* a credential belongs to agent-auth: which source the
user selects (native / gateway / API key), `state.json` materialization,
and any harness-specific application glue (env injection at spawn,
harness config rewriting, per-harness quirks in
`anyharness-lib/src/domains/agents/route_auth/`). Adding a new harness
therefore touches both: its auth vocabulary is a `registry.json` edit
here; how those slots get filled and switched is agent-auth's contract.
Model snapshot freshness and picker-facing model data belong to the
model catalog. Gateway model lists belong to the
[model gateway](model-gateway.md); this platform knows only whether a
harness supports the gateway route, never which models it serves.

## The two documents

An agent is defined by two JSON documents in
[`catalogs/agents/`](../../../../catalogs/agents/), split by who writes
them:

- `registry.json` is the **method document**: hand-written, reviewed intent.
  Per harness it declares how to install in the abstract (an npm package
  spec, a git fork pinned to a commit, or an ACP-registry-backed resolution
  with a fallback), the auth vocabulary (auth slots, env var names, discovery
  kinds, login policy), and launch discovery. Humans are the only writer.
- `catalog.json` is the **lockfile**: machine-resolved proof. The producer
  pipeline freezes the registry's method into exact versions with
  per-platform `{url, sha256}` targets or pinned npm/git specifiers, plus
  the ACP launch args baked into each pin. It also carries everything the
  probe observed on exactly those versions: models, controls, defaults,
  auth contexts, and provenance (the ACP `initialize` attestation and
  committed snapshot files). The pipeline is the only writer; humans review
  the diff.

One line each: the registry answers "how would you get and run this, in
principle"; the catalog answers "exactly which bytes, and what those bytes
were observed to do."

The split is really a split of consumers, and the most important consequence
is what the registry's install method is NOT for: no installer on any
machine ever reads it. It exists to be resolved, not to be installed from.

| Content | Written by | Sole consumer |
| --- | --- | --- |
| Registry: install method (npm/git/ACP-registry specs, fallbacks) | humans | the producer pipeline ([`resolve-pins.mjs`](../../../../scripts/agent-catalog/resolve-pins.mjs)), which resolves it into catalog pins |
| Registry: auth and launch vocabulary (auth slots, env vars, discovery kinds, login policy, executable names) | humans | the runtime, for credential classification, detection, and catalog pairing validation |
| Catalog: pins and probe-observed facts | the pipeline | the installer and the runtime's projections |

Without the registry's install section the nightly resolution would have
nowhere reviewed to look ("is there a new opencode?" needs a declared
source), and changing how a harness installs (say, moving an adapter to our
fork) would be a change to pipeline tooling instead of a diffable document
edit. The runtime still bundles the registry, but only for the vocabulary
row above and for validating the catalog against it at load
(`validate_agent_catalog_registry_pairing`); the install fence in
[Installation](#installation) guarantees the method is never a fallback.

Observed facts live in the lockfile because they are only true of a version:
"codex 0.144.5 advertises these models" sits next to the pin it was observed
on. That makes one document the revert unit: rolling back a catalog PR
returns the fleet to the previous versions and the previous observed
behavior together.

The ACP adapter story lives here too. Harnesses that speak ACP through an
adapter name it in the registry (claude: our git fork
`proliferate-ai/claude-agent-acp` pinned by commit; codex: our npm fork
`@proliferate-ai/codex-acp`), and the catalog freezes the adapter pin like
any other artifact. A pin may carry a `native` block for the CLI the adapter
wraps (claude's `claude` binary, codex's Rust CLI), pinned and sha-verified
the same way.

Document laws:

- The catalog never contains gateway model names. Gateway models are
  discovered live from the proxy with the harness's virtual key; the
  catalog records only that a harness supports the gateway route (the
  `gateway` auth context). Harness-role choices for gateway models (which
  model serves cheap subtasks) are gateway-side configuration.
- Versions follow `YYYY-MM-DD.revision` and strictly increase whenever
  content changes
  ([`scripts/agent-catalog/check-version-discipline.mjs`](../../../../scripts/agent-catalog/check-version-discipline.mjs)).
- `catalog.draft.json` under `scripts/agent-catalog/` and the bundled
  `catalogs/agents/catalog.json` are byte-identical; the draft is the
  pipeline's output and the lockfile is its promotion.

## Installation

The installer materializes exactly what the catalog pin says and nothing
else. Downloads are sha256-verified; npm and git installs use the pinned
specifier. Fail-closed rules, enforced in code
([`anyharness-lib/src/domains/agents/installer/`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/)):

- No pin for the platform means no install. There is no fallback to "npm
  latest", no resolving the registry spec at install time, no adopting a
  binary found on PATH.
- Every install writes `install-manifest.json` next to the artifacts,
  recording the version and sha256 actually materialized. The manifest is
  the durable half of every later drift check.
- Installed adapters get a generated launcher script that `exec`s the
  resolved binary with the pin's baked ACP args; per-session flags are
  applied by the runtime at spawn, never baked into the launcher.

Installation is automatic. Every harness supported on a surface converges
with no user action: absent means install, drifted means reinstall, and
both are the same mechanism — the reconcile job
([`installer/reconcile/execution.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/reconcile/execution.rs)),
triggered by the startup pass on every runtime boot
(`spawn_startup_pass` in
[`runtime.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs)),
walks the supported set and installs whatever the drift planner
([`installer/install_policy.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/install_policy.rs))
says is absent or stale. A user
authenticates harnesses; they never install them. Completed installs
poke the model-snapshot reconciler ([model-catalog.md](model-catalog.md))
so a newly converged harness re-probes its models without extra wiring.
Two carve-outs:

- An agent the user already provides on PATH is left alone: it is usable
  through readiness as-is, and a managed install would shadow their copy.
- Cursor never installs in cloud. It is login-only with no headless
  credential path, so a cloud install could never reach `Ready`.

Install topology per surface is then only about who pays the first
download:

| Surface | claude, codex | opencode, grok | cursor |
| --- | --- | --- | --- |
| Desktop | Seeded: the app bundles a prebuilt seed archive ([`scripts/build-agent-seed.mjs`](../../../../scripts/build-agent-seed.mjs)), hydrated into the runtime home at launch | Auto-installed in the background by the first startup pass | Auto-installed in the background (local only) |
| Cloud (E2B) | Baked into the template image at build ([`scripts/build-template.mjs`](../../../../scripts/build-template.mjs)) | Auto-installed at first boot by the startup pass | Not supported in cloud |

The seed and the bake are the same install run executed early; both write
the same manifests, so the reconcile below treats seeded, baked, and
auto-installed agents identically.

## Convergence

One law: every supported agent converges to the bundled catalog's pin at
runtime startup — install when absent, reinstall on drift. There is no
"detect what changed" step anywhere: every boot fires an idempotent
reconcile, and the reconcile itself discovers the work by diffing pins
against install manifests. One planner owns that diff
([`installer/install_policy.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/install_policy.rs)),
per agent and per artifact role (the ACP
adapter and the wrapped native CLI drift independently): compare the
manifest's recorded version and sha256 against the active pin and
reinstall in precedence order requested reinstall, version drift, missing
recorded version, checksum mismatch. Drift is strictly per-pin, never
per-document: a `catalogVersion` bump whose pin for harness X is
unchanged is a no-op for X. Drift is also directionless (`!=`, not
"newer"): converging backward after a catalog rollback is the same code
path as upgrading.

The reconcile runs from two pokes, both covering the full supported set
for the surface (PATH-provided agents excluded, cursor excluded in
cloud):

- the startup pass (`spawn_startup_pass` in
  [`runtime.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs))
  on every runtime boot, after seed hydration;
- an explicit request (the settings pane's reinstall action, or a scoped
  `POST /v1/agents/reconcile`).

Both funnel into the single observable reconcile job: one slot, agents
converged sequentially, internal pokes waiting out a busy slot
(250ms retry) rather than dropping. Progress is polled, not pushed:
`GET /v1/agents/reconcile` reports per-agent, per-role phase and
download progress, and the desktop polls it continuously
(`useAgentReconcileStatusQuery` in
[`sdk-react/src/hooks/agents.ts`](../../../../anyharness/sdk-react/src/hooks/agents.ts)
— 1.5s while a job runs, 750ms while downloading, 30s idle discovery).

One transport delivers a new active catalog, on every surface: **the
runtime binary carries it.** `catalog.json` is compiled into the runtime
(`include_str!` in
[`catalog/bundled.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/bundled.rs);
a document that fails validation fails the build), so which harness pins
a machine is on is answered by
one number — the runtime version — and a runtime binary update delivers
new pins by definition. The startup pass after the swap is the entire
convergence story; there is no document push, no second version to
reason about, and no faster lane on any surface. The nightly release
train already delivers the catalog daily; a live document-sync layer
would save at most that one day and give up the invariant that makes
this design stable: **the active catalog is immutable for the lifetime
of the runtime process.** Pins can never move under a machine mid-work;
harness installs mutate only across a restart, when nothing is running.

This also makes the runtime version the single rollback unit. Repinning
the fleet to a previous runtime version rolls back the code, the catalog
pins, and the probe-observed behavior together, atomically — there is no
document state that can race the binary or survive it.

Neither document has a live transport, on purpose. Catalog and registry
both ship only inside a new binary: changing pins, install method, or
auth vocabulary is a code-review-and-release event, never a runtime
push.

### Runtime binary convergence (cloud)

The cloud runtime binary converges to a server-advertised pin, and one
process owns the swap: `proliferate-supervisor`, the OS parent of both
the AnyHarness runtime and the worker in every sandbox. Supervision
differs by surface, but the invariant is shared — the process that owns
the children is the only process that swaps their binaries. On desktop
that owner is the app itself (the runtime and worker are bundled
sidecars, replaced only by an app update; neither ever self-swaps).

The pin's provenance: release CI stamps `RUNTIME_VERSION` (and
`WORKER_VERSION`) into the server image at build time
([`server/version.py`](../../../../server/proliferate/server/version.py));
every heartbeat ack advertises them as
`desired_versions`. A server deploy is therefore the fleet trigger — each
sandbox converges within one heartbeat interval (~30s). A per-sandbox
override column exists for targeted pinning ahead of or behind the fleet.

The worker never touches processes or binaries. On mismatch it writes an
update request (exact version and artifact URL) into the supervisor's
file mailbox
([`proliferate-worker/src/supervisor_bridge/mailbox.rs`](../../../../anyharness/crates/proliferate-worker/src/supervisor_bridge/mailbox.rs))
and moves on. The supervisor drains the mailbox — on child exit and on a
periodic poll tick — and runs the swap state machine
([`proliferate-supervisor/src/update/activate/`](../../../../anyharness/crates/proliferate-supervisor/src/update/activate/)):
download, sha256
re-verify, stage, journal-protected atomic swap (a crash mid-swap is
repaired at next boot from the journal), restart in dependency order
(runtime before worker), health-gate against `/health` (which must
report the desired version), roll back to the `.prev` copy on any
failure. A failed pin is recorded and not retried until a newer pin
supersedes it. The supervisor's run loop
([`proliferate-supervisor/src/process/mod.rs`](../../../../anyharness/crates/proliferate-supervisor/src/process/mod.rs))
also restarts either child on crash with backoff, so a sandbox never
depends on server-side reconnect to recover its runtime.

Binary swaps do not wait for live sessions: the supervisor kills and
restarts the runtime even mid-conversation. That is the intended
behavior for now — desktop updates happen at app startup when no
sessions exist, and in cloud the disruption window is one process
restart on a fleet that updates at most daily. Deferring swaps around
long-running work is a known UX gap to revisit, not an accident.

Because the binary is the only catalog transport, this swap is also how
cloud sandboxes receive new harness pins: a merged catalog PR rides the
next runtime release, the server deploy advertises the new
`RUNTIME_VERSION`, the supervisor swaps the binary, and the startup pass
converges the harnesses. Catalog freshness in cloud is therefore bounded
by the runtime release cadence (the nightly train), the same bound
desktop already has.

## The update pipeline

The catalog is regenerated by the probe pipeline, nightly and on demand
(`.github/workflows/catalog-probe.yml`, and locally via
`make catalog-update`):

1. Resolve fresh pins from the registry
   ([`scripts/agent-catalog/resolve-pins.mjs`](../../../../scripts/agent-catalog/resolve-pins.mjs)).
   The registry's install
   spec declares, per artifact, exactly where "latest" is asked for, and
   the resolver dispatches on the spec's `kind`: `direct_binary` GETs the
   declared `latestVersionUrl` (a provider-published text file whose body
   is the version) and takes checksums from the provider's manifest
   beside the binaries; `tarball_release` asks the GitHub releases API
   for the latest tag and uses published asset digests;
   `registry_backed` reads the public ACP registry document and takes
   the entry's version and distribution. Exact-pinned specs (our forked
   adapters: a git commit for claude's, an exact npm version for
   codex's) are carried through verbatim — the resolver never asks
   whether they moved, which is what makes an adapter bump a reviewed
   `registry.json` edit rather than an automatic pickup. Unknown hashes
   are computed by downloading; known ones are reused.
2. Install exactly those pins and launch every harness over ACP under
   every configured auth context, recording what each attested at
   `initialize` and what it advertised (models, modes, controls). Snapshot
   evidence is committed under `scripts/agent-catalog/generated/`.
3. Collate passed snapshots into `catalog.draft.json`, finalize pins only
   for freshly probed agents, carry unchanged agents forward, and promote
   the draft to the lockfile byte-for-byte.
4. A separate job with no provider credentials opens the PR. A human
   reviews the diff and merges; the merge moves the fleet by riding the
   next runtime release (the nightly app build for desktops, the runtime
   binary roll for cloud sandboxes).

The scheduled run's credentials live only in the protected `Catalog Probe`
GitHub environment; provisioning, rotation, revocation, and failure
response are [catalog-probe.md](../../../developing/operating/catalog-probe.md).
The routine update procedure (bump a harness, review a probe PR, roll
back) is
[agent-catalog-update.md](../../../developing/operating/agent-catalog-update.md).

Three CI gates hold the documents honest:

- [`scripts/validate-agent-catalog.mjs`](../../../../scripts/validate-agent-catalog.mjs):
  structural invariants without a Rust toolchain, including registry
  pairing and snapshot-evidence cross-checks.
- The Rust validation
  ([`catalog/validation.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/validation.rs),
  exercised by every test and at binary load): an invalid checked-in
  catalog cannot boot.
- [`scripts/agent-catalog/check-version-discipline.mjs`](../../../../scripts/agent-catalog/check-version-discipline.mjs):
  version format and monotonicity against the PR base.

## Readiness projection

Per target and harness, the runtime answers what the product may offer
([`anyharness-lib/src/domains/agents/readiness/`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/)):

| State | Meaning |
| --- | --- |
| `InstallRequired` | No managed install and no manifest; transient — the next reconcile pass auto-installs, and the UI shows its progress |
| `Unsupported` | A runtime compatibility gate failed (for example claude's minimum Node version) |
| `CredentialsRequired` | Installed, but no auth context's signals match the environment |
| `LoginRequired` | Installed, credentials absent, and the harness has an interactive login path |
| `Ready` | Installed, compatible, and at least one auth context is satisfied |

Readiness is computed from installed artifacts plus the catalog's auth
contexts plus detected credentials. One function owns the answer
(`compute_readiness` in
[`readiness/status.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/status.rs)),
recomputed fresh from disk on every read — no cache, so it can never be
stale, only honest about what is on disk right now. "Installed" is file
presence plus executable bit; the install manifest decorates the version
string but never gates readiness. The agent-auth route can upgrade a
credential state (a gateway selection satisfies the `gateway` context) but
never clears `InstallRequired` or `Unsupported`; a route cannot conjure a
binary. Launch-time validation applies the same catalog data at session
create: an unknown model is rejected as unsupported, a model whose
availability requires an absent auth context is rejected as gated, with
the missing contexts named.

Projection laws, each closing a way the projection could lie:

- An env credential counts only if the variable is set **and non-empty**;
  `ANTHROPIC_API_KEY=""` is absent, not present.
- Credential detection reads only the workspace's composed env plus
  registry-declared variables — never the host process's ambient
  environment at large, so a global var on the machine cannot make every
  workspace look authenticated.
- The `Ready` gate applies at **every** live-start (create, resume,
  fork), not only at session creation, so credentials revoked after a
  session exists fail with the typed readiness error instead of a
  downstream spawn failure.
- The settings read surface and the launch path resolve readiness the
  same way (route-aware); the UI never shows `CredentialsRequired` for a
  harness that would launch fine.

Stated boundaries: readiness is an offline judgment — a revoked but
unexpired token reads `Ready` and fails at the vendor; and opencode's
`provider_managed` policy is structurally always-`Ready` (it resolves
provider auth itself at prompt time), so its real auth state is
represented by agent-auth's selection set, not this projection.

This projection is the data source for the per-harness settings surface
(install state, auth method status, login readiness) and for launch
options in the composer.

## Code map

| Layer | Path | Owns |
| --- | --- | --- |
| Documents | [`catalogs/agents/`](../../../../catalogs/agents/) | registry.json (method), catalog.json (lockfile), registry.schema.json |
| Document handling | [`anyharness-lib/src/domains/agents/catalog/`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/), [`registry/`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/registry/) | Parsing, validation, registry pairing, bundled copies, read routes |
| Install | [`anyharness-lib/src/domains/agents/installer/`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/) | Pin materialization, manifests, seed hydration, the reconcile job |
| Readiness | [`anyharness-lib/src/domains/agents/readiness/`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/) | Artifact resolution, compatibility gates, credential classification, launch validation |
| Producer | [`scripts/agent-catalog/`](../../../../scripts/agent-catalog/) | resolve-pins, probe runner, collation, version discipline, draft |
| Cloud binary transport | [`proliferate-worker/src/supervisor_bridge/`](../../../../anyharness/crates/proliferate-worker/src/supervisor_bridge/) + [`proliferate-supervisor/`](../../../../anyharness/crates/proliferate-supervisor/) | Worker-written update requests; supervisor-owned swap, restart, rollback |
| Version pins | [`server/proliferate/server/version.py`](../../../../server/proliferate/server/version.py) | Release-CI-stamped `RUNTIME_VERSION`/`WORKER_VERSION` advertised in heartbeat acks |

## Failure modes

- Probe run fails for one harness: the pipeline carries the previous
  agent entry forward; the fleet keeps the last good pin. A scheduled
  failure opens an owned GitHub issue (see catalog-probe.md).
- Install fails (checksum mismatch, fetch failure, no pin for platform):
  the reconcile outcome records the error and the agent stays at
  `InstallRequired`; retry is idempotent on the next pass.
- Binary swap fails its health gate: the supervisor restores the `.prev`
  binary, relaunches it, and records the pin as failed so the same
  artifact is not retried; a newer pin clears the record.
- Runtime or worker crashes: the supervisor restarts the dead child with
  backoff; the startup pass re-runs and converges anything the crash
  interrupted.
- A machine misses updates (desktop on an old app version): it keeps
  working on its bundled pins; nothing depends on the fleet being on one
  catalog version simultaneously.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] `catalog.json` still carries gateway model names:
      `session.gatewayPolicy` (`providers` client-side filter, `seedModels`
      pre-probe fallback, `roles`) and gateway entries in
      `session.defaults`. All of it leaves the catalog once proxy-side
      access groups land (gateway spec gaps) and gateway model discovery
      is a live `GET /v1/models` with the harness key; role choices move
      gateway-side. The JS validator's seedModels checks go with it.
- [ ] The Rust `gateway_resolver`/`gateway_probe` consume `gatewayPolicy`
      and delete with it.
- [ ] `specs/developing/operating/agent-catalog-update.md` documents
      `make catalog-update` and the probe-PR review procedure; until it
      lands, the producer sections of the old readiness doc are the only
      writeup.
- [ ] The legacy cloud topology still exists beside the supervisor:
      [`proliferate-worker/src/anyharness_update.rs`](../../../../anyharness/crates/proliferate-worker/src/anyharness_update.rs)
      (worker-owned pgrep/kill/swap of the runtime), the worker's
      self-`exec` update
      ([`self_update.rs`](../../../../anyharness/crates/proliferate-worker/src/self_update.rs)),
      the server's non-supervisor provision branch, and the D5 bridge
      that migrates legacy sandboxes. All of it — plus the
      `PROLIFERATE_SUPERVISOR_OWNED_RUNTIME` gate itself — deletes once
      the fleet is fully supervisor-owned.
- [ ] The heartbeat catalog transport still exists: the server
      advertises its served catalog version in heartbeat acks
      (`record_heartbeat` in
      [`runtime_workers/service.py`](../../../../server/proliferate/server/cloud/runtime_workers/service.py)),
      the worker pushes the document into the runtime
      ([`proliferate-worker/src/catalog_sync.rs`](../../../../anyharness/crates/proliferate-worker/src/catalog_sync.rs)),
      and the runtime accepts it (`PUT /v1/catalogs/agents`,
      [`catalog/sync.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/sync.rs)
      with its catalog-applied reconcile poke, and the server-side
      [`server/proliferate/server/catalogs/`](../../../../server/proliferate/server/catalogs/)
      ETag serving that feeds it). All of it deletes under the
      binary-only transport law above; the runtime keeps only the read
      routes (`GET /v1/catalogs/agents{,/version}`).
- [ ] Installs are not yet automatic: the startup pass runs an
      `installed_only` reconcile (`reconcile_installed_when_idle` in
      [`runtime.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs)
      hardcodes it), so an absent opencode/grok stays `InstallRequired`
      until a user clicks install, and session creation rejects a
      non-`Ready` harness rather than converging it. The auto-install
      law above (full supported set, PATH and cloud-cursor carve-outs)
      is not yet implemented.
- [ ] The readiness projection laws are not yet enforced: an empty env
      var counts as present, the credential ladder falls back to the
      host's ambient env unbounded
      ([`auth/credentials.rs`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/auth/credentials.rs)),
      the `Ready` gate runs only in `create_session` (resume/fork
      live-starts spawn without re-checking), and `GET /v1/agents`
      resolves native-only while launch resolves route-aware, so
      settings and launch can disagree for routed harnesses. Also
      known: claude's Node gate shells out uncached on every read, and
      claude/codex lack cursor/grok's launcher-integrity guard.
