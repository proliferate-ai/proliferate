# Testing Standard

How tests are organized across the repo: what each tier owns, where test files
live, what gates merges vs releases, and how a change decides which tests it
must add. [`core-release-validation.md`](core-release-validation.md) owns the
complete target guarantee and qualification semantics;
[`release-worlds-and-fixtures.md`](release-worlds-and-fixtures.md),
[`tier-3-scenario-contract.md`](tier-3-scenario-contract.md), and
[`tier-4-scenario-contract.md`](tier-4-scenario-contract.md) own the live world
and journey composition. `flows.md` is a legacy current-coverage view being
replaced by generated manifest/collector output.

Companion: `specs/developing/qa/README.md` owns *manual* release QA. This doc
owns automated testing. A flow covered by an automated tier here does not also
need a manual QA checklist entry.

---

## The model

Code is state and logic. Every test is defined by which state is real and
where the boundary to fakes sits. Four tiers:

| Tier | What is real | What is faked | Runs | Gates |
| --- | --- | --- | --- | --- |
| **1 — Unit / contract** | Logic; Postgres/SQLite where the guarantee lives in the DB | Everything across a network | Every PR, seconds | **Merge** |
| **2 — Mocked intent** | Server + product browser hosts + real Postgres, booted on ports; real Stripe test mode for billing | AnyHarness, sandbox provider, LLM, IdP, email, Slack, and every other external provider | Every PR, minutes | **Merge** |
| **3 — Live end-to-end** | The selected world's real candidate server/runtime/provider boundaries, real agents on cheap models, and exact deploy artifacts | Boundaries outside the selected world are absent rather than simulated | Release train + nightly | **Release** |
| **4 — Upgrade path** | Exact retained production N−1 state upgraded through the shipped mechanism to exact candidate N | No claimed product boundary; updater/control channels are isolated while their artifacts and verification remain real | Release train | **Release** |

**The gate rule (hard):** the merge gate is tiers 1–2 only. No real LLM or real
sandbox runs in the merge gate. Stripe test mode is the one explicit
real-network exception; trusted CI fails if its test credential or required
billing cells are missing. Tier 3/4 failures block the *release* and file issues
into the issues service — they never block an ordinary merge. Current-main
fail-open exceptions are recorded, without being normalized as success, in
[`core-release-validation.md`](core-release-validation.md#current-enforcement-exception).

**Real-LLM tests assert outcomes, not transcripts.** "Run reached `completed`,
file exists, emit validated against schema" — never "the agent said X."

---

## Tier 1 — unit / contract

Three sub-kinds, in every language:

- **Pure logic (no state).** State-machine transition guards, decision
  matrices, interpolation/escaping, arg coercion, billing math, catalog
  layering, policy checks. Enumerate the matrix, not just the cells you
  thought about.
- **Logic against real state.** When the guarantee IS a property of the
  database (unique index, `ON CONFLICT`, savepoint, transaction boundary,
  crash-resume cursor), the DB must be real — Postgres for server tests,
  SQLite for runtime tests. Fake everything across a network. A crash drill is
  expressed as calling the construction twice (claim CAS returns `None` the
  second time), not as killing processes.
- **Contract fixtures.** Shared JSON shapes that cross a language boundary
  (workflow plan JSON, run status reports, poll pages, catalog entries) get a
  golden fixture under `fixtures/contracts/`. The producing language asserts
  it produces the fixture; each consuming language asserts it parses it. A
  shape change is made by changing the fixture, which mechanically breaks the
  other side's test until it is updated. Hand-maintained "mirror" validators
  are a migration exception, not a pattern to extend.

### Placement (codifies existing convention; nothing moves)

| Language | Location | Invocation |
| --- | --- | --- |
| Rust | Colocated `*_tests.rs` / `tests.rs` submodule next to the module | `cargo test --workspace` |
| Python | `server/tests/unit/` (logic, DB-backed unit), `server/tests/integration/` (HTTP-level via ASGI against real Postgres) | `cd server && uv run pytest -q` |
| TypeScript | Colocated `*.test.ts(x)` next to source (desktop, packages, SDKs) | `pnpm --filter <pkg> test` |
| Contract fixtures | `fixtures/contracts/<contract-name>/*.json` | Asserted from each language's tier-1 suite |

Rust engine tests that need a step executor use a scripted fake implementing
`WorkflowStepExecutor` (and equivalent seams elsewhere) — never a real agent.

---

## Tier 2 — mocked intent

Real server + real desktop **web frontend** served on a port, seeded Postgres,
Playwright driving a browser. **There is no fake sandbox provider and no mock
LLM (deliberate ruling, 2026-07-07):** flows that need a sandbox or an LLM are
tier 3 by definition; building and maintaining those two fakes costs more than
the per-merge coverage they buy, and tier 1 already owns the logic in those
paths. If nightly/promotion gaps in agent/workflow flows bite repeatedly, that
evidence — not speculation — justifies building a fake then.

The controlled dependencies are:

| Dependency | Fake |
| --- | --- |
| SSO IdP | Mock OIDC container (asserts any identity on demand) |
| Invite/notification email | Token capture (test-only endpoint), no send |
| Stripe | **Real network exception:** Stripe test mode + test clocks; required and fail-closed in trusted CI |
| Poll feeds | Stub feed (replaying, per the poll contract) |

Lives in `tests/intent/`: one stack-boot fixture (`stack/`), fakes as
pluggable slots (`fakes/`), one spec file per flow (`specs/`). Seeding wraps
the existing three-layer local auth story
(`specs/developing/local/feature-worktree-auth.md`).

Tier 2 covers auth, invitation (including expired/reused/wrong-email
negatives), SSO round-trip and negatives, org/user CRUD, repo add, secrets
CRUD, and billing flows. For sandbox-adjacent flows, tier 2 tests **up to the
seam**: workflow create/edit/trigger asserts "run created, plan resolved,
delivery attempted"; cloud workspace create asserts the request path and UI
state — never sandbox readiness or run completion, which are tier 3.

---

## Tier 3 — live end-to-end

Tests the **deploy artifact, not just the code** in three deliberately distinct
worlds:

- local runtime deeply covers candidate AnyHarness, every supported harness,
  managed-gateway and user-key routes, live configuration, local workspaces,
  sessions, preferences, integrations, and managed-LLM billing;
- managed cloud covers public candidate API, immutable candidate E2B template,
  Worker/Supervisor enrollment, repository materialization, cloud access,
  secrets, compute accounting, holds, and recovery; and
- self-host covers disposable candidate installation, TLS, setup/claim,
  invitation/login, Desktop connection, advertised capabilities, and selected
  optional profiles.

No world repeats the complete Cartesian product already proved by another.
The exact dependency matrix lives in
[`release-worlds-and-fixtures.md`](release-worlds-and-fixtures.md#world-dependency-matrix).

- Lives in `tests/release/` as **one runner CLI with explicit world, product-host,
  selector, and diagnostic/strict inputs**. Existing lane flags are migration
  compatibility only. GitHub Actions is one caller of the same provisioners and
  scenarios used from a laptop; workflow YAML supplies protected inputs and
  shard selection, not a second setup implementation.
- Desktop's browser renderer is the broad default product host; packaged/native
  Desktop is selected only where the guarantee crosses Tauri, sidecars,
  filesystem/keychain ownership, relaunch, or another native boundary.
- The E2B template build is cached by content hash of its inputs (runtime
  binary, Dockerfile, agent pins); unchanged inputs resolve to the
  already-uploaded template.
- Tier 3 is also the **per-agent catalog bump gate**: a candidate agent
  version bump runs that agent's smoke on staging; failure means the agent
  stays pinned to last-good and an issue is filed.

### Tier-3 environment

The selected Tier 3 world uses real dependencies. It does not boot E2B, EC2,
Stripe, Desktop, or hosted Web merely because another world or cell needs it.
Candidate AnyHarness, Desktop, server, template, and self-host artifacts are
built once per content identity and reused across compatible shards. Stable
provider capacity such as the qualification LiteLLM deployment, Stripe test
account, E2B team, GitHub App, and AWS network may be reused, while every
actor, virtual key, customer, sandbox, instance, repository grant, and desired
version remains run-scoped.

Two constraints apply:

- **The API server must be publicly reachable** — sandboxes call back into it
  for integrations, gateway auth, and the worker control loop. Staging
  satisfies this; a purely local tier-3 lane still needs a tunnel or a
  reachable server URL.
- Credentials the selected cells require (cheap-LLM key, E2B team, Stripe
  test mode, test GitHub App, test provider accounts) are named in
  `specs/developing/reference/env-vars.yaml`, never hardcoded in scenarios.

---

## Tier 4 — upgrade path

Fresh-install testing never catches a broken updater, and a broken updater can
strand existing users. The two standing core journeys are deliberately narrow:

1. `T4-DESKTOP-1`: launch the exact retained production N−1 Desktop, complete
   a real turn, perform the signed Tauri update to the already-built candidate
   N, relaunch against the same runtime home, reconcile installed native CLIs
   and ACP agent processes to N's pins, preserve auth/workspace/session state,
   and complete another turn.
2. `T4-RUNTIME-1`: provision the exact production N−1 E2B template against the
   candidate qualification API, complete a real turn, change only that target's
   desired AnyHarness version to N, let Worker heartbeat write the durable
   request, let Supervisor verify/activate/health-gate it, reconcile installed
   native CLIs and ACP agent processes, preserve state, and complete another
   turn.

Every other Tier 4 row is selected by a changed artifact or persisted contract
and reuses the smallest retained state or standing world. Self-host `update.sh`
is change-triggered; public artifact integrity is an every-release gate. These
do not create additional standing live worlds.

The current direct-Worker activation implementation is a migration exception:
the target owner is Supervisor. The first ownership-transition release needs a
dedicated bridge test; thereafter only the ordinary N−1→N path remains. Exact
artifact, controller, evidence, and current-gap details live in
[`tier-4-scenario-contract.md`](tier-4-scenario-contract.md).

Tier 4 lives under `tests/release/src/scenarios/upgrade/` and runs through the
same runner and candidate manifest locally and in GitHub Actions.

---

## Deciding where a change's tests go

1. Is the guarantee expressible as pure input→output? → Tier 1 pure logic.
2. Does it only exist as a property of a state transition (dedup,
   exactly-once, crash-resume, ordering)? → Tier 1 against real DB, fake
   neighbors.
3. Did it change a shared JSON shape? → Update the contract fixture; the other
   language's test breaks until updated.
4. Is it a user-visible flow with no real-agent dependency? → Tier 2 spec
   (new spec file, or extend one).
5. Does it need a real agent, sandbox, or the deploy artifact? → Tier 3
   scenario (extend the existing smoke; do not add a new boot-the-world test).
6. Did it touch the updater, template versioning, or migrations? → Tier 4.

**PR obligation:** a PR that adds or changes a flow adds/updates tests at the
tier where its guarantees live, and names them in the PR description. New or
changed guarantees update the target manifest/contract and collector metadata
in the same PR; generated flow and execution views must remain clean.

**Postmortem rule:** any bug caught at tier 3/4 or in production gets an
answer to "which lower tier should have owned this," and that test lands with
the fix. Tier 3 growing per-feature is the smell that a seam test is missing —
tier 3 stays O(1) per lane, not O(features).

---

## Writing a new test (practical guide)

The tiers above say *what* a test is. This says *how* to add one so it matches
the harness that already exists and lands in the right gate.

### Tier 2 — a new mocked-intent spec

Tier 2 lives entirely in `tests/intent/`. It boots the **real server + real
desktop web build** (`apps/desktop` in web-port mode) against a seeded
Postgres and drives a browser with Playwright. Everything across a network —
sandbox provider, LLM, IdP, email, Slack — is faked or absent; a flow that
genuinely needs a real agent or sandbox is tier 3, not tier 2.

- **One spec per flow.** Add `tests/intent/specs/<flow>.spec.ts` (billing specs
  nest under `specs/billing/`). Copy the shape of an existing sibling —
  `auth.spec.ts` and `login-methods.spec.ts` are the smallest, cleanest
  models. Open the file with a comment naming its scenario id and what it owns.
- **Boot is automatic.** `stack/boot.ts` (via `stack/global-setup.ts`) boots
  the stack once per run and publishes `TIER2_INTENT_*` env vars to every
  worker; you never boot it yourself. The stack runs `SINGLE_ORG_MODE=true`
  with GitHub OAuth env unset (password + first-run claim only).
- **Seed through the product's own API, not the DB.** Reuse the helpers in
  `stack/seed.ts` (`ensureInstanceClaimed`, `passwordLogin`, `inviteMember`,
  `registerFreshMember`, `getOwnOrganization`, …). Add new helpers there rather
  than inlining `fetch` in specs. **Raw SQL is the exception, not the pattern:**
  only for state the product exposes no API for (fast-forwarding an
  invitation's `expires_at`, seeding a connection row discover reads but never
  round-trips) — always via `pg` against `databaseUrl()`, and clean it up so it
  can't leak into sibling specs sharing the profile DB.
- **Assert to the seam, not past it.** For sandbox/agent-adjacent flows, assert
  "request accepted, row created, delivery attempted, UI entered pending" —
  never sandbox readiness or run completion. Real-provider round-trips
  (Google/GitHub OAuth, live IdP) are tier 3; tier 2 asserts the *seam that
  decides* which flow fires (discovery answer, availability probe, redirect
  kicked off).
- **Naming/registration:** guarantee ids are `T2-<AREA>-<n>` (for example
  `T2-AUTH-5`). The spec declares those ids in collected metadata; the
  bidirectional manifest audit proves every claimed id exists and every
  enforced cell is collected. Do not hand-edit a pointer/status row in
  `flows.md`.
- **Run it locally:** `pnpm -C tests/intent test` (or a single file, e.g.
  `pnpm -C tests/intent exec playwright test specs/<flow>.spec.ts`).
  `TIER2_INTENT_SKIP_RUNTIME=1` skips building the Rust runtime (nothing in
  scope reads through it); `TIER2_INTENT_PROFILE=<name>` boots on an isolated
  profile so parallel worktrees don't collide; `TIER2_INTENT_VERBOSE=1` streams
  the server/vite logs.

### Tier 3 — a new live scenario

Tier 3 lives in `tests/release/` as **one runner CLI**, not a pile of
independent test files. It selects an explicit world and cell set, consumes the
exact candidate artifact receipt, and drives the real boundaries that world
owns.

- **Extend the existing smoke; do not add a new boot-the-world test.** Tier 3
  stays O(1) per lane, not O(features) — a per-feature tier-3 test is the smell
  that a tier-1/2 seam test is missing. Add scenarios under
  `tests/release/src/scenarios/` reusing the shared fixtures
  (`src/fixtures/`, the T3-FIXTURE identities/lanes) rather than reimplementing
  auth or provisioning.
- **Assert outcomes, never transcripts.** "Run reached `completed`, file
  exists, emit validated against schema" — never "the agent said X".
- **No credential ever lives in a scenario.** Every key the runner needs is
  inventoried in `specs/developing/reference/env-vars.yaml`; the runner
  fails fast with a named-variable error when one is missing.
- **Run it locally** — this is a first-class path, not a CI afterthought. Select
  the same world, product host, cell set, behavior, and candidate manifest as
  CI. A managed-cloud run still provisions real remote E2B and a publicly
  reachable candidate API when invoked from a laptop; “local” describes the
  execution host, not a different product world.
- **Naming/registration:** stable guarantee ids are `T3-<AREA>-<n>` and
  composed journey ids are defined in the Tier 3 contract. Register both in
  the target manifest and declare collected cell metadata on the executable
  scenario. Generated views, not prose pointer cells, report coverage.

Deciding *which* tier a change belongs in is the "Deciding where a change's
tests go" checklist above; this section is only about mechanics once you know
the tier.

---

## What gates what (target mapping)

| Gate | Jobs |
| --- | --- |
| Merge queue | Tier 1 plus the complete trusted Tier 2 cell set, including real Stripe test mode; every required cell is green |
| Staging → production promotion | Strict Tier 3 standing cells plus change-triggered Tier 4 cells for the exact SHA/artifact manifest; signed aggregate evidence is required by promotion |
| Nightly / local diagnostic | Broad cells may report blocked/expected-fail and continue for signal, but always emit non-qualifying evidence and alert on newly blocked cells |

Current workflows do not enforce this mapping: they use advisory
`continue-on-error`, permit missing-credential skips, and production promotion
does not consume release-E2E evidence. The precise migration exception and
closure order are in
[`core-release-validation.md`](core-release-validation.md#current-enforcement-exception).

## Running tier 3/4 locally

Local runs are a first-class path, not a CI afterthought. Laptop and GitHub
Actions invocations call the same artifact loaders, preflight, world
provisioners, readiness checks, scenarios, evidence collector, and cleanup
reconciler:

- select the same world, product host, required-cell selector, result behavior,
  and candidate manifest used by CI;
- remote dependencies remain remote and real: a laptop-managed-cloud run still
  uses E2B, AWS-hosted public qualification services, the qualification
  LiteLLM deployment, Stripe test mode where selected, and the test GitHub App;
- each key is loaded from ignored local secret storage or protected GitHub
  environments and is inventoried in
  `specs/developing/reference/env-vars.yaml`; no scenario embeds a credential;
- diagnostic behavior may report only affected cells blocked and always emits
  non-qualifying evidence; strict behavior fails preflight before provisioning
  or spend when any selected requirement is missing; and
- reproducing CI means using its candidate/retained manifest hashes, world,
  selector, product host, and scenario inputs. Shared durable staging users and
  mutable global staging version pins are diagnostic legacy mechanisms, not
  qualification fixtures.

Merge and release are selectors for different required cell sets. The runner
itself has only diagnostic and strict result behavior; planning/dry-run cannot
produce green qualification evidence.

Migration exceptions, named per house rule: desktop vitest (443 files) is not
yet wired into the merge gate. (The tier-2 intent suite and the tier-3/4 runner
now exist — `tests/intent/` and `tests/release/` respectively — and the "how to
add one" mechanics are in "Writing a new test" above.)
`scripts/validate-agent-catalog.mjs` remains a hand-kept
mirror of the Rust catalog validator until the contract-fixture pattern
absorbs it.
