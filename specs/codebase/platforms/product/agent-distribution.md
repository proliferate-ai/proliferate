# Agent Distribution

Status: target. The body is written in the ideal state. Every difference from
`main` today is listed in [Current gaps](#current-gaps); the list shrinks as
follow-up PRs land, and the label comes off when it is empty.

This document replaces `agent-catalog-readiness.md`, which was written as a
migration playbook and had served its purpose.

## Purpose

Agent distribution answers five questions for the coding-agent harnesses
(claude, codex, opencode, cursor, grok): what an agent is, how it gets onto a
machine, how a machine knows it is current, how the definitions themselves get
updated, and what the product sees. Everything downstream (auth selection,
model pickers, session launch) consumes this platform's answers.

Boundaries: which credential a user selects for a harness and `state.json`
materialization belong to agent-auth. Model snapshot freshness and
picker-facing model data belong to the model catalog. Gateway model lists
belong to the [model gateway](model-gateway.md); this platform knows only
whether a harness supports the gateway route, never which models it serves.

## The two documents

An agent is defined by two JSON documents in `catalogs/agents/`, split by
who writes them:

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
  content changes (`scripts/agent-catalog/check-version-discipline.mjs`).
- `catalog.draft.json` under `scripts/agent-catalog/` and the bundled
  `catalogs/agents/catalog.json` are byte-identical; the draft is the
  pipeline's output and the lockfile is its promotion.

## Installation

The installer materializes exactly what the catalog pin says and nothing
else. Downloads are sha256-verified; npm and git installs use the pinned
specifier. Fail-closed rules, enforced in code
(`anyharness-lib/src/domains/agents/installer/`):

- No pin for the platform means no install. There is no fallback to "npm
  latest", no resolving the registry spec at install time, no adopting a
  binary found on PATH.
- Every install writes `install-manifest.json` next to the artifacts,
  recording the version and sha256 actually materialized. The manifest is
  the durable half of every later drift check.
- Installed adapters get a generated launcher script that `exec`s the
  resolved binary with the pin's baked ACP args; per-session flags are
  applied by the runtime at spawn, never baked into the launcher.

Install topology differs by surface:

| Surface | claude, codex | opencode, grok | cursor |
| --- | --- | --- | --- |
| Desktop | Seeded: the app bundles a prebuilt seed archive (`scripts/build-agent-seed.mjs`), hydrated into the runtime home at launch | Installed on demand from the UI or at session start | Installed on demand (local only) |
| Cloud (E2B) | Baked into the template image at build (`scripts/build-template.mjs`) | Cold-installed at session start | Not supported in cloud |

The seed and the bake are the same install run executed early; both write
the same manifests, so the reconcile below treats seeded, baked, and
on-demand installs identically.

## Convergence

One law: an installed agent converges to the active catalog's pin whenever
the active catalog changes. One planner enforces it
(`installer/install_policy.rs`): compare the install manifest against the
active pin and reinstall on drift, in precedence order requested reinstall,
missing recorded version, version drift, checksum mismatch.

Two transports deliver a new active catalog, split by cost:

- **The binary carries the catalog.** `catalog.json` is compiled into the
  runtime (`include_str!` in `catalog/bundled.rs`; a document that fails
  validation fails the build). A runtime binary update therefore delivers
  new pins by definition, and the startup pass
  (`runtime.rs::spawn_startup_pass`) reconciles installed agents against
  them. This is the only transport on desktop: the app updates on the
  nightly release train, and each update converges harnesses at next
  launch. Desktop deliberately has no faster lane; hot-swapping harness
  binaries under a live session is worse than a one-day lag.
- **The heartbeat carries the catalog (cloud only).** Sandboxes are
  long-lived and catalog changes are frequent, so pin changes must land
  without a runtime binary roll. The server advertises its served catalog
  version in every worker heartbeat
  (`runtime_workers/service.py::record_heartbeat`); on mismatch in either
  direction the worker fetches `GET /catalogs/agents` from the server
  (ETag-aware) and PUTs the document into the runtime
  (`proliferate-worker/src/catalog_sync.rs`). The runtime validates,
  swaps the document in memory, and pokes the same reconcile. "Either
  direction" is the rollback story: reverting the catalog PR converges
  the fleet backward on the next heartbeat. The applied document is not
  persisted; a restart reverts to the bundled catalog and the next
  heartbeat re-converges.

The cloud runtime binary itself also converges over the heartbeat
(`proliferate-worker/src/anyharness_update.rs`: sha-verified download,
`--version` preflight, stop/swap/relaunch with a `.prev` rollback copy),
so the layering on cloud is: binary update is the slow, disruptive
transport for code; catalog sync is the fast, non-disruptive transport
for pins.

The registry has no live transport on purpose. It only ships inside a new
binary: changing install method or auth vocabulary is a code-review-and-
release event, never a runtime push.

## The update pipeline

The catalog is regenerated by the probe pipeline, nightly and on demand
(`.github/workflows/catalog-probe.yml`, and locally via
`make catalog-update`):

1. Resolve fresh pins from the registry
   (`scripts/agent-catalog/resolve-pins.mjs`): query npm, GitHub releases,
   and the public ACP registry; compute or verify sha256s; reuse known
   hashes for unchanged artifacts.
2. Install exactly those pins and launch every harness over ACP under
   every configured auth context, recording what each attested at
   `initialize` and what it advertised (models, modes, controls). Snapshot
   evidence is committed under `scripts/agent-catalog/generated/`.
3. Collate passed snapshots into `catalog.draft.json`, finalize pins only
   for freshly probed agents, carry unchanged agents forward, and promote
   the draft to the lockfile byte-for-byte.
4. A separate job with no provider credentials opens the PR. A human
   reviews the diff and merges; the merge is what moves the fleet (server
   deploy feeds heartbeats, the nightly app build feeds desktops).

The scheduled run's credentials live only in the protected `Catalog Probe`
GitHub environment; provisioning, rotation, revocation, and failure
response are [catalog-probe.md](../../../developing/operating/catalog-probe.md).
The routine update procedure (bump a harness, review a probe PR, roll
back) is
[agent-catalog-update.md](../../../developing/operating/agent-catalog-update.md).

Three CI gates hold the documents honest:

- `scripts/validate-agent-catalog.mjs`: structural invariants without a
  Rust toolchain, including registry pairing and snapshot-evidence
  cross-checks.
- The Rust validation (`catalog/validation.rs`, exercised by every test
  and at binary load): an invalid checked-in catalog cannot boot.
- `scripts/agent-catalog/check-version-discipline.mjs`: version format
  and monotonicity against the PR base.

## Readiness projection

Per target and harness, the runtime answers what the product may offer
(`anyharness-lib/src/domains/agents/readiness/`):

| State | Meaning |
| --- | --- |
| `InstallRequired` | No managed install and no manifest; the UI offers install |
| `Unsupported` | A runtime compatibility gate failed (for example claude's minimum Node version) |
| `CredentialsRequired` | Installed, but no auth context's signals match the environment |
| `LoginRequired` | Installed, credentials absent, and the harness has an interactive login path |
| `Ready` | Installed, compatible, and at least one auth context is satisfied |

Readiness is computed from installed artifacts plus the catalog's auth
contexts plus detected credentials. The agent-auth route can upgrade a
credential state (a gateway selection satisfies the `gateway` context) but
never clears `InstallRequired` or `Unsupported`; a route cannot conjure a
binary. Launch-time validation applies the same catalog data at session
create: an unknown model is rejected as unsupported, a model whose
availability requires an absent auth context is rejected as gated, with
the missing contexts named.

This projection is the data source for the per-harness settings surface
(install state, auth method status, login readiness) and for launch
options in the composer.

## Code map

| Layer | Path | Owns |
| --- | --- | --- |
| Documents | `catalogs/agents/` | registry.json (method), catalog.json (lockfile), registry.schema.json |
| Document handling | `anyharness-lib/src/domains/agents/{catalog,registry}/` | Parsing, validation, registry pairing, catalog sync service, bundled copies |
| Install | `anyharness-lib/src/domains/agents/installer/` | Pin materialization, manifests, seed hydration, the reconcile job |
| Readiness | `anyharness-lib/src/domains/agents/readiness/` | Artifact resolution, compatibility gates, credential classification, launch validation |
| Producer | `scripts/agent-catalog/` | resolve-pins, probe runner, collation, version discipline, draft |
| Distribution | `server/proliferate/server/catalogs/` | Serving the checked-in catalog with ETag; version for heartbeats |
| Cloud transport | `anyharness/crates/proliferate-worker/src/{catalog_sync,anyharness_update}.rs` | Heartbeat-driven document push and runtime binary self-update |

## Failure modes

- Probe run fails for one harness: the pipeline carries the previous
  agent entry forward; the fleet keeps the last good pin. A scheduled
  failure opens an owned GitHub issue (see catalog-probe.md).
- Install fails (checksum mismatch, fetch failure, no pin for platform):
  the reconcile outcome records the error and the agent stays at
  `InstallRequired`; retry is idempotent on the next pass.
- Pushed catalog fails validation: the runtime rejects the PUT and keeps
  its active document; the worker retries on a later heartbeat.
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
