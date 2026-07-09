# Testing Standard

How tests are organized across the repo: what each tier owns, where test files
live, what gates merges vs releases, and how a change decides which tests it
must add. `flows.md` (sibling) is the registry of end-to-end flows that must
never break; this doc is the law those flows are enforced under.

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
| **2 — Mocked intent** | Server + desktop web frontend + real Postgres, booted on a port | AnyHarness, sandbox provider, LLM, IdP, email, Slack — every third party | Every PR, minutes | **Merge** |
| **3 — Live end-to-end** | Everything: real E2B template for the version, real AnyHarness binary, real agents on cheap models | Nothing (cheap LLM + cheap sandbox tier, but real) | Release train + nightly | **Release** |
| **4 — Upgrade path** | An N−1 install upgraded in place to N | The update feed (stub server; the artifacts it serves are real) | Release train | **Release** |

**The gate rule (hard):** the merge gate is tiers 1–2 only. No real LLM, real
sandbox, or real third party ever runs in the merge gate. A flaky merge gate
poisons agent-driven merging; tier 3/4 failures block the *release* and file
issues into the issues service — they never block a merge.

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

The fakes that do exist are cheap and stable:

| Dependency | Fake |
| --- | --- |
| SSO IdP | Mock OIDC container (asserts any identity on demand) |
| Invite/notification email | Token capture (test-only endpoint), no send |
| Stripe | Stripe test mode + test clocks |
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

Tests the **deploy artifact, not just the code**: build (or cache-resolve) the
E2B template for the version, run the real AnyHarness binary, drive real
agents on cheap models through core flows — provision/pause/resume/connect,
chat per cataloged agent × auth method, workflow services live (schedule +
poll triggers, emit, chaining, Slack delivery), config updates applied by live
agents, local↔cloud migration, billing metering integrity.

- Lives in `tests/release/` as **one runner CLI with lane flags**
  (`make release-e2e LANE=... DESKTOP=web|native AGENTS=...`). GitHub Actions
  is one caller of it; the runner must work identically from a laptop. No
  CI-only setup steps in workflow YAML.
- Desktop web-port mode is the default lane; native-shell smoke is a separate
  nightly/pre-release lane that reuses the release build's artifact in CI and
  the local dev build locally.
- The E2B template build is cached by content hash of its inputs (runtime
  binary, Dockerfile, agent pins); unchanged inputs resolve to the
  already-uploaded template.
- Tier 3 is also the **per-agent catalog bump gate**: a candidate agent
  version bump runs that agent's smoke on staging; failure means the agent
  stays pinned to last-good and an issue is filed.

### Tier-3 environment (the wired-in infrastructure)

The tier-3 stack is a real deployment, not a laptop assembly: sandbox-mode
Stripe, the real LLM gateway configured with cheap models, the real API
server, desktop (web-port lane by default), real agents in real E2B
sandboxes. Two constraints:

- **The API server must be publicly reachable** — sandboxes call back into it
  for integrations, gateway auth, and the worker control loop. Staging
  satisfies this; a purely local tier-3 lane still needs a tunnel or a
  reachable server URL.
- Credentials the runner burns (cheap-LLM key, E2B team, test Slack
  workspace, test provider accounts) are named in
  `specs/developing/reference/env-vars.yaml`, never hardcoded in scenarios.

---

## Tier 4 — upgrade path

Fresh-install testing never catches a broken updater, and a broken updater
strands every existing user. There is no single "upgrade path" — five distinct
mechanisms exist, and each is tested at its own seam. The general pattern:
boot N−1 from kept artifacts with seeded N−1 data, stub the *feed* (the
artifacts it serves are real), trigger the mechanism, assert convergence.

| Mechanism | Learns via | Feed knob | Testable today? |
| --- | --- | --- | --- |
| Worker self-update (sandbox only) | Heartbeat `desiredVersions.worker` | Server pins (`WORKER_VERSION`) + CDN base `DESKTOP_DOWNLOADS_BASE_URL` — both **server-side** env vars (the worker asks the API server, which 302-redirects to the CDN base; stub by pointing the base at a file server the sandbox can reach, e.g. via ngrok) | **Yes** — the priority scenario |
| Agent catalog convergence (existing sandboxes + local runtimes) | Heartbeat `desiredVersions.catalogVersion` → worker pushes catalog → runtime reconcile reinstalls drifted CLIs | Server catalog version | **Yes** — full-chain test; today only per-hop units exist |
| Desktop app (Tauri updater; bundles anyharness/worker sidecars) | 30-min poll of `latest.json` | Hardcoded in `tauri.conf.json`, **not env-overridable** | Feed-artifact validation yes; real update needs a test build with an overridable endpoint |
| E2B template | Build-time only; rolling `:staging`/`:production` tags affect **new** sandboxes only | `E2B_TEMPLATE_NAME` / `E2B_TEMPLATE_REF` | Yes — new-sandbox-gets-new-template + old-workspace-still-wakes |
| SQLite/Alembic migrations | Ships inside the new binary/server | — | Yes — forward-apply on kept N−1 data |

The two heartbeat-driven mechanisms are the priority: they are the ones that
run **unattended against every live customer sandbox** on every release, and
neither has an end-to-end test today (coverage is per-hop unit tests). The
worker scenario must include a live session on the box surviving the
swap-and-exec.

Known non-mechanism, stated so nobody tests a ghost: the anyharness binary has
**no in-place update path** — sandboxes only get a new anyharness via a new
template (the worker ignores `desiredVersions.anyharness`; the supervisor
`update/` module validates and stages artifacts handed to it but fetches and
swaps nothing), and desktop only via the app bundle. If in-place anyharness
update is built later, it enters this table with its own scenario.

Lives in `tests/release/upgrade/`, runs under the same runner CLI.

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
tier where its guarantees live, and names them in the PR description. New
end-to-end flows also add a row to `flows.md` in the same PR.

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
- **Naming:** scenario ids are `T2-<AREA>-<n>` (e.g. `T2-AUTH-5`). Define the
  scenario in `scenarios.md`, then register the flow's row in `flows.md`
  pointing at the spec file — **in the same PR** (the PR obligation and the
  `flows.md` completeness audit both enforce this).
- **Run it locally:** `pnpm -C tests/intent test` (or a single file, e.g.
  `pnpm -C tests/intent exec playwright test specs/<flow>.spec.ts`).
  `TIER2_INTENT_SKIP_RUNTIME=1` skips building the Rust runtime (nothing in
  scope reads through it); `TIER2_INTENT_PROFILE=<name>` boots on an isolated
  profile so parallel worktrees don't collide; `TIER2_INTENT_VERBOSE=1` streams
  the server/vite logs.

### Tier 3 — a new live scenario

Tier 3 lives in `tests/release/` as **one runner CLI with lane flags**, not a
pile of independent test files. It builds/cache-resolves the real E2B template,
runs the real AnyHarness binary, and drives real agents on cheap models.

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
- **Run it locally** — this is a first-class path, not a CI afterthought:
  `make release-e2e LANE=... DESKTOP=web AGENTS=...`, pointed at staging (the
  default, same publicly reachable API the sandboxes call back into) or a local
  stack plus tunnel. A red CI run must reproduce by copying its lane flags into
  the local command.
- **Naming/registration:** scenario ids are `T3-<AREA>-<n>`; define in
  `scenarios.md` and register the `flows.md` row (tier 3) in the same PR.

Deciding *which* tier a change belongs in is the "Deciding where a change's
tests go" checklist above; this section is only about mechanics once you know
the tier.

---

## What gates what (current CI mapping)

| Gate | Jobs |
| --- | --- |
| Merge (every PR) | `repo-shape`, `cargo test --workspace`, server `pytest tests/unit tests/integration`, shared-frontend-package vitest, desktop vitest, tier-2 intent suite (`intent-tests` + `intent-billing` in `.github/workflows/intent-tests.yml`) |
| Staging → production promotion | Tier 3 runner per lane + tier 4 upgrade scenario, against staging. Red blocks promotion and files an issue. **Flake-tolerant:** a green re-run unblocks; repeated red on the same scenario is a real failure, not a flake |
| Nightly | Tier 3 lanes (incl. native-shell smoke) against whatever is on staging; failures file issues, never block merges |

## Running tier 3/4 locally

Local runs are a first-class path, not a CI afterthought — the runner is
developed and debugged locally against staging:

- `make release-e2e LANE=... DESKTOP=web AGENTS=...` runs from a laptop,
  pointed either at **staging** (default for debugging what CI saw — same
  publicly reachable API the sandboxes call back into) or at a local stack
  plus tunnel.
- Every key the runner needs (cheap-LLM key, E2B team, sandbox-mode Stripe,
  test Slack workspace, test provider accounts) is inventoried in
  `specs/developing/reference/env-vars.yaml` with where to obtain it. A missing
  key blocks only the scenarios/lanes that require it (reported as blocked, the
  same as an out-of-band gate) rather than failing the whole run, so a
  partially-credentialed environment still produces signal. No scenario ever
  embeds a credential. The CI local lane additionally self-seeds its durable
  user per run through the real `/setup` claim, so the local-lane server-
  mediated scenarios run without any repo secret (the durable-user env stays
  the mechanism for the staging lane).
- A red CI run must be reproducible by copying the run's lane flags into the
  local command against the same staging deploy.

Migration exceptions, named per house rule: desktop vitest (443 files) is not
yet wired into the merge gate. (The tier-2 intent suite and the tier-3/4 runner
now exist — `tests/intent/` and `tests/release/` respectively — and the "how to
add one" mechanics are in "Writing a new test" above.)
`scripts/validate-agent-catalog.mjs` remains a hand-kept
mirror of the Rust catalog validator until the contract-fixture pattern
absorbs it.
