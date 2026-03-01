# Artifacts and Retention

## Goal
Define where run outputs live, how they are referenced, and how retention/security rules are enforced.

## Status
- Applies to: V1
- Normative: Yes

## Scope
In scope:
- artifact classes and ownership
- object storage write/read path
- DB metadata references
- retention and deletion policy
- self-host operator requirements

Out of scope:
- full content-addressed storage redesign
- custom enterprise DLP pipelines

## Artifact classes (V1)
- `completion` artifacts: final run output bundle
- `enrichment` artifacts: pre-execution analysis bundle
- `sources` artifacts: normalized source context snapshot
- `policy` artifacts: policy/evaluation summary bundle
- visual proof artifacts (screenshots/video) when task requires UI proof

## File anchors

```text
apps/worker/src/automation/
  index.ts
  artifacts.ts

packages/services/src/runs/
  service.ts
  db.ts

packages/db/src/schema/
  schema.ts            # automationRuns.*ArtifactRef
  sessions.ts

apps/web/src/server/routers/
  automations.ts
  sessions.ts
```

## Core data model contract

| Model/field | Purpose | File |
|---|---|---|
| `automation_runs.completionArtifactRef` | pointer to completion artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.enrichmentArtifactRef` | pointer to enrichment artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.sourcesArtifactRef` | pointer to source-context artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.policyArtifactRef` | pointer to policy artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.completionJson/enrichmentJson` | structured inline summary payloads | `packages/db/src/schema/schema.ts` |

## Write path contract
1. Run service reaches artifact-write stage and enqueues outbox job (`kind = write_artifacts`).
2. Worker claims job and writes artifact payload to object storage.
3. Worker updates corresponding `*ArtifactRef` field(s) on `automation_runs`.
4. Worker emits durable run/timeline event for artifact write result.

## Read path contract
1. UI/API reads run/session metadata from DB first.
2. If artifact reference exists, backend resolves authorized object access.
3. Client receives metadata + retrieval link/stream response from authorized backend path.

Rules:
- Browsers do not receive unrestricted bucket credentials.
- Artifact read authorization must check org/session ownership before serving.

## Retention contract
- Default retention follows run/session retention window unless overridden by org policy.
- Deletion policy must remove:
  - object storage blob
  - stale DB reference or mark-as-deleted state
- Legal hold/compliance override can suspend deletion for selected orgs.

## Size and safety constraints
- Artifact payloads must be bounded and compressed where appropriate.
- Do not store raw secrets or token values inside artifacts.
- External channel notifications should link to artifact views, not inline full sensitive payloads.

## Self-host requirements
- Operator must provide S3-compatible object storage endpoint.
- Required env/config includes bucket, region/endpoint, and credentials binding.
- Backup/restore runbooks must include both Postgres and object storage.

## Definition of done checklist
- [ ] Artifact write path is asynchronous and durable
- [ ] `automation_runs` stores stable artifact references
- [ ] Artifact reads enforce org/session authorization
- [ ] Retention/deletion policy is documented and executable
- [ ] Self-host deployment docs include object storage prerequisites
