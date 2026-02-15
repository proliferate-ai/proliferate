# Spec Program — Boundary Brief

> **Purpose:** Every agent writing a spec MUST read this file first. It defines what each spec owns, canonical terminology, and cross-reference rules.
> **Rule:** If something is out of scope for your spec, link to the owning spec. Do not re-explain it.

---

## 1. Spec Registry

| # | Spec file | One-line scope | Phase |
|---|-----------|---------------|-------|
| 1 | `agent-contract.md` | System prompt modes, OpenCode tool schemas, capability injection into sandboxes. | 1 |
| 2 | `sandbox-providers.md` | Modal + E2B provider interface, sandbox boot, snapshot resolution, git freshness, sandbox-mcp. | 1 |
| 3 | `sessions-gateway.md` | Session lifecycle (create/pause/resume/snapshot/delete), gateway hub, WebSocket/HTTP streaming, migration, preview. | 2 |
| 4 | `automations-runs.md` | Automation definitions, run pipeline (enrich → execute → finalize), outbox dispatch, notifications, Slack async client, artifacts, side effects, claiming. | 2 |
| 5 | `triggers.md` | Trigger registry, webhook ingestion, polling, cron scheduling, trigger-service, provider adapters (GitHub/Linear/Sentry/PostHog). | 2 |
| 6 | `actions.md` | Action invocations, approval flow, grants, risk classification, provider adapters (Linear/Sentry), sweeper. | 2 |
| 7 | `llm-proxy.md` | LiteLLM proxy, virtual key generation, per-org/per-session spend tracking, model routing. | 2 |
| 8 | ~~`cli.md`~~ | ~~Removed — CLI product deleted.~~ | — |
| 9 | `repos.md` | Repo CRUD, base snapshot builds. | 3 |
| 10 | `secrets-environment.md` | Secret CRUD, bulk import, encryption, connector credentials. | 3 |
| 11 | `integrations.md` | OAuth connection lifecycle for GitHub/Sentry/Linear/Slack via Nango. Connection binding to repos/automations/sessions. | 3 |
| 12 | `auth-orgs.md` | better-auth, user/org/member model, invitations, onboarding/trial activation, API keys, admin/impersonation. | 3 |
| 13 | `billing-metering.md` | Usage metering, credit gating, trial credits, reconciliation, org pause, Autumn integration. Owns charging/gating policy. | 3 |
| 14 | `configurations-snapshots.md` | Configuration CRUD, first-class snapshots, config-scoped secret files, service/setup commands. | 3 |

### Phase ordering

- **Phase 1** specs are heavily cross-referenced by everything else. Write these first.
- **Phase 2** specs can run in parallel after phase 1 is complete.
- **Phase 3** specs can run in parallel after phase 2 is complete.

---

## 2. Strict Boundary Rules

These boundaries resolve the most likely overlaps. Follow them exactly.

| Boundary | Rule |
|----------|------|
| **Integrations vs Actions/Automations/Sessions** | `integrations.md` owns external credential/connectivity lifecycle (OAuth integrations + MCP connector catalog). Runtime behavior that *uses* those records belongs to the consuming spec (Actions, Automations, Sessions). |
| **Actions vs Integrations (connectors)** | `actions.md` owns action execution, risk, approval, grants, and audit behavior. `integrations.md` owns persistence and scope of org-level connector configuration. Connectors are stored in the `org_connectors` table, managed via Integrations CRUD routes. |
| **Agent Contract vs Sessions/Automations** | `agent-contract.md` owns prompt templates, tool schemas, and capability injection. Runtime behavior that *executes* tools belongs to `sessions-gateway.md` (interactive) or `automations-runs.md` (automated). |
| **Agent Contract vs Sandbox Providers** | `agent-contract.md` owns what tools exist and their schemas. `sandbox-providers.md` owns how tools are injected into the sandbox environment (plugin config, MCP server). |
| **LLM Proxy vs Billing** | `llm-proxy.md` owns key generation, routing, and spend *events*. `billing-metering.md` owns charging policy, credit gating, and balance enforcement. |
| **Triggers vs Automations** | `triggers.md` owns event ingestion, matching, and dispatch. Once a trigger fires, the resulting automation run belongs to `automations-runs.md`. The handoff point is the `AUTOMATION_ENRICH` queue enqueue. |
| **Sessions vs Sandbox Providers** | `sessions-gateway.md` owns the session lifecycle and gateway runtime. `sandbox-providers.md` owns the provider interface and sandbox boot mechanics. Sessions *calls* the provider interface; the provider spec defines the contract. |
| **Repos/Configurations vs Sessions** | `repos.md` owns repo records and base snapshot *builds*. `configurations-snapshots.md` owns configuration CRUD, snapshots, secret files, and service commands. `sessions-gateway.md` owns the configuration *resolver* (`apps/gateway/src/lib/configuration-resolver.ts`) which determines which configuration to use at session start. |
| **Secrets vs Sandbox Providers** | `secrets-environment.md` owns secret CRUD and secret file management. How secrets get deployed into a running sandbox is `sandbox-providers.md` (env injection at boot). |
| **Auth/Orgs vs Billing** | `auth-orgs.md` owns user/org model, membership, and onboarding flow. `billing-metering.md` owns trial credit provisioning, plan management, and checkout. Onboarding *triggers* trial activation but billing *owns* the credit grant. |
| ~~**CLI vs Sessions**~~ | ~~CLI product removed. No CLI-specific entry points.~~ |

---

## 3. Canonical Glossary

Use these terms consistently. Do not introduce synonyms.

| Term | Meaning | Do NOT call it |
|------|---------|----------------|
| **sandbox** | The remote compute environment (Modal container or E2B sandbox) where the agent runs. | environment, container, instance, VM |
| **session** | A user-initiated or automation-initiated interaction backed by a sandbox. Has a lifecycle (creating → running → paused → completed). | workspace, project, run (when interactive) |
| **run** | A single execution of an automation. Has a lifecycle (queued → enriching → ready → running → succeeded/failed/needs_human/timed_out/canceled/skipped). | session (when automated), job |
| **hub** | The gateway-side object managing a session's runtime state, WebSocket connections, and event processing. | session manager, controller |
| **provider** | The sandbox compute backend (Modal or E2B). Implements the `SandboxProvider` interface. | runtime, backend, platform |
| **configuration** | A reusable configuration + snapshot combination for faster session starts. Stored in the `configurations` table (historically called "prebuilds"). | prebuild |
| **snapshot** | A saved filesystem state. Three layers: base snapshot, repo snapshot, configuration snapshot. Snapshots are first-class entities in the `snapshots` table. | image, checkpoint, save point |
| **action** | A platform-mediated operation the agent performs on external services (e.g., create Linear issue, update Sentry). | tool (tools are the broader category; actions are the external-service subset) |
| **integration** | An OAuth-backed external connection record (GitHub/Linear/Sentry/Slack) used to resolve tokens server-side. | adapter, connector, provider |
| **connector** | A configuration entry (org-scoped) describing how to reach an MCP server and which secrets/auth mapping to use. | integration, adapter |
| **action source** | The origin of an action definition surfaced to the agent (adapter or connector-backed source). | integration, transport |
| **tool** | A capability available to the agent inside the sandbox. Includes both platform tools (verify, save_snapshot) and action tools. | action (unless it's specifically an external-service action) |
| **trigger** | An event source that can start an automation run. Types: webhook, polling, scheduled (cron). | event, hook, listener |
| **outbox** | The transactional outbox table used for reliable event dispatch. | queue, event log |
| **invocation** | A single request to execute an action, with its approval state. | action request, action call |
| **grant** | A reusable permission allowing an agent to perform an action without per-invocation approval. | permission, allowance |
| **secret file** | A configuration-scoped env file definition with encrypted secret values. Replaces the legacy bundle model. | bundle, secret group, env set |
| **virtual key** | A temporary LiteLLM API key scoped to a session/org for cost isolation. | proxy key, session key |

---

## 4. Cross-Reference Rules

1. **Link, don't re-explain.** If a concept is owned by another spec, write: `See [spec-name.md], section N` and move on. One sentence of context is fine; a paragraph is not.
2. **Use the dependency table.** Every spec has a "Cross-Cutting Concerns" section (template section 7) with a dependency table. Use it to document every cross-spec interface.
3. **Stable section numbers.** The template enforces a fixed section structure (1-9). Reference by number: "See `sessions-gateway.md` §6.2" will be stable across drafts.
4. **File ownership is exclusive.** Every source file belongs to exactly one spec. If two specs seem to need the same file, the file belongs to whichever spec owns the entity the file primarily operates on. The other spec references it.

---

## 5. Writing Rules

1. **Document `main` as it is today.** Do not describe aspirational architecture. Flag gaps in section 9 (Known Limitations).
2. **Cite file paths.** Every claim about behavior must include at least one file path. Prefer `path/to/file.ts:functionName` format.
3. **Target 300-600 lines per spec.** Enough for depth, short enough that agents will actually read it.
4. **Follow the template exactly.** Use `docs/specs/template.md`. Do not add, remove, or rename sections.
5. **Status classifications for features:**
   - `Implemented` — in `main`, tested or visibly working.
   - `Partial` — core path works, known gaps exist (list them).
   - `Planned` — design intent exists, code does not.
   - `Deprecated` — still in code but being removed.
6. **Do not document UI components.** Specs cover backend behavior, data models, and contracts. Frontend pages are evidence of a feature existing, not the spec itself.

---

## 6. Per-Agent Prompt Template

When spawning an agent to write a spec, use this structure:

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — feature inventory for your scope

YOUR ASSIGNMENT:
- Spec file: docs/specs/[spec-name].md
- In scope: [list of features, files, tables, routes]
- Out of scope: [explicit list with owning spec names]

KEY FILES TO READ: [list 5-15 starting-point files]

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```
