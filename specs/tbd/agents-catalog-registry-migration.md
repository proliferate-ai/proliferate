# Agents Catalog + Registry Migration (the "merge-order (b)" stack)

Status: non-authoritative migration plan, finalized 2026-06-10. The operating
law it implements is
[../codebase/structures/anyharness/guides/mental-model.md](../codebase/structures/anyharness/guides/mental-model.md)
and the layer guides. The empirical foundation is the shipped probe pipeline
(#611, #614). Companion backlog:
[anyharness-grammar-adoption-backlog.md](anyharness-grammar-adoption-backlog.md).
Delete sections as PRs land; delete the file when the stack is merged.

## 1. Goal

For each harness, at the exact version we ship, know with certainty: which
models exist, which modes/options exist (thinking/reasoning included),
per-model variation, and availability as a pure function of observed auth
state — and make the runtime *obey* that knowledge: version-pinned installs,
drift-driven reconcile, and auth-aware menus end to end.

Empirically validated foundations (all observed in real probe data):

- Availability is **non-monotone** in auth: credentials can add models, remove
  them (OpenCode free tier), or swap the whole menu (Claude API-key vs OAuth).
- **Menu ≠ availability**: models can be launchable while never advertised
  (fable/opus on API key). Only a completed inference turn counts as proof.
- Harnesses have **credential precedence**: an inherited API key masks an
  OAuth token (the probe env-leak incident, now a deliberate experiment).
- Version skew is real: codex native CLI 0.139 shipping an embedded 0.125 core
  was caught by `agent_info` attestation.

## 2. The 20k view: the agent supply chain

```text
 vendors ship          (new CLIs, adapters, models, modes — outside our control)
      │
 1. PROBE measures     anyharness catalog-probe: harness × auth-context matrix,
      │                real-inference trials, attestation, credential scrub  [SHIPPED]
 2. BUILD collates     build-catalog.mjs: observed-set availability, variant
      │                normalization, curation overlay → catalog v2 draft    [SHIPPED]
 3. CATALOG declares   WHICH: versions (pins), models, options, availability
      │                + probedAgainst registry pairing      [draft v2 ✓, runtime eats v1]
 4. TRAIN ships it     existing release train (server image / E2B template /
      │                desktop bundle) + ONE new transport: runtime fetch of
      │                newer doc (ETag endpoint exists server-side)          [REMAINING]
 5. RUNTIME obeys      plan-then-apply reconcile: manifests vs pins →
      │                targeted reinstall. ONE engine, FOUR triggers         [REMAINING]
 6. SESSIONS consume   menus + launch validation per active auth context;
      │                desktop/server projections                            [REMAINING]
 7. CHAIN attests      pin (declared) → install manifest (on disk) →
      └──────────────→ agent_info (running); drift feeds back into 5        [partial]
```

**Two documents, one direction.** `registry.json` = the slow, hand-curated
**HOW** (install strategies, auth slots + source vocabulary, launch
templates). `catalog.json` = the fast, probe-generated **WHICH** (version
pins, models, per-model option matrices, auth contexts + availability).
Catalog references registry (`probedAgainst.registryVersion`); registry never
knows the catalog exists.

**Truth taxonomy** (binds the chain to the mental model):

| Link | Truth kind | Owner |
| --- | --- | --- |
| catalog pins, registry spec | static (declared); wholesale-refreshable via sync | `catalog/`, `registry/` |
| install manifest | durable (proven on disk) | `installer/manifest.rs` |
| `agent_info` at ACP initialize | live (proven running) | live driver |
| readiness + drift, active auth contexts | derived (recomputed, write-free) | `readiness/`, `auth/context.rs` |

Doctrine amendment this introduces: *static truth may be wholesale-refreshed
by a sync concern; consumers never observe a partial update; a successful swap
fires reconcile.*

## 3. Target domain layout (each remaining item homed)

```text
domains/agents/
  runtime.rs               # facade — reconcile/update use-cases ride here
  model.rs
  registry/                # HOW (unchanged role)
    schema.rs              #   + auth-slot source vocabulary: env vars tagged
    │                      #     secret|flag, named discovery kinds
    │                      #   + registryVersion surfaced (probedAgainst pairing)
  catalog/                 # WHICH — the upgrade target
    schema.rs              #   v2 structs = THE source of truth; pydantic/TS
    │                      #     generated from it; validator consumes it
    service.rs             #   the ONLY read surface (see §5.4)
    validation.rs          #   v2 invariants incl. signals ⊆ slot vocabulary
    projection/            #   v2 → domain types (availability resolution)
    bundled.rs             #   compiled-in copy (never rewritten at runtime)
    sync.rs                #   ETag fetch → validate → atomic swap → poke reconcile
  installer/
    service.rs
    install_policy.rs      #   PURE: (pins, manifests, disk, options) → InstallPlan
    manifest.rs            #   install-manifest.json read/write (atomic)
    npm.rs / native.rs / agent_process.rs / downloads.rs / managed_npm.rs
    lock.rs
    reconcile.rs           #   bulk plan-then-apply; one engine, four triggers
    seed/
  auth/
    service.rs             #   selections, overlays, login
    context.rs             #   PURE classifier: credential facts → ActiveAuthContexts
    credentials.rs         #   re-derived as projection of classification
    config/ · login.rs · login_terminal.rs
  readiness/               #   derived: descriptor × manifest × pins × contexts
    │                      #     → ResolvedAgent (+ version-drift status)
  model_registry/          #   DEMOTED in PR-7 (catalog/service subsumes it)
```

## 4. Current consumption (verified, to be preserved through migration)

```text
catalogs/agents/v1/{catalog,registry}.json
  ├─► server/catalogs/{api,service}.py  GET /v1/catalogs/agents
  │     (Cache-Control: max-age=300, stale-while-revalidate=86400; schemaVersion=1)
  │     └─► cloud SDK getCloudAgentCatalog() ─► desktop
  │           lib/domain/settings/*: cloud registries MERGED with runtime launch
  │           options (mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries)
  └─► anyharness catalog/bundled.rs (compile-time include, validated once)
        ├─ sessions/service/create.rs   mode validation
        ├─ readiness/launch_options     → the runtime side of the desktop merge
        └─ model_registry/              dynamic discovery snapshots

LIVE TRUTH (unchanged by this migration): the actor's native session reports
available_models + current model/mode at start (actor/state.rs); persisted as
live_config snapshots. Catalog is never active-session truth post-start.
```

The expectation ladder already exists and survives v2 — each layer yields to
the one below it:

```text
cloud catalog (optimistic) → runtime launch options (target-corrected)
  → live actor (truth)
```

v2 replaces the *content quality* of the expectation layers and deletes the
model-registry rung; it does not change the ladder.

## 5. Core flows

### 5.1 Version convergence (bump / update / fresh install)

```text
probe CI run → catalog PR (viewer diff) → merge to main
   ├─► release train (existing): server image · E2B template · desktop bundle
   ├─► HEARTBEAT CONVERGENCE (new, the fleet path):
   │     heartbeat response carries { catalogVersion, registryVersion }
   │     worker compares to ACTIVE versions → mismatch →
   │     catalog/sync: ETag fetch → validate → atomic swap → reconcile
   │     ⇒ fleet convergence latency = one heartbeat interval, both platforms,
   │       no polling loop, fetch only on mismatch
   ├─► anyharness START (incl. first run): seed hydrate → reconcile
   │     fresh install: no manifests → full pinned install; menus render from
   │     bundled doc immediately (no network), corrected when cloud doc differs
   └─► manual: worker control "reconcile now" · desktop Settings button
```

Safety invariant: a runtime always holds *some* valid catalog (bundled);
every replacement is validated-then-atomic; reconcile is idempotent — arrival
order (binary first vs document first) never matters.

### 5.2 The reconcile engine

```text
RESOLVE   catalog pins + install-manifest.json per agent + disk probe
DECIDE    install_policy::plan_reconcile (PURE), per agent × artifact role:
            pin == manifest.version && sha256 ok && exists → Keep
            artifact missing                               → Install(Missing)
            manifest.version != pin                        → Reinstall(VersionDrift{from,to})
            sha256 mismatch                                → Reinstall(Corrupt)
            manifest.source != pinned source               → Reinstall(SourceChanged)
APPLY     per agent under AgentInstallLock: mechanisms execute ONLY drift steps;
          manifest written atomically (tmp+rename) after each artifact
ATTEST    readiness recomputes pin × manifest; at next session start,
          agent_info vs manifest → drift warning (never a launch block)
```

Policy decisions:

- **Two artifact classes, two strictness levels.** Agent process (our ACP
  adapter): strictly pinned, always managed, PATH never consulted. Native CLI
  (vendor's, user-managed login state): record observed PATH version in the
  manifest, surface drift vs pin as a readiness warning, managed-install at
  pin only when no usable PATH binary exists. *We pin what we own; we attest
  what we don't.*
- **In-place binary swap** (unix file-handle semantics keep running sessions
  alive; new sessions get the new binary). No versioned dirs, no blue/green.
- **`reinstall: true`** (user "Reinstall" button) = same engine, policy forced
  to Reinstall-all.
- Install manifest shape (per agent, per artifact):

```json
{ "schemaVersion": 1,
  "agent": "codex",
  "artifacts": [{
    "role": "agent_process",
    "version": "0.12.0",
    "sha256": "…",
    "source": "registry_npm:@proliferateai/codex-acp",
    "installedAt": "2026-06-10T18:00:00Z",
    "catalogVersion": "2026-06-10.6"
  }, {
    "role": "native_cli",
    "version": "0.139.0",
    "observedOnPath": true,
    "sha256": null,
    "source": "path",
    "installedAt": "2026-06-10T18:00:00Z"
  }] }
```

### 5.3 Catalog consumption map

```rust
// domains/agents/catalog/service.rs — the ONLY way anything reads the catalog
impl AgentCatalogService {
    pub fn pins(&self, kind) -> HarnessPins;                       // installer, readiness
    pub fn models(&self, kind, ctx: &ActiveAuthContexts) -> Vec<CatalogModel>; // availability ∩ ctx
    pub fn visible_models(&self, kind, ctx) -> Vec<CatalogModel>;  // defaultVisible ∩ available
    pub fn controls(&self, kind, model_id) -> ControlMatrix;       // modes/options + variantSyntax
    pub fn validate_launch(&self, kind, ctx, model, mode)
        -> Result<ResolvedSelection, SelectionUnsupported>;        // replaces resolve_launch_model_id
}                                                                  //   + resolve_mode_id
```

| Consumer | Reads | When |
| --- | --- | --- |
| installer / reconcile | `pins()` | every reconcile |
| readiness | `pins()` | every resolve (drift status) |
| sessions create | `validate_launch()` | resolve phase — *where model_registry dies* |
| desktop / server | `visible_models()` + `controls()` | menu render, per known contexts |
| probe pipeline | writes only | CI |

Semantic rules: `defaultVisible` is the menu, `availability` is the truth
(`validate_launch` accepts launchable-but-unadvertised models); model is an
entity, never a mode; curation lives in the document, never in consumer code.

### 5.4 Auth-context classification (env vars ↔ catalog contexts)

The probe defined each auth context by which credentials it injected; each
context therefore has a detection signature. Runtime classification mirrors
it:

```text
LAYER 1  DETECTORS → FACTS (anyharness-credential-discovery)
         facts, never verdicts; presence only for secrets:
           env:ANTHROPIC_API_KEY              (secret: presence only)
           envflag:CLAUDE_CODE_USE_BEDROCK=1  (flag: value readable)
           discovery:claude-oauth-creds       (kind-preserving — the detectors
           discovery:claude-config-api-key      already compute kinds internally;
           discovery:aws-credential-chain       stop collapsing them to Present)
           discovery:opencode-auth-json/anthropic
         ProviderId closed enum → open ids; LocalAuthState → Vec<CredentialFact>
         NEW detectors: aws-credential-chain (env pair | ~/.aws profile | SSO
         cache — passive sources only), opencode auth.json, cursor keychain.

LAYER 2  REGISTRY SLOT = source vocabulary (HOW)
         per slot: env vars (each tagged secret|flag) + discovery kinds.
         The validation universe, nothing more.

LAYER 3  CATALOG authContexts = ORDERED signatures (WHICH)
         minimal algebra — every operator must be probe-testable:
           env | envFlag | discovery | anyOf | allOf      (no NOT, depth ≤ 2)
         { "id": "anthropic-bedrock", "authSlotId": "anthropic",
           "signals": { "allOf": [ {"envFlag": "CLAUDE_CODE_USE_BEDROCK=1"},
                                   {"discovery": "aws-credential-chain"} ] } }
         { "id": "anthropic-api",   "signals": {"env": "ANTHROPIC_API_KEY"} }
         { "id": "anthropic-oauth", "signals": {"anyOf": [
             {"env": "CLAUDE_CODE_OAUTH_TOKEN"}, {"discovery": "claude-oauth-creds"}]}}
         LIST ORDER = harness precedence (bedrock > api > oauth), validated
         empirically: the probe injects two contexts' creds simultaneously and
         records which menu wins.

LAYER 4  CLASSIFIER (domains/agents/auth/context.rs, PURE)
         facts × signatures → ActiveAuthContexts
           · ONE winner per slot (first match in catalog order — mirrors the
             harness's own precedence)
           · UNION across slots (opencode multi-provider)
           · baseline iff nothing matched
           · evaluated over the COMPOSED launch env (launch_env::merge of
             workspace env + auth overlay) — never ambient env; classifying
             ambient would reproduce the probe env-leak bug in production
           · secrets rule: values readable only for registry-declared flag vars

LAYER 5  CredentialState = projection of classification
         Ready ⇔ some context active; LoginRequired/MissingEnv derived from
         slot login methods. The parallel logic in domains/agents/credentials/
         is deleted, not duplicated.
```

Context knowledge sync (closes the optimistic gap):

```text
cloud-managed targets:  cloud applied the selections → computes contexts from
                        catalog × selections. Known by construction.
local/SSH targets:      runtime classifies at boot + on auth changes and SYNCS
                        ActiveAuthContexts (context IDS ONLY — no facts, no
                        values) target → cloud, same lane as the registry
                        projection. Cloud knows last-classified contexts.
residual cases:         never-connected target → no menu needed (no sessions
                        possible); offline credential edits → stale in the
                        SAFE direction (model shows gated until re-classify),
                        self-heals on next heartbeat.
```

### 5.5 Optimistic UI + session actor

```text
T0  menu render (no runtime roundtrip): catalog × KNOWN contexts
      (cloud-computed for managed targets; last-synced for local/SSH).
      Models outside known contexts render GATED with their unlock condition
      straight from availability.anyOf:
        "Opus 4.8 — sign in with Claude or add an API key"
      No "unverified" limbo; the menu never shrinks, items resolve or stay gated.
T1  runtime correction: readiness × fresh local classification → exact set;
      gates open/close; synced upward.
T2  session create: validate_launch(kind, contexts, model, mode);
      availability beats visibility; variantSyntax composes variant launch ids;
      classified contexts recorded on the session (provenance: "why this menu").
T3  actor start: native session reports available_models + current — TRUTH.
      Catalog's post-start role is cosmetic (display names for reported ids)
      + diagnostic (actor set ≠ expected set for the context → drift signal,
      readiness warning + probe-attention flag; never a block).

LIVE SWITCHING (hard rule):
  Same-harness model changes are ALWAYS live config changes on the existing
  session — never tear down and recreate. New session only on harness change.
  Switch menu = actor-reported models ∪ catalog-composed variants
  (variantSyntax, filtered to the session's contexts); each entry switches via
  the probe-observed mechanism (switchVia: setSessionModel | configOption).
  Harness rejects a composed variant → surface rejection on the same session.
```

## 6. Decisions ledger (settled)

1. **One physical document** end to end; server is a pipe; curation is a
   build-time overlay in the document, not consumer code.
2. **Heartbeat-carried versions** (`catalogVersion`, `registryVersion`) drive
   fleet convergence; fetch only on mismatch.
3. **Dual-read v1/v2** by `schemaVersion`; two files during transition
   (`catalogs/agents/v2/` beside `v1/`); versioned server endpoints; v1 path
   deleted only after all consumers are on v2.
4. **Pin what we own, attest what we don't** (agent process strict; native CLI
   attested with drift warnings).
5. **In-place swap**; running sessions unaffected; install lock serializes.
6. **Skew never blocks launches** — it warns and feeds the drift signal.
7. **Signals live in catalog authContexts**, validated against the registry
   slot vocabulary at build time; precedence is empirical (probe-validated).
8. **Classification is pure, on the composed launch env, presence-only for
   secrets**; context ids (only) sync target → cloud.
9. **Optimistic menus = catalog × known contexts + gated unlocks**; no
   unknown-state UI.
10. **Same-harness model switch never recreates a session.**
11. **model_registry demoted in PR-7**, untouched before then.
12. **AWS chain: three passive sources only** (env pair, shared-credentials
    profile, SSO cache); the exotic tail (IMDS, process creds) is proven by
    launch/trial, not detection — "menus lie, inference proves."

## 7. The PR stack

```text
PR-0   #607 merges (prerequisite; activates probedAgainst pairing)        [open]
PR-1   refactor(agents): the regroup                                  [in flight]
         structure only, behavior-identical, v1 consumption untouched.
         GATE: cargo check+test green; boundary scripts green; reviewed
         against guides/mental-model.md.
PR-2   feat(installer): install manifests
         write/read per-artifact manifests; readiness surfaces versions;
         cursor provenance via manifest. GATE: fresh + reinstall produce
         manifests; no install behavior change.
PR-3   feat(installer): plan-then-apply reconcile
         install_policy vs pins; reconcile upgraded; agent-process installs
         pinned (kills CDN drift + PATH fallback for owned artifacts).
         FIRST BEHAVIOR CHANGE. GATE: policy unit tests on hand-built
         manifests; drift e2e (stale version → exactly one reinstall); seeds
         respected.
PR-4   feat(catalog): schema v2 in Rust + dual-read
         v2 structs incl. authContexts signals + ordered precedence + pins;
         registry slot source vocabulary (secret|flag tags); build invariant
         signals ⊆ vocabulary; dual-read by schemaVersion; pydantic/TS
         generated. GATE: catalog.draft.json validates; invariants [a]–[i]
         enforced; v1 round-trip unchanged.
PR-5   feat(catalog): sync
         ETag fetch → validate → atomic swap → reconcile poke; heartbeat
         version comparison wired. GATE: stale-ETag no-op; bad payload
         rejected with no partial state; newer doc → reconcile observed.
PR-6   feat(reconcile): trigger matrix
         worker control command + desktop Settings → the one engine.
         GATE: all four triggers hit one code path; concurrent triggers
         coalesce under the install lock.
PR-7a  feat(auth): facts + classification
         discovery crate facts API (kind-preserving, open ids, aws-chain +
         opencode + cursor detectors); auth/context.rs classifier;
         CredentialState re-derived; contexts sync target → cloud.
         GATE: classifier unit-tested per signature incl. precedence;
         no secret values cross any boundary.
PR-7b  feat(catalog): v2 consumption
         sessions validate_launch (model_registry demoted/deleted); desktop
         projection + gated menus; server v2 endpoint; session context
         provenance field; live switch menu ∪ composed variants.
         GATE: menus match probe data per context; old clients keep working
         via v1 endpoint; never-recreate rule enforced in switch path.
PR-8   ci(catalog): probe job + auto-PR; probe matrix extension
         (bedrock/vertex contexts, deliberate precedence experiments).
         GATE: dry-run PR with viewer diff.

Dependency shape: 2→3 chain; 4→5→7b chain; 6 needs 3; 7a needs 4;
the chains join at 7b. After PR-1, the two chains proceed IN PARALLEL.

Parallel track (independent): ACP client 0.10.2→0.14, codex fork rebase,
claude thin-fork — per ~/delete/acp-protocol-and-forks-handoff.md.
```

## 8. Follow-ups riding behind the stack

- Probe: `/v1/models`-sourced trial candidates; opencode models.dev data pin;
  claude `anthropic-oauth` setup-token vs interactive-login surface caveat.
- Enforcement: extend boundary checkers with the grammar smells once PR-1
  validates the standard (per the adoption backlog).
- Worked example spec: written from the merged PR-1 diff (agents as the
  canonical annotated domain).
