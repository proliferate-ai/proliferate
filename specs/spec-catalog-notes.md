# Spec Catalog — Working Notes

Status: investigation notes. Use `specs/README.md`,
`specs/codebase/README.md`, `specs/codebase/**/README.md`, and
`specs/developing/README.md` as the authoritative indexes.

## What I've read

### specs/README.md
- Authoritative index. Clear 4-bucket structure: `codebase/structures`, `codebase/primitives`, `codebase/features`, `developing`.
- `tbd/` = intentionally non-authoritative material.
- Has a "Current Read Map" table linking area → docs.

---

## Codebase / Structures

### frontend (specs/codebase/structures/frontend/)
- README.md: authoritative. Covers Desktop + Web + Mobile + shared packages.
- Target shape is well-defined: components/, hooks/access|ui|domain/derived|workflows|lifecycle/, lib/access|domain|workflows|infra/, stores/, config/, copy/, providers/, pages/, navigation/.
- Shared packages: design, ui, product-domain, product-ui, product-surfaces.
- Dependency direction clearly stated.
- Hard rules: no barrel files, `.tsx` only in components, no DOM primitives outside `ui` package.
- CI enforcement via `scripts/check_frontend_boundaries.py`.
- Guides: components, hooks, state, lib, access, config, copy, styling, telemetry, packages.
- **Coverage: VERY THOROUGH**

### desktop-native (specs/codebase/structures/desktop-native/)
- README.md exists. Scope: `apps/desktop/src-tauri/**`.
- Sub-specs: `specs/agent-seeds.md`, `specs/anyharness-sidecar.md`.
- **Coverage: EXISTS — need to check depth**

### anyharness (specs/codebase/structures/anyharness/)
- README.md: authoritative, very deep.
- Covers: session engine (SessionRuntime → SessionService → SessionStore → LiveSessionManager → SessionActor → AcpClient), runtime capabilities, product domains (cowork, reviews, plans, mobility, subagents, workspace_naming), MCP as a vertical.
- Full target shape tree defined.
- Transitional state documented explicitly.
- Guides: system-architecture, crates, api, app, domains, live-runtime, adapters, integrations, harnesses, persistence, observability, repo-shape.
- Specs: session-engine.md, session-actor.md.
- Src legacy docs: acp, agent-mode-matrix, agents, files, git, persistence, sessions, workspaces.
- Harness docs: claude.md, codex.md.
- **Coverage: VERY THOROUGH**

### proliferate-worker (specs/codebase/structures/proliferate-worker/)
- README.md: authoritative.
- Covers: command_downlink, event_uplink, target_status, target (materialization), clients, store, identity.
- Full target shape tree defined.
- Guides: runtime, command-downlink, event-uplink, target-status, target, clients, store, identity, root-support.
- Dependency direction and hard rules clear.
- **Coverage: VERY THOROUGH**

### proliferate-supervisor (specs/codebase/structures/proliferate-supervisor/)
- README.md: authoritative.
- Covers: process/, install/, update/ (manifest, staging, rollback).
- Core workflow (double-loop spawn model) documented.
- Boundary model (Server/Supervisor/Worker/AnyHarness) clear.
- Hard rules clear.
- **Coverage: GOOD, appropriate for the scope of the component**

### server (specs/codebase/structures/server/)
- README.md: authoritative, deep.
- Full domain shape: api.py/service.py/models.py/access.py/domain/policy.py/worker.py/reconciler.py.
- Hard rules: layer law, type pipeline, transactions, authorization, errors, configs/constants, file size thresholds, naming, folder hygiene, cross-domain coordination.
- Guides: domains, database, auth, errors, integrations, config, workers.
- Audits: phase6-billing-reconciler, phase6-cloud-runtime-background-loops, server-structure-hygiene.
- **Coverage: VERY THOROUGH**

### sdk (specs/codebase/structures/sdk/)
- README.md exists.
- **Coverage: EXISTS — need to check depth**

### MISSING FROM STRUCTURES:
- **Auth Gateway** — user's list includes "Auth Gateway" as a structure. There is NO `specs/codebase/structures/auth-gateway/`. Auth gateway lives in server (`server/proliferate/auth/`) and is covered in `server/guides/auth.md` and `specs/codebase/primitives/agent-auth.md`. No dedicated structure spec.

---

## Codebase / Primitives

### sandbox-provisioning.md (spec 00)
- Implementation-ready spec (dated 2026-05-20).
- Full mental model: sandbox_profile / cloud_target / cloud_sandbox_slot separation.
- DB schema changes detailed (10+ tables).
- Background jobs: provision_profile_slot, reconcile_sandbox_profile_target.
- Provisioning lifecycle and synchronicity clearly defined.
- Files to change: comprehensive list.
- Implementation phases (10 chunks).
- Acceptance criteria (24 items).
- Tests listed.
- **Coverage: EXTREMELY THOROUGH — implementation-ready spec**

### workspace-provisioning.md (workspace creation read path)
- New canonical first-read for managed workspace creation.
- It bridges sandbox-provisioning.md, cloud-commands.md, workspace-lifecycle.md,
  pending-workspace-shell.md, and entrypoint feature specs.
- It is intentionally a read-path / invariant doc, not a replacement for the
  deeper implementation specs.
- **Coverage: GOOD — solves the naming/read-path gap**

### workspace-lifecycle.md (workspace pruning & worktree management)
- Implementation-ready spec (dated 2026-05-25).
- Covers: product lifecycle (active/archived/deleted), materialization state, cleanup status, runtime target.
- AnyHarness contract requirements.
- Surface state matrix (table).
- Flows: auto prune, select dehydrated, runtime action on dehydrated, archive, restore, manual prune, delete/purge.
- Implementation phases (7 phases).
- **Coverage: VERY THOROUGH**
- NOTE: Title says "Workspace Pruning" but file covers workspace lifecycle broadly. This is the workspace provisioning/lifecycle spec more broadly.

### mcp-runtime.md
- Authoritative for MCP in AnyHarness.
- Covers 4 MCP concepts: user bindings, session extensions, product MCP servers, MCP elicitation.
- Injection flow, session MCP assembly (assembly.rs), product MCP extension pattern.
- Consolidation and dependency rules.
- **Coverage: GOOD**

### mcp-skills.md (spec 01)
- Implementation-ready spec (dated 2026-05-20).
- Covers: MCP connections, skill configured items, plugin configured items, runtime config revision/manifest/apply.
- Three layers: catalog entry / configured item / runtime manifest.
- Worker materialization via `materialize_environment`.
- AnyHarness runtime config contract.
- **Coverage: THOROUGH**

### agent-auth.md (spec 02)
- Implementation-ready spec (dated 2026-05-20).
- Covers: per-profile per-harness auth source selection, synced_files vs gateway_env materialization modes.
- 10 agent-auth DB tables documented.
- 10 shipped gaps identified and addressed.
- Bifrost integration.
- Worker scope synthesis, AnyHarness fail-closed.
- Capability API.
- **Coverage: EXTREMELY THOROUGH**

### cloud-commands.md (spec 04)
- Implementation-ready spec (dated 2026-05-20).
- Covers: command envelope/result/lease, runtime config preflight, exposure model, session projection, worker projection cursor, wake gate, workspace metadata.
- `managed_profile_launch` canonical function signature.
- `cloud_workspace_exposure` table defined.
- Passive UI invariant.
- **Coverage: EXTREMELY THOROUGH**

### claiming.md (spec 05)
- Implementation-ready spec.
- One-way claim: shared_unclaimed → claimed.
- `cloud_workspace_claim` table.
- Direct-attach JWT issuance.
- Per-token revocation.
- **Coverage: EXISTS — deeper reading would add detail**

### billing.md (spec 09)
- Implementation-ready spec.
- Wires authorize_sandbox_start to wake hook.
- free_cloud_allocation table for anti-abuse.
- Billing state in workspace responses.
- **Coverage: EXISTS — most of billing already shipped**

### agent-catalog-readiness.md
- Not read in full but referenced in anyharness README.
- Covers: single catalog input, trusted descriptor/model projection, install/readiness topology, seed artifacts, launch resolution.

### agents/claude.md, agents/codex.md
- Per-harness specs.

### GAPS in primitives:
- **MCP + Skills** → split across mcp-runtime.md and mcp-skills.md. Good.
- **Product MCP Structure** → covered in `features/agent-features/servers.md` and `features/agent-features/definitions/`. Need to confirm depth.
- **Sandbox Provisioning** = sandbox-provisioning.md. ✓
- **Workspace Provisioning** = workspace-provisioning.md. ✓ (single read path;
  deeper ownership remains split across sandbox-provisioning.md,
  cloud-commands.md, and workspace-lifecycle.md).
- **Agent Auth** = agent-auth.md. ✓
- **Cloud Commands** = cloud-commands.md. ✓
- **Claiming** = claiming.md. ✓
- **Billing** = billing.md. ✓

---

## Codebase / Features

### agent-features/
- `servers.md` — product MCP server pattern.
- `definitions/README.md` — concrete MCP definitions.
- `definitions/artifacts.md` — artifacts MCP.
- `definitions/cowork.md` — cowork.
- `definitions/prompt-and-skill-policy.md`
- `definitions/reviews.md`
- `definitions/subagents.md`
- `definitions/workspace-naming.md`

### Other features:
- `automations.md`
- `chat-composer.md`
- `chat-transcript.md`
- `cloud-dispatch.md` — web/mobile/dispatch UX (spec 08)
- `cowork-artifacts.md`
- `delegated-work.md`
- `mobile-cloud-client.md`
- `pending-workspace-shell.md`
- `product-auth.md`
- `settings-admin-ia.md`
- `slack-bot.md`
- `support-reporting.md`
- `web-cloud-local-parity.md`
- `workspace-files.md`
- `workspace-migration.md`

### GAPS in features — things user mentioned that need a spec or are thin:
- **Onboarding** — NO dedicated spec. Not in features/.
- **Browsers** — NO dedicated spec. Not in features/.
- **Terminals** — NO dedicated spec. Not in features/ (terminals are mentioned in anyharness as a domain but no feature spec).
- **Computer Use** — NO spec. Not mentioned in features/.
- **Plugins** — Covered partially in mcp-skills.md (spec 01) as part of MCP/plugins runtime config. No dedicated feature spec.
- **Subagents** — Has `definitions/subagents.md`. Need to check depth.
- **Artifacts** — Has `definitions/artifacts.md` and `cowork-artifacts.md`. Seems covered.
- **Cloud Access / Dispatch** — Has `cloud-dispatch.md` (spec 08). ✓

---

## Developer Processes

### developing/README.md
- authoritative entry point.
- Defines the process-spec contract: every durable process doc should name
  tools/MCPs/connectors/CLIs, permissions, configuration/env locations, happy
  path, verification, failure modes, secrets policy, and final report shape.

### deploying/
- `README.md` — process map covering 4 deployment questions.
- `ci-cd.md` — full CI/CD, staging/prod deploy, release lanes, env vars.
- `self-hosted-deploy.md` — Docker Compose self-hosted.
- `self-hosted-aws.md` — CloudFormation one-click.
- Release docs/public-surface follow-up is explicit: landing page, public docs,
  changelog/release notes, in-app copy, install docs, or support docs.
- Tools/permissions are now called out at the entrypoint.
- **Coverage: STRONG**

### local/
- `README.md` — profiles, Stripe, mobile quick start. Very thorough.
- `dev-profiles.md` — profile ownership, ports, Tauri identity.
- `mobile.md` — native mobile OAuth, Expo.
- `stripe-local-testing.md` — billing flows.
- Tools/permissions are now called out at the entrypoint.
- **Coverage: THOROUGH**

### debugging/
- `README.md` — 7-step triage process, tools & permissions table, specific runbooks linked.
- `support-reports.md` — end-to-end correlation (Cloud DB, S3, CloudWatch, Sentry, GitHub, Linear).
- `performance-profiling.md`
- General issue runbook and correlation keys now live directly in the README.
- **Coverage: GOOD**
- Remaining opportunity: more specific runbooks beyond support reports and
  performance profiling.

### analytics/
- `README.md` — system goals, ownership table (Customer.io/Metabase/PostHog/Sentry/anon-telemetry), freshness triggers, permissions table.
- `customerio.md` — lifecycle messaging.
- `metabase.md` — dashboards.
- `posthog.md` — hosted analytics.
- `sentry.md` + `sentry-setup-runbook.md`
- `anonymous-telemetry.md`
- **Coverage: THOROUGH — all 5 systems have dedicated docs**

### qa/
- `README.md` — release QA entrypoint with operator requirements, intake,
  baseline verification, local full-stack QA, touched-surface matrix,
  regression rules, failure handling, and final report shape.
- **Coverage: GOOD — per-surface checklists can be split later if releases need
  more detail**

### runbooks/
- `billing-pro-promo-codes.md` — one specific runbook.
- **Coverage: THIN — only one runbook**

### reference/
- `env-vars.yaml` — canonical variable inventory.
- `env-secrets-matrix.md`
- `workspace-command-environment.md`

---

## TBD (intentionally non-authoritative)

- `anyharness-structure-alignment-swarms.md`
- `cloud-shared-sandbox-spec-pack.md`
- `cloud-worker-control-loop.md`
- `frontend-structure-alignment-migration.md`
- `security.md` — **SECURITY SPEC IS IN TBD!**
- `structure-alignment-coordinator-model.md`
- `support-debug-correlation.md` — in tbd, not debugging/
- `workspace-migration-git-durability-plan.md`

---

## Summary of Gaps

### Major Gaps (no dedicated authoritative spec yet):
1. **Onboarding** feature — no dedicated end-to-end feature spec.
2. **Browsers** feature / Product MCP definition — no dedicated spec.
3. **Terminals** product feature — no dedicated feature spec.
4. **Computer Use** feature / Product MCP definition — no dedicated spec.
5. **Security** — exists only in tbd/, not authoritative.

### Minor Gaps / Unclear Coverage:
- **Product MCP Structure** — exists in `features/agent-features/servers.md` + definitions. OK.
- **Auth Gateway** — intentionally split across structures/server auth,
  product-auth, agent-auth, and Bifrost/BYOK docs unless it becomes a separate
  codebase/deploy boundary.
- **Plugins** — covered in mcp-skills.md but no dedicated feature spec.
- **Desktop Native / SDK structures** — README.md exists but depth unknown.
- **General debugging runbook** — debugging/README.md now owns the general
  issue loop; support-reports.md owns the deeper support-correlation path.
- **Specific runbooks** — only one (billing promo codes). No workspace/provisioning/cloud runbooks.
- **Per-surface QA detail** — root QA runbook exists; add focused QA files only
  when release execution needs more depth.

### Nomenclature Notes:
- "Workspace Provisioning" spec = `workspace-provisioning.md` — a read-path
  bridge over sandbox-provisioning.md, cloud-commands.md, workspace-lifecycle.md,
  and pending-shell/entrypoint feature specs.
- "Cloud Commands" spec = `cloud-commands.md` which is actually spec 04 "Cloud Running Alignment" covering much more than just commands.
- "Agent Auth primitive" = `agent-auth.md` + `agent-auth-bifrost-byok.md`.

---

## MCPs + Permissions Per Developer Process (notes)

### Deploying / Infra:
- MCP: GitHub (workflow triggers, PR metadata, release artifacts), potentially Vercel MCP for web deploys
- Permissions: GitHub Actions, AWS (ECS, ECR, RDS, S3, SSM, CloudFront, IAM), GitHub Environments for secrets, Apple (TestFlight, signing), Vercel (web)

### Local Dev:
- MCP: none typically needed
- Permissions: local shell (make, cargo, pnpm, uv, stripe CLI, ngrok)

### Debugging:
- MCP: GitHub (issues, PRs), Linear (tickets)
- Permissions: Sentry, AWS (CloudWatch, S3 for support reports), PostHog, browser access for dashboards

### Analytics:
- MCP: GitHub (env vars, PRs)
- Permissions: Customer.io, Metabase, PostHog, Sentry, Cloudflare DNS, AWS, read-only DB

### QA:
- MCP: GitHub (issue tracking)
- Permissions: all of the above depending on what's being QA'd; profile-isolated local dev env

---

## Outstanding Questions for Pablo:
1. Should "Auth Gateway" be its own structure spec or stay split across server/auth and agent-auth primitive?
2. Should "Onboarding" get a feature spec even if the flow is simple?
3. Should Browser and Computer Use be concrete Product MCP definitions, broader
   feature specs, or both?
4. Should Terminals be a product feature spec or an AnyHarness runtime
   subsystem spec?
5. Which specific operational runbooks are highest value after billing promo codes: cloud provisioning failure, worker enrollment failure, Stripe webhook failure, sandbox slot replacement, or E2B rollback?
