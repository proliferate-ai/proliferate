# lints/ — rules as data

Every mechanical rule this repository enforces lives here as a TOML record.
**The record is the doc**: the rule's statement, its rationale, its examples,
and its exact exceptions are canonical in the record — prose docs cite rule
IDs, they never restate rules. The CI diagnostic is generated from the record,
so a failure teaches the rule instead of just saying "banned."

Checkers (the enforcement engines) live in `scripts/` per existing convention
and load their records from here via `scripts/lint_records.py`. Native tools
(Clippy, ESLint, rustfmt, mypy) enforce additional rules in their own config
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
