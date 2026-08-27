# lints/ — rules as data

Every mechanical rule this repository enforces lives here as a TOML record.
**The record is the doc**: the rule's statement, its rationale, its examples,
and its exact exceptions are canonical in the record — prose docs cite rule
IDs, they never restate rules. The CI diagnostic is generated from the record,
so a failure teaches the rule instead of just saying "banned."

Checkers (the enforcement engines) live in `scripts/` per existing convention
and load their records from here via `scripts/lint_records.py`. Native tools
(Clippy, tsc, Ruff, rustfmt, mypy) enforce additional rules in their own config
formats; they are outside these records today — see `native-tools.md` for the
ledger and the follow-up.

## Layout

```
lints/
├── README.md            this contract
├── native-tools.md      native-tool enforcement ledger (follow-up scope)
├── anyharness/          AH-*   rules for the AnyHarness runtime owner
├── server/              SRV-*  rules for the server owner
├── frontend/            FE-*   rules for the frontend owner
└── product/             PROD-* cross-owner rules (docs, attribution, copy, theme)
```

Each owner dir holds:

- `<family>.toml` — rule records, one `[[rule]]` per record
- `exceptions.toml` — the exception ledger: grandfathered violation sites,
  one `[[exception]]` per site (fine-grained: a site, not a file)
- `ratchets.toml` — measured shrink-only debt (see Ratchets)

## The rule record

```toml
[[rule]]
id = "SRV-API-1"                    # citable forever; never renumbered
title = "API routes do not touch the database"
owner = "server"
status = "law"                      # law | holds | leaks
enforced_by = "scripts/check_server_boundaries.py"
mode = "lint"                       # compiler | lint | test | review
scope = "server/proliferate/server/**/api.py"

rule = """One imperative sentence: what is forbidden or required."""
alternative = """What to do instead — the legal path."""
why = """The rationale. If incident-born, the incident, dated."""

[rule.example]
bad = "db.execute(...) inside an api.py route handler"
good = "route calls service; service owns the transaction"
```

- `status`: `law` = clean, zero exceptions; `holds` = clean except the named
  ledger entries; `leaks` = known unenforced edge, tracked by `gap`.
- `gap = "#1234"` (optional): this rule COULD be mechanical and isn't yet, or
  the checker has a known hole. A gap is public debt, never a footnote.
- "Status: target" does not exist as a category. A rule is falsifiable or it
  is named debt.

## Rule ID allocation

An id is "citable forever; never renumbered," so two efforts minting ids in
parallel — on branches that cannot see each other — must not collide. The
loader's only cross-file invariant on `id` is exact-match uniqueness (`load`
fails on any duplicate); it does not parse or constrain the id's internal
shape, so the convention below needs no loader change to hold.

Each feature effort reserves its own family segment — the middle token
between the owner prefix and the number — and numbers sequentially within
it: one effort mints `FE-SCROLL-001`, `FE-SCROLL-002`, ...; another mints
`FE-LOAD-001+`; a cross-owner effort mints `PROD-AUTH-001+`. Distinct family
segments cannot collide by construction. Two efforts extending the same
existing family (for example, both adding to `SRV-STORE-*`) must coordinate
the next number by hand, or one of them should reserve a fresh family
segment instead.

## The exception ledger

```toml
[[exception]]
rule = "SRV-API-1"
path = "server/proliferate/server/accounts/identity/api.py"
site = "get_identity::db.commit"    # fingerprint: symbol/import/anchor, not a count
reason = "inherited Auth transaction semantics retained during the route move"
```

- **Violations are never counted.** A rule is clean or carries exact named
  sites. CI diffs the ledger; it never trusts a number.
- **Carry-forward is legal.** Renaming, moving, or splitting a grandfathered
  file moves its entries with it — that is maintenance, not an amendment.
- **Net-new exceptions are amendments.** Adding a site that was not
  grandfathered requires founder approval (see Constitution).

## Ratchets

Some debt is inherently measured (file line counts, mypy diagnostic counts).
Those are ratchets, not rules-with-exceptions: a measured baseline that may
only shrink. Ratchet config lives in the owner's `ratchets.toml`; the checker
fails on any growth and expects the baseline updated in the same PR as any
shrink.

**`ratchets.toml` carries no schema validation.** `lint_records.load()` skips
`ratchets.toml` outright — it is read only by `load_ratchets()`, as a raw
dict, with no shape check. A ratchet table enforces nothing by itself: it
only does anything once some checker script reads that table and compares
the current measurement against it. Adding rows to `ratchets.toml` with no
checker wired to read them is silent — the rule record still needs a
covering rule whose `enforced_by` names the checker that reads the ratchet,
so the `enforced_by`-exists validation above at least confirms that checker
file is real.

## Edge baselines

A fence rule freezes a measured import graph rather than naming per-site debt:
its record file carries `[[edge]]` tables (`from` / `to`) alongside the
`[[rule]]` records, and the checker fails on a crossing outside the declared
edges AND on a declared edge nothing crosses any more — the baseline always
equals reality exactly, and may only shrink. The loader ignores non-`[[rule]]`
tables in a rule file, so the baseline travels with the rule that owns it
(`lints/anyharness/fences.toml`, `lints/frontend/fences.toml`,
`lints/server/fences.toml`). Removing a row
when its last crossing dies is maintenance; adding a row is a net-new coupling
and therefore an amendment.

## Manifests

Every server system folder carries a `MANIFEST.toml` — name, spec link, owns,
public surface, allowed importers (Organization Standard rule 2). The manifest
lives with the code it describes, not under `lints/`; the covering rules are
`PROD-MANIFEST-*` in `product/manifests.toml`, enforced by
`scripts/check_manifests.py`. `allowed_importers` is measured reality, not
permission-by-intention: the checker fails on drift in either direction, so a
new importer is a visible amendment and a stale entry is same-PR maintenance.

## Generated diagnostics

Checkers emit diagnostics through `scripts/lint_records.py`, which renders the
record into the failure message: the rule sentence, the legal alternative, and
the record path. A bare "error: banned" is a bug in the checker.

## Constitution

Weakening a rule, adding a net-new exception, deleting a pinning test, or
rewriting a normative record is an amendment. Agents may not amend the
constitution: flag the need in the PR description and STOP for founder review.
Making CI green by changing the rules is never a fix. `CODEOWNERS` requires
founder approval on everything under `lints/`.
