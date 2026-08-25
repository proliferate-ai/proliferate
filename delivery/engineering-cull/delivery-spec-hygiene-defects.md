# PR-E2 — Hygiene Defects

Status: frozen delivery specification.

> Freeze note (recorded at freeze, not a post-freeze edit): item 2's "Runtime
> reads the canonical catalog" framing is inaccurate — both cited sites were
> already `#[cfg(test)]`, and runtime reads the canonical catalog via
> `bundled.rs` unchanged. The change is exactly the cited sites (test
> fixtures), so the Revert section's "runtime behavior" caveat does not apply.

## Intent

Fix the five real defects the investigations found. No feature change; each item is a correctness or repo-integrity repair.

## Scope — changed

### 1. Declare PyYAML (server)
`server/proliferate/server/cloud/agent_gateway/verification.py:34` does `import yaml` at runtime (plus 6 test modules), but `pyyaml` is absent from `[project].dependencies` in `server/pyproject.toml` — it resolves only transitively via `uvicorn[standard]`. Add `pyyaml` with a floor version matching the lock; regenerate `server/uv.lock`. (`types-PyYAML` already present as dev dep.)

### 2. Runtime reads the canonical catalog, not the draft
`anyharness/crates/anyharness-lib/src/domains/agents/catalog/loader.rs:45` and `schema.rs:261` reach into `scripts/agent-catalog/catalog.draft.json` via `concat!(env!("CARGO_MANIFEST_DIR"), ...)`. Point both at `catalogs/agents/catalog.json` (the shipped copy the Makefile promotes to). The draft stays as the authoring intermediate; the byte-identical duplication stops being load-bearing. Update the loader's tests to pin the canonical path.

### 3. Stop the triple rebuild of the artifact-runtime bundle
`server-ci.yml` builds `server/artifact-runtime` at lines ~227, ~354, ~457 (once per lane). Build once in a shared step/artifact and reuse. **Deliberately deferred:** un-committing the 280K hashed bundle (`server/proliferate/server/artifact_runtime/static/**`) — the served assets must exist at deploy time and `artifact_runtime`'s product fate is [[Cull Plan]] decision 2. This PR only stops the redundant CI work.

### 4. Broken path references
- `specs/authoring.md:27` — the `../../../../server/...` link resolves above the repo root; correct the prefix (the sibling AGENT_AUTH.md link shows the right depth).
- `.gitignore:120` and `scripts/dev-build.mjs:38` — reference `scripts/copy-product-client-assets.mjs`, which lives at `apps/packages/product-client/scripts/copy-product-client-assets.mjs`. Fix both. (The three migration docs repeating the stale path die in [[PR-E6 Docs Diaries]] — do not fix them here.)

### 5. Frozen-spec title defect
`delivery/workflows-gen2/delivery-spec-workflows-gen2-pr8.md` opens with the unfilled template placeholder `# PR <N> — …` while marked frozen. Repair via the one sanctioned mechanism: a founder re-ruling note appended to the file recording the correct title. Requires founder sign-off in the PR.

## Non-goals

The Vite bundle gitignore question · dependabot/posthog pin (rides product PR-5) · anything Grafana/Honeycomb.

## Acceptance

- `uv lock` diff shows pyyaml as a direct dependency; server tests green.
- Grep-gate: `catalog.draft.json` appears in **zero** `.rs` files; `cargo test -p anyharness-lib` green (loader tests updated).
- `server-ci.yml` builds artifact-runtime exactly once per run (assert by reading the workflow; CI run confirms).
- `check_docs.py` green; the two fixed path references resolve.
- pr8 re-ruling note carries founder attribution.

## Revert

Items are independent; revert per-item or whole. Item 2 is the only one with runtime behavior (path change) — its revert restores the draft path harmlessly.
