# Agent Distribution

Status: current.

This document replaces `agent-catalog-readiness.md`, which was written as a migration playbook and had served its purpose.

## Purpose

Agent distribution answers five questions for the coding-agent harnesses (claude, codex, opencode, cursor, grok):
- What an agent is
- How it gets onto a machine
- How a machine knows it is current
- How the definitions / installation instructions themselves get updated
- What the product sees.

Everything downstream (auth selection, model pickers, session launch) consumes this platform's answers.

Boundaries — the auth split is declare vs apply:

- **This platform *declares* auth vocabulary**: the registry's per-harness
  auth slots, env var names, discovery kinds, and login policy, plus the
  catalog's probed auth contexts — and the readiness states computed from
  them.
- **Agent-auth *applies* a credential**: which source the user selects
  (native / gateway / API key), `state.json` materialization, and the
  harness-specific application glue (env injection at spawn, harness
  config rewriting, per-harness quirks in
  `anyharness-lib/src/domains/agents/route_auth/`).
- **A new harness touches both**: its auth vocabulary is a `registry.json`
  edit here; how those slots get filled and switched is agent-auth's
  contract.
- **Executable models and controls** belong to the selected target's observed
  launch-options state, not distribution.
- **Gateway model lists** belong to the [model gateway](launch-options.md);
  this platform knows only whether a harness supports the gateway route,
  never which models it serves.

## The two documents

An agent is defined by two JSON documents in [`catalogs/agents/`](../../../catalogs/agents), split by who writes them:

- `registry.json` is the **method document**: hand-written, reviewed intent.
  Per harness it declares how to install in the abstract (an npm package
  spec, a git fork pinned to a commit, or an ACP-registry-backed resolution
  with a fallback), the auth vocabulary (auth slots, env var names, discovery
  kinds, login policy), and launch discovery. Humans are the only writer.
- `catalog.json` is the **distribution lockfile**: machine-resolved proof. The producer
  pipeline freezes the registry's method into exact versions with
  per-platform `{url, sha256}` targets or pinned npm/git specifiers, plus
  the ACP launch args baked into each pin. It also carries presentation labels
  and auth/install metadata, but no executable models, controls, defaults,
  filters, or fallbacks. The pipeline is the only writer; humans review the
  diff.

One line each: the registry answers "how would you get and run this, in principle"; the catalog answers "exactly which bytes are distributed."

The split is really a split of consumers, and the most important consequence is what the registry's install method is NOT for: no installer on any machine ever reads it. It exists to be resolved, not to be installed from.

| Content | Written by | Sole consumer |
| --- | --- | --- |
| Registry: install method (npm/git/ACP-registry specs, fallbacks) | humans | the producer pipeline ([`resolve-pins.mjs`](../../../scripts/agent-catalog/resolve-pins.mjs)), which resolves it into catalog pins |
| Registry: auth and launch vocabulary (auth slots, env vars, discovery kinds, login policy, executable names) | humans | the runtime, for credential classification, detection, and catalog pairing validation |
| Catalog: pins and presentation metadata | the pipeline | the installer and presentation surfaces |

Without the registry's install section the nightly resolution would have nowhere reviewed to look ("is there a new opencode?" needs a declared source), and changing how a harness installs (say, moving an adapter to our fork) would be a change to pipeline tooling instead of a diffable document edit. The runtime still bundles the registry, but only for the vocabulary row above and for validating the catalog against it at load (`validate_agent_catalog_registry_pairing`); the install fence in [Installation](#installation) guarantees the method is never a fallback.

Executable observations live in the target runtime's launch-options store because they are properties of the installed target and its current auth context. Rolling back a distribution catalog rolls back pins and presentation; the target must be re-observed under its new basis before it can launch.

The ACP adapter story lives here too. Harnesses that speak ACP through an adapter name it in the registry (claude: our git fork `proliferate-ai/claude-agent-acp` pinned by commit; codex: our npm fork `@proliferate-ai/codex-acp`), and the catalog freezes the adapter pin like any other artifact. A pin may carry a `native` block for the CLI the adapter wraps (claude's `claude` binary, codex's Rust CLI), pinned and sha-verified the same way.

Document laws:

- The catalog never contains executable model names or control vocabularies.
  Gateway and direct-provider options are discovered from the installed
  harness and exposed only through target-observed launch options.
- Versions follow `YYYY-MM-DD.revision` and strictly increase whenever
  content changes
  ([`scripts/agent-catalog/check-version-discipline.mjs`](../../../scripts/agent-catalog/check-version-discipline.mjs)).
- `catalog.draft.json` under `scripts/agent-catalog/` and the bundled
  `catalogs/agents/catalog.json` are byte-identical; the draft is the
  pipeline's output and the lockfile is its promotion.

## Installation

The installer materializes exactly what the catalog pin says and nothing else. Downloads are sha256-verified; npm and git installs use the pinned specifier. Fail-closed rules, enforced in code ([`anyharness-lib/src/domains/agents/installer/`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer)):

- No pin for the platform means no install. There is no fallback to "npm
  latest", no resolving the registry spec at install time, no adopting a
  binary found on PATH.
- Every install writes `install-manifest.json` next to the artifacts,
  recording the version and sha256 actually materialized. The manifest is
  the durable half of every later drift check.
- Installed adapters get a generated launcher script that `exec`s the
  resolved binary with the pin's baked ACP args; per-session flags are
  applied by the runtime at spawn, never baked into the launcher.
- Every LIVE launcher write is staged-then-atomically-renamed, never written
  in place. `generate_launcher_script_atomic`
  ([`integrations/agent_cli/launcher.rs`](../../../anyharness/crates/anyharness-lib/src/integrations/agent_cli/launcher.rs))
  writes a `.{name}.next` sibling, makes it executable, then renames it over
  the live launcher, keeping a transient `.{name}.previous` so a failed
  promotion leaves the prior launcher in place. A managed session already
  running keeps its old inode open (POSIX rename semantics) — no kills, no
  waiting. The archive-adapter path stages the same way through
  `ArchiveTreeActivation::activate_launcher`
  ([`installer/downloads/activation.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/downloads/activation.rs)).
- The launcher's env is data-driven from the registry's per-harness
  `selfUpdateNeutralization` record (`managed_launcher_env` in
  [`installer/agent_process.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/agent_process.rs)):
  an `env` mechanism injects each declared var (claude disables its own
  auto-updater with `DISABLE_AUTOUPDATER=1`); `none_found`/`not_applicable`
  inject nothing and exist to record the static-analysis finding honestly, so
  the managed lane stays the single version authority.
- A terminal install failure carries a typed classification, not just a
  string. `InstallError::kind()`
  ([`installer/service.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/service.rs))
  maps to `InstallErrorKind` `{ network, checksum, in_use, disk, other }`,
  threaded additively through `AgentReconcileResult.failure_kind` → the
  contract's `ReconcileAgentResult.failureKind` → the terminal-failure toast,
  so the UI names WHY a reinstall failed.

Installation is automatic. Every harness supported on a surface converges with no user action: absent means install, drifted means reinstall, and both are the same mechanism — the reconcile job ([`installer/reconcile/execution.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/reconcile/execution.rs)), triggered by the startup pass on every runtime boot (`spawn_startup_pass` in [`runtime.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs)), walks the supported set and installs whatever the drift planner ([`installer/install_policy.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/install_policy.rs)) says is absent or stale. A user authenticates harnesses; they never install them. Proliferate always maintains its own managed copy (R2.0, RULED): a user's own copy on PATH is detection-only now and no longer blocks the managed install — resolution already prefers the managed copy when both exist ([`readiness/artifacts.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/artifacts.rs), `resolve_native_artifact`/`resolve_agent_process_artifact`), so nothing displaces the user's binary, but nothing defers to it either. The one remaining carve-out is one named predicate ([`installer/auto_install.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/auto_install.rs)), deliberately not a side effect of the pass's scope. Completed installs poke the launch-options probe ([MODELS.md](launch-options.md)) so a newly converged harness re-observes its executable options. The one carve-out:

- Cursor never installs in cloud. Its readiness resolves through a headless
  credential path — an enabled `api_key` selection (agent-auth.md's
  `CURSOR_API_KEY` slot) upgrades `CredentialsRequired` to `Ready` the same
  way any other routed harness's selection does, and that route is real:
  `cursor-agent` **does** honor a supplied `CURSOR_API_KEY`, proven by a live
  `initialize` → `session/new` → prompt → `end_turn` run on 2026-07-26 and
  wired into the probe's cursor arm in commit `4ccbfc41a`
  (`catalog_probe.rs`). (An earlier revision of this paragraph claimed the
  opposite; that claim was stale and is struck.) Cursor stays
  cloud-uninstallable for a different reason: its *native* login lives in the
  macOS Keychain, which no headless Linux sandbox has and which no cloud
  surface can interactively seed. For the same keychain reason it is
  excluded from unattended launch-option probing and refreshed only on request
  ([MODELS.md](launch-options.md)'s probe engine).

When a managed copy lands alongside a harness the user already had on PATH, the settings pane (`HarnessPane.tsx`) shows a one-time, dismissible notice explaining that Proliferate now maintains its own copy and the user's own install is untouched; dismissal persists per harness under `proliferate.harnessManagedNotice.v1`. The signal is an additive, tolerant `AgentSummary.userPathCopyDetected` bit (anyharness-contract), read independently of which artifact resolution picked — a managed hit short-circuits before ever checking PATH, so the resolved artifact alone cannot express "both exist". An escape hatch, `ANYHARNESS_ALWAYS_MANAGED_INSTALL=off`, restores the pre-R2.0 PATH carve-out for operators who need to revert without a code change; it defaults on (the ruling).

Install topology per surface is then only about who pays the first download:

| Surface | claude, codex | opencode, grok | cursor |
| --- | --- | --- | --- |
| Desktop | Seeded: the app bundles a prebuilt seed archive ([`scripts/build-agent-seed.mjs`](../../../scripts/build-agent-seed.mjs)), hydrated into the runtime home at launch | Auto-installed in the background by the first startup pass | Auto-installed in the background (local only) |
| Cloud (E2B) | Baked into the template image at build ([`scripts/build-template.mjs`](../../../scripts/build-template.mjs)) | Auto-installed at first boot by the startup pass | Not supported in cloud |

The seed and the bake are the same install run executed early; both write the same manifests, so the reconcile below treats seeded, baked, and auto-installed agents identically.

## Convergence

One law: every supported agent converges to the bundled catalog's pin at runtime startup — install when absent, reinstall on drift. There is no "detect what changed" step anywhere: every boot fires an idempotent reconcile, and the reconcile itself discovers the work by diffing pins against install manifests. One planner owns that diff ([`installer/install_policy.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/install_policy.rs)), per agent and per artifact role (the ACP adapter and the wrapped native CLI drift independently): compare the manifest's recorded version and sha256 against the active pin and reinstall in precedence order requested reinstall, version drift, missing recorded version, checksum mismatch. Drift is strictly per-pin, never per-document: a `catalogVersion` bump whose pin for harness X is unchanged is a no-op for X. Drift is also directionless (`!=`, not "newer"): converging backward after a catalog rollback is the same code path as upgrading.

The reconcile runs from two pokes, both covering the full supported set for the surface (cursor excluded in cloud; a PATH-provided agent is no longer excluded — R2.0 installs a managed copy alongside it):

- the startup pass (`spawn_startup_pass` in
  [`runtime.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs))
  on every runtime boot, after seed hydration;
- an explicit request (the settings pane's reinstall action, or a scoped
  `POST /v1/agents/reconcile`).

Both funnel into the single observable reconcile job: one slot, agents converged sequentially, internal pokes waiting out a busy slot (250ms retry) rather than dropping. Progress is polled, not pushed: `GET /v1/agents/reconcile` reports per-agent, per-role phase and download progress, and the desktop polls it continuously (`useAgentReconcileStatusQuery` in [`sdk-react/src/hooks/agents.ts`](../../../anyharness/sdk-react/src/hooks/agents.ts) — 1.5s while a job runs, 750ms while downloading, 30s idle discovery).

The runtime binary is always the FLOOR transport, on every surface: `catalog.json` is compiled into the runtime (`include_str!` in [`catalog/bundled.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/bundled.rs); a document that fails validation fails the build), so which harness pins a machine is on is answered by one number — the runtime version — and a runtime binary update delivers new pins by definition. **A machine that never fetches anything is fully correct**, on this floor alone, exactly as it always was.

Since the publisher lane (FR-1), a SECOND transport exists alongside the floor: a signed, versioned catalog+registry artifact ([`catalog/artifact.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/artifact.rs)), fetched at BOOT ONLY, behind an env gate an operator must set (`ANYHARNESS_CATALOG_ARTIFACT_BASE_URL`, `ANYHARNESS_CATALOG_CHANNEL` default `"stable"`). Absent, the lane is inert and nothing downstream of that check is ever consulted — no client is constructed, no request is ever made. This is a conscious supersession of commit 796ff1f08's conclusion that the binary is the ONLY transport a runtime process ever consults, made because a signed, boot-only artifact can close roughly a day of the nightly-train's catalog lag without reopening the hazard 796ff1f08 closed: a mid-lifetime push that could move a pin under running work.

That hazard is closed by construction, not by convention. The staged- vs-bundled decision — which document actually becomes the active catalog — is made exactly ONCE, at `CatalogSyncService` construction, before `AppState::new` runs, and never revisited: **the active catalog is immutable for the lifetime of the runtime process**, the same invariant 796ff1f08 established, now proven by `sync.rs`'s `active_catalog_is_immutable_for_the_process_lifetime` tripwire test regardless of which transport supplied the winner. Pins can never move under a machine mid-work; harness installs mutate only across a restart, when nothing is running, and a fetched artifact only ever competes for the NEXT boot's decision. Boot sequence:

1. **The lane gate is env-AND-key, not env-alone.** The base-url env
   (`ANYHARNESS_CATALOG_ARTIFACT_BASE_URL`, and it must resolve to an
   `https://` URL — anything else, including bare `http://`, is refused and
   treated as absent) must be set AND a signing pubkey must be baked in.
   Either being missing makes the ENTIRE staged lane inert — not just the
   network fetch: the warm-cache load of a previously staged directory is
   gated the same way, so a directory left on disk by a differently-built
   binary can never activate on a build that lacks the key.
2. If the gate is open: one best-effort fetch, bounded to a hard 3s timeout
   and a 4 MiB response-size ceiling per file, of the channel's rolling
   manifest and the catalog+registry files it names. The manifest itself is
   minisign-verified FIRST, before its `catalogVersion`/`registryVersion` are
   trusted for anything (including building the versioned URLs the documents
   are fetched from) — otherwise a forged-but-unsigned manifest pointing at
   an old, still-validly-signed pair could walk a runtime backwards. The two
   documents are then sha256-verified against the manifest and
   minisign-verified against the baked publisher pubkey (a signing trust
   domain distinct from desktop app signing; a second const slot exists for
   a two-release rotation), gated through the SAME parse/validate/
   registry-pairing checks the bundled floor runs, and checked for version
   identity between the manifest and the documents it names. Any failure —
   fetch, signature, gate, or version-identity — logs a typed
   `CATALOG_ARTIFACT_REJECTED`.
3. If this boot's fetch succeeded, the ALREADY-verified in-memory pair
   activates directly — no disk round-trip. If it failed (or the gate was
   closed), the runtime falls back to whatever a PRIOR boot staged to
   `runtime_home/catalog/staged/`, re-running the full minisign verification
   over the exact staged bytes (the `.minisig` files are persisted alongside
   the staged documents for exactly this) plus every parse/validate gate —
   a staged directory is untrusted input to a fresh process until it
   re-verifies signatures itself, not just schema-shape.
4. Decide once: the staged pair (freshly fetched or reloaded-and-reverified
   from disk) wins over the bundled floor iff it passed every gate AND its
   `generatedAt` is strictly newer than `max(bundled floor, this machine's
   persisted activation high-water mark)`, comparing RFC3339 instants —
   never the dotted `catalogVersion` string lexicographically (`.9` sorts
   after `.10`). The high-water mark
   (`runtime_home/catalog/activated.json`, tolerant read/write) records the
   `generatedAt` of the last artifact this machine ever activated, across
   restarts, so a still-validly-signed but OLDER artifact can never win once
   a newer one has already been active here — downgrade resistance the
   bundled-floor comparison alone cannot provide, since the floor never
   moves. The mark is written only after a successful activation decision.
   Catalog and registry always activate as the SAME staged pair; there is no
   path that mixes a staged catalog with the bundled registry or vice versa.
   Publisher caution: the mark is monotonic, so an artifact published with a
   FUTURE `generatedAt` (CI clock skew, manual stamping) pins every machine
   that activates it ahead of later correctly-stamped catalogs until their
   timestamps catch up — the failure is denial-of-update to the bundled
   floor, never activation of anything unsigned, and the remedy is
   republishing with a corrected, newer timestamp.

**Registry consumers outside `CatalogSyncService`**: auth's launch-facts collection (`auth/launch_facts.rs`, `registry_flag_vars` and `collect_launch_env_facts_with_ambient`) cannot reach the constructed `CatalogSyncService` without invasive plumbing through several launch call sites, so it reads through a documented process-global (`catalog::sync::active_agent_registry`), published exactly once at `CatalogSyncService` construction — the same one-decision, immutable-after- boot discipline as the active catalog itself. This closes the residual called out in earlier revisions of this document: a staged registry that advertises a new agent now yields consistent launch-facts instead of the collector silently reading the bundled floor underneath an activated staged registry.

This also keeps the runtime version the rollback unit of record for the floor, and adds a second, faster rollback unit for the publisher lane: re-publishing an OLDER immutable version onto the channel's rolling pointer (`catalogs/agents/<channel>/manifest.json`) rolls every FUTURE boot back, without a new runtime release — see "The publisher pipeline" below for the exact procedure. Neither rollback path can race the other: a runtime that already booted keeps whatever it activated, by the same immutability invariant.

### The publisher pipeline

`.github/workflows/publish-agent-catalog.yml` runs on every `catalogs/agents/**` change that lands on `main` (or manual dispatch): it re-runs `scripts/validate-agent-catalog.mjs`, builds a manifest (`scripts/generate-agent-catalog-manifest.mjs`: `catalogVersion`, `registryVersion`, `generatedAt`, and a per-file sha256), minisign-signs `catalog.json`, `registry.json`, AND the manifest itself (`manifest.json.minisig`, same key) with the `AGENT_CATALOG_SIGNING_*` CI secrets (a trust domain separate from desktop app signing; the job fails with a clear message rather than publishing unsigned if those secrets are not yet provisioned) — the manifest signature is what lets the runtime trust `catalogVersion`/`registryVersion` before it ever builds a versioned URL from them (see boot-sequence step 2 above) — and publishes following the desktop updater's S3 pattern exactly: a `head-object` refuse-existing guard plus `--if-none-match "*"` and `max-age=31536000, immutable` on the versioned, never-overwritten path (`catalogs/agents/<catalogVersion>/...`, now including `manifest.json.minisig`), then a short-cached (`max-age=300`) rolling pointer at `catalogs/agents/<channel>/manifest.json` plus its `.minisig` sibling, with a CloudFront invalidation scoped to both rolling-pointer paths only — never the immutable versioned paths.

**Rollback**: every version this job publishes stays in S3 forever, so rolling back is a manual `aws s3 cp` of an OLDER version's `manifest.json` onto the rolling pointer, plus a CloudFront invalidation of that pointer — the publish job itself is not involved and does not re-run old commits.

**Signing-key rotation**: two-release choreography, no automation. Ship the new pubkey alongside the old one (the second const slot in `artifact.rs`) in release N; every artifact published between N and N+1 keeps signing with the OLD key so already-running fetch code (which only knows the old key) still verifies. Drop the old key in release N+1, once every runtime that could still be checking it has had a release cycle to pick up the new one.

**Channel resolution**: the server's `GET /meta` gains an additive `agentCatalog: {channel, artifactBaseUrl} | null` field (`None` unless an operator configures `AGENT_CATALOG_ARTIFACT_BASE_URL`); a desktop shell or cloud worker that sees it non-null passes the two env vars through to its runtime sidecar launch. This is advertisement, not a push — the runtime still only ever fetches once, at its own boot.

**Convergence telemetry, never desired state**: the worker heartbeat carries a read-only `catalogVersion`, polled each tick from the runtime's own `GET /v1/catalogs/agents/version` (mirrors [`launch_options_sync.rs`](../../../anyharness/crates/proliferate-worker/src/launch_options_sync.rs)'s non-fatal pattern), and the server stores it alongside `anyharness_version` on the runtime-worker row purely for a fleet- convergence dashboard. There is no field in either direction that acts on this value — the catalog sync/push channel 796ff1f08 deleted stays deleted; this is observation only.

There is no per-tenant executable catalog overlay. Legacy `agent_catalog_override` storage is not read by launch-option projection and cannot add, remove, hide, alias, or default a model or control. A tenant differs only when its selected execution target reports different `HarnessLaunchOptions`; Cloud copies that target state verbatim by sandbox and harness.

### Runtime binary convergence (cloud)

Runtime binary convergence for cloud targets — how the supervisor, worker, and server coordinate to swap binaries and how the binary-is-catalog principle makes catalog freshness a side effect of runtime updates — is owned by [Managed Runtime](managed-runtime.md).

## The update pipeline

The catalog is regenerated by the probe pipeline, nightly and on demand (`.github/workflows/catalog-probe.yml`, and locally via `make catalog-update`):

1. Resolve fresh pins from the registry
   ([`scripts/agent-catalog/resolve-pins.mjs`](../../../scripts/agent-catalog/resolve-pins.mjs)).
   The registry's install
   spec declares, per artifact, exactly where "latest" is asked for, and
   the resolver dispatches on the spec's `kind`: `direct_binary` GETs the
   declared `latestVersionUrl` (a provider-published text file whose body
   is the version) and takes checksums from the provider's manifest
   beside the binaries; `tarball_release` asks the GitHub releases API
   for the latest tag and uses published asset digests — for the CLI
   archive and for each declared `companions[]` sidecar (codex's
   `codex-code-mode-host`, a separate asset of the same release), which
   the installer places beside the CLI so it is on the launcher's `PATH`
   and readiness plans a reinstall when a pinned companion is missing
   ([pinned.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/pinned.rs),
   `ReinstallReason::MissingCompanion`);
   `registry_backed` reads the public ACP registry document and takes
   the entry's version and distribution. Exact-pinned specs (our forked
   adapters: a git commit for claude's, an exact npm version for
   codex's) are carried through verbatim — the resolver never asks
   whether they moved, which is what makes an adapter bump a reviewed
   `registry.json` edit rather than an automatic pickup. Unknown hashes
   are computed by downloading; known ones are reused. Pins are resolved for
   every platform `Platform::registry_key()` can report (macOS arm64/x64, Linux
   x64/arm64, Windows x64/arm64); a platform absent from the resolver's list is
   a platform whose install fails closed at runtime with
   `InstallError::NoPinForPlatform` (HTTP 400 `AGENT_NO_PIN_FOR_PLATFORM`).
   Passing `--keep-versions` re-resolves the versions the lockfile already pins
   instead of upstream latest, which is how a platform is added to an existing
   catalog without drifting a pin away from the probe evidence that validates
   it; under that flag a `registry_backed` entry whose ACP registry version has
   moved on is left untouched rather than silently upgraded.
2. Resolve and validate distribution pins plus presentation metadata into
   `catalog.draft.json`; the pipeline never copies probe-observed executable
   options into the document.
3. Promote the validated draft to the lockfile byte-for-byte.
4. A separate job with no provider credentials opens the PR. A human
   reviews the diff and merges; the merge moves the fleet by riding the
   next runtime release (the nightly app build for desktops, the runtime
   binary roll for cloud sandboxes).

The scheduled run's credentials live only in the protected `Catalog Probe` GitHub environment; provisioning, rotation, revocation, and failure response are [catalog-probe.md](../../../guides/operating/catalog-probe.md). The routine update procedure (bump a harness, review a probe PR, roll back) is [agent-catalog-update.md](../../../guides/operating/agent-catalog-update.md).

Three CI gates hold the documents honest:

- [`scripts/validate-agent-catalog.mjs`](../../../scripts/validate-agent-catalog.mjs):
  structural invariants without a Rust toolchain, including registry pairing
  and rejection of executable model/control/default/fallback fields.
- The Rust validation
  ([`catalog/validation.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/validation.rs),
  exercised by every test and at binary load): an invalid checked-in
  catalog cannot boot.
- [`scripts/agent-catalog/check-version-discipline.mjs`](../../../scripts/agent-catalog/check-version-discipline.mjs):
  version format and monotonicity against the PR base.

## Readiness projection

Per target and harness, the runtime answers what the product may offer ([`anyharness-lib/src/domains/agents/readiness/`](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness)):

| State | Meaning |
| --- | --- |
| `InstallRequired` | No managed install and no manifest; transient — the next reconcile pass auto-installs, and the UI shows its progress |
| `Unsupported` | A runtime compatibility gate failed (for example claude's minimum Node version) |
| `CredentialsRequired` | Installed, but no auth context's signals match the environment |
| `LoginRequired` | Installed, credentials absent, and the harness has an interactive login path |
| `Ready` | Installed, compatible, and at least one auth context is satisfied |

Readiness is computed from installed artifacts, registry-declared auth contexts, and detected credentials. One function owns the answer (`compute_readiness` in [`readiness/status.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/status.rs)), recomputed fresh from disk on every read — no cache, so it can never be stale, only honest about what is on disk right now. "Installed" is file presence plus executable bit; the install manifest decorates the version string but never gates readiness. The agent-auth route can upgrade a credential state (a gateway selection satisfies the `gateway` context) but never clears `InstallRequired` or `Unsupported`; a route cannot conjure a binary. Launch-time validation reloads one current target observation at session create. Unknown models, controls, values, omissions, and basis mismatches fail before the actor starts; the catalog is never executable truth.

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

Stated boundaries: readiness is an offline judgment — a revoked but unexpired token reads `Ready` and fails at the vendor; and opencode's `provider_managed` policy is structurally always-`Ready` (it resolves provider auth itself at prompt time), so its real auth state is represented by agent-auth's selection set, not this projection.

This projection is the data source for the per-harness settings surface (install state, auth method status, login readiness) and for launch options in the composer.

## Code map

| Layer | Path | Owns |
| --- | --- | --- |
| Documents | [`catalogs/agents/`](../../../catalogs/agents) | registry.json (method), catalog.json (lockfile), registry.schema.json |
| Document handling | [`anyharness-lib/src/domains/agents/catalog/`](../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog), [`registry/`](../../../anyharness/crates/anyharness-lib/src/domains/agents/registry) | Parsing, validation, registry pairing, bundled copies, read routes |
| Install | [`anyharness-lib/src/domains/agents/installer/`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer) | Pin materialization, manifests, seed hydration, the reconcile job |
| Readiness | [`anyharness-lib/src/domains/agents/readiness/`](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness) | Artifact resolution, compatibility gates, credential classification, launch validation |
| Producer | [`scripts/agent-catalog/`](../../../scripts/agent-catalog) | resolve-pins, probe runner, collation, version discipline, draft |
| Cloud binary transport | [`proliferate-worker/src/supervisor_bridge/`](../../../anyharness/crates/proliferate-worker/src/supervisor_bridge) + [`proliferate-supervisor/`](../../../anyharness/crates/proliferate-supervisor) | Worker-written update requests; supervisor-owned swap, restart, rollback |
| Version pins | [`server/proliferate/server/version.py`](../../../server/proliferate/server/version.py) | Release-CI-stamped `RUNTIME_VERSION`/`WORKER_VERSION` advertised in heartbeat acks |

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

- [x] ~~The legacy cloud topology still exists beside the supervisor~~ —
      deleted by the cull sweep's delete-worker-legacy track: the
      worker-owned in-place runtime swap, the worker's self-`exec` update,
      the D5 bridge, and the `PROLIFERATE_SUPERVISOR_OWNED_RUNTIME` gate
      are all gone; the supervisor mailbox is the only convergence path.
- [ ] Two known readiness inefficiencies, neither a correctness law:
      claude's Node gate shells out uncached on every read, and the
      journal-protected atomic activation guard
      ([`installer/downloads/activation.rs`](../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/downloads/activation.rs))
      covers only `Archive`-sourced agent-process installs (cursor,
      opencode) — claude's git install and codex/grok's npm installs
      have no equivalent guard.
