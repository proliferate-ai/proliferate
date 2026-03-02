# Code Quality Contract - System Spec

## 1. Purpose

Define a clean, principle-first quality contract for migration and new code.

Primary rule:
- If you touch a file, leave it better than before, or at minimum not worse.

Primary goal:
- Prevent duplicated logic and disorganized code so migration work does not create rewrite debt later.

---

## 2. Scope

### In scope
- Code organization rules (where code belongs).
- Touched-file quality ratchet.
- Duplication prevention rules.
- CI and exception protocol.

### Out of scope
- Product behavior and runtime architecture (owned by subsystem specs).
- UI design system details.

---

## 3. Core Principles

1. **Clear placement before coding**
	- Decide the owning layer/module before adding logic.
2. **One responsibility per file**
	- Keep transport, orchestration, and persistence separated.
3. **No new duplication**
	- Reuse shared helpers; do not copy logic across providers/routes.
4. **Touched files improve or hold**
	- Legacy debt can exist; touched code must not regress.
5. **Prefer extraction over growth**
	- When a file is hard to reason about, extract coherent modules.

---

## 4. Code Organization Rules (Normative)

### 4.1 Backend layering
1. Routers/route handlers must stay transport adapters.
2. Business orchestration/policy lives in `packages/services/src/**/service.ts`.
3. Persistence mechanics live in `packages/services/src/**/db.ts` (or `*-db.ts`).
4. Code outside allowed packages must not import `@proliferate/db` directly.
5. New direct DB writes in `service.ts` must not be introduced.

### 4.2 Shared logic and duplication prevention
1. Shared pure helpers/types belong in `packages/shared`.
2. Shared backend/business helpers belong in `packages/services`.
3. Web-only helpers stay in `apps/web/src/lib`.
4. Duplicate implementations of the same primitive in touched code are not allowed.
5. Security-sensitive primitives (for example signature/hash verification) must use one shared implementation per pattern.

### 4.3 Frontend placement rules
1. Data fetching in components should use project data-layer patterns (oRPC/TanStack Query), not ad-hoc raw API calls.
2. Hooks should be explicit, reusable, and use kebab-case filenames (for example `use-repos.ts`).
3. Avoid adding business logic directly in route/page components when it can live in services or shared modules.

### 4.4 Tests for changed logic
1. Touched business logic (`service.ts`, `db.ts`, provider lifecycle code) must include updated or new tests, or a time-boxed exception.
2. Bug fixes must include regression coverage unless impossible (then exception required).

---

## 5. Touched-File Ratchet

For each touched file:
1. No new violations on zero-tolerance gates.
2. No regression on baselined gates.
3. Avoid net complexity growth when simple extraction is possible.
4. No new duplicated helper patterns.

Recommended:
- If a high-debt file is touched, reduce at least one clear local debt item (extract helper/module, remove duplication, simplify branching).

---

## 6. CI Enforcement

### 6.1 Active blocking gates
- `lint:no-direct-db-import`
- `lint:no-raw-api-fetch`
- `lint:db-boundary`
- `biome check .`

### 6.2 Baseline model
- Baselines are temporary debt ledgers, not permission to add debt.
- Existing baseline:
	- `scripts/db-boundary-baseline.json`
- Baseline increases require an approved exception.

### 6.3 Planned quality gates
- Duplicate helper/signature detection.
- Touched-file organization/placement checks (where practical).
- Additional complexity checks where tooling is stable.

---

## 7. Exceptions (Time-Boxed)

Allowed only for temporary, justified cases (for example critical incident fixes or unsafe decomposition windows).

Required fields:
- `reason`
- `owner`
- `expiresOn` (YYYY-MM-DD)
- `followUpTicket`
- `scope` (file/rule waived)

Storage:
- Human-readable: `docs/code-quality-exceptions.md`
- Machine-readable: `scripts/code-quality-exceptions.json`

Expiry:
- Expired exceptions fail CI.
- Renewals require explicit reviewer re-approval.

---

## 8. Status

| Feature | Status | Evidence |
|---|---|---|
| No direct DB imports outside allowed packages | Implemented | `scripts/check-no-direct-db-import.mjs` |
| No raw `fetch('/api/...')` in web source | Implemented | `scripts/check-no-raw-api-fetch.mjs` |
| DB-boundary baseline for `packages/services` | Implemented | `scripts/check-db-boundary.mjs`, `scripts/db-boundary-baseline.json` |
| Touched-file ratchet | Partial | Baseline ratchet exists; broaden enforcement over time |
| Duplicate helper/signature detection | Planned | Add dedicated lint gate |
| Organization-first placement checks | Planned | Add targeted checks where tooling is reliable |

---

## 9. Acceptance Checklist

- [ ] Contract is principle-first and easy to apply during reviews.
- [ ] Layer placement rules are explicit and consistent.
- [ ] Anti-duplication rules are explicit and enforced over time.
- [ ] Existing blocking gates remain active.
- [ ] Exception protocol is enforceable (including expiry).
# Code Quality Contract - System Spec

## 1. Purpose

This spec defines the minimum code-quality contract for migration work.

Primary rule:
- If you touch a file, leave it better than before, or at minimum not worse.

Why this exists:
- Keep migration velocity high without allowing quality regressions.
- Make quality expectations objective and CI-enforceable.

---

## 2. Scope

### In scope
- Touched-file ratchet policy.
- Layer boundary rules (router/service/db).
- CI quality gates and baselines.
- Time-boxed exceptions.

### Out of scope
- Product architecture and runtime behavior (owned by subsystem specs).
- UI design guidance.

---

## 3. Normative Rules (MUST)

### 3.1 Layer boundaries
1. Route handlers/routers are transport adapters only.
2. Business logic lives in `packages/services/src/**/service.ts`.
3. Persistence logic lives in `packages/services/src/**/db.ts` (or `*-db.ts`).
4. Code outside allowed packages must not import `@proliferate/db` directly.
5. New direct DB writes in `service.ts` must not be introduced.

### 3.2 Touched-file ratchet
For each touched file:
1. No new violations on zero-tolerance gates.
2. No regression on baselined gates (count must not exceed baseline).
3. If file is above target size, line count must not increase.
4. If file is above hard ceiling, line count must decrease unless exception approved.
5. No new duplicated crypto/signature helper implementations.

### 3.3 Size and complexity thresholds

| Layer | Target | Hard ceiling (exception required) |
|---|---:|---:|
| Web/gateway routers | 350 | 600 |
| `service.ts` | 400 | 650 |
| `db.ts` | 300 | 500 |
| Provider modules | 450 | 800 |
| UI components | 300 | 500 |

Function thresholds:
- Target max function length: 60 lines.
- Hard ceiling: 120 lines (exception required).
- Cyclomatic complexity target: 10.
- Hard ceiling: 15 (exception required).

### 3.4 Tests on changed logic
- Touched business logic (`service.ts`, `db.ts`, provider lifecycle code) must include updated or new tests.
- Bug fixes must include regression tests unless exception-approved.

---

## 4. CI Enforcement

### 4.1 Blocking today
- `lint:no-direct-db-import`
- `lint:no-raw-api-fetch`
- `lint:db-boundary`
- `biome check .`

### 4.2 Required gates for full contract
- `lint:file-size` (touched files vs thresholds)
- `lint:function-size` (touched functions vs length limits)
- `lint:complexity` (touched code vs complexity limits)
- `lint:no-duplicate-signature-helpers`

### 4.3 Baselines
Baselines are temporary debt ledgers, not permission to add debt.

Existing:
- `scripts/db-boundary-baseline.json`

Planned:
- `scripts/file-size-baseline.json`
- `scripts/function-complexity-baseline.json`

Rules:
- Baselines are file-scoped and count-based.
- Raising baseline counts requires an approved exception.

---

## 5. Exceptions (Time-Boxed)

Exceptions are allowed only for temporary, justified cases (for example critical incident fixes or unsafe decomposition windows).

Required fields:
- `reason`
- `owner`
- `expiresOn` (YYYY-MM-DD)
- `followUpTicket`
- `scope` (file/rule waived)

Storage:
- Human-readable: `docs/code-quality-exceptions.md`
- Machine-readable: `scripts/code-quality-exceptions.json`

Expiry:
- Expired exceptions fail CI.
- Renewal requires explicit reviewer re-approval.
---

## 6. Status

| Feature | Status | Evidence |
|---|---|---|
| No direct DB imports outside allowed packages | Implemented | `scripts/check-no-direct-db-import.mjs` |
| No raw `fetch('/api/...')` in web source | Implemented | `scripts/check-no-raw-api-fetch.mjs` |
| DB-boundary baseline for `packages/services` | Implemented | `scripts/check-db-boundary.mjs`, `scripts/db-boundary-baseline.json` |
| Touched-file ratchet (repo-wide) | Partial | DB-boundary ratchet exists; expand via §4.2 |
| File length/complexity gates by layer | Planned | Add scripts + CI wiring in §4.2 |
| Duplicate signature helper detection | Planned | Add gate in §4.2 |

---

## 7. Acceptance Checklist

- [ ] Contract is principle-first and CI-enforceable.
- [ ] Existing blocking gates remain active.
- [ ] New touched-file gates are implemented and rolled out.
- [ ] Exception protocol is enforced (including expiry).
- [ ] `AGENTS.md`, `CLAUDE.md`, and PR template reference this contract.
# Code Quality Contract - System Spec

## 1. Scope & Purpose

### In Scope
- Repository-wide code quality standards for migration and new development.
- Enforceable boundaries between router/service/db layers.
- Touched-file ratchet policy ("no net quality debt" on changed code).
- CI gate definitions for lint/boundary/size/complexity/test requirements.
- Exception protocol for temporary rule breaks.

### Out of Scope
- Product/runtime architecture decisions (owned by subsystem specs).
- UI design guidelines.
- Team staffing/process norms outside code quality enforcement.

### Feature Status

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| No direct DB imports outside allowed packages | Implemented | `scripts/check-no-direct-db-import.mjs`, `package.json:lint:no-direct-db-import` | Blocking in `pnpm lint` |
| No raw `fetch('/api/...')` in web source | Implemented | `scripts/check-no-raw-api-fetch.mjs`, `package.json:lint:no-raw-api-fetch` | Blocking in `pnpm lint` |
| DB-boundary baseline for `packages/services` | Implemented | `scripts/check-db-boundary.mjs`, `scripts/db-boundary-baseline.json`, `package.json:lint:db-boundary` | Baseline ratchet exists today |
| Migration touched-file ratchet (repo-wide) | Partial | Existing DB-boundary ratchet only | Expanded contract defined in this spec |
| File length/complexity CI gates by layer | Planned | This spec §6.2, §6.6 | Add scripts + CI jobs |
| Duplicate signature/crypto helper detection | Planned | This spec §6.3, §6.6 | Add duplication gate |

### Purpose
This contract defines minimum quality guarantees during rewrite/migration.  
Primary rule: **any file touched in a PR must be equal or better quality than before**, unless a documented exception is approved.

---

## 2. Core Concepts

### 2.1 Quality Contract
Quality is not advisory. Rules in this document use:
- **MUST / MUST NOT**: hard requirements.
- **SHOULD / SHOULD NOT**: strong default; exceptions allowed with justification.

### 2.2 Touched-File Ratchet
Principle: if a PR edits file `F`, treat `F` as potentially carrying quality debt and leave it better than before (or at minimum not worse).

Enforcement: PR quality checks evaluate `F` against this contract and baseline.
- Existing debt in untouched files is tolerated short-term.
- New or increased debt in touched files is not tolerated.

### 2.3 Debt Baseline
A baseline file records known violations that are temporarily tolerated.
- Example existing baseline: `scripts/db-boundary-baseline.json`.
- Baselines are debt ledgers, not permission to add debt.

### 2.4 Exception Record
Temporary waivers are allowed only with:
- explicit owner,
- explicit expiry date,
- follow-up ticket,
- reviewer approval.

---

## 3. Ownership and Enforcement Surfaces

### 3.1 Core files
- CI workflow: `/Users/pablo/proliferate/.github/workflows/ci.yml`
- Lint entrypoint: `/Users/pablo/proliferate/package.json` (`lint`, `typecheck`, `test`)
- Current quality scripts:
  - `/Users/pablo/proliferate/scripts/check-no-direct-db-import.mjs`
  - `/Users/pablo/proliferate/scripts/check-no-raw-api-fetch.mjs`
  - `/Users/pablo/proliferate/scripts/check-db-boundary.mjs`
  - `/Users/pablo/proliferate/scripts/db-boundary-baseline.json`
- Agent instructions:
  - `/Users/pablo/proliferate/AGENTS.md`
  - `/Users/pablo/proliferate/CLAUDE.md`
- PR policy:
  - `/Users/pablo/proliferate/.github/PULL_REQUEST_TEMPLATE.md`

### 3.2 Ownership
- Platform/infra maintainers own CI gates and baseline files.
- Domain teams own remediation of touched-file violations in their areas.

---

## 4. Quality Targets (Normative)

### 4.1 Layering invariants
1. Routers/route handlers **MUST** be transport adapters only.
2. Business orchestration/policy **MUST** live in `packages/services/src/**/service.ts`.
3. Persistence mechanics **MUST** live in `packages/services/src/**/db.ts` (or `*-db.ts`).
4. Code outside allowed packages **MUST NOT** import `@proliferate/db` directly.
5. New direct DB writes in `service.ts` **MUST NOT** be introduced.

### 4.2 Size thresholds (touched-file policy)
For touched files:

| Layer | Target | Hard ceiling without exception |
|---|---:|---:|
| Web/gateway routers | 350 lines | 600 lines |
| `service.ts` | 400 lines | 650 lines |
| `db.ts` | 300 lines | 500 lines |
| Provider modules | 450 lines | 800 lines |
| UI components | 300 lines | 500 lines |

Rules:
- New files **MUST** meet target.
- Touched legacy files above target **MUST NOT** grow in size.
- Touched files above hard ceiling **MUST** be reduced or carry approved exception.

### 4.3 Function complexity thresholds (touched-file policy)
- Target max function length: 60 lines.
- Hard ceiling without exception: 120 lines.
- Cyclomatic complexity target: 10.
- Hard ceiling without exception: 15.

If complexity tooling is unavailable for a given package today, function-length checks still apply and complexity gate is introduced as planned in §6.6.

### 4.4 Duplication and security invariants
1. Crypto/signature primitives (`HMAC`, hash verify helpers) **MUST** have one shared implementation per pattern.
2. Provider-specific wrappers **SHOULD** call shared helpers, not reimplement primitives.
3. Duplicate implementations **MUST NOT** be added in touched code.

### 4.5 Test invariants for changed logic
- Touched business logic files (`service.ts`, `db.ts`, provider lifecycle logic) **MUST** include:
  - updated existing tests, or
  - new tests covering changed behavior, or
  - explicit exception record.
- Bug fixes **MUST** include regression test coverage unless impossible (then exception required).

---

## 5. Touched-File Ratchet Rules

### 5.1 Definition of touched file
A touched file is any tracked source file changed in the PR diff:
- `apps/**`
- `packages/**`
- `scripts/**` (for quality gates)

### 5.2 Ratchet policy
For each touched file:
1. **No new violations**: any gate with zero baseline tolerance must remain zero.
2. **No regression**: for baselined gates, count must not exceed baseline.
3. **Improve-or-hold floor**: if immediate improvement is not practical in this PR, the file MUST at least not regress.
4. **Size ratchet**:
  - if file is above target, line count must not increase.
  - if file is above hard ceiling, line count must decrease unless exception approved.
5. **Duplication ratchet**: no new duplicated crypto/signature helpers.

### 5.3 Debt reduction bonus rule (recommended)
When touching a high-debt file (> hard ceiling), PR **SHOULD** reduce file size by at least 5% or extract one coherent module.

---

## 6. CI Enforcement Plan

### 6.1 Existing blocking gates (already active)
- `pnpm lint` executes:
  - `turbo run lint`
  - `biome check .`
  - `lint:no-raw-api-fetch`
  - `lint:no-direct-db-import`
  - `lint:db-boundary`

### 6.2 Required new gates
Add scripts (or equivalent checks) and wire into `pnpm lint` / CI:
1. `lint:file-size`:
  - evaluates touched files against §4.2 thresholds.
2. `lint:function-size`:
  - evaluates touched functions against §4.3 length limits.
3. `lint:complexity`:
  - evaluates touched files against §4.3 complexity limits.
4. `lint:no-duplicate-signature-helpers`:
  - prevents new duplicated `hmacSha256`/signature primitives.

### 6.3 Baseline files
Use baseline files for legacy debt where needed:
- `scripts/db-boundary-baseline.json` (existing)
- `scripts/file-size-baseline.json` (new)
- `scripts/function-complexity-baseline.json` (new, if needed)

Baseline rules:
- Baseline entries **MUST** be count-based and file-scoped.
- Raising baseline counts in PR **MUST NOT** happen without exception.

### 6.4 CI failure policy
- Any blocking gate failure fails PR.
- Exception-approved violations are validated against allowlist file (see §7).
- Warning-only phase allowed during rollout (see §8), then blocking.

### 6.5 Minimum PR verification for touched backend code
For PRs touching backend logic (`apps/gateway`, `apps/worker`, `packages/services`, providers):
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (or package-scoped test command with rationale)

---

## 7. Exception Protocol (Time-Boxed)

### 7.1 Allowed exception cases
- Critical production fix where immediate decomposition is unsafe.
- Large migration slice where split must occur in follow-up PR.
- External API/regression constraints requiring temporary complexity.

### 7.2 Required exception payload
Every exception **MUST** include:
- `reason`
- `owner`
- `expiresOn` (YYYY-MM-DD)
- `followUpTicket`
- `scope` (files/rules waived)

### 7.3 Storage
- Exception records **SHOULD** be stored in:
  - `docs/code-quality-exceptions.md` (human-readable)
  - `scripts/code-quality-exceptions.json` (machine-readable)

### 7.4 Expiry behavior
- Expired exceptions fail CI.
- Renewals require explicit reviewer re-approval and new expiry.

---

## 8. Rollout Plan

### Phase 0 (immediate)
- Adopt this spec.
- Continue existing blocking gates.

### Phase 1 (week 1)
- Introduce new gates in warning mode (`file-size`, `function-size`, `duplicate-signature`).
- Populate initial baselines for legacy hotspots.

### Phase 2 (week 2)
- Switch touched-file gates to blocking mode.
- Enforce exception protocol in PR template.

### Phase 3 (week 3+)
- Enable complexity blocking.
- Tighten thresholds gradually in high-churn domains.

---

## 9. Known Limitations & Tech Debt

1. Current enforcement is strong for DB-boundary and direct import misuse, but weak for file size/complexity until new gates land.
2. Some large legacy files already exceed targets (routers/providers); ratchet policy prevents regression while migration decomposes them.
3. Complexity tooling may vary across packages; temporary fallback is function-length checks.
4. Duplicate signature helper detection is currently manual; automated gate is required.

---

## Acceptance Checklist

- [ ] Spec exists and is referenced by quality/migration work
- [ ] Existing gates remain blocking in CI
- [ ] New touched-file gates are implemented and phased in
- [ ] Exception protocol is documented and enforceable
- [ ] `AGENTS.md`, `CLAUDE.md`, and PR template reference this contract
