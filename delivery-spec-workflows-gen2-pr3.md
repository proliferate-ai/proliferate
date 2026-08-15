# Delivery spec: workflows gen-2 PR3 — envelope rendering, docs registry, context materialization

**Status: FROZEN at PR3 branch creation.** Role: implementer of the Workflows ADR
(spec of record). This rung adds the rendering + filesystem half of the durable
cell. No live engine (PR4), no HTTP (PR5a).

## Scope

Builds on PR1's `domains/workflows` ground layer, branch stacked on
`codex/workflows-gen2-pr1-supersede-and-ground`.

### 1. Envelope rendering (`domains/workflows/render.rs`)

`render_envelope(node, definition, arguments, docs) -> RenderedEnvelope` producing
`{instruction_blocks, first_message, system_prompt_append}`:

- **Wrapped hidden instruction blocks** (the RULED workflow channel): the fixed
  context-doc preamble rides as system-instruction blocks prepended ahead of the
  user-visible first message, rendered with the exact house wrapper
  ("System instruction from AnyHarness, not user content:\n…") — the
  `prompt/render.rs:154` pattern (`system_instruction_block`). PR3 renders the
  *strings*; PR4 converts to ACP content blocks at send time via the existing
  prompt payload path.
- Preamble teaches: where `.proliferate/context/` lives, the NN-slug.md
  numbering, read/write freely, keep docs legible, evidence over prose. Fixed
  text, versioned in code, logged per node via the stored envelope.
- `@input:name` interpolation from the frozen `arguments` (verbatim value;
  non-string JSON values render as compact JSON).
- `@doc:slug` resolution to the doc's real workspace-relative path
  (`.proliferate/context/NN-slug.md`) from the run's doc registry rows — never
  from the definition, so builder reorders and run-local rows stay authoritative.
- `system_prompt_append`: the same preamble, set additively; correctness never
  rides on it.
- Envelope persisted via PR1's `store_rendered_envelope` before any launch
  (persist-before-act; PR4 consumes).

### 2. Docs registry completion

- PR1 already seeds `workflow_run_docs` rows in `create_run_with_first_node`.
  PR3 adds `register_doc(run_id, slug, producing_node_row_id)` for later
  registration (adhoc/discovered docs), keeping UNIQUE(run_id, slug) semantics
  and the NN filename law (NN = producing node's chain_index, %02d; bare
  `slug.md` when producer-less).

### 3. Context materialization (`domains/workflows/materialize.rs`)

`materialize_context(workspace_root, docs, doc_templates) -> Result<()>`:

- Creates `.proliferate/context/`, writes each registry row's file seeded from
  its template body (empty body → empty file), idempotent (existing files never
  overwritten — run-local edits win).
- Writes the **root-relative `/.proliferate/` exclude entry** into the shared
  `.git` common dir's `info/exclude` — once per clone, idempotent, never touches
  the user's `.gitignore`. Covers root checkouts and every worktree (ADR law;
  closes the env-file precedent gap).
- The law: folder + seeds + exclude entry exist on disk **before the first
  node's session/new** (harnesses walk the workspace once at session start).
  PR3 provides the function; PR4's PUT path calls it pre-launch.

## Tests (tier 1, real fs + real rows)

- Render: preamble block wrapper text exact; @input interpolation incl.
  non-string; @doc resolves to NN path from rows; unknown references cannot
  occur (validation precedes) — defensive error otherwise; envelope stored and
  reloaded byte-identical.
- Materialization: seeds written; re-materialize never clobbers an edited file;
  exclude entry appended exactly once across repeated calls (T1 negative
  control: entry present twice → test fails); worktree shape — entry lands in
  the COMMON git dir, not the worktree's private gitdir.
- Negative control per behavior.

## Non-goals

Session creation, prompt sending, actor loop (PR4); HTTP (PR5a); artifacts/
sibling folder (v1 optional, deferred).
