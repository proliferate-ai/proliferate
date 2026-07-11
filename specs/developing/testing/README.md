# Testing Standard

How tests are organized across the repo: what each tier owns, where test files
live, what gates merges vs releases, and how a change decides which tests it
must add. [`core-release-validation.md`](core-release-validation.md) is the
complete normative Tier 2/3/4 qualification manifest. `flows.md` maps the
currently implemented subset to collected tests, and `scenarios.md` records
implementation detail; neither is complete enough to qualify a release today.
`core-release-scenario-manifest.json` is the machine-checked target ID
inventory, not a complete collected execution/lane map.

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
| **2 — Mocked intent** | Server + product browser surface + real Postgres; Stripe test mode; optional non-LLM AnyHarness HTTP seam | Sandbox/LLM execution and controlled provider fixtures | Every PR, minutes | **Merge** |
| **3 — Live end-to-end** | Everything: real E2B template for the version, real AnyHarness binary, real agents on cheap models | Nothing (cheap LLM + cheap sandbox tier, but real) | Release train + nightly | **Release** |
| **4 — Upgrade path** | An N−1 install upgraded in place to N | The update feed (stub server; the artifacts it serves are real) | Release train | **Release** |

**The gate rule (hard):** the merge gate is Tiers 1–2 only. No real LLM,
sandbox, or provider execution runs there except the explicit Stripe test-mode
contract. Controlled provider fixtures and the narrow non-LLM AnyHarness seam
are deterministic Tier 2 dependencies. Tier 3/4 failures block the *release*,
not an ordinary merge.

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

A narrow non-LLM local AnyHarness process is allowed only for an HTTP contract
seam such as runtime model-eligibility validation. It may not launch an agent,
call a provider, or substitute for a Tier 3 journey.

Lives in `tests/intent/`: one stack-boot fixture (`stack/`), fakes as
pluggable slots (`fakes/`), one spec file per flow (`specs/`). Seeding wraps
the existing three-layer local auth story
(`specs/developing/local/feature-worktree-auth.md`).

The complete Tier 2 scope is the manifest in
[`core-release-validation.md`](core-release-validation.md): identity,
organizations, browser surfaces, workspace and configuration intent, secrets,
integrations, agent policy, sessions, Workflows, Automations, billing, and
self-hosted/degraded postures. For sandbox-adjacent flows, Tier 2 tests **up to
the seam**: workflow create/edit/trigger asserts "run created, plan resolved,
delivery attempted"; cloud workspace create asserts the request path and UI
state — never sandbox readiness or run completion, which are Tier 3.

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
strands every existing user. There is no single "upgrade path." The table
below tracks the principal mechanisms that already have concrete runner
designs; the complete required upgrade, data, compatibility, credential,
billing, self-hosted, mobile, and artifact matrix lives in
[`core-release-validation.md`](core-release-validation.md). The general
pattern is:
boot N−1 from kept artifacts with seeded N−1 data, stub the *feed* (the
artifacts it serves are real), trigger the mechanism, assert convergence.

| Mechanism | Learns via | Feed knob | Testable today? |
| --- | --- | --- | --- |
| Worker target update (sandbox only) | Worker compares heartbeat `desiredVersions.worker` and writes an atomic mailbox request; it never downloads/swaps/restarts itself | Server pin plus the feed consumed by the separately specified target activation owner | Required, but the activation owner must be specified before the scenario can qualify |
| Bundled catalog/registry convergence (existing sandboxes + local runtimes) | N runtime/Desktop/template ships the trusted inputs; installed-only reconcile repairs drifted CLIs | Candidate runtime/Desktop/template artifact | **Yes** — full-chain test; no server-pushed catalog may become a trusted runtime input |
| AnyHarness target update (sandbox only) | Worker compares `desiredVersions.anyharness` and writes an atomic update request; it does not perform activation | Server pin plus the feed consumed by the separately specified target activation owner | Required, but activation/rollback ownership must be explicit; the current scenario is diagnostic until then |
| Desktop app (Tauri updater; bundles anyharness/worker sidecars) | 30-min poll of `latest.json` | Shipped default hardcoded in `tauri.conf.json`; **build-overridable** via a `tauri build --config` overlay (`make desktop-test-build UPDATER_URL=...`) — the shipped build is untouched | **Yes** — build an N−1 app pointed at a local feed and drive a real update. See [desktop-update-testing.md](./desktop-update-testing.md) |
| E2B template | Build-time only; rolling `:staging`/`:production` tags affect **new** sandboxes only | `E2B_TEMPLATE_NAME` / `E2B_TEMPLATE_REF` | Yes — new-sandbox-gets-new-template + old-workspace-still-wakes |
| SQLite/Alembic migrations | Ships inside the new binary/server | — | Yes — forward-apply on kept N−1 data |

The heartbeat-driven request mechanisms are priority coverage because they run
unattended against customer sandboxes. Tests must preserve the ownership cut:
Worker observes desired state, persists the request, and later reports
convergence; it never downloads, swaps, restarts, or rolls back itself. A
qualifying test names and drives the target activation owner as a black box and
keeps a live session intact across that owner's action.

The Supervisor `update/` module validates and privately stages artifacts handed
to it but does not fetch, activate, or roll them back. Desktop receives a new
AnyHarness only through the app bundle. Any sandbox Worker/AnyHarness
activation path remains non-qualifying until its owner and shipped trigger are
specified; tests must not invent that ownership to make the scenario green.

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
the fix. The Tier 3 deployed world boots O(1) times per lane and runs the
required scenarios inside that world; adding a second boot-the-world harness
for one feature is the smell that a seam test is missing.

---

## Writing a new test (practical guide)

The tiers above say *what* a test is. This says *how* to add one so it matches
the harness that already exists and lands in the right gate.

### Tier 2 — a new mocked-intent spec

Tier 2 lives entirely in `tests/intent/`. It boots the **real server + product
browser build** against seeded Postgres and drives a browser with Playwright.
Network dependencies use controlled fixtures; sandbox and LLM execution remain
absent. A narrow non-LLM AnyHarness HTTP seam is allowed, but a flow that needs
a real agent or sandbox is Tier 3.

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
  `TIER2_INTENT_SKIP_RUNTIME=1` is only for a targeted run that excludes every
  runtime-dependent spec; it cannot make the complete suite pass. Required CI
  supplies a prebuilt runtime and sets `TIER2_INTENT_REQUIRE_RUNTIME=1`, so a
  missing or unhealthy runtime fails setup. `TIER2_INTENT_PROFILE=<name>` boots
  on an isolated profile so parallel worktrees don't collide;
  `TIER2_INTENT_VERBOSE=1` streams the server/vite logs.

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

## Required gate mapping

| Gate | Jobs |
| --- | --- |
| Merge (every PR or trusted merge-queue run) | `repo-shape`, `cargo test --workspace`, server `pytest tests/unit tests/integration`, every frontend/SDK/Desktop suite, and the complete Tier 2 manifest in `core-release-validation.md` |
| Staging → production promotion | Complete strict Tier 3 manifest plus every Tier 4 row triggered by the candidate artifacts. Only green exact-SHA evidence permits promotion |
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
  `specs/developing/reference/env-vars.yaml` with where to obtain it. Signal
  runs may continue through independent scenarios and report a missing key as
  blocked. Strict qualification treats any blocked required row as a failed
  qualification. No scenario embeds a credential. Disposable run-scoped
  identities are the canonical fixture; a durable shared identity is a local
  debugging fallback, not release evidence.
- A red CI run must be reproducible by copying the run's lane flags into the
  local command against the same staging deploy.

Migration exceptions, named per house rule: several product suites are still
outside the merge gate. Executed Tier 2 jobs now fail closed, but fork and
Dependabot PRs explicitly skip the secret-bearing billing job and are
non-qualifying until the trusted merge-queue rerun. The collected suite is not
the complete 68-row target. Release-E2E manual runs enforce only the current
12-row provisional Workflow manifest; scheduled local/source runs are signal,
staging is dispatch-only, and self-host artifact checks are post-publish
diagnostics. Complete exact-artifact aggregation and production-promotion
consumption remain absent, so these workflows do not satisfy
[`core-release-validation.md`](core-release-validation.md) or constitute WS10c
evidence. The harnesses live in `tests/intent/` and `tests/release/`.
`scripts/validate-agent-catalog.mjs` remains a hand-kept
mirror of the Rust catalog validator until the contract-fixture pattern
absorbs it.
