# Proliferate Spec Catalog

_Catalog of the current spec tree: what exists, what it covers, and where the
next spec work belongs. `specs/README.md` remains the canonical root index._
_Written 2026-06-01. Update in the same PR when specs are added or removed._

---

## How the Spec System Is Organized

```text
specs/
  codebase/
    structures/   Folder rules, ownership, code maps per system.
    primitives/   Reusable runtime/product substrate (data models, APIs, acceptance criteria).
    features/     User-facing workflows and surfaces assembled from primitives.
  developing/     Operator runbooks — local dev, deploying, debugging, analytics, QA.
  tbd/            Intentionally non-authoritative material; see tbd/README.md.
```

Rule: read the relevant spec before touching code; update it in the same PR.

---

## Codebase — Structures

### Frontend Apps
**`specs/codebase/structures/frontend/README.md`** — Desktop, Web, Mobile + shared packages.

Defines the full target shape (`components/<domain>/<surface>/<role>/`, `hooks/<domain>/derived|workflows|lifecycle/`, `lib/access|domain|workflows|infra/`, `stores/<domain>/`), shared package stack (`design → ui → product-ui → product-surfaces`, plus `product-domain` as a pure-logic leaf), and dependency direction enforced by `scripts/check_frontend_boundaries.py`.

Guides: `components`, `hooks`, `state`, `lib`, `access`, `config`, `copy`, `styling`, `telemetry`, `packages/README.md`.

### Desktop Native
**`specs/codebase/structures/desktop-native/README.md`** — `apps/desktop/src-tauri/**`.

Sub-specs: `specs/codebase/structures/desktop-native/specs/anyharness-sidecar.md` (sidecar launch), `specs/codebase/structures/desktop-native/specs/agent-seeds.md` (bundled seed artifacts).

### AnyHarness
**`specs/codebase/structures/anyharness/README.md`** — `anyharness/crates/**`.

Session engine call chain: `api/http → SessionRuntime → SessionService/SessionStore → LiveSessionManager → SessionActor → AcpClient + SessionEventSink + InteractionBroker`.

Layers: `api/` (transport), `app/` (wiring), `domains/` (durable product rules), `live/` (actors/handles/PTYs), `adapters/` (files/git/processes), `integrations/` (MCP/ACP protocol), `persistence/`, `observability/`.

Product domains plugged in via `SessionExtension`: `cowork`, `reviews`, `subagents`.

MCP is a vertical: `domains/sessions/mcp_bindings/` (user bindings + assembly), `domains/<feature>/mcp/` (tool behavior), `integrations/mcp/` (JSON-RPC scaffolding), `live/sessions/interactions/mcp_elicitation/` (live ACP interaction).

Crates: `anyharness` (thin binary), `anyharness-contract` (wire schemas), `anyharness-credential-discovery` (credential files), `anyharness-lib` (all runtime behavior).

Guides: `system-architecture`, `crates`, `api`, `app`, `domains`, `live-runtime`, `adapters`, `integrations`, `harnesses`, `persistence`, `observability`, `repo-shape`. Active specs: `specs/codebase/structures/anyharness/specs/session-engine.md`, `specs/codebase/structures/anyharness/specs/session-actor.md`. Harness docs: `harnesses/claude.md`, `harnesses/codex.md`, `harnesses/gemini.md`.

### Proliferate Worker
**`specs/codebase/structures/proliferate-worker/README.md`** — `anyharness/crates/proliferate-worker/**`.

Target-side bridge, collapsed/ephemeral identity (one worker = one sandbox = one Target, no slots/fencing): two long-polls — `control` down (`Cloud → Worker → AnyHarness`: commands + per-domain reconcile incl. revoked-jti) and `tail` up (`AnyHarness → Worker → Cloud`: events) — plus a heartbeat carrying the self-update check.

Folders: `control/` (`commands/` + `reconcile/`), `tail/`, `lifecycle/` (heartbeat + self-update mailbox), `inventory/` (startup capabilities), `materialization/` (target-local effects), `cloud_client/` + `anyharness_client/` (raw HTTP only), `store/` (SQLite: applied-revisions/up-cursor), `identity/` (enrollment/credentials). Consolidated narrative in `architecture.md`.

Guides: `runtime`, `identity`, `control`, `tail`, `lifecycle`, `inventory`, `materialization`, `clients`, `store`, `root-support`.

### Proliferate Supervisor
**`specs/codebase/structures/proliferate-supervisor/README.md`** — `anyharness/crates/proliferate-supervisor/**`.

Owns exactly: start/restart AnyHarness and Worker, stage and verify update artifacts. Nothing else. Core workflow: `spawn AnyHarness → loop { spawn Worker; restart on exit }`.

Folders: `process/`, `install/`, `update/` (manifest, staging, rollback).

### Server
**`specs/codebase/structures/server/README.md`** — `server/**`.

Domain shape: `api.py` (transport) → `service.py` (orchestration) → `domain/policy.py` (pure rules) + `db/store/` (queries). Type pipeline: ORM → frozen `@dataclass` → Pydantic; ORM never leaves the store.

Guides: `domains`, `database`, `auth`, `errors`, `integrations`, `config`, `workers`.

### SDK
**`specs/codebase/structures/sdk/README.md`** — `anyharness/sdk/**` and `anyharness/sdk-react/**`.

Cloud SDK generated artifacts under `cloud/sdk/**` and `cloud/sdk-react/**`
are owned by the Cloud API/server surface and the primitive specs that change
Cloud contracts; regenerate them with the owning Cloud SDK generation flow when
server OpenAPI changes.

### Auth Gateway — split ownership, no standalone structure spec
No `specs/codebase/structures/auth-gateway/` exists today. The explicit
cross-link lives in `specs/codebase/structures/README.md`. Coverage is split
across `server/guides/auth.md` for server-side auth infrastructure,
`features/product-auth.md` for product account auth, and
`primitives/agent-auth.md` / `primitives/agent-auth-bifrost-byok.md` for LLM
gateway, BYOK, managed credits, and sandbox auth materialization.

Create a dedicated Auth Gateway structure spec only if it becomes a separately
deployed or separately owned codebase boundary.

---

## Codebase — Primitives

### Sandbox Provisioning (spec 00)
**`specs/codebase/primitives/sandbox-provisioning.md`**

Two objects kept separate: `sandbox_profile` (stable product/config identity, survives replacement) and the **ephemeral managed target = sandbox** (`cloud_target` is the addressable endpoint, `cloud_sandbox` its 1:1 provider-lifecycle row). The target is replaced as a new target, not edited; there is no slot layer.

New tables: `cloud_target_runtime_access` (AnyHarness URL/token/data key per target), `sandbox_profile_target_state` (rename+broaden of agent-auth-only table; carries both runtime-config and agent-auth applied state, keyed by `(profile, target)`, no slot fence). Collapsed identity: managed target = sandbox (1:1, ephemeral), no slots/`slot_generation`/fencing — `target_id` is the epoch.

Sync path: inserts rows, mints enrollment token — **never calls E2B**. Background path: `provision_profile_slot` (E2B create → worker boot → enrollment → runtime access write). Reconciler: `reconcile_sandbox_profile_target`.

10 chunks, 24 acceptance criteria, full files-to-change list.

### Workspace Provisioning / Creation
**`specs/codebase/primitives/workspace-provisioning.md`**

Canonical read path for managed workspace creation. It stitches together the
existing owners: sandbox profile/target/slot and `cloud_workspace` creation in
`sandbox-provisioning.md`, `managed_profile_launch`, exposure, projection, wake,
and command fencing in `cloud-commands.md`, post-creation materialization and
lifecycle in `workspace-lifecycle.md`, and pending-shell handoff in
`features/pending-workspace-shell.md`.

### Workspace Lifecycle / Materialization
**`specs/codebase/primitives/workspace-lifecycle.md`**

Core split: `Workspace` = durable product record; `Worktree` = filesystem materialization.

State model: product lifecycle (`active / archived / deleted`) × materialization state (`hydrated / dehydrated / hydrating / unknown / inconsistent`) × cleanup status (`idle / pruning / blocked / failed / skipped / completed`).

7 documented flows. Safety rule: never auto-prune uncommitted/conflicted work, live sessions, or paths outside Proliferate-managed roots.

### MCP + Skills Flow
**`specs/codebase/primitives/mcp-runtime.md`** — MCP inside AnyHarness.
**`specs/codebase/primitives/mcp-skills.md`** (spec 01) — Cloud-side MCP/skills/plugins as sandbox runtime config.

Four MCP concepts in AnyHarness: user bindings, session extensions, product MCP servers, MCP elicitation. Central assembly: `domains/sessions/mcp_bindings/assembly.rs::assemble_session_mcp_launch(...)`.

mcp-skills.md adds: catalog entry → configured item → runtime manifest pipeline; `materialize_environment` command for applying config; `requiredRuntimeConfigRevision` session preflight.

### Product MCP Structure
**`specs/codebase/features/agent-features/servers.md`** — repeatable two-part pattern.
**`specs/codebase/features/agent-features/definitions/`** — concrete definitions: `artifacts.md`, `cowork.md`, `reviews.md`, `subagents.md`, `prompt-and-skill-policy.md`.

Every product MCP server: `definition.rs`, `auth.rs`, `context.rs`, `tools.rs`, `calls.rs`. Session binding side: `product_catalog.rs` — launch-side facade: select and materialize product MCP launch extras for this session (mints capability token). URL: `/v1/workspaces/{id}/.../{session_id}/mcp`.

### Agent Auth (spec 02)
**`specs/codebase/primitives/agent-auth.md`**
**`specs/codebase/primitives/agent-auth-bifrost-byok.md`**

One question per profile per harness: which credential + which materialization mode (`synced_files` = native auth files written by worker; `gateway_env` = Bifrost virtual key injected as protected env).

10 agent-auth DB tables. 10 gaps identified and addressed (proactive grant rotation, cleanup-on-revoke, AnyHarness fail-closed on no selection → `AGENT_AUTH_SELECTION_REQUIRED`, worker scope synthesis, `protected_env` allowlist per agent+mode, hosted capability API, `needs_resync` detection).

### Cloud Commands / Running Alignment (spec 04)
**`specs/codebase/primitives/cloud-commands.md`**

Command flow: `client → enqueue_command (preflight + wake) → Worker → AnyHarness → event uplink (exposure-gated) → Cloud DB ← passive GET reads`.

Key additions: `cloud_workspace_exposure` table (visibility, commandable, projection_level), session projection columns on `cloud_sessions`, worker projection cursor (SQLite), `target_id` correlation on lease/result/ingest (no slot fence), `_validate_runtime_config_preflight()`, async wake gate (wake-required kinds never block `enqueue_command`; background job; failed wakes → `failed_delivery` with typed error code).

`managed_profile_launch(...)` — canonical entry point for every managed cloud workspace creation. Passive UI rule: GET endpoints on workspaces/sessions/transcript never wake a sandbox.

### Claiming (spec 05)
**`specs/codebase/primitives/claiming.md`**

One-way irreversible: `shared_unclaimed → claimed`. `cloud_workspace_claim` table (immutable). Desktop direct-attach via RS256 JWT scoped to one workspace/session; per-token revocation only (claim itself cannot be revoked). Listing scopes: my work, team unclaimed pool, admin audit.

### Billing (spec 09)
**`specs/codebase/primitives/billing.md`**

Most billing already shipped. Spec 09 closes: wire `authorize_sandbox_start` to wake hook, tie managed-credit budget to subscription plan, `free_cloud_allocation` table keyed by GitHub provider user id (anti-abuse), billing state in workspace SSE patches, web Settings → Billing pane.

### Supporting Primitives
- **`primitives/agent-catalog-readiness.md`** — single catalog input, trusted descriptor/model projection, seed artifacts, launch resolution.
- **`primitives/agents/claude.md`**, **`primitives/agents/codex.md`** — per-harness behavior specs.

---

## Codebase — Features

| File | Covers |
| --- | --- |
| `agent-features/servers.md` | Product MCP server pattern (see Primitives above) |
| `agent-features/definitions/*.md` | artifacts, cowork, reviews, subagents, prompt-and-skill-policy |
| `automations.md` | Agent automation orchestration |
| `chat-composer.md` | Chat input composer surface |
| `chat-transcript.md` | Transcript rendering surface |
| `cloud-dispatch.md` (spec 08) | Web/Mobile/Desktop dispatch UX — live hooks, exposure-aware listing, Continue remotely, Open in web, deep links |
| `cowork-artifacts.md` | Cowork artifact creation and delegation |
| `delegated-work.md` | Delegated work flows |
| `mobile-cloud-client.md` | Mobile Cloud SDK cutover from fixture data |
| `onboarding.md` | Signed-out to product-ready account handoff, readiness gates, and first workspace transition |
| `pending-workspace-shell.md` | Shell shown while workspace is pending |
| `product-auth.md` | OAuth and sign-in flows |
| `settings-admin-ia.md` (spec 03) | Settings and Admin IA placement |
| `slack-bot.md` (spec 07) | Slack bot integration |
| `support-reporting.md` | Desktop support report uploads |
| `web-cloud-local-parity.md` | Web ↔ local Desktop cloud experience parity |
| `workspace-files.md` | Workspace file browsing surface |
| `workspace-migration.md` | Workspace migration flows |

### Feature spec queue

These requested feature names either map to existing specs or need a focused
spec before end-to-end product work changes that surface.

| Feature | Current owner | Next spec action |
| --- | --- | --- |
| **Onboarding** | `features/onboarding.md`; lower-level owners are `product-auth.md`, `agent-auth-bifrost-byok.md`, `billing.md`, `settings-admin-ia.md`, and workspace creation read path in `workspace-provisioning.md` | Covered for the current end-to-end read path; deepen the feature spec when onboarding UX grows. |
| **Browsers** | AnyHarness runtime structure and future Product MCP pattern | Add a browser feature spec or Product MCP definition before adding user-visible browser workflows. |
| **Terminals** | `features/terminals.md` for product UX (terminal pane, creation grid contract); AnyHarness structure specs for runtime internals | Covered for terminal pane UX; runtime-only work belongs in AnyHarness structure specs. |
| **Computer Use** | Future Product MCP pattern | Add a computer-use feature spec or Product MCP definition before changing permissions, UX, or QA behavior. |
| **Plugins** | `primitives/mcp-skills.md`, `settings-admin-ia.md` | Add `features/plugins.md` only when catalog/install/manage UX grows beyond the primitive contract. |
| **Subagents** | `delegated-work.md`, `agent-features/definitions/subagents.md` | Covered for current UX and Product MCP semantics; split only if product-surface behavior outgrows those docs. |

---

## Developer Processes

### Deploying / Updating to Production

**`specs/developing/deploying/`**

| File | Covers |
| --- | --- |
| `README.md` | Process map: 4 deployment questions |
| `ci-cd.md` | Hosted CI/CD, staging → production, release lanes (desktop/mobile/web/server/E2B/workers), env vars, production inventory |
| `self-hosted-deploy.md` | Docker Compose canonical self-hosted deployment |
| `self-hosted-aws.md` | CloudFormation one-click AWS launch stack |

Env vars live in: GitHub Environments (hosted deploy-time), AWS SSM SecureString (ECS runtime), canonical inventory at `developing/reference/env-vars.yaml`.

MCPs + permissions: GitHub MCP / `gh`, AWS (ECS, ECR, RDS, S3, SSM,
CloudFront), GitHub Actions environment admin, Apple developer account, Vercel,
Expo/EAS, App Store Connect, and browser/Chrome access for provider dashboards.

Release docs/public-surface ownership is explicit in `deploying/README.md` and
`deploying/ci-cd.md`: user-facing releases must confirm whether landing page,
public docs, changelog/release notes, in-app copy, install docs, or support
docs need to change.

---

### Developing Locally

**`specs/developing/local/`**

| File | Covers |
| --- | --- |
| `README.md` | Full-stack local startup, profiles quickstart, Stripe quickstart, web/desktop/mobile access |
| `dev-profiles.md` | Profile contract: ports, state paths, database, Tauri identity |
| `stripe-local-testing.md` | Webhook forwarding, checkout, portal, refill, meter events |
| `mobile.md` | Native mobile OAuth, Expo overrides, dev refresh-token path |

Quick start: `make setup PROFILE=<name>` + `make build` for a clean worktree + `make run PROFILE=<name>` (Pablo's alias: `pdev <name>`).

Stripe: `make stripe-setup-test` then `make run PROFILE=<name> STRIPE=1`.
Mobile web: `pnpm --dir apps/mobile web:profile`.
Native mobile: `make dev-mobile-auth` (starts server + ngrok + Expo).
Tunnels: `make run PROFILE=<name> AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok` or `CLOUD_WORKER_TUNNEL=ngrok`.

MCPs + permissions: local shell, Browser/Chrome for local/OAuth/provider
surfaces, GitHub MCP/`gh` when reproducing from issue or artifact context,
Stripe CLI for billing, Expo/simulator/device for mobile, and tunnel tooling
when callbacks or gateway flows require a public URL.

---

### Debugging

**`specs/developing/debugging/`**

| File | Covers |
| --- | --- |
| `README.md` | 7-step triage, tools/permissions table, runbook links |
| `support-reports.md` | End-to-end correlation: support report id → tenant/user/org/workspace/session/command/worker id → Cloud DB, S3, CloudWatch, Sentry |
| `performance-profiling.md` | Privacy-safe renderer + AnyHarness timing baselines |

Triage order: GitHub issue → support report correlation → Sentry → recent deploys → reproduce locally → capture evidence → update issue.

MCPs + permissions: GitHub MCP/`gh` for issues/PRs/workflows, Browser/Chrome
for dashboards, Sentry, internal support-report/S3 access, AWS/GitHub Actions
for deploy or infra issues, and vendor access only for the affected surface.

The general issue runbook now lives directly in `debugging/README.md`; specific
deep dives remain in `support-reports.md`, `performance-profiling.md`, and the
analytics/deploying docs.

---

### Analytics + Keeping Fresh

**`specs/developing/analytics/`**

| Surface | Owns | File |
| --- | --- | --- |
| Customer.io | Engagement and lifecycle messaging | `customerio.md` |
| Metabase | Durable operating dashboards over DB facts | `metabase.md` |
| PostHog | Hosted-product analytics + optional session replay | `posthog.md` |
| Sentry | Exceptions, native crashes, release health, support correlation | `sentry.md` + `sentry-setup-runbook.md` |
| Anonymous telemetry | First-party aggregate usage (no vendor, desktop/self-managed/local) | `anonymous-telemetry.md` |

Privacy invariant: no analytics surface receives prompts, transcript bodies, terminal output, repo names, raw file paths, auth material, or request bodies.

Update the owning doc in the same PR as any event/dashboard/alert/replay/privacy change.

MCPs + permissions: GitHub MCP/`gh`, Browser/Chrome access for Customer.io,
Metabase, PostHog, Sentry, Cloudflare, AWS, and GitHub, read-only database
access for Metabase validation, and release/debug-upload tokens only when the
Sentry lane requires them.

---

### QA

**`specs/developing/qa/README.md`**

The QA root is now an authoritative release QA entrypoint. It covers operator
requirements, release intake, baseline verification, profile-isolated
full-stack QA, a touched-surface matrix, regression rules, failure handling,
and final QA report shape.

The remaining opportunity is depth: split per-surface checklists into
`specs/developing/qa/*.md` only when release execution needs more detail than
the root matrix.

---

### Runbooks

**`specs/developing/runbooks/`**

Current runbooks:

- `billing-pro-promo-codes.md`
- `stripe-webhook-failure.md`
- `e2b-template-rollback.md`
- `cloud-provisioning-failure.md`
- `worker-enrollment-failure.md`
- `managed-target-replacement.md`
- `operator-security-posture.md`

**⚠️ Gap:** `managed-target-replacement.md` is an operational placeholder
until the operator-safe replacement flow and audit trail are implemented.

---

### Reference

**`specs/developing/reference/`**

| File | Covers |
| --- | --- |
| `env-vars.yaml` | Canonical inventory of every env var, surface, and owner |
| `env-secrets-matrix.md` | Environments vs secrets matrix |
| `workspace-command-environment.md` | Env available inside workspace commands |

---

## TBD (non-authoritative)

| File | Topic |
| --- | --- |
| `anyharness-structure-alignment-swarms.md` | AnyHarness structure alignment |
| `cloud-worker-control-loop.md` | Worker control loop design |
| `frontend-structure-alignment-migration.md` | Frontend structure migration |
| `structure-alignment-coordinator-model.md` | Coordinator model |
| `workspace-migration-git-durability-plan.md` | Workspace migration / git durability |

---

## Gap Summary

### 🔴 Missing entirely

| Gap | Action needed |
| --- | --- |
| Browsers feature | Write `features/browsers.md` |
| Computer Use feature | Write `features/computer-use.md` |
| Security spec | Write an authoritative security spec (no draft exists) |

### 🟡 Thin or split

| Gap | Action needed |
| --- | --- |
| Auth Gateway structure | Keep the explicit split-ownership cross-link unless Auth Gateway becomes a separate deployable/codebase boundary |
| Plugins feature | Extract from mcp-skills.md into `features/plugins.md` |
| Specific operational runbooks | Add provisioning/worker/Stripe/E2B rollback runbooks to `developing/runbooks/` |
| Per-surface QA detail | Add `developing/qa/*.md` files only when the root matrix is too shallow for release execution |

### ✅ Well covered

All major structure areas (Frontend, Desktop Native, AnyHarness, Worker,
Supervisor, Server, and SDK), the requested primitive map, most features, all 5
analytics systems, local dev, and deploying.

---

## Quick Lookup: Which Spec to Read First

| Touching | Read |
| --- | --- |
| Frontend components / hooks / stores | `structures/frontend/README.md` + relevant guide |
| AnyHarness session logic | `structures/anyharness/README.md` + `structures/anyharness/specs/session-engine.md` |
| Cloud provisioning / sandbox creation | `primitives/sandbox-provisioning.md` |
| Managed workspace creation | `primitives/workspace-provisioning.md` |
| Cloud workspace commands / wake / projection | `primitives/cloud-commands.md` |
| Agent LLM auth / Bifrost | `primitives/agent-auth.md` |
| MCP / skills / plugins runtime config | `primitives/mcp-skills.md` + `primitives/mcp-runtime.md` |
| Product MCP tool (add/change) | `features/agent-features/servers.md` + `definitions/README.md` |
| Onboarding / first-run readiness | `features/onboarding.md` + `features/product-auth.md` |
| Workspace archive / prune / lifecycle | `primitives/workspace-lifecycle.md` |
| Billing / wake gate | `primitives/billing.md` + `primitives/cloud-commands.md` |
| Claiming | `primitives/claiming.md` |
| Deploying to production | `developing/deploying/ci-cd.md` |
| Running locally | `developing/local/README.md` |
| Debugging a support issue | `developing/debugging/README.md` + `debugging/support-reports.md` |
| Analytics change | `developing/analytics/README.md` + owning system doc |
