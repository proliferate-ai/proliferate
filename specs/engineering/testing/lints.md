# Lints — the read-half constitution

Expands: [README.md#1--purpose](README.md#1--purpose)

The legible index of the lint estate. The records and their engines are the
machine half (`lints/` today; `specs/lints/` after the reshape — records +
engines + engine tests behind one CODEOWNERS gate); this document is the
human half. Counts are the 2026-08-26 inventory; the ledgers, not this
prose, are authoritative for numbers.

## 1 · Purpose

**A test proves a promise by running the code; a lint proves a law by
reading it.**

| | Test | Lint |
| --- | --- | --- |
| Coverage | samples — the cases someone wrote | **total** — every site, including future ones |
| Cost | env + seconds-to-minutes, can flake | milliseconds, no env, cannot flake |
| Red means | the product is broken | the constitution is violated — the code may run fine and still rot us |

The bar: **if a law is statically visible in the text of the code, it's a
lint, never a test** — including business laws. The flagship is admission
(*every mutating route calls `admit_*` before side effects*): pure product
law, enforced as a lint because a lint sees every route ever written while
a test sees the ones someone listed.

Corollary: `enforced_by = "review"` is not enforcement — it is declared
debt. The 8 such records in `lints/server/gaps.toml` were ruled deleted
2026-08-26 (honest beats aspirational; re-author properly if a law earns an
engine).

## 2 · Buy vs build

The estate is two halves:

- **Bought** (language-generic; ledgered in
  [lints/native-tools.md](../../../lints/native-tools.md), not wrapped in
  records — thousands of upstream rules, tool-native config, versioned by
  others): **ruff** (lint + format — our black+flake8+isort) · **Biome**
  format-only for TS/CSS/JSON (ruled 2026-08-26, wiring in flight; Markdown
  deliberately unformatted — `check_docs` polices what matters there) ·
  **rustfmt** + **clippy** (ruled into CI 2026-08-26, wiring in flight —
  the plan: mechanical warnings fixed; judgment lints on *provisional*
  `allow` with rule ids, revisited in the code-debt migration;
  `await_holding_lock` = a tracked debt row with a careful dedicated pass
  queued; then `-D warnings`) · **mypy** strict + the
  149-entry census ratchet · **tsc** — deliberately the *only* TS linter
  (no ESLint, by ruling) · **CodeQL**.
- **Built** (201 records, ~24 Python engines): only laws no off-the-shelf
  tool can know — our boundaries, our design vocabulary, our safety
  invariants.

The rule: **buy for generic, build for ours — never a custom formatter,
always the boundary checker.**

## 3 · The six families

| # | Family | Defends | Where |
| --- | --- | --- | --- |
| 1 | **Formatting** | one machine-owned style; zero review time on style | ruff format · rustfmt · biome · terraform fmt — coverage includes `scripts/` + `server/scripts/` (ruled 2026-08-26) |
| 2 | **Static types** | whole classes of bugs impossible | mypy strict + census ratchet · tsc everywhere (`integrations.*` opted out of mypy — visible debt, accepted) |
| 3 | **Boundaries** | who may import what — the specs' Fences made mechanical | the biggest family: the three plane boundary engines + 120 fence edges + manifests, both directions |
| 4 | **Size** | files stay readable; debt only shrinks | 64 `max_lines` rows, shrink-only, stale row fails |
| 5 | **Bug patterns** | known-bad idioms | ruff check (`E,F,I,UP,B,SIM,ANN`) · clippy |
| 6 | **Spec-law lints** | statically-visible laws of specific systems | admission · secret-log bans · WCAG contrast · toast copy · attribution · component library (record ruled in 2026-08-26) · chat-scroll single writer · migration discipline · update-flow atomicity |

Family 6 is the growth family: every future spec law that is statically
visible lands there.

## 4 · The closed grid (how boundary enforcement actually works)

- **Server:** each domain's manifest declares `allowed_importers` — *who
  may import it*. The checker does one regex scan of every file in the
  package and fails drift in **both directions**: an undeclared import is
  red, and a declared importer that no longer imports is red. The
  declaration lives with the **importee**, because the owner of a surface
  rules its consumers.
- **Runtime + frontend:** the same closure as `[[edge]]` baselines —
  every observed cross-domain edge must be a row, every row must still be
  observed. Growing the graph is a reviewable diff in `lints/`, which is
  CODEOWNERS-founder-gated.
- **Front-matter plan (ruled):** the manifest content moves into each spec
  README's TOML block; the checker reads specs; the 17 `MANIFEST.toml`
  files die — and the server graph becomes founder-gated for free.
- **Rust endgame note:** per-domain crates would make illegal imports
  *uncompilable* (the edge list and the build graph become one artifact);
  revisit at the domain renames. The scanner is the floor; for Python and
  TypeScript it is also the ceiling.

## 5 · What earns a lint

1. The law is **statically visible** — no execution needed.
2. An **owning spec** states it: the record cites the spec, the spec cites
   the rule id.
3. It lands as **record + engine + engine tests in one PR**; grandfathered
   sites go into an exact, shrink-only baseline.
4. Prose never restates a rule — it cites the id.

## 6 · The ledgers — the numbers that matter

The rule count (201) is an artifact of granularity — one citable sentence
per rule. Watch the **debt ledgers**, all shrink-only: exception entries
(283) · fence edges (120) · max-lines rows (64) · the mypy census (149).
Founder review gates every net-new entry.

## 7 · Queued new lints (from the 2026-08-26 rulings)

lane census (`continue-on-error` only via quarantine rows with expiry) ·
gate-mirror (every `make gate` command byte-identical to a PR step) ·
no-orphan docs (every sibling linked from its README; `Expands:` anchors
resolve) · proof trailers (`PROD-PROOF-001`) · wall-clock-day ban
(`SRV-TEST-001`) · migration-id cross-branch · front-matter identity.

## Decisions

Fully ruled 2026-08-26 — none open: Biome format-only + the format-on-commit
hook · clippy plan (mechanical fixes, provisional allows, debt row,
`-D warnings`) · rustfmt into CI · ruff over `scripts/` + `server/scripts/`
· the 8 `gaps.toml` records deleted · `check_component_library` gets its
record.
