# Workflows

Status: authoritative for Workflows V1 definition authoring.

Workflows are reusable, validated definitions for ordered agent work. The
first V1 slice owns only authoring and durable storage. It deliberately proves
the definition contract before adding execution, session takeover, grants,
triggers, or additional step kinds.

Read with:

- [`../../../platforms/product/model-catalog.md`](../../../platforms/product/model-catalog.md) for the
  probe-generated agent and model catalog;
- [`../../../platforms/product/agent-catalog-readiness.md`](../../../platforms/product/agent-catalog-readiness.md)
  for catalog distribution and target readiness;
- [`../../../structures/server/README.md`](../../../structures/server/README.md) for server
  ownership boundaries;
- [`../../../structures/frontend/README.md`](../../../structures/frontend/README.md) for
  frontend ownership boundaries; and
- [`../../../../developing/testing/README.md`](../../../../developing/testing/README.md)
  for the automated testing tiers.

## 1. PR1 Scope

PR1 includes:

- one `workflow_definition` table;
- personal ownership;
- strict server and client validation;
- create, list, read, full-replacement update, and soft-delete APIs;
- optimistic revision checks;
- an optional default repository configuration;
- sequential stages containing sequential `agent.prompt` steps;
- the same probe-generated catalog used by the optimistic agent UI;
- a basic Desktop list/create/edit/save/reopen surface; and
- contract, Postgres, server, frontend, and Tier 2 definition-lifecycle tests.

PR1 does not create runs, contact AnyHarness, take over sessions, invoke tools,
resolve credentials, grant integrations, schedule work, or deliver work to a
runtime. Runtime readiness is therefore not part of definition validation.

## 2. Mental Model

```text
WorkflowDefinition
  identity, user ownership, title, description
  schema version, optimistic revision, validating catalog version
  optional default repository configuration
  declared scalar inputs
  ordered stages

Stage
  harness configuration
  ordered steps executed in one session in a later PR

agent.prompt step
  prompt
  optional goal objective
```

The outer `stages` array is sequential. Each stage represents one future
session and its `steps` are sequential within that same session. PR1 stores
that meaning but does not execute it.

Stages and steps have no authored IDs. Their PR1 address is their array index.
Stable authored IDs arrive only when branching, output references, or graph
editing require them.

## 3. Definition Contract

API payloads use camelCase. The persisted JSON contract is `schemaVersion: 1`.
Unknown fields are rejected at every nested level.

```json
{
  "id": "10000000-0000-4000-8000-000000000001",
  "userId": "20000000-0000-4000-8000-000000000001",
  "title": "Diagnose a ticket",
  "description": "",
  "schemaVersion": 1,
  "revision": 1,
  "validatedCatalogVersion": "2026-07-11.2",
  "defaultRepoConfigId": null,
  "inputs": [
    { "name": "ticket", "type": "string", "required": true }
  ],
  "stages": [
    {
      "harnessConfig": { "agentKind": "claude" },
      "steps": [
        {
          "kind": "agent.prompt",
          "prompt": "Investigate {{inputs.ticket}}."
        }
      ]
    }
  ],
  "createdAt": "2026-07-12T12:00:00Z",
  "updatedAt": "2026-07-12T12:00:00Z",
  "deletedAt": null
}
```

The canonical cross-language examples are:

- [`../../../../../fixtures/contracts/workflow-definition/minimal.json`](../../../../../fixtures/contracts/workflow-definition/minimal.json)
- [`../../../../../fixtures/contracts/workflow-definition/full.json`](../../../../../fixtures/contracts/workflow-definition/full.json)

### 3.1 Inputs

An input contains exactly:

```json
{ "name": "ticket", "type": "string", "required": true }
```

Rules:

- `name` is a non-empty identifier and is unique within the definition;
- `type` is `string`, `number`, or `boolean`;
- `required` is a boolean;
- defaults, choices, arrays, objects, and secret values are not in PR1; and
- prompts reference inputs only as `{{inputs.name}}`.

Every input reference must name a declared input. Malformed references and
references to undeclared inputs are invalid.

### 3.2 Stages and harness configuration

A definition contains at least one stage. A stage contains exactly one
`harnessConfig` and at least one step.

`harnessConfig` contains:

| Field | Required | Meaning |
| --- | --- | --- |
| `agentKind` | yes | Catalog agent kind. |
| `modelId` | no | Explicit catalog model. Omission means use the target default at execution. |
| `effort` | no | Explicit model-specific effort. Requires `modelId`. |

Execution mode is not authored. Workflow sessions will use the product's
bypass-equivalent execution mode.

The string `"default"` is never an omission sentinel. If a catalog contains a
model whose ID is `default`, selecting that model persists `"modelId":
"default"`; choosing the future target default omits `modelId`.

### 3.3 Prompt steps and goals

The only PR1 step is:

```json
{
  "kind": "agent.prompt",
  "prompt": "Investigate {{inputs.ticket}}.",
  "goal": { "objective": "Produce an evidence-backed diagnosis." }
}
```

`prompt` is non-empty. `goal` is optional; when present it contains exactly one
non-empty `objective`. A prompt without a goal represents one completed turn.
A prompt with a goal represents future execution until that goal reaches a
terminal state. PR1 validates and stores that distinction only.

## 4. Default Repository

`defaultRepoConfigId` is either `null` or the ID of one of the owning user's
active `repo_config` rows. `null` explicitly means no repository.

The server rejects missing, deleted, or another user's repository
configuration. The foreign key uses `ON DELETE SET NULL` so physical removal
cannot strand the definition. Because repository removal may also be logical,
reads and replacements treat a soft-deleted referenced configuration as
unavailable rather than presenting it as a valid choice.

Branch, environment, checkout, and per-invocation repository overrides are
execution concerns and are out of scope.

## 5. Persistence

`workflow_definition` owns:

```text
id                          uuid primary key
user_id                     uuid FK user.id
title                       text
description                 text, non-null (empty when omitted/blank)
schema_version              integer, exactly 1
revision                    integer, starts at 1
validated_catalog_version   text
default_repo_config_id      uuid nullable FK repo_config.id, ON DELETE SET NULL
inputs_json                 jsonb
stages_json                 jsonb
created_at                  timestamptz
updated_at                  timestamptz
deleted_at                  timestamptz nullable
```

`user_id` is always the actor who created the row and is immutable. Deleting a
user cascades through that user's definitions.

Titles are required and are not unique. Description input is optional, but the
server normalizes an absent or blank description to the non-null empty string
in storage and responses. Deletion is soft deletion; normal list and read
operations exclude deleted rows.

`revision` is an optimistic concurrency counter. A full replacement supplies
`expectedRevision`. The store performs one conditional update equivalent to:

```sql
UPDATE workflow_definition
SET ..., revision = revision + 1
WHERE id = :id AND revision = :expected_revision
RETURNING ...;
```

A stale replacement returns HTTP 409 and does not change any field. A
read-then-write sequence without the revision predicate is invalid.

## 6. Catalog Validation

Definition authoring uses the current probe-generated catalog served by:

```text
GET /v1/catalogs/agents?schemaVersion=2
```

The server reads the same catalog document directly. There is no workflow-only
agent, model, or effort enum.

Rules:

- `agentKind` must exist in the catalog;
- an explicit model must be active and visible in the authoring menu
  (`status == active` and `defaultVisible == true`);
- promoted catalog rows materialize `defaultVisible`; malformed omissions fail
  closed as hidden;
- model aliases are accepted at the API boundary and the canonical model ID is
  stored and returned;
- `effort` requires an explicit model;
- effort options come from that exact model's `effort` or
  `reasoning_effort` control matrix;
- the matching session control must also declare an application mapping
  (`createField` or `liveConfigId`); probe metadata without an application
  mapping is not authorable;
- an agent-wide union must never authorize an option absent from the selected
  model; and
- a step with `goal` requires `session.supportsGoals` for that stage's agent.

Examples that must fail even though the value exists elsewhere in the same
harness catalog:

- Claude `sonnet` with `xhigh`;
- Claude `haiku` with `high`; and
- Codex `gpt-5.5` with `ultra`.

Omitted `modelId` and `effort` stay omitted. Probe-observed defaults are UI
hints and must never be materialized into the stored definition merely because
the user did not choose a value.

`validatedCatalogVersion` records the catalog version consulted by the server
for the most recent accepted create or replacement. It is diagnostic metadata,
not a pin. Reads never fail solely because the live catalog changed. The UI
compares every stored selection with the current catalog and warns about stale
or unavailable selections; version equality alone is not proof that every
selection remains available. New or changed selections must pass the current
catalog. The editor must never silently rewrite stale stored selections.

Target-specific installation, credentials, routing, and readiness are checked
against AnyHarness launch options only when execution exists. They do not make
a reusable definition invalid at authoring time.

## 7. Access Policy

- The actor creates definitions owned by themself.
- Only that user may list, read, replace, or delete their definitions.
- Another user receives a non-enumerating not-found response.
- `userId` is server-owned and immutable after creation.

Organization ownership and sharing are explicitly deferred. PR1 has no owner
scope selector, organization ID, creator/admin distinction, or organization
authorization path.

## 8. API Surface

The Cloud API owns:

```text
GET    /v1/workflows
POST   /v1/workflows
GET    /v1/workflows/{definitionId}
PUT    /v1/workflows/{definitionId}
DELETE /v1/workflows/{definitionId}
```

Create accepts only the mutable definition fields. The server supplies the ID,
`userId`, schema version, revision, catalog version, and timestamps. `PUT` is a
full replacement of mutable fields and requires `expectedRevision`; user
ownership and identity fields are immutable.

All writes are authoritatively validated by the server even when the client
already reported inline validation errors. Typed errors distinguish invalid
definitions, unavailable catalog selections, access denial/not-found, and
revision conflict.

## 9. PR1 Desktop And Web Surface

The first editor is intentionally basic:

- definition list and create/edit entrypoints;
- title and description;
- default repository or no repository;
- input rows;
- ordered stage cards;
- agent, model, and effort controls sourced from the current catalog;
- ordered prompt blocks with optional goal objective;
- inline validation; and
- save, reload, reopen, and soft-delete behavior.

Desktop local mode may mount the product shell without an account. Anonymous
users see a sign-in gate; development auth bypass shows instructions to disable
the bypass and use real account authentication. Neither state mounts the Cloud
workflow, catalog, or repository query tree. Authenticated Desktop requests use
the verified current user's ID as their cache scope and fail closed when that
identity is unavailable. Web remains behind its app-level authentication gate.

The UI preserves array order exactly. Switching an agent or model clears an
incompatible model or effort rather than submitting a hidden invalid value. A
revision conflict keeps the local draft and offers a deliberate reload; it
does not overwrite the newer server value.

There is no canvas, execution monitor, run history, trigger UI, grants editor,
or advanced step palette in PR1.

## 10. Acceptance

Tier 1 owns:

- server and client validation matrices;
- cross-language contract fixtures;
- canonical alias normalization;
- durable user-scoped CRUD against Postgres;
- repository configuration ownership validation;
- exact optimistic concurrency, including two writers racing on one revision;
- soft deletion and access policy; and
- UI component/domain behavior.

Tier 2 scenario `T2-WFDEF-1` owns the real definition lifecycle:

```text
sign in
  -> create a definition with inputs, stages, catalog choices, and a repo
  -> save
  -> reload the browser
  -> reopen and verify exact values and ordering
  -> edit and save with the returned revision
  -> reopen the newer revision
  -> delete and verify it leaves the normal list
```

AnyHarness is skipped for this scenario because PR1 has no runtime boundary.
Tier 3 begins only with the execution PR.

## 11. Follow-up PRs

The execution spine follows this contract without redesigning it:

- create a workflow invocation with filled inputs;
- deliver the resolved bundle to AnyHarness;
- persist invocation arguments and steps in the workflow service's SQLite;
- take over a live session or create a new one; and
- execute sequential prompt/goal steps.

Later independent additions own grants and integration scoping, required tool
calls, automation and polling, Slack notification, PR creation, scripts,
parallel agents, and function invocations. None of those extensions widen the
PR1 definition contract implicitly.

Organization-owned and shared definitions are also a follow-up. They require
an organization-compatible repository model and an explicit sharing/access
policy; PR1 must not pre-build either through dormant owner fields.
