# Delivery specification: Cull sweep Track G — wave0 manifests and checkers

Status: frozen delivery specification (governs this PR's delta only).
Source of record: the cull sweep plan and Organization Standard (Pablo's
workspace, `Cull Plan.md` and `Core Architecture.md` §Organization Standard),
approved 2026-08-25. Shared rules for all cull tracks: own worktree + branch,
moves never mix with behavior changes, narrowest proof that establishes the
delta, docs updated in the same PR, commit trailers per repo convention.
Merge order: this track is independent — mergeable anytime.

## Intent

Lints before moves — the safety net for Waves 2–4.

## Scope

- `MANIFEST` format per Organization Standard (owns / public surface /
  allowed importers / spec link); manifests for the systems Track A founds +
  existing server domains
- `lints/runtime/` + a cross-domain import checker for `anyharness-lib`
  modules (pattern-copy of `check_server_boundaries.py`: rules + exception
  ledger seeded with current reality)
- `lints/client/` + directory-fence import lint for `product-client` (seeded
  permissive, ratchets later)
- CI wiring for both, non-blocking warn-mode first

## Acceptance

- Both checkers run in CI, green in warn mode
- Exception ledgers reflect current reality exactly (zero aspirational
  entries)
- Docs: Organization Standard's rule 2 marked current

## Frozen-spec adaptation notes (recorded at freeze, before implementation)

The spec text above is verbatim from the approved draft. Two path-level
adaptations, both required by repo convention discovered at execution time;
neither changes scope:

1. The repo's lint-record system (`lints/README.md`) fixes the owner set to
   `anyharness` / `server` / `frontend` / `product` and its loader
   (`scripts/lint_records.py`) validates against exactly those directories.
   The runtime records therefore land in `lints/anyharness/` (the runtime
   owner) and the client records in `lints/frontend/` — not the literal
   `lints/runtime/` and `lints/client/` names drafted before that convention
   was surveyed.
2. Track A moves the four live cloud systems — housed in six folders
   (`agent_gateway` → agent_auth; `integrations` + `integration_gateway` →
   integration_gateway; `worker` + `runtime_workers` → seam workers;
   `github_app` → github) — to new homes in the same sweep. Manifests are
   written where those systems live on main today
   (`server/proliferate/server/cloud/...`) so `git mv` carries them; path
   updates after Track A merges are a mechanical rebase. (Clarified at
   adversarial review: "four systems" and "six folders" describe the same
   set; both counts appear in the implementation.)
