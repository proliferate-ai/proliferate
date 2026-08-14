# Delivery specification: Workflows gen-2 PR2 — server v2

Status: frozen. Source of truth for intent: the Workflows gen-2 ADR
(`Proliferate Workspace/ADRs/Workflows/Core/Workflows ADR.md`), sections
"DB models → CP Postgres", "API, end to end, per plane → Server plane", and
"High level sequencing → PR2 server v2". This spec governs only this PR's
delta. Contradictions with current area docs are reported, never silently
resolved.

## Intent

Teach the control plane the gen-2 workflow definition DSL (`schemaVersion: 2`)
and the gen-2 invocation freeze shape, additively. v1 definitions and
invocations keep validating and executing exactly as today until PR7. This PR
is the first rung of the gen-2 ladder that other rungs consume: the runtime
(PR3/PR4/PR5a) builds against the frozen `invocation_json` shape and the
contract fixtures landed here; the client (PR5b/PR7) builds against the v2
endpoints.

## Scope

### 1. v2 definition document validation

New wire models plus a pure cross-field validator, with the v2 document shape:

```json
{
  "schemaVersion": 2,
  "nodes": [
    { "id": "n_research", "type": "agent", "title": "Research the topic",
      "prompt": "Research @input:topic and write findings into @doc:research-findings.",
      "model": { "agentKind": "claude", "modelId": "...", "modeId": "..." } },
    { "id": "n_review", "type": "human_in_loop", "title": "Review findings",
      "prompt": "Summarize @doc:research-findings for review." }
  ],
  "edges": [ { "from": "n_research", "to": "n_review" } ],
  "inputs": [ { "name": "topic", "description": "What to research", "required": true } ],
  "docTemplates": [ { "slug": "research-findings", "producingNodeId": "n_research", "body": "# Findings\n" } ]
}
```

Cross-field rules (pure function, designed for lockstep with the runtime's
PR3 validator via the shared contract fixtures):

- `nodes` non-empty; node ids unique; `type` is `agent | human_in_loop`.
- `edges` form exactly one linear path covering all nodes: every node has at
  most one incoming and one outgoing edge, exactly one head and one tail,
  no cycles, no unreachable nodes; a single-node definition has zero edges.
- `docTemplates` slugs unique (lowercase kebab); `producingNodeId` resolves to
  a declared node.
- Every `@input:name` reference in any prompt resolves to a declared input;
  every `@doc:slug` reference resolves to a declared docTemplate.
- `model` is optional per node and is a pass-through
  `{ agentKind, modelId?, modeId? }`. No catalog validation for v2: the same
  validator must be implementable identically on the runtime plane, which has
  no CP catalog. (Deliberate departure from v1's catalog-checked validation;
  the ADR's v2 validation list contains no catalog rule.)
- No placement key anywhere in the DSL (`extra=forbid` at every level; a
  dedicated invalid fixture pins the `placement` rejection).

### 2. v2 endpoints (additive on the existing routes)

- `POST /v1/workflows` and `PUT /v1/workflows/{id}` accept a v2 body
  `{ title, description?, defaultRepoConfigId?, definition: <v2 document> }`
  alongside the unchanged v1 flat body. v2 updates keep `expectedRevision`
  (CP optimistic concurrency is current behavior the ADR table abbreviates).
- `GET /v1/workflows` and `GET /v1/workflows/{id}` return v2 rows as
  `{ ..., schemaVersion: 2, definition: {...} }` (no `inputs`/`stages`, no
  `validatedCatalogVersion`).
- `GET /v1/workflows/{id}/run-eligibility` returns eligible with no blockers
  for v2 definitions (shape validity is guaranteed at write; placement is a
  trigger-time binding).
- `PUT /v1/workflow-invocations/{id}` accepts the v2 body
  `{ schemaVersion: 2, workflowDefinitionId, arguments, placement: { repoConfigId, mode: "worktree" | "repo_root" } }`
  and freezes:

```json
{
  "id": "...", "schemaVersion": 2,
  "workflowDefinitionId": "...", "definitionRevision": 3,
  "title": "...", "description": "...",
  "definition": { "the definition_json at trigger time, verbatim": "..." },
  "arguments": { "topic": "..." },
  "placement": { "repoConfigId": "...", "mode": "worktree" },
  "createdAt": "..."
}
```

  Idempotent on id via the existing canonical-JSON identity check. Placement
  repo must exist and belong to the user. Arguments must cover required
  inputs, name only declared inputs, and be portable scalars. A v2 invocation
  of a v1 definition (and vice versa) is invalid. No `expectedRevision` in the
  v2 body: gen-2 freezes whatever the definition is at trigger time, verbatim
  (ADR snapshot custody ruling).
- `GET /v1/workflow-invocations/{id}` returns the frozen record directly for
  v2 (no managed-execution read). v2 invocations create no managed-execution
  row; `deliver`/`cancel` on them 404 (no managed row exists), which is the
  correct answer — gen-2 delivery is the client courier's job (PR5b).

### 3. Storage

- Alembic migration: relax `ck_workflow_definition_schema_version` and
  `ck_workflow_invocation_schema_version` to `schema_version IN (1, 2)`; add
  nullable `definition_json JSONB` to `workflow_definition`.
- v2 rows: `schema_version=2`, `definition_json` holds the document,
  `inputs_json`/`stages_json` stay `[]`, `validated_catalog_version` stays
  `''` (v2 performs no catalog validation).

### 4. Contract fixtures (`fixtures/contracts/workflow-definition/`)

Both-planes fixtures; the Python tests here are the producer/consumer half,
the runtime consumes them in PR3 (this closes the fixture gap where
workflow-definition had a Python-only consumer):

- `v2-full.json` — response-shaped full v2 definition (both node types, model
  override, inputs, docTemplates).
- `v2-minimal.json` — single node, zero edges/inputs/docTemplates.
- `v2-invalid-*.json` — one file per rejected shape, each
  `{ "expectedIssuePath": ..., "definition": ... }`: duplicate node id,
  nonlinear edges (branch), edge cycle, unknown edge endpoint, duplicate doc
  slug, unknown doc producing node, unresolved `@input:`, unresolved `@doc:`,
  placement key in the DSL.
- `run-snapshot-v2.json` — the frozen v2 `invocation_json`, byte-shape the
  courier hands the runtime; an integration test proves the server produces
  exactly this shape.
- The existing `full.json`/`minimal.json` (v1) and
  `fixtures/contracts/workflow-portable-execution/` are untouched (PR1 owns
  the portable-execution deletion).

### 5. Tests

- Unit: fixture-driven v2 validation suite (valid fixtures pass; every
  invalid fixture fails at its declared path); v2 wire-model rejection cases.
- Integration: v2 definition CRUD lifecycle; v2 invocation freeze +
  idempotency + conflict + argument/placement rejection + cross-version
  rejection + GET-returns-frozen-record; run-snapshot fixture equality.
- All existing v1 workflow tests pass unchanged (the "v1 keeps validating"
  gate).

### 6. Generated artifacts

`server/openapi.json` and the cloud SDK generated client regenerate to carry
the new models (mechanical, `make cloud-openapi cloud-client-generate`).

## Out of scope

Runtime SQLite schema, envelope rendering, WorkflowActor, runtime HTTP
surface, client UI, v1 removal, starter templates. The gen-1 managed-execution
lane is untouched on every rung.

## Gate / revert

Additive; plain revert. Nothing consumes v2 until PR5b lands behind the
`workflows_v2` client flag.

## Amendments (review fix wave, 2026-08-14)

The frozen sections above stand as written; this section corrects the claims
the Opus review falsified and records the conductor rulings applied on top.
Each item names what changed.

1. **"Gate / revert: Additive; plain revert" is corrected.** The v2 write
   path is live on the server the moment this merges, so v2 rows can exist.
   A plain code revert leaves those rows routing through the v1 response
   model (`schemaVersion: Literal[1]`) and 500s that user's list; the
   migration downgrade now deletes v2 rows first (invocations, then
   definitions) before recreating the narrow `schema_version = 1` CHECKs.
   Deleting on downgrade is sanctioned: the feature ships dark, so v2 rows
   exist only where v2 was exercised deliberately.
2. **"Nothing consumes v2 until PR5b" is corrected.** The shared, unflagged
   `GET /v1/workflows` list and detail endpoints are consumed by the live v1
   Workflows UI today. This rung therefore also carries the client-safety
   floor: `cloud/sdk` re-points its list type at the renamed
   `WorkflowDefinitionListAnyResponse` generated schema (the stale name had
   silently degraded to `any`), models the list/detail payloads as the
   v1|v2 union, and `workflowDefinitionFromResponse` skips non-v1 rows
   (returns null; the detail surface renders an "Unsupported workflow
   version" state) instead of crashing on the missing `stages`.
3. **"All existing v1 workflow tests pass unchanged" is corrected in
   letter.** Three v1 tests were edited: the union request bodies namespace
   422 error `loc`s by request-model branch, and the OpenAPI request/response
   schemas for the shared routes went from `$ref` to `anyOf`. This is a wire
   contract change on v1 routes for 422 error shapes and the OpenAPI
   document; no in-repo client parses `loc`.
4. **§6's `server/openapi.json` claim is corrected**: that file is
   gitignored; the tracked, CI-verified artifact is
   `cloud/sdk/src/generated/openapi.ts`.
5. **§5 argument coverage is completed (Ruling H).** The implemented rule has
   always been three-part: arguments name only declared inputs, cover every
   `required` input, and cover every input referenced by any node prompt —
   referenced-but-optional inputs included. The client satisfies the third
   rule by sending `""` for blank optional inputs. Now documented and tested.
6. **Placement validation is relaxed to shape-only (Ruling A).**
   `placement.repoConfigId` is a non-empty string, not a CP repo config the
   user owns: for local v1 it carries a RUNTIME repo-root id end to end. The
   CP freezes placement verbatim and never resolves it — resolution is the
   engine plane's job. (ADR contradiction journaled for the morning ruling.)
7. **Reference grammar becomes scan-then-validate (Ruling C, amended C.1).**
   The scanner detects sigils case-insensitively (so `@INPUT:x` is an error,
   not silent literal text), captures the following run of non-space non-`@`
   characters (back-to-back references parse individually), peels trailing
   prose punctuation from the token, and validates the peeled token against
   the canonical per-kind grammar. Malformed = wrong-case sigil, empty
   token, or grammar-fail after the peel: wrong-case tokens, leading dashes,
   underscore doc slugs, and unpeelable trailing junk (`@doc:plan.md`) are
   validation errors, never silent non-matches or prefix matches — while a
   sentence may end directly after a reference (`@doc:research-findings.`
   is valid). Five `v2-invalid-ref-*` fixtures pin the rejects and
   `v2-valid-refs.json` pins the accepts for all three planes.
8. **Cross-version update guards are now symmetric.** The v1 update path
   rejects v2 rows (400, path `schemaVersion`) before validating or writing;
   the store only touches `definition_json` when a document is explicitly
   provided. A v1 PUT replay against an invocation id occupied by a v2
   invocation is a 409 conflict, not a 400 blaming stored data.
9. **The frozen invocation embeds the definition verbatim at the storage
   layer** — `invocation_json["definition"]` equals the definition row's
   `definition_json` — and this is now pinned DB-level by the producer test.
10. **`defaultRepoConfigId` is a runtime-space opaque id (Ruling A,
    live-testing follow-up, 2026-08-14).** The spec inherited gen-1's
    behavior of resolving the definition's `defaultRepoConfigId` against the
    CP repo-config store, but the client sources that field from RUNTIME
    repo roots (`GET /v1/repo-roots`) — so every id the builder offers was
    rejected with 400 while ids the builder can never produce were accepted.
    The CP now applies shape-only validation (UUID-or-null at the request
    model) and stores the id opaquely; resolution is the engine plane's job
    at placement time. This required dropping the DB-level resolver too:
    `workflow_definition.default_repo_config_id`'s FK into `repo_config`
    (Postgres-enforced CP resolution) is dropped in this PR's migration and
    recreated on downgrade after the v2-row deletes. v1 keeps its
    creation-time ownership check at the service layer; `repo_config` is
    soft-delete-only, so the FK's `ON DELETE SET NULL` never fired in
    practice. The invocation-freeze path was audited and repeats no such
    lookup — placement was already shape-only per amendment 6.
