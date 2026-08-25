# Testing Standard

How tests are organized across the repo: what each tier owns, what gates
merges vs releases, and how a change decides which tests it must add — derive
that from the diff, not from habit. Consider this document in every PR. Depth
(release validation, release worlds, the tier-3/4 contracts, manual QA) lives
in [`specs/TESTING/`](TESTING/README.md).

## Harness launch-option authority gate

Changes to harness observation, session create/configuration, cloud target
copy, or first-party launch pickers must prove the complete authority chain:

- target observation covers non-empty, empty, same-basis failure,
  basis-change invalidation, unknown identifiers, and exact model-scoped
  control statements when the harness exposes them;
- create reloads current-basis state, validates against the selected model row
  when present, rejects exact non-members, and stores the complete resolved
  intent atomically;
- actor startup cannot publish ready until every explicit value is confirmed;
- live mutation advances the full session snapshot, and active UI ignores
  target/catalog state;
- Codex `collaboration_mode` and `mode` remain independent and obsolete
  `full-access` is absent; and
- cloud copy is monotonic and isolated by cloud sandbox plus harness.

The deterministic gate is:

```bash
cargo test -p anyharness-contract -p anyharness-lib -p proliferate-worker
pnpm --filter @anyharness/sdk test
pnpm --filter @anyharness/tests test
pnpm --filter @proliferate/product-client test
pnpm --filter @proliferate/product-client typecheck
(cd server && uv run pytest -q)
pnpm -C tests/intent test
python3 scripts/check_agent_auth_secret_logs.py
python3 scripts/check_docs.py
```

Only one Cargo/Rust invocation may run on this machine at a time; check
`pgrep -x cargo` and `pgrep -x rustc` first. The final manual proof attaches to
an already running named profile:

```bash
node scripts/verify-harness-launch-options.mjs \
  --profile harness-launch-options \
  --harness claude --harness grok --harness codex
```

The verifier never boots services, builds Rust, starts Docker, or prints
credentials. Missing install/auth and `observed_empty` are incomplete proof,
not a pass.

## The model

Code is state and logic. Every test is defined by which state is real and
where the boundary to fakes sits. Four tiers:

| Tier | What is real | What is faked or absent | Runs | Gates |
| --- | --- | --- | --- | --- |
| **1 — Unit / contract** | Logic; Postgres/SQLite where the guarantee lives in the DB | Everything across a network | Every PR, seconds | **Merge** |
| **2 — Mocked intent** | Server + Desktop renderer in Chromium + real Postgres, booted on ports; real Stripe test mode for billing | AnyHarness, sandbox provider, LLM, IdP, email, Slack, and every other external provider | Every PR, minutes | **Merge** |
| **3 — Live end-to-end** | The selected world's real candidate server/runtime/provider boundaries, real agents on cheap models, and exact deploy artifacts | Boundaries outside the selected world are absent rather than simulated | Release train + on demand (the nightly cron was removed in the 2026-08 engineering cull; re-establishing a cadence is a step-3 CI/CD-spec decision) | **Release** |
| **4 — Packaged install / upgrade** | Exact signed candidate packages plus retained production N−1 state upgraded through shipped mechanisms to exact candidate N | No claimed product boundary; updater/control channels are isolated while their artifacts and verification remain real | Release train | **Release** |

**The gate rule (hard):** the merge gate is tiers 1–2 only. No real LLM or
real sandbox runs in the merge gate. Stripe test mode is the one explicit
real-network exception; trusted CI fails if its test credential or required
billing cells are missing. Tier 3/4 failures block the *release* and file
issues into the issues service — they never block an ordinary merge.
Current-main fail-open exceptions are recorded, without being normalized as
success, in [`TESTING/core-release-validation.md`](TESTING/core-release-validation.md#current-enforcement-exception).

**Real-LLM tests assert outcomes, not transcripts.** "Run reached `completed`,
file exists, emit validated against schema" — never "the agent said X."

## Tier 1 — unit / contract

Three sub-kinds, in every language:

- **Pure logic (no state).** State-machine guards, decision matrices, billing
  math, policy checks. Enumerate the matrix, not just the cells you thought about.
- **Logic against real state.** When the guarantee IS a property of the
  database (unique index, `ON CONFLICT`, savepoint, transaction boundary,
  crash-resume cursor), the DB must be real — Postgres for server tests,
  SQLite for runtime tests. Fake everything across a network. A crash drill
  is expressed as calling the construction twice (claim CAS returns `None`
  the second time), not as killing processes.
- **Contract fixtures.** Shared JSON shapes that cross a language boundary get
  a golden fixture under `fixtures/contracts/`. The producing language asserts
  it produces the fixture; each consuming language asserts it parses it. A
  shape change is made by changing the fixture, which mechanically breaks the
  other side's test until it is updated.

| Language | Location | Invocation |
| --- | --- | --- |
| Rust | Colocated `*_tests.rs` / `tests.rs` submodule next to the module | `cargo test --workspace` |
| Python | `server/tests/unit/` (logic, DB-backed unit), `server/tests/integration/` (HTTP-level via ASGI against real Postgres) | `cd server && uv run pytest -q` |
| TypeScript | Colocated `*.test.ts(x)` next to source (desktop, packages, SDKs) | `pnpm --filter <pkg> test` |
| Contract fixtures | `fixtures/contracts/<contract-name>/*.json` | Asserted from each language's tier-1 suite |

Standalone diagnostics collector behavior is Tier 1: exercise its real child
process and loopback transport with inherited anonymous capability/control
file descriptors, while keeping Desktop, AnyHarness, Worker, server, and cloud
integration absent. Run `cargo test -p proliferate-diagnostics-collector` for
the deterministic contract/process suite. That command builds the package with
default features, so the internal OTLP export path and its dogfood proof are
compiled out of it entirely; they need
`cargo test -p proliferate-diagnostics-collector --features internal-dogfood-export`,
which CI runs as its own step. The dogfood proof drives the real collector
binary against a strict local OTLP receiver and establishes wire conformance
and failure isolation, not that any hosted destination accepts the payload. The
release-only RSS profile runner is a separate bounded proof and writes its
JSON/CSV evidence outside the repo.

The bounded producer adapter (`proliferate-diagnostics-client`) and the
Desktop child-bridge, launch, fallback-root, and Worker-tail seams are also
Tier 1: colocated deterministic tests use in-process descriptors, local
sockets/pipes, and the test binary itself as any needed child fixture. They
never invoke nested Cargo and never require an unbuilt binary.

Desktop collector ownership is also Tier 1 at the native seam. Colocated tests
pin target packaging, protected descriptor/capability handling, authenticated
startup and replacement generations, bounded restart policy, renderer ingest
ownership, broker framing/credentials/discovery/caps, query encoding, artifact
gating, fallback limits, lifecycle pairing, and ordered verified reaping. The
packaged macOS qualification must contain exactly AnyHarness, Worker,
`proliferate-debug`, and the non-placeholder collector, then reach
authenticated health through the broker. RV-2-04's records-minor/tail-1.1
asymmetry, RV-2-05's malformed-control child-exit behavior, and RV-2-06's
64-operation moving window remain explicit qualification evidence rather than
claims that this Desktop slice changed collector internals.

Engine tests that need a step executor use a scripted fake implementing
`WorkflowStepExecutor` (and equivalent seams elsewhere) — never a real agent.

## Tier 2 — mocked intent

Real server + the real Desktop renderer served on a port, seeded Postgres,
and Playwright driving Chromium. **There is no fake sandbox provider and no
mock LLM (deliberate ruling, 2026-07-07):** flows that need a sandbox or an
LLM are tier 3 by definition; building and maintaining those two fakes costs
more than the per-merge coverage they buy, and tier 1 already owns the logic
in those paths. If nightly/promotion gaps in agent/workflow flows bite
repeatedly, that evidence — not speculation — justifies building a fake then.

| Dependency | Test control |
| --- | --- |
| SSO IdP | Mock OIDC container (asserts any identity on demand) |
| Invite/notification email | Token capture (test-only endpoint), no send |
| Stripe | **Real network exception:** Stripe test mode + test clocks; required and fail-closed in trusted CI |
| Poll feeds | Stub feed (replaying, per the poll contract) |

Lives in `tests/intent/`: one stack-boot fixture (`stack/`), fakes as
pluggable slots (`fakes/`), one spec file per flow (`specs/`). Seed through
the product's own API via the `stack/seed.ts` helpers; raw SQL is the
exception, only for state the product exposes no API for.

**Tier 2 tests up to the seam, never past it.** For sandbox/agent-adjacent
flows, assert "request accepted, row created, delivery attempted, UI entered
pending" — never sandbox readiness or run completion, which are tier 3.
Real-provider round-trips (Google/GitHub OAuth, live IdP) are tier 3; tier 2
asserts the *seam that decides* which flow fires. Run locally:
`pnpm -C tests/intent test` (`TIER2_INTENT_SKIP_RUNTIME=1` skips building the
Rust runtime; `TIER2_INTENT_PROFILE=<name>` isolates parallel worktrees).

### Scroll-physics suite (transcript renderer)

A Tier-2-style merge-gating suite for chat transcript scroll behavior. The real
transcript renderer (`MessageList`) mounts in real Chromium AND real WebKit,
driven by the real `@anyharness/sdk` reducer over scripted event batches. There
is no server, sandbox, LLM, or network: a `window.__scrollPhysics` driver owns
every state transition, so physics like pinned-follow, mid-stream unpin, repin
band edges, older-history prepend anchoring, and session-revisit placement are
measured against the exact code that ships rather than a simulated DOM.

It sits with Tier 2 because the boundary is identical: real renderer plus a real
browser, everything external absent, deterministic fixture. It differs only in
that the browser engine itself is the system under test, so both Blink and
WebKit run. Specs assert observable invariants from DOM probes (viewport
`scrollTop`/`scrollHeight`/`clientHeight`) and a per-frame `scrollTop` trace,
never internal component state. Scenarios that today reproduce a known bug
documented in the Chat Scroll ADR are marked `test.fixme` with the rung that
owns the fix.

Lives in `apps/packages/product-client/qualification/scroll-physics/` (Vite
fixture host plus `specs/`), alongside the browser-build fixture. The fixture
resolves the shipped renderer through `#product/*` -> `dist`, so `pnpm shared:build`
must be run first (once, or whenever product-client/design source changes) to
produce that `dist`. Run locally:

```
pnpm shared:build
pnpm --filter @proliferate/product-client test:scroll-physics
```

(`test:scroll-physics` builds the Vite fixture itself, then runs Playwright at
`workers=1`; it does not rebuild `dist`.) CI runs it in the `scroll-physics`
job of the dispatch-only `ci-heavy-lanes.yml` (off the per-PR path since the
2026-08 engineering cull; the structural half stays enforced per-PR by
`check_transcript_scroll_writer.py` in repo-shape), which builds the shared
packages and installs both browser engines.

### Workflow-canvas suite (builder graph surface)

The same shape as the scroll-physics suite, for the one part of the Workflows
builder a simulated DOM cannot answer for: the canvas's real stacking, hit
testing, pointer capture and pointer routing. The shipped
`WorkflowBuilderChainCanvas` mounts in real Chromium over a scripted graph, and
the specs assert what a pointer can actually reach — a midpoint control above
the cards it sits over, a press that selects without moving a card, a drag that
moves one, and a connection released off-canvas leaving no armed source.

Chromium only: unlike scroll physics, no behavior here is engine-specific, and
the geometry it measures is the same in both.

Lives in `apps/packages/product-client/qualification/workflow-canvas/` (Vite
fixture host plus `specs/`). Run locally:

```
pnpm --filter @proliferate/product-client test:workflow-canvas
```

(`test:workflow-canvas` builds the fixture, then runs Playwright at
`workers=1`; `typecheck:workflow-canvas` checks the fixture on its own.) It is
run on demand rather than by a CI job — the graph invariants that gate a merge
are covered by the ProductClient suite, and this harness exists for the
pointer-level questions that suite cannot ask.

## Tier 3 — live end-to-end

Tests the **deploy artifact, not just the code** in three deliberately
distinct worlds: local runtime, managed cloud, and self-host. No world
repeats the complete Cartesian product already proved by another; the exact
dependency matrix lives in [`TESTING/release-worlds-and-fixtures.md`](TESTING/release-worlds-and-fixtures.md#world-dependency-matrix).

- Lives in `tests/release/` as one runner CLI with explicit world,
  product-host, selector, and diagnostic/strict inputs. GitHub Actions is one
  caller of the same provisioners and scenarios used from a laptop; local runs
  are a first-class path, not a CI afterthought.
- **Extend the existing smoke; do not add a new boot-the-world test.** Tier 3
  stays O(1) per lane, not O(features) — a per-feature tier-3 test is the
  smell that a tier-1/2 seam test is missing.
- Tier 3 is also the per-agent catalog bump gate: a candidate agent version
  bump runs that agent's smoke on staging; failure means the agent stays
  pinned to last-good and an issue is filed.
- No credential ever lives in a scenario: every key the runner needs is
  inventoried in `specs/developing/reference/env-vars.yaml`.
- Guarantee ids are `T3-<AREA>-<n>`; register them in the target manifest and
  declare collected cell metadata on the executable scenario.

## Tier 4 — packaged install and upgrade

One qualification stage with independently evidenced target cells, using
exact shipped packages or immutable runtime artifacts: clean candidate
Desktop install, Desktop N−1 → N signed update (`T4-DESKTOP-1`),
managed-runtime upgrade through Worker mailbox + Supervisor activation
(`T4-RUNTIME-1`), and self-host N−1 → N when its artifacts changed. It does
not rerun the Tier 3 functional matrix. Exact artifact, controller, evidence,
and current-gap details live in [`TESTING/tier-4-scenario-contract.md`](TESTING/tier-4-scenario-contract.md).

## Deciding where a change's tests go

1. Is the guarantee expressible as pure input→output? → Tier 1 pure logic.
2. Does it only exist as a property of a state transition (dedup,
   exactly-once, crash-resume, ordering)? → Tier 1 against real DB, fake
   neighbors.
3. Did it change a shared JSON shape? → Update the contract fixture (which
   mechanically breaks the consuming side's test).
4. Is it a user-visible flow with no real-agent dependency? → Tier 2 spec
   (new spec file, or extend one).
5. Does it need a real agent, sandbox, or the deploy artifact? → Tier 3.
6. Did it touch packaged/native installation, the updater, template
   versioning, or migrations? → Tier 4.

**PR obligation:** a PR that adds or changes a flow adds/updates tests at the
tier where its guarantees live, and names them in the PR description. New or
changed guarantees update the target manifest/contract and collector metadata
in the same PR; generated flow and execution views must remain clean.

**Postmortem rule:** any bug caught at tier 3/4 or in production gets an
answer to "which lower tier should have owned this," and that test lands with
the fix.

Named migration exceptions: desktop vitest is not yet wired into the merge
gate; the broad tier-2 intent lanes (`intent-tests` + `intent-billing`) are
provisional and dispatch-only since the 2026-08 engineering cull (their return
to a cadence or the merge gate is a step-3 CI/CD-spec decision); and
`scripts/validate-agent-catalog.mjs` remains a hand-kept mirror of the Rust
catalog validator until the contract-fixture pattern absorbs it. Target gate
tables and the exception's closure order live in the same contract linked above.
