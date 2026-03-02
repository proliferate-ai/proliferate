# Current Codebase Specs (Consolidated)

> Generated from canonical current-state specs in `docs/specs/` (excluding `docs/specs/agent-platform-v1/`).
>
> Notes:
> - This file reflects current spec sources as of generation time.
> - Some sections (for example streaming V2) intentionally include `Planned`/`Deprecated` entries in the source docs.

## Included Sources
- `docs/specs/boundary-brief.md`
- `docs/specs/feature-registry.md`
- `docs/specs/agent-contract.md`
- `docs/specs/sandbox-providers.md`
- `docs/specs/sessions-gateway.md`
- `docs/specs/automations-runs.md`
- `docs/specs/triggers.md`
- `docs/specs/actions.md`
- `docs/specs/llm-proxy.md`
- `docs/specs/cli.md`
- `docs/specs/repos-prebuilds.md`
- `docs/specs/secrets-environment.md`
- `docs/specs/integrations.md`
- `docs/specs/auth-orgs.md`
- `docs/specs/billing-metering.md`
- `docs/specs/streaming-preview.md`

---

## Source: `docs/specs/boundary-brief.md`

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
| 8 | `cli.md` | Device auth flow, local config, file sync, OpenCode launch, CLI-specific API routes. | 2 |
| 9 | `repos-prebuilds.md` | Repo CRUD, configuration management, base + repo snapshot builds, service commands, env file generation. | 3 |
| 10 | `secrets-environment.md` | Secret CRUD, bundles, bulk import, env file deployment to sandbox, encryption. | 3 |
| 11 | `integrations.md` | OAuth connection lifecycle for GitHub/Sentry/Linear/Slack via Nango. Connection binding to repos/automations/sessions. | 3 |
| 12 | `auth-orgs.md` | better-auth, user/org/member model, invitations, onboarding/trial activation, API keys, admin/impersonation. | 3 |
| 13 | `billing-metering.md` | Usage metering, credit gating, trial credits, reconciliation, org pause, Autumn integration. Owns charging/gating policy. | 3 |
| 14 | `streaming-preview.md` | Clean-slate V2 transport and preview plane: unified WS contracts, sandbox-daemon, gateway zero-trust proxying, terminal/FS/preview event model. | 2 |

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
| **Actions vs Integrations (connectors)** | `actions.md` owns action execution, risk, approval, grants, and audit behavior. `integrations.md` owns persistence and scope of org-level connector configuration (target ownership). Current implementation still stores connectors on configurations as a legacy transitional path documented in `repos-prebuilds.md`. |
| **Agent Contract vs Sessions/Automations** | `agent-contract.md` owns prompt templates, tool schemas, and capability injection. Runtime behavior that *executes* tools belongs to `sessions-gateway.md` (interactive) or `automations-runs.md` (automated). |
| **Agent Contract vs Sandbox Providers** | `agent-contract.md` owns what tools exist and their schemas. `sandbox-providers.md` owns how tools are injected into the sandbox environment (plugin config, MCP server). |
| **LLM Proxy vs Billing** | `llm-proxy.md` owns key generation, routing, and spend *events*. `billing-metering.md` owns charging policy, credit gating, and balance enforcement. |
| **Triggers vs Automations** | `triggers.md` owns event ingestion, matching, and dispatch. Once a trigger fires, the resulting automation run belongs to `automations-runs.md`. The handoff point is the `AUTOMATION_ENRICH` queue enqueue. |
| **Sessions vs Sandbox Providers** | `sessions-gateway.md` owns the session lifecycle and gateway runtime. `sandbox-providers.md` owns the provider interface and sandbox boot mechanics. Sessions *calls* the provider interface; the provider spec defines the contract. |
| **Sessions vs Streaming/Preview** | `sessions-gateway.md` owns lifecycle state machines and ownership/migration logic. `streaming-preview.md` owns the V2 transport mechanics (unified WS, sandbox-daemon contracts, proxy/auth model, preview routing, replay/backpressure contracts). |
| **Repos/Configurations vs Sessions** | `repos-prebuilds.md` owns repo records, configuration configs, and snapshot *builds*. `sandbox-providers.md` owns snapshot *resolution* (`resolveSnapshotId()` in `packages/shared/src/snapshot-resolution.ts`). `sessions-gateway.md` owns the configuration *resolver* (`apps/gateway/src/lib/configuration-resolver.ts`) which determines which configuration to use at session start. |
| **Secrets vs Sandbox Providers** | `secrets-environment.md` owns secret CRUD and bundle management. How secrets get deployed into a running sandbox is `sandbox-providers.md` (env injection at boot) + `agent-contract.md` (the `save_env_files` tool). |
| **Auth/Orgs vs Billing** | `auth-orgs.md` owns user/org model, membership, and onboarding flow. `billing-metering.md` owns trial credit provisioning, plan management, and checkout. Onboarding *triggers* trial activation but billing *owns* the credit grant. |
| **CLI vs Sessions** | `cli.md` owns the CLI-specific entry point (device auth, local config, file sync). Session creation from CLI uses the same session lifecycle defined in `sessions-gateway.md`. |

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
| **configuration** | A reusable configuration + snapshot combination for faster session starts. Previously called "prebuild" in some code. | prebuild (in specs — use "configuration" consistently) |
| **snapshot** | A saved filesystem state. Three layers: base snapshot, repo snapshot, configuration snapshot. | image, checkpoint, save point |
| **action** | A platform-mediated operation the agent performs on external services (e.g., create Linear issue, update Sentry). | tool (tools are the broader category; actions are the external-service subset) |
| **integration** | An OAuth-backed external connection record (GitHub/Linear/Sentry/Slack) used to resolve tokens server-side. | adapter, connector, provider |
| **connector** | A configuration entry (org-scoped) describing how to reach an MCP server and which secrets/auth mapping to use. | integration, adapter |
| **action source** | The origin of an action definition surfaced to the agent (adapter or connector-backed source). | integration, transport |
| **tool** | A capability available to the agent inside the sandbox. Includes both platform tools (verify, save_snapshot) and action tools. | action (unless it's specifically an external-service action) |
| **trigger** | An event source that can start an automation run. Types: webhook, polling, scheduled (cron). | event, hook, listener |
| **outbox** | The transactional outbox table used for reliable event dispatch. | queue, event log |
| **invocation** | A single request to execute an action, with its approval state. | action request, action call |
| **grant** | A reusable permission allowing an agent to perform an action without per-invocation approval. | permission, allowance |
| **bundle** | A named group of secrets. | secret group, env set |
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
4. **Follow the template exactly.** Use `docs/specs/template.md`. Do not add, remove, or rename sections. Exception: Sections 3 (File Tree) and 4 (Data Models) may be omitted; use inline file path references instead.
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

---

## Source: `docs/specs/feature-registry.md`

# Feature Registry

> **Purpose:** Single source of truth for every product feature, its implementation status, and which spec owns it.
> **Status key:** `Implemented` | `Partial` | `Planned` | `Deprecated`
> **Updated:** 2026-02-19. Session UI overhaul + billing Phase 1.2 + Slack config UX + notification destinations + config selection strategy.
> **Evidence convention:** `Planned` entries may cite RFC/spec files until code exists; once implemented, update evidence to concrete code paths.

---

## 1. Agent Contract (`agent-contract.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Setup system prompt | Implemented | `packages/shared/src/prompts.ts:getSetupSystemPrompt` | Configures agent for repo setup sessions |
| Coding system prompt | Implemented | `packages/shared/src/prompts.ts:getCodingSystemPrompt` | Configures agent for interactive coding |
| Automation system prompt | Implemented | `packages/shared/src/prompts.ts:getAutomationSystemPrompt` | Configures agent for automation runs |
| `verify` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:VERIFY_TOOL` | Uploads screenshots/evidence to S3 |
| `save_snapshot` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:SAVE_SNAPSHOT_TOOL` | Saves sandbox filesystem state |
| `save_service_commands` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:SAVE_SERVICE_COMMANDS_TOOL` | Persists auto-start commands for future sessions |
| `save_env_files` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:SAVE_ENV_FILES_TOOL` | Generates .env files from secrets |
| `automation.complete` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:AUTOMATION_COMPLETE_TOOL` | Marks automation run outcome with artifacts |
| `request_env_variables` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:REQUEST_ENV_VARIABLES_TOOL` | Requests secrets from user with suggestions |
| Tool capability injection | Implemented | `packages/shared/src/sandbox/config.ts` | Plugin injection into sandbox OpenCode config |

---

## 2. Sandbox Providers (`sandbox-providers.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| `SandboxProvider` interface | Implemented | `packages/shared/src/sandbox-provider.ts` | Common contract for all providers |
| Modal provider | Implemented | `packages/shared/src/providers/modal-libmodal.ts` | Default provider. Uses libmodal SDK. |
| E2B provider | Implemented | `packages/shared/src/providers/e2b.ts` | Full interface. Docker support, pause, snapshots. |
| Modal image + deploy | Implemented | `packages/modal-sandbox/deploy.py` | Python. `modal deploy deploy.py` |
| Sandbox-MCP API server | Implemented | `packages/sandbox-mcp/src/api-server.ts` | HTTP API on port 4000 inside sandbox |
| Sandbox-MCP terminal WS | Implemented | `packages/sandbox-mcp/src/terminal.ts` | Terminal WebSocket inside sandbox |
| Sandbox-MCP service manager | Implemented | `packages/sandbox-mcp/src/service-manager.ts` | Start/stop/expose sandbox services |
| Sandbox-MCP auth | Implemented | `packages/sandbox-mcp/src/auth.ts` | Token-based sandbox auth |
| Sandbox-MCP CLI setup | Implemented | `packages/sandbox-mcp/src/proliferate-cli.ts` | Sets up `proliferate` CLI inside sandbox |
| Sandbox env var injection | Implemented | `packages/shared/src/sandbox/config.ts` | Env vars passed at sandbox boot |
| OpenCode plugin injection | Implemented | `packages/shared/src/sandbox/config.ts:PLUGIN_MJS` | SSE plugin template string |
| Snapshot version key | Implemented | `packages/shared/src/sandbox/version-key.ts` | Deterministic snapshot versioning |
| Snapshot resolution | Implemented | `packages/shared/src/snapshot-resolution.ts` | Resolves which snapshot layers to use |
| Git freshness / pull cadence | Implemented | `packages/shared/src/sandbox/git-freshness.ts` | Configurable pull on session resume |
| E2B git freshness parity | Implemented | `packages/shared/src/providers/e2b.ts` | Extended to E2B in PR #97 |

---

## 3. Sessions & Gateway (`sessions-gateway.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Session CRUD (create/delete/rename) | Implemented | `apps/web/src/server/routers/sessions.ts` | oRPC routes |
| Session pause | Implemented | `apps/web/src/server/routers/sessions.ts:pause` | Pauses sandbox via provider |
| Session resume | Implemented | `apps/web/src/server/routers/sessions.ts:resume` | Resumes from snapshot |
| Session snapshot | Implemented | `apps/web/src/server/routers/sessions.ts:snapshot` | Saves current state |
| Gateway session creation | Implemented | `apps/gateway/src/lib/session-creator.ts` | HTTP route + provider orchestration |
| Gateway hub manager | Implemented | `apps/gateway/src/hub/hub-manager.ts` | Creates/retrieves session hubs |
| Session hub | Implemented | `apps/gateway/src/hub/session-hub.ts` | Per-session runtime management |
| Session runtime | Implemented | `apps/gateway/src/hub/session-runtime.ts` | Runtime state coordination |
| Event processor | Implemented | `apps/gateway/src/hub/event-processor.ts` | Processes sandbox SSE events |
| WebSocket streaming | Implemented | `apps/gateway/src/api/proliferate/ws/` | Bidirectional real-time |
| HTTP message route | Implemented | `apps/gateway/src/api/proliferate/http/sessions.ts` | `POST /:sessionId/message` |
| Session status route | Implemented | `apps/gateway/src/api/proliferate/http/sessions.ts` | `GET /:sessionId/status` |
| SSE bridge to OpenCode | Implemented | `apps/gateway/src/hub/sse-client.ts` | Connects gateway to sandbox OpenCode |
| Session migration controller | Implemented | `apps/gateway/src/hub/migration-controller.ts` | Auto-migration on sandbox expiry |
| Preview/sharing URLs | Implemented | `apps/web/src/app/preview/[id]/page.tsx` | Public preview via `previewTunnelUrl` |
| Port forwarding proxy | Implemented | `apps/gateway/src/api/proxy/opencode.ts` | Token-auth proxy to sandbox ports |
| Git operations | Implemented | `apps/gateway/src/hub/git-operations.ts` | Stateless git/gh via gateway |
| Session store | Implemented | `apps/gateway/src/lib/session-store.ts` | In-memory session state |
| Session connections (DB) | Implemented | `packages/db/src/schema/sessions.ts` | `session_connections` table |
| Session telemetry capture | Implemented | `apps/gateway/src/hub/session-telemetry.ts` | Passive metrics, PR URLs, latest task |
| Session telemetry DB flush | Implemented | `packages/services/src/sessions/db.ts:flushTelemetry` | SQL-level atomic increment |
| Session outcome derivation | Implemented | `apps/gateway/src/hub/capabilities/tools/automation-complete.ts` | Set at explicit terminal call sites |
| Async graceful shutdown (telemetry) | Implemented | `apps/gateway/src/index.ts`, `apps/gateway/src/hub/hub-manager.ts` | Bounded 5s flush on SIGTERM/SIGINT |
| Gateway auth middleware | Implemented | `apps/gateway/src/middleware/auth.ts` | Token verification |
| Gateway CORS | Implemented | `apps/gateway/src/middleware/cors.ts` | CORS policy |
| Gateway error handler | Implemented | `apps/gateway/src/middleware/error-handler.ts` | Centralized error handling |
| Gateway request logging | Implemented | `apps/gateway/src/` | pino-http via `@proliferate/logger` |
| Session telemetry in list rows | Implemented | `apps/web/src/components/sessions/session-card.tsx` | latestTask subtitle, outcome badge, PR indicator, compact metrics, dedicated configuration column |
| Session peek drawer (URL-routable) | Implemented | `apps/web/src/components/sessions/session-peek-drawer.tsx` | `?peek=sessionId` URL param on sessions page |
| Summary markdown sanitization | Implemented | `apps/web/src/components/ui/sanitized-markdown.tsx` | AST-based via rehype-sanitize |
| Session display helpers | Implemented | `apps/web/src/lib/session-display.ts` | formatActiveTime, formatCompactMetrics, getOutcomeDisplay, parsePrUrl |
| Inbox run triage telemetry | Implemented | `apps/web/src/components/inbox/inbox-item.tsx` | Summary, metrics, PR count on run triage cards |
| Shared run status display | Implemented | `apps/web/src/lib/run-status.ts` | Consolidated getRunStatusDisplay used by inbox, activity, my-work |
| Activity run titles | Implemented | `apps/web/src/app/(command-center)/dashboard/activity/page.tsx` | Shows session title or trigger name instead of generic label |
| My-work run enrichment | Implemented | `apps/web/src/app/(command-center)/dashboard/my-work/page.tsx` | Claimed runs show session title, consistent status display |
| Immutable session boot snapshot envelope | Planned | `docs/specs/sessions-gateway.md` | Current session/runtime context is live-derived; no dedicated `boot_snapshot` column yet |
| Centralized resume-time credential rehydration contract | Planned | `docs/specs/sessions-gateway.md` | Credential refresh exists in multiple runtime paths but not as one enforced contract |

---

## 4. Automations & Runs (`automations-runs.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Automation CRUD | Implemented | `apps/web/src/server/routers/automations.ts` | Create/update/delete/list |
| Automation triggers binding | Implemented | `apps/web/src/server/routers/automations.ts` | Add/remove triggers on automation |
| Automation connections | Implemented | `packages/db/src/schema/automations.ts` | `automation_connections` table |
| Run lifecycle (pending → enriching → executing → completed) | Implemented | `apps/worker/src/automation/index.ts` | Orchestrates pipeline |
| Run enrichment | Implemented | `apps/worker/src/automation/enrich.ts` | Extracts trigger context deterministically |
| Run execution | Implemented | `apps/worker/src/automation/index.ts` | Creates session for run |
| Run finalization | Implemented | `apps/worker/src/automation/finalizer.ts` | Post-execution cleanup |
| Run events log | Implemented | `packages/db/src/schema/automations.ts` | `automation_run_events` table |
| Outbox dispatch | Implemented | `apps/worker/src/automation/index.ts:dispatchOutbox` | Reliable event delivery |
| Outbox atomic claim | Implemented | `packages/services/src/outbox/service.ts` | Claim + stuck-row recovery |
| Side effects tracking | Implemented | `packages/db/src/schema/automations.ts` | `automation_side_effects` table |
| Artifact storage (S3) | Implemented | `apps/worker/src/automation/artifacts.ts` | Completion + enrichment artifacts |
| Target resolution | Implemented | `apps/worker/src/automation/resolve-target.ts` | Resolves which repo/configuration to use |
| Slack notifications | Implemented | `apps/worker/src/automation/notifications.ts` | Run status posted to Slack |
| Notification dispatch | Implemented | `apps/worker/src/automation/notifications.ts:dispatchRunNotification` | Delivery orchestration |
| Notification destination types | Implemented | `packages/db/src/schema/automations.ts:notificationDestinationType` | `slack_dm_user`, `slack_channel`, `none` |
| Slack DM notifications | Implemented | `apps/worker/src/automation/notifications.ts:postSlackDm` | DM to selected user via `conversations.open` |
| Session completion notifications | Implemented | `apps/worker/src/automation/notifications.ts:dispatchSessionNotification` | DM subscribers on session complete |
| Session notification subscriptions | Implemented | `packages/services/src/notifications/service.ts` | Upsert/delete/list subscriptions per session |
| Configuration selection strategy | Implemented | `apps/worker/src/automation/resolve-target.ts` | `fixed` (default) or `agent_decide` with allowlist + fallback |
| Slack async client | Implemented | `apps/worker/src/slack/client.ts` | Full bidirectional session via Slack |
| Slack inbound handlers | Implemented | `apps/worker/src/slack/handlers/` | Text, todo, verify, default-tool |
| Slack receiver worker | Implemented | `apps/worker/src/slack/` | BullMQ-based message processing |
| Run claiming / manual update | Implemented | `apps/web/src/server/routers/automations.ts` | Claim/unclaim for org members; resolve for owner/admin via `assignRun`/`unassignRun`/`resolveRun` routes |
| Org pending runs query | Implemented | `packages/services/src/runs/db.ts:listOrgPendingRuns`, `apps/web/src/server/routers/automations.ts` | Failed/needs_human/timed_out runs for attention inbox |
| Schedules for automations | Implemented | `packages/db/src/schema/schedules.ts` | Cron schedules with timezone |

---

## 5. Triggers (`triggers.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Trigger CRUD | Implemented | `apps/web/src/server/routers/triggers.ts` | Create/update/delete/list |
| Trigger events log | Implemented | `packages/db/src/schema/triggers.ts` | `trigger_events` + `trigger_event_actions` |
| Trigger service (dedicated app) | Implemented | `apps/trigger-service/src/` | Standalone Express service |
| Webhook ingestion (Nango) | Implemented | `apps/trigger-service/src/lib/webhook-dispatcher.ts` | `POST /webhooks/nango` |
| Webhook dispatch + matching | Implemented | `apps/trigger-service/src/lib/trigger-processor.ts` | Matches events to triggers |
| Polling scheduler | Implemented | `apps/trigger-service/src/polling/worker.ts` | Cursor-based stateful polling |
| Cron scheduling | Implemented | `apps/trigger-service/src/scheduled/worker.ts`, `apps/trigger-service/src/index.ts` | Scheduled worker runs in trigger-service, restores enabled cron triggers at startup, and creates trigger-driven runs |
| GitHub provider | Implemented | `packages/triggers/src/github.ts` | Webhook triggers |
| Linear provider | Implemented | `packages/triggers/src/linear.ts` | Webhook + polling |
| Sentry provider | Implemented | `packages/triggers/src/sentry.ts` | Webhook only — `poll()` explicitly throws |
| PostHog provider | Implemented | `packages/triggers/src/posthog.ts` | Webhook only, HMAC validation |
| Gmail provider | Partial | `packages/triggers/src/service/adapters/gmail.ts` | Full polling impl via Composio, but not in HTTP provider registry (`getProviderByType()` returns null) |
| Provider registry | Implemented | `packages/triggers/src/index.ts` | Maps provider types to implementations |
| PubSub session events | Implemented | `apps/worker/src/pubsub/` | Subscriber for session lifecycle events |
| Tick-based manager scheduler (outbound cadence polling) | Planned | `docs/specs/triggers.md` | Planned migration from webhook-first ingestion toward cadence-driven source polling |
| Per-agent/per-source checkpoint cursors | Planned | `docs/specs/triggers.md` | Current cursor persistence is poll-group scoped, not manager-agent scoped |
| Trigger artifact retirement plan (`triggers`/`trigger_events`/`webhook_inbox`) | Planned | `docs/specs/triggers.md` | Requires staged deprecation and cutover verification before schema removal |

---

## 6. Actions (`actions.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Action invocations | Implemented | `packages/services/src/actions/db.ts` | `action_invocations` table |
| Invocation lifecycle (pending → approved/denied → expired) | Implemented | `packages/services/src/actions/` | Full state machine |
| Risk classification (read/write/danger) | Implemented | `packages/services/src/actions/db.ts` | Three-level risk model |
| Action grants | Implemented | `packages/services/src/actions/grants.ts` | Scoped reusable permissions with call budgets |
| Grant CRUD + evaluation | Implemented | `packages/services/src/actions/grants.ts` | Create, list, evaluate, revoke |
| Gateway action routes | Implemented | `apps/gateway/src/api/proliferate/http/` | Invoke, approve, deny, list, grants |
| Provider guide/bootstrap | Implemented | `apps/gateway/src/api/proliferate/http/` | `GET /:sessionId/actions/guide/:integration` |
| Linear adapter | Implemented | `packages/services/src/actions/adapters/linear.ts` | Linear API operations |
| Sentry adapter | Implemented | `packages/services/src/actions/adapters/sentry.ts` | Sentry API operations |
| Slack adapter | Implemented | `packages/services/src/actions/adapters/slack.ts` | Slack `send_message` action via `chat.postMessage` |
| Invocation sweeper | Implemented | `apps/worker/src/sweepers/index.ts` | Expires stale invocations |
| Sandbox-MCP grants handler | Implemented | `packages/sandbox-mcp/src/actions-grants.ts` | Grant handling inside sandbox |
| Actions list (web) | Implemented | `apps/web/src/server/routers/actions.ts` | Org-level actions inbox (oRPC route) |
| Inline attention inbox tray | Implemented | `apps/web/src/components/coding-session/inbox-tray.tsx`, `apps/web/src/hooks/use-attention-inbox.ts` | Merges WS approvals, org-polled approvals, and pending runs into inline tray in thread |
| Connector-backed action sources (`remote_http` MCP via Actions) | Implemented | `packages/services/src/actions/connectors/`, `apps/gateway/src/api/proliferate/http/actions.ts` | Gateway-mediated remote MCP connectors through Actions pipeline (connector source: org-scoped `org_connectors` table) |
| MCP connector 404 session recovery (re-init + retry-once) | Implemented | `packages/services/src/actions/connectors/client.ts:callConnectorTool` | Stateless per call; SDK handles session ID internally; 404 triggers fresh re-init |
| Post-approval live-policy revalidation | Planned | `docs/specs/actions.md` | Current approval flow does not re-resolve mode/drift/kill-switch state before execution |
| Live revocation override contract (TOCTOU guard) | Planned | `docs/specs/actions.md` | Needs explicit execution-time precedence for org kill-switch + credential revocation |

---

## 7. LLM Proxy (`llm-proxy.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts` | Per-session/org temp keys via LiteLLM API |
| Key scoping (team/user) | Implemented | `packages/shared/src/llm-proxy.ts` | Team = org, user = session for cost isolation |
| Key duration config | Implemented | `packages/environment/src/schema.ts:LLM_PROXY_KEY_DURATION` | Configurable via env |
| Virtual key budget/rate enforcement | Planned | `docs/specs/agent-platform-v1/15-llm-proxy-architecture.md` | Enforce hard spend/rate limits synchronously at proxy layer |
| Model routing | Implemented | External LiteLLM service | Not a local app — external dependency |
| Spend tracking (per-org) | Implemented | `packages/shared/src/llm-proxy.ts` | Via LiteLLM virtual key spend APIs |
| LLM spend cursors (DB) | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` | Tracks spend sync state |

> **Note:** The LLM proxy is an external LiteLLM service, not a locally built app. This spec covers the integration contract (key generation, spend queries) and the conventions for how sessions use it.

---

## 8. CLI (`cli.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Device auth flow | Implemented | `packages/cli/src/state/auth.ts` | OAuth device code flow, token saved to `~/.proliferate/token` |
| Local config management | Implemented | `packages/cli/src/state/config.ts` | Project-local `.proliferate/` config |
| File sync (local → sandbox) | Implemented | `packages/cli/src/lib/sync.ts` | Unidirectional rsync-based push |
| OpenCode launch | Implemented | `packages/cli/src/agents/opencode.ts` | Opens OpenCode UI |
| CLI API routes (auth) | Implemented | `apps/web/src/server/routers/cli.ts:cliAuthRouter`, `apps/web/src/app/api/cli/auth/device/route.ts`, `apps/web/src/app/api/cli/auth/device/poll/route.ts` | oRPC-backed auth flows plus `/api/cli/auth/*` compatibility handlers |
| CLI API routes (repos) | Implemented | `apps/web/src/server/routers/cli.ts:cliReposRouter` | Get/create repos from CLI |
| CLI API routes (sessions) | Implemented | `apps/web/src/server/routers/cli.ts:cliSessionsRouter` | Session creation for CLI |
| CLI API routes (SSH keys) | Implemented | `apps/web/src/server/routers/cli.ts:cliSshKeysRouter`, `apps/web/src/app/api/cli/ssh-keys/route.ts` | oRPC-backed key management plus `/api/cli/ssh-keys` compatibility handler |
| CLI API routes (GitHub) | Implemented | `apps/web/src/server/routers/cli.ts:cliGitHubRouter` | GitHub connection for CLI |
| CLI API routes (configurations) | Implemented | `apps/web/src/server/routers/cli.ts:cliConfigurationsRouter` | Configuration listing for CLI |
| GitHub repo selection | Implemented | `packages/db/src/schema/cli.ts:cliGithubSelections` | Selection history |
| SSH key storage | Implemented | `packages/db/src/schema/cli.ts:userSshKeys` | Per-user SSH keys |

---

## 9. Repos & Configurations (`repos-prebuilds.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Repo CRUD | Implemented | `apps/web/src/server/routers/repos.ts` | List/get/create/delete |
| Repo search | Implemented | `apps/web/src/server/routers/repos.ts:search` | Search available repos |
| Repo connections | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Integration bindings |
| Configuration CRUD | Implemented | `apps/web/src/server/routers/configurations.ts` | List/create/update/delete |
| Configuration-repo associations | Implemented | `packages/db/src/schema/configurations.ts:configurationRepos` | Many-to-many |
| Effective service commands | Implemented | `apps/web/src/server/routers/configurations.ts:getEffectiveServiceCommands` | Resolved config |
| Base snapshot builds | Implemented | `apps/worker/src/base-snapshots/index.ts` | Worker queue, deduplication |
| Configuration snapshot builds | Implemented | `apps/worker/src/configuration-snapshots/index.ts` | Multi-repo, tightly coupled to configuration creation |
| Configuration resolver | Implemented | `apps/gateway/src/lib/configuration-resolver.ts` | Resolves config at session start |
| Service commands persistence | Implemented | `packages/db/src/schema/configurations.ts:serviceCommands` | JSONB on configurations |
| Env file persistence | Implemented | `packages/db/src/schema/configurations.ts:envFiles` | JSONB on configurations |
| Configuration connector configuration (deprecated) | Deprecated | `packages/db/src/schema/configurations.ts:connectors` | Legacy JSONB on configurations table; migrated to org-scoped `org_connectors` table via `0022_org_connectors.sql` |
| Org-scoped connector catalog | Implemented | `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/` | `org_connectors` table with full CRUD via Integrations routes |
| Org connector management UI | Implemented | `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts` | Settings → Tools redirects to integrations page |
| Org connector validation endpoint | Implemented | `apps/web/src/server/routers/integrations.ts:validateConnector` | `tools/list` preflight with diagnostics |
| Base snapshot status tracking | Implemented | `packages/db/src/schema/configurations.ts:sandboxBaseSnapshots` | Building/ready/failed |
| Configuration snapshot status tracking | Implemented | `packages/services/src/configurations/db.ts` | Building/default/ready/failed on configurations table |

---

## 10. Secrets & Environment (`secrets-environment.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Secret CRUD | Implemented | `apps/web/src/server/routers/secrets.ts` | Create/delete/list |
| Secret check (exists?) | Implemented | `apps/web/src/server/routers/secrets.ts:check` | Check without revealing value |
| Secret bundles CRUD | Deprecated | `apps/web/src/server/routers/secrets.ts` | Bundle routes removed; secrets are now flat per-org |
| Bundle metadata update | Deprecated | `apps/web/src/server/routers/secrets.ts` | Bundle routes removed |
| Bulk import | Implemented | `apps/web/src/server/routers/secrets.ts:bulkImport` | `.env` paste flow |
| Secret encryption | Implemented | `packages/services/src/secrets/` | Encrypted at rest |
| Per-secret persistence toggle | Implemented | Recent PR `c4d0abb` | Toggle whether secret persists across sessions |
| Secret encryption (DB) | Implemented | `packages/services/src/secrets/service.ts` | AES-256 encrypted in PostgreSQL; S3 is NOT used for secrets (only verification uploads) |

---

## 11. Integrations (`integrations.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Integration list/update | Implemented | `apps/web/src/server/routers/integrations.ts` | Generic integration routes |
| GitHub OAuth (GitHub App) | Implemented | `apps/web/src/app/api/integrations/github/callback/route.ts` | Direct GitHub App installation flow |
| Sentry OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:sentryStatus/sentrySession` | Via Nango |
| Linear OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:linearStatus/linearSession` | Via Nango |
| Slack OAuth | Implemented | `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts` | Workspace install stored in `slack_installations` (not Nango-managed) |
| Slack installations | Implemented | `packages/db/src/schema/slack.ts:slackInstallations` | Workspace-level |
| Slack conversations cache | Implemented | `packages/db/src/schema/slack.ts:slackConversations` | Channel cache |
| Slack members API | Implemented | `apps/web/src/server/routers/integrations.ts:slackMembers` | Workspace member list for DM target picker |
| Slack channels API | Implemented | `apps/web/src/server/routers/integrations.ts:slackChannels` | Workspace channel list for notification config |
| Session notification subscriptions table | Implemented | `packages/db/src/schema/slack.ts:sessionNotificationSubscriptions` | Per-session DM notification opt-in |
| Nango callback handling | Implemented | `apps/web/src/server/routers/integrations.ts:callback` | OAuth callback |
| Integration disconnect | Implemented | `apps/web/src/server/routers/integrations.ts:disconnect` | Remove connection |
| Connection binding (repos) | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Repo-to-integration |
| Connection binding (automations) | Implemented | `packages/db/src/schema/automations.ts:automationConnections` | Automation-to-integration |
| Connection binding (sessions) | Implemented | `packages/db/src/schema/sessions.ts:sessionConnections` | Session-to-integration |
| Sentry metadata | Implemented | `apps/web/src/server/routers/integrations.ts:sentryMetadata` | Sentry project/org metadata |
| Linear metadata | Implemented | `apps/web/src/server/routers/integrations.ts:linearMetadata` | Linear team/project metadata |
| Jira OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:jiraStatus/jiraSession` | Via Nango (Atlassian 3LO) |
| Jira metadata | Implemented | `apps/web/src/server/routers/integrations.ts:jiraMetadata` | Sites, projects, issue types |
| Jira action adapter | Implemented | `packages/providers/src/providers/jira/actions.ts` | 6 actions: list_sites, list/get/create/update issues, add_comment |
| GitHub auth (gateway) | Implemented | `apps/gateway/src/lib/github-auth.ts` | Gateway-side GitHub token resolution |
| Org-scoped MCP connector catalog | Implemented | `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/` | Org-level connector CRUD with atomic secret provisioning |
| Org-scoped connector management UI | Implemented | `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts` | Settings → Tools redirects to integrations; connector management on integrations page |

---

## 12. Auth, Orgs & Onboarding (`auth-orgs.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| User auth (better-auth) | Implemented | `packages/shared/src/auth.ts` | Email/password + OAuth |
| Email verification | Implemented | `packages/shared/src/verification.ts` | Verify email flow |
| Org CRUD | Implemented | `apps/web/src/server/routers/orgs.ts` | List/get orgs |
| Member management | Implemented | `apps/web/src/server/routers/orgs.ts:listMembers` | List org members |
| Invitations | Implemented | `apps/web/src/server/routers/orgs.ts:listInvitations` | Invite/accept flow |
| Domain suggestions | Implemented | `apps/web/src/server/routers/orgs.ts:getDomainSuggestions` | Email domain-based org suggestions |
| Onboarding flow | Implemented | `apps/web/src/server/routers/onboarding.ts` | Start trial, mark complete, finalize |
| Trial activation | Implemented | `apps/web/src/server/routers/onboarding.ts:startTrial` | Credit provisioning |
| API keys | Implemented | `packages/db/src/schema/auth.ts:apikey` | Programmatic access |
| Admin status check | Implemented | `apps/web/src/server/routers/admin.ts:getStatus` | Super-admin detection |
| Admin user listing | Implemented | `apps/web/src/server/routers/admin.ts:listUsers` | All users |
| Admin org listing | Implemented | `apps/web/src/server/routers/admin.ts:listOrganizations` | All orgs |
| Admin impersonation | Implemented | `apps/web/src/server/routers/admin.ts:impersonate` | Debug as another user |
| Org switching | Implemented | `apps/web/src/server/routers/admin.ts:switchOrg` | Switch active org context |
| Invitation acceptance page | Implemented | `apps/web/src/app/invite/[id]/page.tsx` | Accept org invite |

---

## 13. Billing & Metering (`billing-metering.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Billing status | Implemented | `apps/web/src/server/routers/billing.ts:getStatus` | Current billing state |
| Current plan | Implemented | `apps/web/src/server/routers/billing.ts:getCurrentPlan` | Active plan info |
| Pricing plans | Implemented | `apps/web/src/server/routers/billing.ts:getPricingPlans` | Available plans |
| Billing settings update | Implemented | `apps/web/src/server/routers/billing.ts:updateBillingSettings` | Update billing prefs |
| Checkout flow | Implemented | `apps/web/src/server/routers/billing.ts:startCheckout` | Initiate payment |
| Credit usage | Implemented | `apps/web/src/server/routers/billing.ts:useCredits` | Deduct credits |
| Usage metering | Implemented | `packages/services/src/billing/metering.ts` | Real-time compute metering |
| Credit gating | Implemented | `packages/shared/src/billing/gating.ts`, `packages/services/src/billing/gate.ts`, `apps/gateway/src/api/proliferate/http/sessions.ts` | Enforced in oRPC session creation, gateway session creation, setup sessions, and runtime resume |
| Shadow balance | Implemented | `packages/services/src/billing/shadow-balance.ts` | Fast balance approximation |
| Org pause on zero balance | Implemented | `packages/services/src/billing/org-pause.ts` | Auto-pause all sessions |
| Trial credits | Implemented | `packages/services/src/billing/trial-activation.ts` | Auto-provision on signup |
| Billing reconciliation | Implemented | `packages/db/src/schema/billing.ts:billingReconciliations` | Manual adjustments with audit |
| Billing events | Implemented | `packages/db/src/schema/billing.ts:billingEvents` | Usage event log |
| LLM spend sync | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` | Syncs spend from LiteLLM |
| Distributed locks (billing-cycle) | Deprecated | Removed — BullMQ concurrency 1 ensures single-execution | See billing-metering.md §6.11. Note: `org-pause.ts` still uses session migration locks (`runWithMigrationLock`) for per-session enforcement; those are session-layer infrastructure, not billing-cycle locks. |
| Billing worker | Implemented | `apps/worker/src/billing/worker.ts` | Interval-based reconciliation |
| Autumn integration | Implemented | `packages/shared/src/billing/` | External billing provider client |
| Overage policy (pause/allow) | Implemented | `packages/services/src/billing/org-pause.ts` | Configurable per-org |
| Overage auto-top-up | Implemented | `packages/services/src/billing/auto-topup.ts` | Auto-charge when balance negative + policy=allow. Circuit breaker, velocity limits, cap enforcement. |
| Fast reconciliation | Implemented | `apps/worker/src/jobs/billing/fast-reconcile.job.ts` | On-demand shadow balance sync with Autumn, triggered by payment events. |

---

## 14. Streaming & Preview (`streaming-preview.md`)

This section tracks the clean-slate V2 transport architecture contract defined in `streaming-preview.md`.

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Unified client stream transport (`/v1/sessions/:id/stream`) | Planned | `docs/specs/streaming-preview.md` | Single multiplexed WebSocket stream for terminal, fs, agent events, and preview signals |
| Gateway two-hop zero-trust auth with per-request HMAC signature | Planned | `docs/specs/streaming-preview.md` | Strip browser auth headers; sign hop-2 requests with nonce + expiry |
| `sandbox-daemon` PID 1 runtime bridge | Planned | `docs/specs/streaming-preview.md` | Owns PTY, FS RPC, watcher events, and port discovery |
| PTY ring replay (`last_seq`) with dual caps (lines + bytes) | Planned | `docs/specs/streaming-preview.md` | 10k-line or 8MB cap; warm replay semantics |
| Native Monaco FS RPC with strict workspace jail | Planned | `docs/specs/streaming-preview.md` | Replaces VS Code server file browsing/edit path |
| Event-driven git/code-changes updates from FS watcher | Planned | `docs/specs/streaming-preview.md` | No polling; WS `fs_change` invalidates client queries |
| Dynamic preview port discovery and daemon in-memory routing | Planned | `docs/specs/streaming-preview.md` | Explicit preview registration preferred; `ss -tln` fallback + stability gating |
| Cross-replica gateway control-stream backplane | Planned | `docs/specs/streaming-preview.md` | Redis/NATS for low-volume control events; PTY data stays on session-owner gateway path |
| Approval-state reconciliation on reconnect | Planned | `docs/specs/streaming-preview.md` | Daemon/harness pulls pending invocation outcomes after resume |
| Slow-consumer backpressure isolation | Planned | `docs/specs/streaming-preview.md` | Per-client bounded queue with disconnect on overflow |
| VS Code server transport surface | Deprecated | `apps/gateway/src/api/proxy/vscode.ts`, `apps/web/src/components/coding-session/vscode-panel.tsx` | Explicit removal in V2 clean-slate mandate |
| Polling-based right-sidebar refresh hooks | Deprecated | `apps/web/src/components/coding-session/*` | Polling banned; replaced by daemon-driven events |
| Direct browser access to provider tunnel URLs | Deprecated | `docs/specs/streaming-preview.md` | Gateway-only routing and auth injection contract |

---

## Cross-Cutting (not a spec — covered within relevant specs)

| Feature | Where documented | Evidence |
|---------|-----------------|----------|
| Intercom chat widget | `auth-orgs.md` (or omit — trivial) | `apps/web/src/server/routers/intercom.ts` |
| Sentry error tracking | Operational concern | `apps/web/sentry.*.config.ts` |
| BullMQ queue infrastructure | Each spec documents its own queues | `packages/queue/src/index.ts` |
| Drizzle ORM / migrations | Each spec documents its own tables | `packages/db/` |
| Logger infrastructure | `CLAUDE.md` covers conventions | `packages/logger/` |
| Environment schema | Referenced by specs as needed | `packages/environment/src/schema.ts` |
| Gateway client libraries | `sessions-gateway.md` | `packages/gateway-clients/` |

---

## Source: `docs/specs/agent-contract.md`

# Agent Contract — System Spec

## 1. Scope & Purpose

### In Scope
- System prompt contract for setup, coding, automation, and scratch sessions
- OpenCode tool schemas and execution domains:
	- `verify`
	- `save_snapshot`
	- `save_service_commands`
	- `save_env_files`
	- `automation.complete`
	- `request_env_variables`
- Capability injection rules (which files must be written into sandboxes, and when)
- Gateway callback contract for intercepted tools (`POST /proliferate/:sessionId/tools/:toolName`)
- Agent/model configuration contract (canonical IDs, OpenCode IDs, provider mapping)

### Out of Scope
- Gateway websocket/session runtime state machine (see `sessions-gateway.md`)
- Provider boot internals and snapshot restoration mechanics (see `sandbox-providers.md`)
- Automation run orchestration beyond the `automation.complete` interface (see `automations-runs.md`)
- Secret CRUD, encryption, and env-file generation runtime (see `secrets-environment.md`)
- LLM proxy key issuance and spend accounting (see `llm-proxy.md`)

### Mental Models

1. **Contract, not implementation detail inventory.** This spec defines behavioral contracts and invariants. File trees and concrete model structs live in code.
2. **Two channels exist for tool execution.**
	- Gateway-mediated tools execute server-side over synchronous HTTP callbacks.
	- Sandbox-local tools execute in the OpenCode runtime and drive UI through streamed tool events.
3. **Prompts are policy; tools are capability.** Prompts tell the agent what it should do, while tool files define what it can do.
4. **Providers do capability injection, not business logic.** Modal and E2B write the same tool/config artifacts; gateway handlers own platform side effects.
5. **Mode-gating is defense in depth.** Availability is enforced by both injected file set and handler runtime checks for setup-only tools.

### Things Agents Get Wrong

- `automation` prompt **extends** coding prompt; it does not replace it (`getAutomationSystemPrompt()` wraps `getCodingSystemPrompt()`).
- Setup mode wins precedence over automation in prompt selection (`session_type === "setup"` is checked before `client_type === "automation"`).
- `request_env_variables` is **not** gateway-mediated; it runs locally and returns immediately.
- `save_env_files` is active and setup-only; it is not a removed/legacy capability.
- `automation.complete` is injected in all session modes today; prompt guidance, not file-level gating, prevents out-of-mode calls.
- OpenCode tool registration is file discovery from `.opencode/tool/*.ts`; `opencode.json` does not register tools.
- OpenCode config currently sets `"mcp": {}`; it does not explicitly provision Playwright MCP in `getOpencodeConfig()`.
- Gateway callback idempotency is in-memory and retention-based (5 minutes), not durable.
- Most tool wrappers return `result.result` text to OpenCode even on gateway-side `success: false`; failures are often surfaced as tool output, not thrown exceptions.
- `session.system_prompt` fully overrides mode-derived prompt selection.

### Key Invariants
- Tool schema source of truth is `packages/shared/src/opencode-tools/index.ts`.
- Setup-only tools are `save_service_commands` and `save_env_files`; all other contract tools are injected in all session modes.
- Gateway intercept registry is authoritative for server-side execution (`apps/gateway/src/hub/capabilities/tools/index.ts`).
- Sandbox callback auth must validate `req.auth.source === "sandbox"` on tool routes.
- Session-scoped sandbox auth token and gateway URL must be injected before OpenCode tool callbacks can work.

---

## 2. Core Concepts

### System Prompt Selection — `Implemented`
- Prompt builders live in `packages/shared/src/prompts.ts`.
- Selection precedence in `apps/gateway/src/lib/session-store.ts`:
	- Setup session -> `getSetupSystemPrompt(repoName)`
	- Else automation client -> `getAutomationSystemPrompt(repoName)`
	- Else coding -> `getCodingSystemPrompt(repoName)`
- Scratch sessions use `getScratchSystemPrompt()` when no configuration exists.
- `session.system_prompt` overrides all computed prompt selection.

### Tool Surface — `Implemented`

| Tool | Execution domain | Mode availability | Key schema constraints |
|---|---|---|---|
| `verify` | Gateway-mediated | All sessions | `{ folder?: string }` |
| `save_snapshot` | Gateway-mediated | All sessions | `{ message?: string }` |
| `automation.complete` (`automation_complete` alias) | Gateway-mediated | Injected in all sessions | `run_id`, `completion_id`, `outcome` required by handler |
| `save_service_commands` | Gateway-mediated | Setup only | `commands[]` 1-10; name/command/cwd/workspacePath limits validated in gateway |
| `save_env_files` | Gateway-mediated | Setup only | `files[]` 1-10; relative paths only; format=`dotenv`; mode=`secret`; keys[] 1-50 |
| `request_env_variables` | Sandbox-local | All sessions | `keys[]` with optional `type`, `required`, `suggestions` |

Primary references:
- Tool definitions: `packages/shared/src/opencode-tools/index.ts`
- Handler registry: `apps/gateway/src/hub/capabilities/tools/index.ts`
- Handler implementations: `apps/gateway/src/hub/capabilities/tools/*.ts`

### Gateway Callback Contract — `Implemented`
- Sandbox wrappers call:
	- `POST /proliferate/:sessionId/tools/:toolName`
	- Body: `{ tool_call_id: string, args: Record<string, unknown> }`
	- Auth: `Authorization: Bearer <SANDBOX_MCP_AUTH_TOKEN>`
- Router behavior in `apps/gateway/src/api/proliferate/http/tools.ts`:
	- Reject non-sandbox sources (`403`).
	- Deduplicate by `tool_call_id` via in-memory inflight + completed caches.
	- Completed cache retention is 5 minutes.
	- Execute handler once per idempotency key and reuse cached result for retries.

### Snapshot Boundary Retry Semantics — `Implemented`
- `TOOL_CALLBACK_HELPER` retries callback transport failures (`ECONNRESET`, `ECONNREFUSED`, `fetch failed`, `AbortError`) with exponential backoff.
- Retries must reuse the same `tool_call_id`.
- `save_snapshot` can trigger freeze/thaw boundaries where this retry behavior is required for correctness.

### Capability Injection — `Implemented`
- Both providers write:
	- Tool `.ts` + `.txt` pairs in `{repoDir}/.opencode/tool/`
	- OpenCode config to both global and repo-local paths
	- Plugin at `/home/user/.config/opencode/plugin/proliferate.mjs`
	- `.opencode/instructions.md` and `.proliferate/actions-guide.md`
	- Preinstalled tool deps (`package.json`, `node_modules`) into `.opencode/tool/`
- Setup-only tool files are removed in non-setup sessions to prevent setup snapshot leakage.

### Agent/Model Configuration — `Implemented`
- Only `opencode` agent type exists.
- Canonical model IDs are defined in `packages/shared/src/agents.ts` and map to:
	- `anthropic/*` OpenCode IDs for Anthropic models
	- `litellm/*` OpenCode IDs for non-Anthropic models
- `getOpencodeConfig()` emits provider blocks for both `anthropic` and `litellm`, with `permission: { "*": "allow", "question": "deny" }` and currently empty MCP config (`"mcp": {}`).

---

## 5. Conventions & Patterns

### Do
- Define all contract tools in `packages/shared/src/opencode-tools/index.ts` as exported string templates.
- Export both `.ts` and `.txt` artifacts per tool.
- Keep setup-only tool gating aligned in both places:
	- Provider injection/removal logic
	- Gateway handler runtime checks
- Use `tool_call_id` consistently for callback idempotency.
- Use Zod validation for structured handler args (`save_service_commands`, `save_env_files`).

### Don't
- Do not register tools in `opencode.json`.
- Do not move gateway side effects (DB/provider/S3 writes) into sandbox tool code.
- Do not assume `session.agent_config.tools` filters injected tools; it is currently carried through context but not enforced.
- Do not modify coding/setup prompts without checking automation prompt side effects.

### Error Handling
- Intercepted handlers return `InterceptedToolResult` with `{ success, result, data? }`.
- Callback helper converts HTTP/network errors into structured `{ success: false, result: string }`.
- Tool wrappers usually return `result.result` to OpenCode; callers should treat tool output content as authoritative for success/failure messaging.

### Reliability
- Callback timeout per attempt is 120 seconds.
- Retry behavior is exponential backoff with `MAX_RETRIES = 5` (up to 6 attempts total including first try).
- OpenCode readiness probe uses exponential backoff (200ms base, 1.5x, max 2s, 30s budget).
- Idempotency is process-memory scoped and lost on gateway restart.

### Testing Conventions
- Unit-test each intercepted handler's schema + guard behavior.
- Route-level tests should assert:
	- sandbox-source auth enforcement
	- inflight dedup behavior
	- completed-result cache reuse by `tool_call_id`
- Prompt tests should assert mode-specific expectations, especially setup vs automation precedence.

---

## 6. Subsystem Deep Dives (Invariant Set)

### 6.1 Prompt Contract Invariants — `Implemented`
- The prompt selection function must stay pure and precedence-ordered: setup first, then automation, then coding.
- Scratch sessions must not reuse configuration-backed prompt selection logic.
- `session.system_prompt` override remains authoritative and bypasses mode-derived prompt composition.
- Automation prompt must continue to include coding prompt content plus explicit completion requirements.
- Setup prompt must preserve setup-only behavioral constraints (no source edits, explicit verification/snapshot workflow, env-file guidance).

### 6.2 Tool Definition Invariants — `Implemented`
- The canonical tool schema and wrapper logic must live in a single module (`opencode-tools/index.ts`).
- Each tool must ship as a pair: executable module (`*.ts`) and companion guidance (`*.txt`).
- Schema invariants are part of this contract:
	- `verify`: optional `folder`.
	- `save_snapshot`: optional `message`.
	- `automation.complete`: required `run_id`, `completion_id`, and `outcome`.
	- `save_service_commands`: `commands[]` length 1-10 with bounded command metadata fields.
	- `save_env_files`: `files[]` length 1-10, relative paths only, `format=dotenv`, `mode=secret`.
	- `request_env_variables`: `keys[]` payload with optional `type`, `required`, and `suggestions`.
- Tool names in wrappers, provider-written filenames, and gateway registry must remain consistent:
	- `automation.complete` wrapper file is `automation_complete.ts`.
	- Gateway must continue supporting both `automation.complete` and `automation_complete`.
- Setup-only capabilities (`save_service_commands`, `save_env_files`) must not be available in non-setup sessions after provider initialization.

### 6.3 Callback Transport Invariants — `Implemented`
- Gateway-mediated tools must execute through synchronous HTTP callbacks, not patching OpenCode parts post hoc.
- Callback auth must reject any non-sandbox caller regardless of bearer token presence.
- Idempotency key semantics:
	- `tool_call_id` uniquely identifies the logical callback execution window.
	- Duplicate in-flight keys must await the same promise.
	- Duplicate completed keys within retention must return cached results.
- Snapshot-boundary retries must preserve `tool_call_id`.
- `automation.complete` must use `completion_id` as callback idempotency key in the tool wrapper.

### 6.4 Capability Injection Invariants — `Implemented`
- Providers must write equivalent contract artifacts regardless of provider backend (Modal/E2B).
- OpenCode config must be written to both global and repo-local paths.
- Provider boot must set callback-critical env vars in sandbox runtime:
	- `SANDBOX_MCP_AUTH_TOKEN`
	- `PROLIFERATE_GATEWAY_URL`
	- `PROLIFERATE_SESSION_ID`
- Provider restore paths must remove setup-only tools in non-setup sessions to prevent snapshot contamination.

### 6.5 OpenCode Runtime Configuration Invariants — `Implemented`
- OpenCode server must bind to `0.0.0.0:4096`.
- Plugin path must reference the global Proliferate plugin file.
- Permission policy must continue to deny `question` while allowing command execution (`"*": "allow"`).
- Canonical model IDs must remain transformable into:
	- OpenCode model ID (`toOpencodeModelId`)
	- Provider API model ID (`toApiModelId`)
- Non-Anthropic models must route via the `litellm` OpenCode provider block.

### 6.6 Environment Request and Persistence Invariants — `Implemented`
- `request_env_variables` must remain sandbox-local and non-blocking from gateway callback perspective.
- UI env-request state depends on streamed tool events (`tool_start`) and must remain compatible with `request_env_variables` payload shape.
- User env submissions must merge into `/tmp/.proliferate_env.json` via provider `writeEnvFile()` implementations.
- Secret persistence policy is controlled by submission inputs (`persist` per key, fallback `saveToConfiguration`) and is not owned by the tool schema itself.
- `save_env_files` must persist env-file generation spec (not secret values) and remain setup-session-gated.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | This -> Gateway | `POST /proliferate/:sessionId/tools/:toolName` | Tool callbacks are part of gateway runtime lifecycle |
| `sandbox-providers.md` | This -> Providers | Tool/config injection contract | Providers materialize tool files and OpenCode config defined here |
| `automations-runs.md` | Runs -> This | `automation.complete` payload contract | Run completion depends on this tool schema and idempotency rules |
| `repos-prebuilds.md` | This -> Configurations | `save_service_commands`, `save_env_files` writes | Setup tools persist reusable configuration metadata |
| `secrets-environment.md` | This <-> Secrets | `request_env_variables`, submit-env write path | Tool requests values; secrets subsystem persists optional org secrets |
| `llm-proxy.md` | Proxy -> This | OpenCode provider options | Proxy URL/key populate OpenCode provider options |
| `actions.md` | This -> Actions | Prompt + actions bootstrap guidance | Prompts and bootstrap file document `proliferate actions` usage |

### Security & Auth
- Gateway-mediated tools execute with server-side credentials; sandbox code does not receive direct DB/S3/provider credentials.
- Callback endpoints enforce sandbox-origin authentication (`req.auth.source === "sandbox"`).
- Prompt/tool guidance requires key-level extraction from env JSON, avoiding full-file echoing.
- Prompts continue to forbid requesting raw integration API keys when integrations are connected.

### Observability
- Tool callback route logs execution events with `toolName`, `toolCallId`, and `sessionId`.
- Session telemetry tracks tool call IDs and active tool call counts.
- OpenCode readiness and key runtime operations emit `[P-LATENCY]`/latency logs.
- `session_tool_invocations` schema exists for audit, but current callback router does not use it as a write-through idempotency store.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tool handler tests pass
- [ ] Prompt/tool references are synchronized (including `save_env_files`)
- [ ] Provider injection rules match handler runtime gates for setup-only tools
- [ ] Section 6 invariants are validated against current implementation
- [ ] If contract behavior changed, `docs/specs/feature-registry.md` is updated

---

## 9. Known Limitations & Tech Debt

- [ ] **`automation.complete` is not mode-gated at injection time** — injected in non-automation sessions; enforced only by prompt expectations.
- [ ] **Dual naming for automation completion** — registry supports both `automation.complete` and `automation_complete` for compatibility.
- [ ] **Mixed tool authoring styles** — `verify` still uses raw export object while other tools use `tool()` API.
- [ ] **Custom prompt override bypasses safety text** — `session.system_prompt` can omit mode-critical instructions.
- [ ] **Idempotency cache is in-memory only** — gateway restart drops dedup state and may permit rare duplicate side effects.
- [ ] **Idempotency key namespace is global to process map** — cache key is `tool_call_id` only, not scoped by session/tool.
- [ ] **`session_tool_invocations` table is not integrated into callback execution path** — durable audit/idempotency coupling is still missing.

---

## Source: `docs/specs/sandbox-providers.md`

# Sandbox Providers — System Spec

## 1. Scope & Purpose

### In Scope
- `SandboxProvider` interface contract and capability flags
- Provider factory selection (`modal` vs `e2b`)
- Modal provider implementation (`ModalLibmodalProvider`)
- E2B provider implementation (`E2BProvider`)
- Sandbox boot orchestration (workspace clone/restore, tool injection, OpenCode startup)
- Snapshot behavior (filesystem snapshot, pause snapshot, memory snapshot)
- Git freshness on restore (`shouldPullOnRestore` + provider integrations)
- Base snapshot version key + Modal base/configuration snapshot build paths
- sandbox-mcp sidecar (`api-server`, terminal WS, service manager, in-sandbox CLI)
- Sandbox auth token wiring (`SANDBOX_MCP_AUTH_TOKEN`)
- Caddy preview/proxy integration (`/_proliferate/mcp/*`, `/_proliferate/vscode/*`)

### Out of Scope
- Session lifecycle orchestration, hub ownership, SSE runtime state machine — see `sessions-gateway.md`
- Tool schemas/prompts and interception semantics — see `agent-contract.md`
- Configuration lifecycle and snapshot build triggering policy — see `repos-prebuilds.md`
- Secret CRUD and bundle lifecycle — see `secrets-environment.md`
- LLM proxy key issuance/routing policy — see `llm-proxy.md`

### Mental Models

A sandbox provider is a compute orchestration adapter, not a session orchestrator. Session code decides *when* to create, resume, pause, or terminate; provider code decides *how* that action is executed against Modal or E2B.

The core abstraction is capability-based, not provider-uniform:
- Filesystem snapshot exists on both providers.
- Pause/resume exists only on E2B (`supportsPause`, `supportsAutoPause`).
- Memory snapshot exists only on Modal (`supportsMemorySnapshot`, `memorySnapshot`, `restoreFromMemorySnapshot`).

Every sandbox has two control planes:
- OpenCode plane on port `4096` for agent interaction.
- sandbox-mcp plane on port `4000` for terminal/services/git inspection, fronted by Caddy on preview port `20000`.

Boot is intentionally split into two phases:
- Essential phase (blocking): required for a usable agent session.
- Additional phase (async): improves runtime ergonomics but should not block session readiness.

State is intentionally split:
- Durable session metadata in DB (`sessions` row and linked records).
- In-sandbox operational metadata at `/home/user/.proliferate/metadata.json`.
- Provider instances themselves are ephemeral/stateless across calls.

### Things Agents Get Wrong

- `ensureSandbox()` is the default lifecycle entry point; `createSandbox()` is for explicit fresh creation only (`packages/shared/src/sandbox-provider.ts`, `packages/shared/src/providers/*.ts`).
- Modal and E2B use different identity primitives for recovery:
  - Modal finds by sandbox name = `sessionId` (`fromName`).
  - E2B finds by stored `currentSandboxId` (`Sandbox.getInfo`) (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- Memory snapshot IDs are prefixed `mem:` and only Modal can restore them (`restoreFromMemorySnapshot`) (`packages/shared/src/providers/modal-libmodal.ts`).
- Snapshot resolution utility no longer does repo-level fallback; it is configuration snapshot or `null` only (`packages/shared/src/snapshot-resolution.ts`).
- Setup-only tools are session-type gated; they are injected for `setup` sessions and explicitly removed for non-setup restores (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- `PLUGIN_MJS` logs execute inside sandbox runtime, not in provider process (`packages/shared/src/sandbox/config.ts`).
- `checkSandboxes()` must be side-effect free; E2B must not use `Sandbox.connect()` there (`packages/shared/src/providers/provider-contract.test.ts`, `packages/shared/src/providers/e2b.ts`).
- Snapshot restore freshness is cadence-gated and metadata-aware; cadence advances only when all pulls succeed (`packages/shared/src/sandbox/git-freshness.ts`, `packages/shared/src/providers/pull-on-restore.test.ts`).
- Gateway callback tools (`verify`, `save_snapshot`, etc.) require `PROLIFERATE_GATEWAY_URL`, `PROLIFERATE_SESSION_ID`, and `SANDBOX_MCP_AUTH_TOKEN` in sandbox env (`packages/shared/src/opencode-tools/index.ts`).
- Direct provider instantiation is valid for snapshot workers, not for session runtime code paths (`apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`, `packages/shared/src/providers/index.ts`).

---

## 2. Core Concepts

### Provider Factory
`getSandboxProvider(type?)` resolves provider implementation from explicit type or `DEFAULT_SANDBOX_PROVIDER` and returns a fresh provider instance (`packages/shared/src/providers/index.ts`).

Session runtime persists and reuses provider type via `sessions.sandbox_provider` to keep resume/snapshot behavior provider-consistent (`apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/hub/session-hub.ts`).

### SandboxProvider Contract
`SandboxProvider` defines required lifecycle methods plus optional capability methods (`checkSandboxes`, `resolveTunnels`, `execCommand`, memory snapshot methods) (`packages/shared/src/sandbox-provider.ts`).

Capability flags are authoritative:
- `supportsPause` / `supportsAutoPause` (E2B)
- `supportsMemorySnapshot` (Modal)

Callers must branch on capabilities rather than assuming parity.

### Snapshot Surfaces
Current snapshot surfaces in active runtime flow:
- Configuration/session snapshot IDs (plain string IDs)
- Pause snapshots (E2B: snapshot ID equals sandbox ID)
- Memory snapshots (Modal: `mem:<id>`)
- Base snapshots for cold-start acceleration (Modal only)

`resolveSnapshotId()` is intentionally a pure utility with simple semantics: return `configurationSnapshotId` if present, else `null` (`packages/shared/src/snapshot-resolution.ts`).

### OpenCode + Model Configuration
Canonical model IDs live in `agents.ts`, and providers convert to OpenCode model IDs via `toOpencodeModelId()` (`packages/shared/src/agents.ts`).

Default model is `claude-sonnet-4.6` (not Opus) (`packages/shared/src/agents.ts`).

OpenCode config and readiness are shared utilities (`getOpencodeConfig`, `waitForOpenCodeReady`) used by both providers (`packages/shared/src/sandbox/opencode.ts`).

### Metadata + Freshness
Providers maintain `SessionMetadata` in `/home/user/.proliferate/metadata.json` for repo directory and freshness cadence tracking (`packages/shared/src/sandbox/opencode.ts`, `packages/shared/src/providers/*.ts`).

`shouldPullOnRestore()` is the shared policy function. Providers own actual git credential rewrite/pull execution and metadata timestamp updates (`packages/shared/src/sandbox/git-freshness.ts`).

### sandbox-mcp Sidecar
sandbox-mcp provides in-sandbox HTTP/WS APIs for service management, terminal access, and git introspection (`packages/sandbox-mcp/src/index.ts`, `packages/sandbox-mcp/src/api-server.ts`, `packages/sandbox-mcp/src/terminal.ts`).

It is reachable externally through Caddy’s `/_proliferate/mcp/*` path (`packages/shared/src/sandbox/config.ts`).

---

## 5. Conventions & Patterns

### Do
- Use `getSandboxProvider()` for runtime selection in gateway/session code.
- Use `ensureSandbox()` for runtime bootstrap/recovery.
- Gate provider-specific behavior with capability flags (`supportsPause`, `supportsMemorySnapshot`).
- Pass callback/auth env vars whenever sandbox tools/services depend on gateway callbacks.
- Use `shellEscape()` for shell-interpolated values and `capOutput()` for logged command output.
- Wrap/normalize provider errors via `SandboxProviderError`.
- Treat provider `terminate()` as idempotent and tolerant of not-found.

### Don’t
- Don’t assume snapshot IDs are interchangeable across providers.
- Don’t call `Sandbox.connect()` in `checkSandboxes()` (side effects on paused E2B sandboxes).
- Don’t log raw secrets or unredacted provider errors.
- Don’t expose setup-only tools in non-setup sessions.
- Don’t block session readiness on async additional dependency setup.

### Reliability Notes
- OpenCode readiness probes are bounded and best-effort on create; runtime recovery should tolerate transient failure and reconnect (`packages/shared/src/sandbox/opencode.ts`, `packages/shared/src/providers/*.ts`).
- sandbox-mcp CLI retries transient local API connection errors (`packages/sandbox-mcp/src/proliferate-cli.ts`).

---

## 6. Subsystem Deep Dives (Declarative Invariants)

### 6.1 Provider Selection Invariants — `Implemented`
- Provider choice for a session must be stable after session creation (`sessions.sandbox_provider`).
- `getSandboxProvider()` must fail fast on unknown/missing provider type.
- Session-facing runtime code must call providers through the factory.
- Direct class instantiation is permitted only in provider-specific build/ops paths (base/config snapshot workers, snapshot CLI).

References: `packages/shared/src/providers/index.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`.

### 6.2 Lifecycle Entry Invariants — `Implemented`
- `ensureSandbox()` must preserve recovery-first semantics: reuse live sandbox when possible, otherwise create.
- Recovery must return fresh tunnel/preview endpoints via `resolveTunnels()`.
- Provider-level state must not be required between calls; only DB and sandbox filesystem state are authoritative.

References: `packages/shared/src/sandbox-provider.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`.

### 6.3 Modal Provider Invariants — `Implemented`
- Modal declares `supportsPause=false`, `supportsAutoPause=false`, `supportsMemorySnapshot=true`.
- Modal image selection precedence is invariant:
  - restore snapshot (`opts.snapshotId`) first
  - base snapshot (`opts.baseSnapshotId` or `MODAL_BASE_SNAPSHOT_ID`) second
  - `get_image_id` fallback last
- Modal memory snapshots must round-trip through `mem:` ID prefix and `restoreFromMemorySnapshot()`.
- Memory restore must not return control before OpenCode readiness succeeds.
- `pause()` must always fail with explicit unsupported error.

References: `packages/shared/src/providers/modal-libmodal.ts`, `packages/modal-sandbox/deploy.py`.

### 6.4 E2B Provider Invariants — `Implemented`
- E2B declares `supportsPause=true`, `supportsAutoPause=true`.
- E2B snapshot semantics are pause semantics (`snapshot()` delegates to `pause()`, snapshot ID = sandbox ID).
- E2B resume path (`Sandbox.connect(snapshotId)`) is allowed to fall back to fresh create on failure.
- `checkSandboxes()` must use listing APIs only and remain side-effect free.

References: `packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/provider-contract.test.ts`.

### 6.5 Boot Pipeline Invariants — `Implemented`
- Essential boot work must complete before `createSandbox()` resolves:
  - workspace clone/restore resolution
  - OpenCode config + plugin + tools/instructions/actions-guide writes
  - OpenCode process launch
- Additional boot work runs async and must not fail session creation:
  - start infra services
  - Caddy startup
  - sandbox-mcp startup
  - env apply + service autostart bootstrapping
- Setup-only tools (`save_service_commands`, `save_env_files`) are only present in setup sessions.
- Non-setup sessions must proactively remove setup-only tools when restoring from setup snapshots.

References: `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`, `packages/shared/src/opencode-tools/index.ts`.

### 6.6 Service Boot + Env File Invariants — `Implemented`
- Env files must be applied before tracked service autostart commands run.
- Service autostart requires both `snapshotHasDeps=true` and non-empty resolved service commands.
- Services started via `proliferate services start` are expected to be tracked by service-manager state/log APIs.

References: `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`, `packages/sandbox-mcp/src/proliferate-cli.ts`, `packages/sandbox-mcp/src/service-manager.ts`.

### 6.7 Freshness Invariants — `Implemented`
- Pull-on-restore must be policy-driven (`SANDBOX_GIT_PULL_ON_RESTORE`, cadence, snapshot presence, repo count).
- Providers must refresh git credentials with newly resolved repo tokens on snapshot restore, independent of pull cadence, so subsequent push/PR commands avoid stale-token auth failures.
- Providers must refresh git credentials before pull attempts when pull policy is active.
- `lastGitFetchAt` may advance only when all repo pulls succeed.
- Pull failures must be non-fatal to sandbox restore/startup.

References: `packages/shared/src/sandbox/git-freshness.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/pull-on-restore.test.ts`.

### 6.8 Snapshot Resolution Invariants — `Implemented`
- `resolveSnapshotId()` must never invent provider-specific fallback IDs.
- If `configurationSnapshotId` exists, return it.
- If absent, return `null`.

References: `packages/shared/src/snapshot-resolution.ts`, `packages/shared/src/snapshot-resolution.test.ts`.

### 6.9 sandbox-mcp API Invariants — `Implemented`
- HTTP API listens on port `4000`; terminal WS endpoint is `/api/terminal`.
- All endpoints except `/api/health` require bearer auth token validation.
- Git endpoints must constrain repo/file paths to workspace boundaries.
- Git diff responses must be capped to prevent oversized payloads.

References: `packages/sandbox-mcp/src/index.ts`, `packages/sandbox-mcp/src/api-server.ts`, `packages/sandbox-mcp/src/terminal.ts`, `packages/sandbox-mcp/src/auth.ts`.

### 6.10 Service Manager Invariants — `Implemented`
- Service state is persisted in `/tmp/proliferate/state.json`; logs in `/tmp/proliferate/logs/`.
- Starting a service with an existing name must replace prior process ownership.
- Process group termination semantics must be used when possible to avoid orphan children.
- Exposed port routing must be written to `/home/user/.proliferate/caddy/user.caddy` and reloaded via Caddy signal.

References: `packages/sandbox-mcp/src/service-manager.ts`, `packages/shared/src/sandbox/config.ts`.

### 6.11 Proliferate CLI Invariants — `Implemented`
- `services` commands are sandbox-mcp API clients and require auth token.
- `env apply` is two-pass (validate then write) and path-constrained to workspace.
- `env scrub` removes secret-mode files and local override file.
- `actions` commands call gateway APIs and must support approval-polling flow.

References: `packages/sandbox-mcp/src/proliferate-cli.ts`, `packages/sandbox-mcp/src/proliferate-cli-env.test.ts`, `packages/sandbox-mcp/src/actions-grants.ts`.

### 6.12 Base + Configuration Snapshot Build Invariants — `Implemented`
- Base snapshot version key must deterministically hash runtime-baked files/config + image version salt.
- Base snapshot builds are Modal-only and run out-of-band (worker/ops scripts), not in session request path.
- Configuration snapshot builds are Modal-only; non-Modal configurations are marked default/no-snapshot.

References: `packages/shared/src/sandbox/version-key.ts`, `apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`, `apps/gateway/src/bin/create-modal-base-snapshot.ts`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions/Gateway runtime | Gateway -> Provider | `ensureSandbox`, `snapshot`, `pause`, `terminate`, `execCommand` | Runtime lifecycle orchestration belongs to `sessions-gateway.md`; providers execute compute operations. |
| Agent tooling | Provider -> Sandbox FS | `.opencode/tool/*`, plugin file, instructions | Tool schemas/behavior are owned by `agent-contract.md`; providers only inject runtime artifacts. |
| Repos/Configurations | Workers -> Modal provider | `createBaseSnapshot`, `createConfigurationSnapshot` | Build scheduling/ownership is in `repos-prebuilds.md`. |
| Secrets/Environment | Services/Gateway -> Provider | `CreateSandboxOpts.envVars`, env files spec | Secret CRUD and schema ownership is in `secrets-environment.md`. |
| LLM proxy | Services -> Provider/Sandbox | `LLM_PROXY_API_KEY`, `ANTHROPIC_BASE_URL` | Key issuance/routing policy is in `llm-proxy.md`. |
| Actions | sandbox CLI -> Gateway | `/proliferate/:sessionId/actions/*` | Approval/risk/grants logic is in `actions.md`; provider responsibility is env wiring and CLI availability. |

### Security & Auth
- sandbox-mcp auth is bearer-token based and deny-by-default when token is absent (`packages/sandbox-mcp/src/auth.ts`).
- Gateway derives per-session sandbox token via HMAC and uses it when proxying terminal/devtools flows (`apps/gateway/src/lib/sandbox-mcp-token.ts`, `apps/gateway/src/api/proxy/terminal.ts`).
- Provider error surfaces must redact secrets via `SandboxProviderError` and `redactSecrets()` (`packages/shared/src/sandbox/errors.ts`).
- Snapshot save flow scrubs secret env files before snapshot and reapplies afterward (`apps/gateway/src/hub/session-hub.ts`).

### Observability
- Providers emit structured latency markers across critical lifecycle edges (`provider.*` events) (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- sandbox-mcp logs via service-scoped logger for API/terminal components (`packages/sandbox-mcp/src/api-server.ts`, `packages/sandbox-mcp/src/terminal.ts`).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Shared/provider tests pass (`pnpm -C packages/shared test`)
- [ ] sandbox-mcp tests pass (`pnpm -C packages/sandbox-mcp test`)
- [ ] This spec removes sectioned file-tree/data-model inventories and keeps deep dives declarative
- [ ] No spec statements conflict with provider capabilities (`supportsPause`, `supportsMemorySnapshot`) in code

---

## 9. Known Limitations & Tech Debt

- [ ] **Modal pause is unsupported** — Modal sessions cannot use native pause semantics and rely on snapshot + recreate paths (`packages/shared/src/providers/modal-libmodal.ts`).
- [ ] **E2B resume fallback is silent** — failed `Sandbox.connect(snapshotId)` falls back to fresh sandbox creation without user-visible warning (`packages/shared/src/providers/e2b.ts`).
- [ ] **Immediate sandbox creation path does not inject gateway callback env vars by default** — `session-creator` direct `provider.createSandbox()` path omits `SANDBOX_MCP_AUTH_TOKEN`, `PROLIFERATE_GATEWAY_URL`, and `PROLIFERATE_SESSION_ID`, while tool callbacks/sandbox-mcp auth depend on them (`apps/gateway/src/lib/session-creator.ts`, `apps/gateway/src/hub/session-runtime.ts`, `packages/shared/src/opencode-tools/index.ts`, `packages/shared/src/providers/*.ts`).
- [ ] **Freshness logic is duplicated across layers** — providers run cadence-aware pull-on-restore, and runtime also runs a best-effort pull from `/home/user/workspace`; this creates overlap and uneven multi-repo behavior (`packages/shared/src/providers/*.ts`, `apps/gateway/src/hub/session-runtime.ts`).
- [ ] **E2B setup parity gap** — E2B provider currently does not write SSH authorized keys or trigger context files, unlike Modal (`packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/modal-libmodal.ts`).
- [ ] **`resolveSnapshotId()` is currently not on the primary session-start path** — runtime/session-creator consume snapshot IDs directly from resolved configuration/session state, leaving this utility as a pure helper/test surface (`packages/shared/src/snapshot-resolution.ts`, `apps/gateway/src/lib/configuration-resolver.ts`, `apps/gateway/src/lib/session-creator.ts`).
- [ ] **Setup-only tool cleanup is reactive** — non-setup sessions remove setup-only tools during restore instead of pre-snapshot scrubbing (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- [ ] **sandbox-mcp/service processes are fire-and-forget** — no built-in supervisor for OpenCode, Caddy, or sandbox-mcp after provider startup (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- [ ] **Service-manager state is `/tmp`-backed** — persistence characteristics differ across provider lifecycle semantics and are not durable across fresh sandbox recreation (`packages/sandbox-mcp/src/service-manager.ts`).

---

## Source: `docs/specs/sessions-gateway.md`

# Sessions & Gateway — System Spec

## 1. Scope & Purpose

### In Scope
- Session lifecycle orchestration: create, eager-start, pause, snapshot, stop, status, delete, rename.
- Gateway runtime orchestration: hub ownership, sandbox lifecycle, OpenCode session lifecycle, SSE streaming, reconnect.
- Distributed safety primitives: owner/runtime leases, migration locks, CAS/fencing writes, orphan sweep recovery.
- Real-time protocol surface: WebSocket session protocol, HTTP prompt/cancel/info/status/tool routes.
- Gateway-intercepted tool execution over synchronous sandbox callbacks.
- Expiry/idle behavior: BullMQ expiry jobs, idle snapshotting, automation transcript-preserving completion.
- Session telemetry capture and flush pipeline (`metrics`, `pr_urls`, `latest_task`).
- Devtools and OpenCode proxying via gateway (`/proxy/*`) including sandbox-mcp auth token injection.
- Gateway client library contracts (`packages/gateway-clients`) used by web and workers.
- Session-focused web surfaces backed by the above contracts (session list, peek drawer, inbox session context).

### Out of Scope
- Sandbox provider internals (Modal/E2B implementation details, image contents, provider deployment) — see `sandbox-providers.md`.
- Tool schemas/prompt contract and capability policy — see `agent-contract.md`.
- Automation run DAG, scheduling, and notification fanout — see `automations-runs.md`.
- Repo/configuration CRUD and prebuild policy — see `repos-prebuilds.md`.
- OAuth connection lifecycle and Nango sync — see `integrations.md`.
- Billing policy design and pricing semantics — see `billing-metering.md`.

### Mental Models
- **Control plane vs stream plane:** Next.js/oRPC/API routes create and mutate metadata; live model streaming is only Client ↔ Gateway ↔ Sandbox.
- **Session record vs hub vs runtime:** DB session row is durable metadata; `SessionHub` is per-process coordination state; `SessionRuntime` owns sandbox/OpenCode/SSE readiness.
- **Creation vs activation:** Creating a session record does not guarantee a sandbox exists. Runtime activation happens when a hub ensures readiness (or eager-start runs).
- **Ownership vs liveness:** Owner lease answers "which gateway instance may act"; runtime lease answers "is there a live runtime heartbeat".
- **Idle is a predicate, not just "no sockets":** idle snapshot requires no WS clients, no proxy clients, no active HTTP tool callbacks, no running tools, and grace-period satisfaction; assistant-turn gating can also be satisfied by explicit agent-idle signals.
- **Migration/snapshot writes are fenced:** DB transitions that depend on a specific sandbox use CAS (`updateWhereSandboxIdMatches`) so stale actors cannot clobber newer state.
- **Recovery is multi-path:** runtime reconnect and expiry are job-driven; orphan cleanup is DB-first + runtime-lease-based and works even when no hub exists in memory.
- **Automation sessions are logically active even when headless:** automation client type is treated as active for expiry decisions, but SSE auto-reconnect is skipped while no WS client is attached.
- **Automation sessions are excluded from idle snapshotting:** idle-snapshot predicates do not apply to `client_type="automation"` sessions, which are worker-managed.

### Things Agents Get Wrong
- Assuming API routes are in the token streaming path. They are not.
- Assuming one creation path. There are two materially different pipelines: gateway HTTP creation and web oRPC creation.
- Assuming session creation always provisions sandboxes. Deferred mode and oRPC create both return before provisioning.
- Assuming `userId` from client payload is trusted. The hub derives identity from authenticated connection/auth context.
- Assuming owner lease is optional or post-runtime. Lease acquisition gates runtime lifecycle work.
- Assuming runtime lease implies ownership. It is a liveness heartbeat, not ownership authority.
- Assuming expiry migration is triggered by an in-process timer. Current code relies on BullMQ delayed jobs plus local lifecycle decisions.
- Assuming hub eviction/hard-cap LRU exists centrally. Current `HubManager` is a registry + lifecycle hooks; eviction is explicit via hub callbacks.
- Assuming tool callback idempotency is global. It is in-memory per gateway process.
- Assuming SSE carries bidirectional traffic. SSE is read-only (sandbox → gateway); prompts/cancel are HTTP.
- Assuming preview/devtools proxies can skip session readiness checks. Most proxy routes require runtime readiness to resolve targets.
- Assuming markdown summaries are safe to render raw. UI must use sanitized markdown renderer.

---

## 2. Core Concepts

### Hub Manager
`HubManager` is an in-process registry keyed by session ID.

- `getOrCreate(sessionId)` deduplicates concurrent constructors via a pending promise map.
- Hub creation always starts by loading fresh DB-backed session context.
- `remove(sessionId)` is lifecycle cleanup entrypoint for in-memory hub references.
- `releaseAllLeases()` performs best-effort telemetry flush and stops hub monitors during shutdown.

References: `apps/gateway/src/hub/hub-manager.ts`, `apps/gateway/src/server.ts`

### Session Ownership + Runtime Leases
Redis leases coordinate multi-instance safety.

- Owner lease key: `lease:owner:{sessionId}` (30s TTL). Required for runtime lifecycle authority.
- Runtime lease key: `lease:runtime:{sessionId}` (20s TTL). Used for liveness/orphan detection.
- Owner renewals use Lua check-and-extend to avoid race conditions.
- Lease cleanup is owner-aware; hubs that never owned must not clear shared runtime lease state.

References: `apps/gateway/src/lib/session-leases.ts`, `apps/gateway/src/hub/session-hub.ts`

### Split-Brain Lag Guard
Lease renewal is event-loop-sensitive.

- If renewal lag exceeds owner lease TTL, hub self-terminates to avoid split-brain execution.
- Self-termination drops clients, stops migration/idle monitors, disconnects SSE, and evicts hub.

Reference: `apps/gateway/src/hub/session-hub.ts`

### Runtime Boundary
`SessionRuntime` owns the actual runtime state machine.

- Single-flight `ensureRuntimeReady()` coalesces concurrent callers.
- Context is reloaded from DB on readiness attempts.
- Runtime waits migration lock release (unless skip flag during controlled migration re-init).
- Runtime always goes through provider abstraction (`ensureSandbox`) instead of direct create calls.

Reference: `apps/gateway/src/hub/session-runtime.ts`

### Session Creation Paths
There are two intentional creation paths.

- Gateway HTTP (`POST /proliferate/sessions`): configuration resolution, optional immediate sandbox, integration/session connections, Redis idempotency envelope.
- Web oRPC (`sessions.create`): lightweight DB-centric path (including scratch sessions) that may trigger eager-start asynchronously.

References: `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions-create.ts`

### SSE Bridge
SSE is transport-only and unidirectional.

- Gateway connects to sandbox `GET /event` and parses events with `eventsource-parser`.
- Hub owns reconnect strategy and policy; `SseClient` does not reconnect on its own.
- Heartbeat/read timeout failures map to disconnect reasons that drive hub reconnect logic.

References: `apps/gateway/src/hub/sse-client.ts`, `apps/gateway/src/hub/session-hub.ts`

### Migration + Idle + Orphan Recovery
Migration and cleanup are lock/fencing-driven.

- Expiry jobs are scheduled with BullMQ using `expiresAt - GRACE_MS` delay.
- Migration and idle snapshot flows are protected by distributed migration lock.
- Idle/orphan writes fence against stale sandbox IDs via CAS update methods.
- Orphan sweeper is DB-first and runtime-lease-based, so recovery works post-restart with empty hub map.

References: `apps/gateway/src/expiry/expiry-queue.ts`, `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`

### Gateway-Intercepted Tool Callbacks
Intercepted tools execute through HTTP callbacks, not SSE interception.

- Route: `POST /proliferate/:sessionId/tools/:toolName`.
- Auth source must be sandbox HMAC token.
- Idempotency is per-process (`inflightCalls` + `completedResults` cache with retention).

References: `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`

---

## 5. Conventions & Patterns

### Do
- Obtain hubs via `hubManager.getOrCreate()` only.
- Treat `SessionHub.ensureRuntimeReady()` as the lifecycle gate for runtime availability.
- Use `createSyncClient()` for programmatic gateway access.
- Use `GIT_READONLY_ENV` for read-only git operations to avoid index lock contention.

### Don't
- Do not route real-time tokens through Next.js API routes.
- Do not trust caller-supplied `userId` in WS/HTTP prompt payloads when auth already establishes identity.
- Do not call provider sandbox creation primitives directly from hub lifecycle code; use runtime/provider orchestration entrypoints.
- Do not mutate session state on snapshot/migration paths without lock + CAS safeguards.

### Error Handling
- Route-level operational failures should throw `ApiError` for explicit status and details.
- Billing gate failures map to 402 via `BillingGateError` handling.
- Unknown/unexpected exceptions are logged and returned as 500.

Reference: `apps/gateway/src/middleware/error-handler.ts`

### Reliability
- **SSE read timeout**: Configurable via `env.sseReadTimeoutMs`. Stream read uses `readWithTimeout()` to detect stuck connections.
- **Heartbeat monitoring**: `SseClient` checks for event activity every ~`heartbeatTimeoutMs / 3`. Exceeding the timeout triggers reconnection.
- **Reconnection**: Exponential backoff via `env.reconnectDelaysMs` array. Headless automation sessions (`client_type="automation"` with no WS clients) skip auto-reconnect on SSE disconnect to avoid OpenCode session churn; reconnect happens when a client explicitly attaches.
- **SSE disconnect continuity**: Runtime preserves OpenCode session identity across transient SSE disconnects and re-validates the stored OpenCode session ID on reconnect before creating a replacement.
- **Ownership lease**: A hub must hold a Redis ownership lease (`lease:owner:{sessionId}`) to act as the session owner; renewed by heartbeat (~10s interval) while the hub is alive. Lease loss triggers split-brain suicide (see §2).
- **Runtime lease**: Sandbox-alive signal (`lease:runtime:{sessionId}`) with 20s TTL, set after successful runtime boot and used for orphan detection.
- **Hub eviction**: Hubs are evicted on idle TTL (no connected WS clients) and under a hard cap (LRU) to bound memory usage. `HubManager.remove()` is called via `onEvict` callback.
- **Session create idempotency**: DB-based via `sessions.idempotency_key` column. Redis-based idempotency (`idempotency.ts`) still exists as a legacy path.
- **Initial prompt reliability**: `maybeSendInitialPrompt()` uses an in-memory `initialPromptSending` guard to prevent concurrent sends (eager start + runtime init), marks `initial_prompt_sent_at` before dispatch to avoid duplicates, and rolls that DB marker back on send failure so a later runtime init can retry. The in-memory guard is always reset in a `finally` block.
- **Tool call idempotency**: In-memory `inflightCalls` + `completedResults` maps per process, keyed by `tool_call_id`, with 5-minute retention for completed results.
- **Tool result patching**: `updateToolResult()` retries up to 5x with 1s delay (see `agent-contract.md` §5).
- **Migration lock**: Distributed Redis lock prevents concurrent migrations for the same session. Active expiry migrations use a 120s TTL to cover OpenCode stop + scrub/snapshot/re-apply + runtime bring-up critical path.
- **Expiry triggers**: Hub schedules an in-process expiry timer (primary) plus a BullMQ job as a fallback for evicted hubs.
- **Expiry timestamp source-of-truth**: Newly created sandboxes use provider-reported expiry only; stored DB expiry is reused only when recovering the same sandbox ID.
- **Snapshot secret scrubbing**: All snapshot capture paths (`save_snapshot`, idle snapshot, expiry migration, web `sessions.pause`, web `sessions.snapshot`) run `proliferate env scrub` before capture when env-file spec is configured. Paths that continue running the same sandbox re-apply env files after capture; pause/stop paths skip re-apply.
- **Scrub failure policy**: Manual snapshots use strict scrub mode (scrub failure aborts capture). Idle/expiry paths use best-effort scrub mode (log and continue) so pause/stop cleanup is not blocked by scrub command failures.
- **Streaming backpressure**: Token batching (50-100ms) and slow-consumer disconnect based on `ws.bufferedAmount` thresholds.
- **Idle snapshot failure circuit-breaker**: Force-terminates after repeated failures to prevent runaway spend.
- **Automation idle-snapshot exclusion**: `SessionHub.shouldIdleSnapshot()` hard-returns `false` for `client_type="automation"` to avoid terminate/recreate thrash loops.
- **Orphan sweeper terminal-sandbox handling**: If provider snapshot calls return `FAILED_PRECONDITION` (`Sandbox has already finished`), sweeper treats the sandbox as terminal and CAS-pauses the session instead of retrying snapshot.

### Testing Conventions
- Colocate gateway tests near source.
- Mock sandbox providers and lease/tool dependencies for deterministic lifecycle tests.
- Validate lease ordering and prompt idempotency behaviors explicitly (existing test patterns).

References: `apps/gateway/src/hub/session-hub.test.ts`, `apps/gateway/src/api/proliferate/ws/ws-handler.test.ts`, `apps/gateway/src/hub/session-telemetry.test.ts`

---

## 6. Subsystem Deep Dives

### 6.1 Session Creation — `Implemented`

**What it does:** Creates a session record and optionally provisions a sandbox.

**Gateway HTTP path** (`POST /proliferate/sessions`):
1. Auth middleware validates JWT/CLI token (`apps/gateway/src/middleware/auth.ts:createRequireAuth`).
2. Route validates required configuration option (`apps/gateway/src/api/proliferate/http/sessions.ts`).
3. `resolveConfiguration()` resolves or creates a configuration record (`apps/gateway/src/lib/configuration-resolver.ts`).
4. `createSession()` writes DB record, creates session connections, and optionally creates sandbox (`apps/gateway/src/lib/session-creator.ts`).
5. For new managed configurations, fires a setup session with auto-generated prompt.
6. Immediate sandbox boot now injects the same gateway callback env vars used by runtime resume (`SANDBOX_MCP_AUTH_TOKEN`, `PROLIFERATE_GATEWAY_URL`, `PROLIFERATE_SESSION_ID`) so intercepted tools (including `automation.complete`) work on first boot.
7. Immediate sandbox boot persists provider expiry (`sandbox_expires_at`) on the initial session update, instead of waiting for a later runtime reconciliation pass.

**Scratch sessions** (no configuration):
- `configurationId` is optional in `CreateSessionInputSchema`. When omitted, the oRPC path creates a **scratch session** with `configurationId: null`, `snapshotId: null`.
- `sessionType: "setup"` is rejected at schema level (via `superRefine`) when configuration is absent — setup sessions always require a configuration.
- Gateway `loadSessionContext()` handles `configuration_id = null` with an early-return path: `repos: []`, synthetic scratch `primaryRepo`, `getScratchSystemPrompt()`, `snapshotHasDeps: false`.

**oRPC path** (`apps/web/src/server/routers/sessions.ts`):
- `create` → calls `createSessionHandler()` (`sessions-create.ts`) which writes a DB record only. This is a **separate, lighter pipeline** than the gateway HTTP route — no session connections, no sandbox provisioning.
- Setup-session entry points in web (`dashboard/configurations`, `snapshot-selector`, `configuration-group`) pass `initialPrompt: getSetupInitialPrompt()`. `createSessionHandler()` persists this and calls gateway `eagerStart()` so setup work begins automatically before the user types.
- Setup-session UI is explicit and persistent: `SetupSessionChrome` renders a checklist describing the two required user actions (iterate with the agent until verification, and configure secrets in Environment), and setup right-panel empty state reinforces the same flow.
- When the agent calls `request_env_variables`, the web runtime opens the Environment panel and the tool UI also renders an `Open Environment Panel` CTA card so users can reopen it from the conversation. In setup sessions, Environment is **file-based only**: users create secret files with a row-based env editor (`Key`/`Value` columns), can import via `.env` paste/upload, and save by target path. In multi-repo configurations, users must pick a repository/workspace first; the entered file path is interpreted relative to that workspace.
- The Git panel is workspace-aware in multi-repo sessions: users choose the target repository/workspace, and git status + branch/commit/push/PR actions are scoped to that `workspacePath`.
- `pause` → loads session, runs shared snapshot scrub prep (`prepareForSnapshot`, best-effort, no re-apply), calls `provider.snapshot()` + `provider.terminate()`, finalizes billing, updates DB status to `"paused"` (`sessions-pause.ts`).
- `resume` → no dedicated handler. Resume is implicit for normal sessions: connecting a WebSocket client to a paused session triggers `ensureRuntimeReady()`, which creates a new sandbox from the stored snapshot.
- `resume` exception (automation-completed) → if `client_type="automation"` and session is terminal (`status in {"paused","stopped"}` with non-null `outcome`), client init/get_messages hydrate transcript without calling `ensureRuntimeReady()`, preventing post-completion OpenCode session identity churn.
- `delete` → calls `sessions.deleteSession()`.
- `rename` → calls `sessions.renameSession()`.
- `snapshot` → calls `snapshotSessionHandler()` (`sessions-snapshot.ts`) which runs shared snapshot scrub prep (`prepareForSnapshot`, strict mode, re-apply after capture) before provider snapshot.
- `submitEnv` → writes secrets to DB, writes env file to sandbox via provider.

**Idempotency:**
- The `sessions` table has an `idempotency_key` TEXT column. When provided, callers can detect duplicate creation attempts.
- Redis-based idempotency (`apps/gateway/src/lib/idempotency.ts`) also exists as a legacy deduplication path for the gateway HTTP route.

**Files touched:** `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions.ts`, `apps/web/src/components/coding-session/setup-session-chrome.tsx`, `apps/web/src/components/coding-session/right-panel.tsx`, `apps/web/src/components/coding-session/environment-panel.tsx`, `apps/web/src/components/coding-session/runtime/message-handlers.ts`

### 6.2 Session Runtime Lifecycle — `Implemented`

**What it does:** Lazily provisions sandbox, OpenCode session, and SSE bridge on first client connect.

**SessionHub pre-step** (`apps/gateway/src/hub/session-hub.ts:ensureRuntimeReady`):
1. Start lease renewal: acquire owner lease (`lease:owner:{sessionId}`) — fail fast if another instance owns this session.
2. Begin heartbeat timer (~10s interval) with split-brain lag guard.
3. Then call `runtime.ensureRuntimeReady()`.
4. On success: set runtime lease, start migration monitor, reset agent idle state.
5. On failure: stop lease renewal to release ownership.

**Happy path** (`apps/gateway/src/hub/session-runtime.ts:doEnsureRuntimeReady`):
1. Wait for migration lock release (`lib/lock.ts:waitForMigrationLockRelease`).
2. Reload `SessionContext` from database (`lib/session-store.ts:loadSessionContext`).
3. Resolve provider, git identity, base snapshot, sandbox-mcp token.
4. Call `provider.ensureSandbox()` — recovers existing or creates new sandbox.
5. Update session DB record with `sandboxId`, `status: "running"`, tunnel URLs.
6. Schedule expiry job via BullMQ (`expiry/expiry-queue.ts:scheduleSessionExpiry`).
7. Ensure OpenCode session exists:
   - First verify stored `coding_agent_session_id` via direct `GET /session/:id` lookup.
   - If not found, fall back to `GET /session` list/adopt, then create only when no reusable session exists.
8. Connect SSE to `{tunnelUrl}/event`.
9. Broadcast `status: "running"` to all WebSocket clients.

**Edge cases:**
- Concurrent `ensureRuntimeReady()` calls coalesce into a single promise (`ensureReadyPromise`) within an instance.
- OpenCode session creation uses bounded retry with exponential backoff for transient transport failures (fetch/socket and retryable 5xx/429), with per-attempt latency logs.
- On direct lookup transport failures, runtime keeps the stored session ID instead of rotating immediately, preventing message-history churn during transient tunnel/list instability.
- Git identity is resolved from `sessions.created_by` (`users.findById`) and exported into sandbox env as `GIT_AUTHOR_*`/`GIT_COMMITTER_*` during both deferred runtime boot and immediate session creation, preventing fallback to provider host identities like `root@modal.(none)`.
- Repo token selection prefers GitHub App installation-backed connections over non-App connections when both are present, and falls back across candidates when a token cannot access the target repository.
- OpenCode session creation emits explicit reason-coded logs when identity rotation is required (`missing_stored_id` / `stored_id_not_found`) so churn can be traced per session lifecycle.
- LLM proxy usage is explicitly gated by `LLM_PROXY_REQUIRED=true`; when false, sandboxes use direct `ANTHROPIC_API_KEY` even if `LLM_PROXY_URL` is present in env.
- E2B auto-pause: if provider supports auto-pause, `sandboxId` is stored as `snapshotId` for implicit recovery.
- Stored tunnel URLs are used as fallback if provider returns empty values on recovery.
- If lease renewal lag exceeds TTL during runtime work, self-terminate immediately to prevent split-brain ownership (see §2 Lease Heartbeat Lag Guard).

**Files touched:** `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/lib/session-store.ts`

### 6.3 Event Processing Pipeline — `Implemented`

**What it does:** Translates OpenCode SSE events into client-facing `ServerMessage` payloads.

**Event types handled** (`apps/gateway/src/hub/event-processor.ts:process`):

| SSE Event | Client Message(s) | Notes |
|-----------|-------------------|-------|
| `message.updated` (assistant) | `message` (new) | Creates assistant message stub |
| `message.part.updated` (text) | `token`, `text_part_complete` | Streaming tokens |
| `message.part.updated` (tool-like) | `tool_start`, `tool_metadata`, `tool_end` | Any part carrying `callID` + `tool` is treated as a tool lifecycle event |
| `session.idle` / `session.status` (idle) | `message_complete` | Marks assistant done and records known-idle even if assistant message ID is retained for dedup |
| `session.error` | `error` | Skips `MessageAbortedError` |
| `server.connected`, `server.heartbeat` | (ignored) | Transport-level |

**Tool events:**
- The SSE tool lifecycle events (`tool_start` / `tool_metadata` / `tool_end`) are forwarded to clients as UI observability.
- `tool_metadata` deduplication keys on task-summary content (title + per-item status/title signature), not just summary length, so in-place progress changes continue streaming to clients during long-running task tools.
- If a tool is running with no metadata/output updates, the gateway emits periodic `status: "running"` heartbeat messages with elapsed-time context so clients can show liveness during long tasks.
- Gateway-mediated tools are executed via synchronous sandbox callbacks (`POST /proliferate/:sessionId/tools/:toolName`) rather than SSE interception. Idempotency is provided by in-memory `inflightCalls` + `completedResults` maps, keyed by `tool_call_id`. Invocations are also persisted in `session_tool_invocations`.
- See `agent-contract.md` for the tool callback contract and tool schemas.

**Files touched:** `apps/gateway/src/hub/event-processor.ts`, `apps/gateway/src/hub/session-hub.ts`

### 6.3a Session Telemetry — `Implemented`

**What it does:** Passively captures session metrics (tool calls, messages, active time), PR URLs, and latest agent task during gateway event processing, then periodically flushes to the DB.

**Architecture:**

Each `SessionHub` owns a `SessionTelemetry` instance (pure in-memory counter class). The EventProcessor fires optional callbacks on key events; the hub wires these to telemetry recording methods.

| Event | Callback | Telemetry method |
|-------|----------|-----------------|
| First tool event per `toolCallId` | `onToolStart` | `recordToolCall(id)` — deduplicates via `Set` |
| Assistant message idle | `onMessageComplete` | `recordMessageComplete()` — increments delta counter |
| User prompt sent | (direct call in `handlePrompt`) | `recordUserPrompt()` — increments delta counter |
| Text part complete | `onTextPartComplete` | `extractPrUrls(text)` → `recordPrUrl(url)` for each |
| Tool metadata with title | `onToolMetadata` | `updateLatestTask(title)` — dirty-tracked |
| Git PR creation | (direct call in `handleGitAction`) | `recordPrUrl(result.prUrl)` |

**Active time tracking:** `startRunning()` records a timestamp; `stopRunning()` accumulates elapsed seconds into a delta counter. Both are idempotent — repeated `startRunning()` calls don't reset the timer.

**Flush lifecycle (single-flight mutex):**

1. `getFlushPayload()` snapshots current deltas (tool call IDs, message count, active seconds including in-flight time, new PR URLs, dirty latestTask). Returns `null` if nothing is dirty.
2. `flushFn()` calls `sessions.flushTelemetry()` — SQL-level atomic increment for metrics, JSONB append with dedup for PR URLs.
3. `markFlushed(payload)` subtracts only the captured snapshot from deltas (differential approach), preserving any data added during the async flush.

If a second `flush()` is called while one is in progress, it queues exactly one rerun — no data loss, no double-counting.

**Flush points** (all wrapped in `try/catch`, best-effort):

| Trigger | Location | Notes |
|---------|----------|-------|
| Idle snapshot | `migration-controller.ts` before CAS write | `stopRunning()` + flush |
| Expiry migration | `migration-controller.ts` before CAS write | `stopRunning()` + flush |
| Automation terminate | `session-hub.ts:terminateForAutomation()` | `stopRunning()` + flush |
| Force terminate | `migration-controller.ts:forceTerminate()` | Best-effort flush |
| Graceful shutdown | `hub-manager.ts:releaseAllLeases()` | Parallel flush per hub, bounded by 5s shutdown timeout |

**DB method:** `sessions.flushTelemetry(sessionId, delta, newPrUrls, latestTask)` uses SQL-level `COALESCE + increment` to avoid read-modify-write races:

```sql
UPDATE sessions SET
  metrics = jsonb_build_object(
    'toolCalls', COALESCE((metrics->>'toolCalls')::int, 0) + $delta,
    'messagesExchanged', COALESCE((metrics->>'messagesExchanged')::int, 0) + $delta,
    'activeSeconds', COALESCE((metrics->>'activeSeconds')::int, 0) + $delta
  ),
  pr_urls = (SELECT COALESCE(jsonb_agg(DISTINCT val), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(pr_urls, '[]'::jsonb) || $new) AS val),
  latest_task = $latest_task
WHERE id = $session_id
```

**Outcome derivation:** Set at explicit terminal call sites, not in generic `markStopped()`:

| Path | Outcome | Location |
|------|---------|----------|
| `automation.complete` tool | From completion payload | `automation-complete.ts` — persists and marks session `paused` |
| CLI stop | `"completed"` | `cli/db.ts:stopSession`, `stopAllCliSessions` |
| Force terminate (circuit breaker) | `"failed"` | `migration-controller.ts:forceTerminate` |

**latestTask clearing:** All 12 non-hub write paths that transition sessions away from active states set `latestTask: null` to prevent zombie text (billing pause, manual pause, CLI stop, orphan sweeper, migration CAS).

**Files touched:** `apps/gateway/src/hub/session-telemetry.ts`, `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/hub/event-processor.ts`, `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/hub/hub-manager.ts`, `packages/services/src/sessions/db.ts`

### 6.4 WebSocket Protocol — `Implemented`

**What it does:** Bidirectional real-time communication between browser clients and the gateway.

**Connection**: `WS /proliferate/:sessionId?token=<JWT>` (`apps/gateway/src/api/proliferate/ws/index.ts`).

**Multi-instance behavior:** If the request lands on a non-owner gateway instance, the hub will fail to acquire the owner lease and the connection attempt will fail, prompting the client to reconnect. With L7 sticky routing (recommended), this should be rare.

**Client → Server messages** (`session-hub.ts:handleClientMessage`):

| Type | Auth | Description |
|------|------|-------------|
| `ping` | Connection | Returns `pong` |
| `prompt` | userId required | Sends prompt to OpenCode |
| `cancel` | userId required | Aborts OpenCode session |
| `get_status` | Connection | Returns current status |
| `get_messages` | Connection | Re-sends init payload (for automation-completed sessions, serves transcript without runtime resume) |
| `save_snapshot` | Connection | Triggers snapshot |
| `run_auto_start` | userId required | Tests service commands |
| `get_git_status` | Connection | Returns git status |
| `git_create_branch` | Mutation auth | Creates branch |
| `git_commit` | Mutation auth | Commits changes |
| `git_push` | Mutation auth | Pushes to remote |
| `git_create_pr` | Mutation auth | Creates pull request |

**Mutation auth**: Requires `userId` to match `session.created_by` (or `created_by` is null for headless sessions). Source: `session-hub.ts:assertCanMutateSession`.

**Server → Client messages**: `status`, `message`, `token`, `text_part_complete`, `tool_start`, `tool_metadata`, `tool_end`, `message_complete`, `message_cancelled`, `error`, `snapshot_result`, `init`, `preview_url`, `git_status`, `git_result`, `auto_start_output`, `pong`.

### 6.5 Session Migration — `Implemented`

**What it does:** Handles sandbox expiry by snapshotting and optionally creating a new sandbox.

**Guards:**
1. Ownership lease: only the session owner may migrate.
2. Migration lock: distributed Redis lock with path-specific TTL prevents concurrent migrations for the same session (120s for active expiry migrations).

**Expiry triggers:**
1. Primary: in-process timer on the hub (fires at expiry minus `GRACE_MS`).
2. Fallback: BullMQ job `"session-expiry"` (needed when the hub was evicted before expiry). Job delay: `max(0, expiresAtMs - now - GRACE_MS)`. Worker calls `hub.runExpiryMigration()`.

**Active migration (clients connected):**
1. Acquire distributed lock (120s TTL).
2. Wait for agent message completion (30s timeout), abort if still running.
3. Scrub configured env files from sandbox, snapshot current sandbox, then re-apply env files.
4. Disconnect SSE, reset sandbox state.
5. Call `ensureRuntimeReady()` — creates new sandbox from snapshot.
6. Broadcast `status: "running"`.

**Idle migration (no clients):**
1. Acquire lock, stop OpenCode.
2. Guard against false-idle by checking `shouldIdleSnapshot()` (accounts for `activeHttpToolCalls > 0` and proxy connections).
3. Scrub configured env files, then pause (if E2B) or snapshot + terminate (if Modal).
4. Update DB with CAS fencing: `status: "paused"` and snapshot metadata; if terminate fails after snapshot, keep `sandboxId` pointer so later cleanup remains fenced.
5. Clean up hub state, call `onEvict` for memory reclamation.

**Orphan sweep snapshot path (no local hub):**
1. Acquire migration lock + re-validate no lease and `status="running"`.
2. Reuse `prepareForSnapshot()` before memory/pause/filesystem capture (best-effort `failureMode="log"`, `reapplyAfterCapture=false`).
3. Capture snapshot via memory/pause/filesystem path, then CAS-update session state.

**Automation completion behavior:**
- If `automation.complete` is invoked, the run is finalized and session outcome/summary are persisted.
- The gateway marks the session `paused` immediately (with `pauseReason="automation_completed"`) to prevent headless reconnect/orphan churn from rotating OpenCode session IDs.
- Runtime is not force-terminated in the completion handler, so users can open the automation session and inspect transcript history.
- For completed automation sessions, WebSocket init/get_messages do not auto-resume runtime; the guard keys off terminal automation status + non-null `outcome` (not `pauseReason`) so generic sweeps cannot disable transcript protection.
- Completed automation prompts are blocked for both HTTP and WebSocket paths to prevent accidental runtime wake-ups after completion.
- Normal expiry/cleanup paths still apply.

**Circuit breaker:** After `MAX_SNAPSHOT_FAILURES` (3) consecutive idle snapshot failures, the migration controller stops attempting further snapshots.

Source: `apps/gateway/src/hub/migration-controller.ts`

### 6.6 Git Operations — `Implemented`

**What it does:** Stateless helper translating git commands into sandbox `execCommand` calls.

**Operations** (`apps/gateway/src/hub/git-operations.ts`):
- `getStatus()` — parallel `git status --porcelain=v2`, `git log`, and plumbing probes for busy/shallow/rebase/merge state.
- `createBranch()` — pre-checks existence, then `git checkout -b`.
- `commit()` — stages files (selective, tracked-only, or all), checks for empty diff, commits.
- `push()` — detects upstream, selects push strategy, handles shallow clone errors with `git fetch --deepen`.
- `createPr()` — pushes first, then `gh pr create`, retrieves PR URL via `gh pr view --json`.
- Before each git action/status request, the hub refreshes git context from `loadSessionContext()` so per-repo integration tokens are re-resolved and not pinned to session-start values.

**Security**: `resolveGitDir()` validates workspace paths stay within `/home/user/workspace/`. All commands use `GIT_TERMINAL_PROMPT=0` and `GIT_ASKPASS=/bin/false` to prevent interactive prompts.
**Commit identity**: `GitOperations` merges session git identity into command env (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`) so commit actions succeed even when repo/global git config is absent.
**Push/PR auth resilience**: `GitOperations` refreshes `/tmp/.git-credentials.json` from current session repo tokens before push, injects `GIT_TOKEN`/`GH_TOKEN` env fallbacks, and supports URL variants (`.git`, no suffix, trailing slash) to avoid credential-helper lookup misses.

### 6.7 Port Forwarding Proxy — `Implemented`

**What it does:** Proxies HTTP requests from the client to sandbox ports via the OpenCode tunnel URL.

**Route**: `GET/POST /proxy/:sessionId/:token/opencode/*` (`apps/gateway/src/api/proxy/opencode.ts`).

Auth is token-in-path (required for SSE clients that can't set headers). `createRequireProxyAuth()` validates the token. `createEnsureSessionReady()` ensures the hub and sandbox are ready. `http-proxy-middleware` forwards to the sandbox OpenCode URL with path rewriting.

### 6.8 Gateway Client Libraries — `Implemented`

**What it does:** TypeScript client libraries for programmatic gateway access.

**Factory**: `createSyncClient({ baseUrl, auth, source })` from `packages/gateway-clients`.

**SyncClient API**:
- `createSession(request)` → `POST /proliferate/sessions` with optional idempotency key.
- `connect(sessionId, options)` → WebSocket with auto-reconnection (exponential backoff, max 10 attempts).
- `postMessage(sessionId, { content, userId, source })` → `POST /proliferate/:sessionId/message`.
- `postCancel(sessionId)` → `POST /proliferate/:sessionId/cancel`.
- `getInfo(sessionId)` → `GET /proliferate/:sessionId`.
- `getSessionStatus(sessionId)` → `GET /proliferate/sessions/:sessionId/status`.

**Auth modes**: `ServiceAuth` (HS256 JWT signing with service name) or `TokenAuth` (pre-existing token string).

**WebSocket reconnection defaults**: `maxAttempts: 10`, `baseDelay: 1000ms`, `maxDelay: 30000ms`, `backoffMultiplier: 2`.

Source: `packages/gateway-clients/src/`

### 6.9 Gateway Middleware — `Implemented`

**Auth** (`apps/gateway/src/middleware/auth.ts`):
Token verification chain: (1) User JWT (signed with `gatewayJwtSecret`), (2) Service JWT (signed with `serviceToken`, must have `service` claim), (3) Sandbox HMAC token (HMAC-SHA256 of `serviceToken + sessionId`), (4) CLI API key (HTTP call to web app for DB lookup).

**CORS** (`apps/gateway/src/middleware/cors.ts`): Allows all origins (`*`), methods `GET/POST/PATCH/DELETE/OPTIONS`, headers `Content-Type/Authorization/Accept`, max-age 86400s.

**Error handler** (`apps/gateway/src/middleware/error-handler.ts`): Catches `ApiError` for structured JSON responses. Unhandled errors logged via `@proliferate/logger` and returned as 500.

### 6.10 Session UI Surfaces — `Implemented`

**Session list rows** (`apps/web/src/components/sessions/session-card.tsx`): Enriched with Phase 2a telemetry. Active rows show `latestTask` as subtitle; idle rows show `latestTask` → `promptSnippet` fallback; completed/failed rows show outcome label + compact metrics + PR count. An outcome badge appears for non-"completed" outcomes. A `GitPullRequest` icon + count shows when `prUrls` is populated. Sessions list now includes a dedicated **Configuration** column (short `configurationId`, fallback "No config") rendered for every row on desktop widths. The row accepts an optional `onClick` prop — when provided, it fires the callback instead of navigating directly. The sessions page uses this to open the peek drawer; other pages (my-work) omit it and navigate to `/workspace/:id`.

**Session display helpers** (`apps/web/src/lib/session-display.ts`): Pure formatting functions: `formatActiveTime(seconds)`, `formatCompactMetrics({toolCalls, activeSeconds})`, `getOutcomeDisplay(outcome)`, `formatConfigurationLabel(configurationId)`, `parsePrUrl(url)`. Used across session list rows, peek drawer, and my-work pages.

**Session peek drawer** (`apps/web/src/components/sessions/session-peek-drawer.tsx`): URL-routable right-side sheet. Opened via `?peek=<sessionId>` query param on the sessions page (`apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`). Content sections: header (title + status + outcome), initial prompt, sanitized summary markdown, PR links, metrics grid, timeline, and context (repo/branch/automation). Footer has "Enter Workspace" or "Resume Session" CTA. Uses `useSessionData(id)` for detail data (includes `initialPrompt`). The sessions page wraps its content in `<Suspense>` for `useSearchParams()`.

**Coding session thread status banner** (`apps/web/src/components/coding-session/thread.tsx`, `apps/web/src/components/coding-session/runtime/use-session-websocket.ts`): When gateway sends `status` with a non-empty `message` (including long-task heartbeat updates), the thread renders an inline progress banner above the composer; it clears when tool output resumes (`tool_metadata` / `tool_end`) or the assistant turn completes.

**Sanitized markdown** (`apps/web/src/components/ui/sanitized-markdown.tsx`): Reusable markdown renderer using `react-markdown` + `rehype-sanitize` with a restrictive schema: allowed tags limited to structural/inline elements (no `img`, `iframe`, `script`, `style`), `href` restricted to `http`/`https` protocols (blocking `javascript:` URLs). Optional `maxLength` prop for truncation. Used to render LLM-generated `session.summary` safely.

**Inbox run triage enrichment** (`apps/web/src/components/inbox/inbox-item.tsx`): Run triage cards show session telemetry context — `latestTask`/`promptSnippet` fallback, sanitized summary (via `SanitizedMarkdown`), compact metrics, and PR count. The shared `getRunStatusDisplay` from `apps/web/src/lib/run-status.ts` is used consistently across inbox, activity, and my-work pages (replacing duplicated local helpers). Approval cards show `latestTask` context from the associated session.

**Activity + My-Work consistency**: Activity page (`apps/web/src/app/(command-center)/dashboard/activity/page.tsx`) shows session title or trigger name for each run instead of a generic "Automation run" label. My-work claimed runs show session title or status label. Both use the shared `getRunStatusDisplay` mapping.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sandbox-providers.md` | This → Provider | `ensureSandbox`, `snapshot`, `pause`, `terminate`, `memorySnapshot` | Runtime and migration delegate all sandbox lifecycle operations via provider abstraction |
| `agent-contract.md` | This → Tool contract | `/proliferate/:sessionId/tools/:toolName` | Gateway-intercepted tools execute through synchronous HTTP callbacks |
| `automations-runs.md` | Runs → This | `createSyncClient().createSession/postMessage` | Automation worker bootstraps sessions through gateway client contracts |
| `actions.md` | Shared surface | `/proliferate/:sessionId/actions/*` | Action invocation and approval lifecycle references session context and hub broadcast |
| `repos-prebuilds.md` | This → Config | `resolveConfiguration`, configuration repo/service command APIs | Gateway creation/runtime path depends on configuration resolution outputs |
| `secrets-environment.md` | This ← Secrets | `sessions.buildSandboxEnvVars`, configuration env file spec | Session runtime/build paths hydrate env vars and file instructions from services |
| `integrations.md` | This ↔ Integrations | repo/session connection token resolution | Gateway/session-store resolve git + provider tokens through integration services |
| `billing-metering.md` | This ↔ Billing | `assertBillingGateForOrg`, `checkBillingGateForOrg`, billing columns | Creation and resume are gate-protected; telemetry/status feed metering lifecycle |

### Security & Auth
- Auth sources supported by gateway: user JWT, service JWT, sandbox HMAC token, CLI API key.
- Proxy auth uses path token because some clients cannot attach headers for upgrade/streaming paths.
- Sandbox callback/tool routes require sandbox auth source explicitly.
- Session mutation operations guard against unauthorized user mutation even after connection auth.

References: `apps/gateway/src/middleware/auth.ts`, `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/session-hub.ts`

### Observability
- Structured logs are namespaced by gateway module (`hub`, `runtime`, `migration`, `sse-client`, etc.).
- Runtime readiness logs latency breakdown for major lifecycle stages.
- HTTP layer uses request logging via `pino-http` wrapper.

References: `apps/gateway/src/server.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/hub/sse-client.ts`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tests pass (`pnpm -C apps/gateway test`)
- [ ] Gateway client tests pass (`pnpm -C packages/gateway-clients test`)
- [ ] Deep Dives section is invariant-based (no imperative step-runbooks)
- [ ] Legacy "File Tree" and "Data Models" sections are removed from this spec

---

## 9. Known Limitations & Tech Debt

- [ ] **No immutable `boot_snapshot` persistence model in current session schema** — runtime policy/context is assembled from live session/config/integration state at boot time; there is no dedicated frozen JSON envelope column on `sessions` today. Evidence: `packages/db/src/schema/sessions.ts`, `apps/gateway/src/lib/session-store.ts`.
- [ ] **Credential refresh semantics are distributed across runtime paths** — token refresh behaviors exist (for example git credential rewrites before pull/push), but there is no single "rehydrate all short-lived credentials on every resume" contract boundary. Evidence: `packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `apps/gateway/src/hub/git-operations.ts`.
- [ ] **Hub memory growth is lifecycle-driven, not cap-driven** — current `HubManager` has no explicit hard-cap/LRU policy; cleanup depends on hub lifecycle callbacks and shutdown.
- [ ] **Expiry migration trigger is queue-driven** — there is no separate in-process precise expiry timer in current gateway runtime path.
- [ ] **Tool callback idempotency is process-local** — duplicate callbacks routed to different pods can bypass in-memory dedup.
- [ ] **Session create idempotency is Redis path-dependent** — `sessions.idempotency_key` exists in schema but is not the active enforcement path in gateway creation.
- [ ] **Dual session creation pipelines remain** — gateway HTTP and web oRPC creation are still separate behavioral paths.
- [ ] **GitHub token resolution logic is duplicated** — similar selection logic exists in both `session-store.ts` and `session-creator.ts`.
- [ ] **No durable chat transcript persistence in gateway/session DB path** — message history continuity depends on sandbox/OpenCode continuity.
- [ ] **CORS is permissive (`*`)** — production hardening still depends on token controls rather than origin restrictions.
- [ ] **Session status remains a text column in DB** — invalid status writes are possible without DB enum/check constraints.

---

## Source: `docs/specs/automations-runs.md`

# Automations & Runs — System Spec

## 1. Scope & Purpose

### In Scope
- Automation CRUD and configuration (instructions, model, routing strategy, notifications)
- Automation connections (integration bindings)
- Run lifecycle state model (`queued → enriching → ready → running → succeeded|failed|needs_human|timed_out`)
- Run pipeline ownership and invariants (enrich → execute → finalize)
- Enrichment worker (deterministic context extraction)
- Execution worker (configuration resolution, session creation, prompt dispatch)
- Finalizer reconciliation against session and sandbox liveness
- Run event log (`automation_run_events`)
- Outbox dispatch (`enqueue_enrich`, `enqueue_execute`, `write_artifacts`, `notify_run_terminal`, `notify_session_complete`)
- Side-effect idempotency (`automation_side_effects`) for external notifications
- Artifact writes (completion + enrichment JSON to S3)
- Run assignment, manual resolution, org-level pending run query
- Manual run triggering (Run Now)
- Slack async client integration (Slack thread ↔ session)
- Session completion notification subscriptions + dispatch

### Out of Scope
- Trigger ingestion/matching and provider parsing logic — see `triggers.md`
- Tool schema details (`automation.complete`) — see `agent-contract.md`
- Session runtime lifecycle and hub ownership — see `sessions-gateway.md`
- Sandbox boot/provider mechanics — see `sandbox-providers.md`
- Slack OAuth installation lifecycle — see `integrations.md`
- Billing/metering policy for runs and sessions — see `billing-metering.md`

### Mental Model

An **automation** is policy. A **run** is execution state. A **session** is the runtime container where the agent works.

The automations subsystem is a database-orchestrated pipeline with explicit durability boundaries:
- Trigger-side code creates a trigger event + run + first outbox row in one transaction (`packages/services/src/runs/service.ts:createRunFromTriggerEvent`).
- Workers claim runs through leases (`packages/services/src/runs/db.ts:claimRun`) and claim outbox rows through `FOR UPDATE SKIP LOCKED` (`packages/services/src/outbox/service.ts:claimPendingOutbox`).
- Completion is closed by a tool callback path (`apps/gateway/src/hub/capabilities/tools/automation-complete.ts`) that writes terminal run state transactionally and then terminates the automation session fast-path (`apps/gateway/src/hub/session-hub.ts:terminateForAutomation`).

The system is intentionally **at-least-once** at dispatch boundaries. Idempotency is applied at state boundaries (`completion_id`) and side-effect boundaries (`automation_side_effects`).

### Things Agents Get Wrong

- The outbox is not BullMQ. It is a Postgres table polled every 2s, and BullMQ is downstream (`apps/worker/src/automation/index.ts:dispatchOutbox`).
- Enrichment is deterministic and local; configuration selection can still call an LLM in `agent_decide` mode (`apps/worker/src/automation/enrich.ts`, `apps/worker/src/automation/configuration-selector.ts`).
- `agent_decide` never creates new managed configurations. It only selects from allowlisted existing configurations (`apps/worker/src/automation/resolve-target.ts`).
- Run creation now sets a default deadline (2 hours) at insert time (`packages/services/src/runs/service.ts:DEFAULT_RUN_DEADLINE_MS`, `createRunFromTriggerEvent`).
- Enrichment completion is atomic (payload + status + outbox) and no longer sequential best-effort (`packages/services/src/runs/service.ts:completeEnrichment`).
- `transitionRunStatus` does not enforce allowed transition edges; callers must preserve lifecycle correctness (`packages/services/src/runs/service.ts:transitionRunStatus`).
- Session notifications are not automation-only; gateway idle/orphan paths can also enqueue `notify_session_complete` (`apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`).
- Run claim/unclaim are available to any org member, while resolve remains `owner|admin`; DB mutations are scoped by `run_id + organization_id + automation_id` when automation context is provided (`apps/web/src/server/routers/automations.ts`, `packages/services/src/runs/db.ts`).

---

## 2. Core Concepts

### Outbox Pattern
All inter-stage dispatch is represented as `outbox` rows. Workers poll and claim rows atomically, then dispatch to queues or inline handlers.
- Key detail agents get wrong: malformed payloads and unknown kinds are marked permanently failed, not retried forever (`apps/worker/src/automation/index.ts:dispatchOutbox`).
- Reference: `packages/services/src/outbox/service.ts`, `apps/worker/src/automation/index.ts`

### Lease-Based Run Claiming
Runs are claimed with lease expiry + allowed-status gating. Claims update `lease_version` monotonically.
- Key detail agents get wrong: stale leases are reclaimable even if status is unchanged (`packages/services/src/runs/db.ts:claimRun`).
- Reference: `packages/services/src/runs/db.ts`

### Completion Contract
`automation.complete` is the terminal contract between agent and run state. It records completion transactionally, updates trigger event status, persists session summary/outcome, and schedules terminal sandbox cleanup.
- Key detail agents get wrong: completion idempotency is enforced by `completion_id`, and mismatched payloads for the same ID are rejected (`packages/services/src/runs/service.ts:completeRun`).
- Reference: `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`, `packages/services/src/runs/service.ts`

### Configuration Selection Strategy
Target configuration selection is policy-driven:
- `fixed`: use `defaultConfigurationId`
- `agent_decide`: select from `allowedConfigurationIds` via LLM and fallback to `fallbackConfigurationId`/default
- Key detail agents get wrong: `agent_decide` requires explicit allowlist; empty allowlist is a hard failure (`apps/worker/src/automation/resolve-target.ts`).
- Reference: `apps/worker/src/automation/resolve-target.ts`, `apps/worker/src/automation/configuration-selector.ts`

### Slack Async Client
Slack integration runs as an async gateway client. Inbound Slack messages create/reuse sessions and outbound session events are posted back to Slack threads.
- Key detail agents get wrong: outbound Slack messages are not webhook fan-out; they are direct Slack API calls made by the worker client (`apps/worker/src/slack/client.ts`).
- Reference: `apps/worker/src/slack/client.ts`, `apps/worker/src/slack/handlers/`

### Session Notification Subscriptions
Session-complete notifications are subscription-driven (`session_notification_subscriptions`) and dispatched by outbox.
- Key detail agents get wrong: delivery semantics are controlled by `notified_at` per subscription, not by outbox row uniqueness (`packages/services/src/notifications/service.ts`).
- Reference: `packages/services/src/notifications/service.ts`, `apps/worker/src/automation/notifications.ts`

---

## 5. Conventions & Patterns

### Do
- Claim runs before stage mutation (`runs.claimRun`) and process only allowed statuses.
- Use `runs.completeEnrichment` for enrichment completion to preserve atomicity.
- Use `runs.completeRun` for tool-driven terminal writes; do not hand-roll completion writes.
- Keep inter-stage work in outbox rows; queue fan-out happens in outbox dispatch.
- Record external side effects via `sideEffects.recordOrReplaySideEffect` when dispatch can retry.

### Don't
- Don't bypass outbox and enqueue BullMQ jobs directly from business services.
- Don't assume `transitionRunStatus` validates edge legality.
- Don't treat `llmFilterPrompt` / `llmAnalysisPrompt` as enrichment execution logic.
- Don't send Slack notifications without decrypting installation bot token at send time.

### Error Handling

```typescript
// Pattern: claim -> validate context -> process -> mark failed with stage-specific reason
const run = await runs.claimRun(runId, ["ready"], workerId, LEASE_TTL_MS);
if (!run) return;

const context = await runs.findRunWithRelations(runId);
if (!context?.automation || !context.triggerEvent) {
	await runs.markRunFailed({
		runId,
		reason: "missing_context",
		stage: "execution",
		errorMessage: "Missing automation or trigger event context",
	});
	return;
}
```

Source: `apps/worker/src/automation/index.ts:handleExecute`

### Reliability
- Outbox poll cadence: 2s (`OUTBOX_POLL_INTERVAL_MS`) — `apps/worker/src/automation/index.ts`
- Outbox stuck recovery lease: 5m (`CLAIM_LEASE_MS`) — `packages/services/src/outbox/service.ts`
- Outbox max attempts: 5 (`MAX_ATTEMPTS`) — `packages/services/src/outbox/service.ts`
- Outbox retry backoff: `min(30s * 2^attempts, 5m)` — `apps/worker/src/automation/index.ts:retryDelay`
- Run lease TTL: 5m (`LEASE_TTL_MS`) — `apps/worker/src/automation/index.ts`
- Run default deadline: 2h from creation — `packages/services/src/runs/service.ts:DEFAULT_RUN_DEADLINE_MS`
- Finalizer cadence: 60s; stale threshold: 30m inactivity (`INACTIVITY_MS`) — `apps/worker/src/automation/index.ts`
- Session creation idempotency key: `run:${runId}:session` — `apps/worker/src/automation/index.ts`
- Prompt idempotency key: `run:${runId}:prompt:v1` — `apps/worker/src/automation/index.ts`
- Slack API timeout: 10s (`SLACK_TIMEOUT_MS`) — `apps/worker/src/automation/notifications.ts`

### Testing Conventions
- Finalizer logic is dependency-injected (`FinalizerDeps`) for deterministic unit testing.
- Enrichment logic is pure and tested with synthetic run relations.
- Outbox dispatch tests validate recovery order, payload validation, and retry semantics.
- Execution integration tests validate configuration selection strategy behavior.

Sources:
- `apps/worker/src/automation/finalizer.test.ts`
- `apps/worker/src/automation/enrich.test.ts`
- `apps/worker/src/automation/outbox-dispatch.test.ts`
- `apps/worker/src/automation/execute-integration.test.ts`

---

## 6. Subsystem Deep Dives

### 6.1 Run Lifecycle Invariants — `Implemented`

**Invariants**
- Each run is uniquely bound to one trigger event (`trigger_event_id` unique).
- Trigger event creation, run creation, and initial `enqueue_enrich` outbox enqueue are transactional.
- Non-terminal run statuses are operational (`queued`, `enriching`, `ready`, `running`); terminal outcomes are `succeeded`, `failed`, `needs_human`, `timed_out`.
- Manual resolution is only legal from `needs_human`, `failed`, `timed_out` and only to `succeeded|failed`.

**Rules**
- Run ownership for processing requires both allowed status and non-active lease.
- Lifecycle edge validity is caller-owned; DB helpers do not enforce a strict finite-state machine.
- Every meaningful status mutation should emit a run event for auditability.

Sources:
- `packages/services/src/runs/service.ts`
- `packages/services/src/runs/db.ts`
- `packages/db/src/schema/schema.ts`

### 6.2 Enrichment Invariants — `Implemented`

**Invariants**
- Enrichment is deterministic extraction from trigger context; no external APIs and no model call.
- `parsedContext.title` is mandatory; absence is a terminal enrichment failure.
- Enrichment completion persists payload, transitions run to `ready`, records events, and enqueues `write_artifacts` + `enqueue_execute` in one transaction.
- Enrichment completion clears the claim lease (`leaseOwner`, `leaseExpiresAt`) when transitioning to `ready` so execute workers can claim immediately.

**Rules**
- Enrichment worker may only claim `queued|enriching` runs.
- Missing context (`automation`, `trigger`, `triggerEvent`) must fail the run with explicit stage/reason metadata.

Sources:
- `apps/worker/src/automation/enrich.ts`
- `apps/worker/src/automation/index.ts:handleEnrich`
- `packages/services/src/runs/service.ts:completeEnrichment`

### 6.3 Configuration Resolution Invariants — `Implemented`

**Invariants**
- `fixed` strategy resolves to `defaultConfigurationId` and does not call selector LLM.
- `agent_decide` strategy can only choose from explicit allowlisted configuration IDs.
- Candidate configurations without routing descriptions are ineligible for LLM selection.
- `agent_decide` failure falls back to `fallbackConfigurationId` (or default); without fallback/default it is a hard execution failure.

**Rules**
- Resolver must not create managed configurations in automation run execution.
- LLM selection response is accepted only if it returns JSON with eligible `configurationId`.

Sources:
- `apps/worker/src/automation/resolve-target.ts`
- `apps/worker/src/automation/configuration-selector.ts`
- `packages/services/src/automations/service.ts:updateAutomation`

### 6.4 Execution Invariants — `Implemented`

**Invariants**
- Execute worker only processes claimed `ready` runs.
- `target_resolved` run event is recorded before execution outcome branching.
- Run transitions to `running` before session creation/prompt send.
- Session creation uses deterministic idempotency key and `sandboxMode: "immediate"`.
- Prompt payload always includes completion contract (`automation.complete`, `run_id`, `completion_id`).

**Rules**
- Missing valid configuration target is terminal execution failure.
- Existing `sessionId` suppresses duplicate session creation.
- Existing `promptSentAt` suppresses duplicate prompt sends.
- Trigger event is advanced to `processing` when session creation succeeds.

Sources:
- `apps/worker/src/automation/index.ts:handleExecute`
- `apps/worker/src/automation/resolve-target.ts`

### 6.5 Completion & Terminalization Invariants — `Implemented`

**Invariants**
- `automation.complete` is the only first-class terminal completion tool for automation runs.
- `completeRun` writes terminal run state + completion event + outbox items (`write_artifacts`, `notify_run_terminal`) transactionally.
- Completion retries with identical `completion_id` and identical payload are idempotent.
- Completion retries with same `completion_id` but different payload are rejected.
- Gateway updates trigger event terminal status and persists session outcome/summary before session fast-path termination.

**Rules**
- Completion session ID mismatch is rejected.
- Automation session cleanup is best-effort and intentionally asynchronous after tool response.

Sources:
- `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`
- `packages/services/src/runs/service.ts:completeRun`
- `apps/gateway/src/hub/session-hub.ts:terminateForAutomation`

### 6.6 Finalizer Invariants — `Implemented`

**Invariants**
- Finalizer only evaluates stale `running` runs (deadline exceeded or inactivity threshold).
- Missing session, terminated-without-completion, and provider-dead sandbox are terminal failure conditions.
- Deadline exceedance transitions run to `timed_out` and enqueues terminal notification.
- Trigger event is marked failed when finalizer determines terminal failure/timed-out path.
- Finalizer gateway status checks include `organizationId` to satisfy service-to-service auth requirements.

**Rules**
- If gateway status lookup fails, finalizer skips mutation and retries on next tick.
- If session is terminated but `completionId` already exists, finalizer leaves the run unchanged.

Sources:
- `apps/worker/src/automation/finalizer.ts`
- `apps/worker/src/automation/index.ts:finalizeRuns`
- `packages/services/src/runs/db.ts:listStaleRunningRuns`

### 6.7 Outbox Dispatch Invariants — `Implemented`

**Invariants**
- Dispatch cycle always attempts stuck-row recovery before fresh claim.
- Claims are atomic and concurrent-safe via `FOR UPDATE SKIP LOCKED` update-returning pattern.
- Outbox kind drives dispatch target:
  - `enqueue_enrich` -> BullMQ enrich queue
  - `enqueue_execute` -> BullMQ execute queue
  - `write_artifacts` -> inline S3 writes
  - `notify_run_terminal` -> inline run notification dispatch
  - `notify_session_complete` -> inline session notification dispatch

**Rules**
- Successful dispatch must call `markDispatched`.
- Dispatch errors use exponential backoff retry scheduling.
- Structural payload errors and unknown kinds are permanent failures.

Sources:
- `apps/worker/src/automation/index.ts:dispatchOutbox`
- `packages/services/src/outbox/service.ts`

### 6.8 Notification Invariants — `Implemented`

**Invariants**
- Run notification destinations are explicit per automation: `none`, `slack_channel`, `slack_dm_user`.
- Channel notifications resolve installation + channel and are idempotent via side-effect keys.
- DM notifications resolve installation + user DM channel and are idempotent via side-effect keys.
- Session completion notifications are subscription-driven and only send for rows with `notified_at IS NULL`.

**Rules**
- Missing destination configuration yields no-op, not hard failure.
- Slack API/network timeout errors are retryable through outbox retry semantics.
- Session notification dispatch throws on partial failure so outbox can retry remaining subscriptions.

Sources:
- `apps/worker/src/automation/notifications.ts`
- `packages/services/src/notifications/service.ts`
- `packages/services/src/side-effects/service.ts`

### 6.9 Slack Async Client Invariants — `Implemented`

**Invariants**
- Slack thread identity (`installationId`, `channelId`, `threadTs`) maps to one session conversation record.
- Inbound Slack messages create or reuse sessions and always ensure a receiver worker exists.
- Slack-originated wake events are ignored to prevent echo loops.
- Outbound event handling posts text/tool outputs incrementally until message completion.

**Rules**
- Session creation strategy in Slack honors installation-level selection policy (`fixed` vs `agent_decide`).
- Significant tool reporting is intentionally filtered (`verify`, `todowrite`) to reduce thread noise.

Sources:
- `apps/worker/src/slack/client.ts`
- `apps/worker/src/slack/handlers/`

### 6.10 Artifact Storage Invariants — `Implemented`

**Invariants**
- Completion and enrichment artifacts are materialized as JSON objects under deterministic run-scoped S3 keys.
- Artifact references are written back to run row after successful S3 put.

**Rules**
- Artifact write requires `S3_BUCKET` and `S3_REGION` at runtime.
- `write_artifacts` outbox dispatch fails if neither completion nor enrichment payload exists.

Sources:
- `apps/worker/src/automation/artifacts.ts`
- `apps/worker/src/automation/index.ts:writeArtifacts`

### 6.11 Run Assignment & Resolution Invariants — `Implemented`

**Invariants**
- Assignment is org-scoped and single-owner (`assigned_to` nullable with conflict semantics).
- Automation run listing is scoped by both `automation_id` and `organization_id`.
- Resolve operation is org-scoped, automation-scoped, and status-gated with TOCTOU-safe conditional update.
- Manual resolution always appends `manual_resolution` event data including actor metadata.

**Rules**
- API layer validates automation existence, allows assignment/unassignment for any org member, and requires `owner|admin` for resolve.
- Assignment/unassignment DB mutations are scoped by run + org and additionally by automation ID when provided by caller.

Sources:
- `packages/services/src/runs/service.ts:assignRunToUser`
- `packages/services/src/runs/service.ts:resolveRun`
- `packages/services/src/runs/db.ts`
- `apps/web/src/server/routers/automations.ts`

### 6.12 Manual Run Invariants — `Implemented`

**Invariants**
- Manual runs are represented as normal runs with synthetic trigger events.
- Manual trigger uses valid provider enum (`webhook`) plus `_manual` config flag, and is disabled to avoid accidental ingestion.
- Manual trigger is reused when present; duplicate manual triggers are not created.

**Rules**
- Manual run entrypoint still uses standard `createRunFromTriggerEvent`, preserving deadline, outbox, and run audit behavior.

Sources:
- `packages/services/src/automations/service.ts:triggerManualRun`
- `packages/services/src/automations/db.ts:findManualTrigger`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `triggers.md` | Triggers -> This | `runs.createRunFromTriggerEvent()` | Trigger processor hands off by creating run + `enqueue_enrich` outbox row. |
| `agent-contract.md` | This -> Agent | `automation.complete` tool contract | Prompt and tool callback finalize run state. |
| `sessions-gateway.md` | This -> Gateway | `syncClient.createSession`, `postMessage`, `getSessionStatus` | Workers drive runtime through gateway SDK. |
| `sandbox-providers.md` | This -> Provider (indirect) | Session creation + status liveness | Finalizer depends on gateway-reported provider liveness. |
| `integrations.md` | This -> Integrations | Slack installation resolution | Notification dispatch resolves installations/tokens through integrations service. |
| `repos-prebuilds.md` | This -> Configurations | Configuration metadata and candidates | Run execution selects existing configurations. |
| `billing-metering.md` | This -> Billing (indirect) | Session creation gate happens in gateway | This subsystem does not perform direct credit enforcement. |

### Security & Auth
- Automation routes are `orgProcedure` protected and org-scoped.
- Worker -> gateway auth uses service token (`SERVICE_TO_SERVICE_AUTH_TOKEN`).
- Slack bot tokens are encrypted at rest and decrypted only at dispatch time.
- Completion tool path validates run/session consistency before terminal writes.

Sources:
- `apps/web/src/server/routers/automations.ts`
- `apps/worker/src/automation/index.ts`
- `apps/worker/src/automation/notifications.ts`
- `packages/services/src/runs/service.ts:completeRun`

### Observability
- Worker stages log structured run/session context.
- Outbox recovery logs recovered row counts.
- Finalizer logs reconcile outcomes and non-fatal gateway reachability failures.
- Slack dispatch logs destination errors for retry diagnosis.

Sources:
- `apps/worker/src/automation/index.ts`
- `apps/worker/src/automation/finalizer.ts`
- `apps/worker/src/automation/notifications.ts`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] Services tests pass (`pnpm -C packages/services test`)
- [ ] Spec reflects current runtime invariants and agent-facing pitfalls

---

## 9. Known Limitations & Tech Debt

- [ ] **Manager tick orchestration is not first-class yet (High):** run creation is still trigger/manual-event driven; there is no dedicated "tick worker" stage that performs routine source polling and then conditionally spawns child coding sessions. Source: `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/runs/service.ts:createRunFromTriggerEvent`, `apps/worker/src/automation/index.ts:handleExecute`.
- [ ] **No single-active-tick lease/idempotency per agent profile (High):** current leasing/idempotency protects run/session execution and outbox dispatch, but there is no explicit one-tick-per-agent guardrail contract. Source: `apps/worker/src/automation/index.ts`, `packages/services/src/outbox/service.ts`.
- [ ] **Sessions are automation-linked, not agent-profile-linked (Medium):** current session linkage uses `sessions.automation_id`; there is no separate nullable `agent_id` path in the current schema for ad-hoc-vs-manager identity partitioning. Source: `packages/db/src/schema/sessions.ts`, `packages/services/src/sessions/db.ts`.
- [ ] **Transition guardrails are caller-enforced** — `transitionRunStatus` allows arbitrary `toStatus`; invalid edges are possible if callers misuse it. Source: `packages/services/src/runs/service.ts:transitionRunStatus`.
- [ ] **Run status schema includes unused states** — `canceled` and `skipped` exist in shared schema but are not currently produced by the run pipeline. Source: `packages/shared/src/contracts/automations.ts`.
- [ ] **LLM filter/analysis fields are still not run-stage execution inputs** — enrichment does not use `llm_filter_prompt` / `llm_analysis_prompt`. Source: `apps/worker/src/automation/enrich.ts`.
- [ ] **Configuration selector depends on LLM proxy availability** — `agent_decide` degrades to failure/fallback when proxy config or call fails. Source: `apps/worker/src/automation/configuration-selector.ts`.
- [ ] **Notification channel fallback remains for backward compatibility** — channel resolution still reads legacy `enabled_tools.slack_notify.channelId`. Source: `apps/worker/src/automation/notifications.ts:resolveNotificationChannelId`.
- [ ] **Artifact retries are coarse-grained** — `write_artifacts` retries the whole outbox item; completion and enrichment artifact writes are not independently queued. Source: `apps/worker/src/automation/index.ts:writeArtifacts`.
- [x] **Assignment scoping alignment across layers** — API layer validates automation ownership and triage role, and DB assignment/unassignment can include automation ID in mutation WHERE predicates. Source: `apps/web/src/server/routers/automations.ts`, `packages/services/src/runs/db.ts`, `packages/services/src/runs/service.ts`.
- [x] **Run deadline enforcement at creation** — Addressed via `DEFAULT_RUN_DEADLINE_MS` in run creation transaction. Source: `packages/services/src/runs/service.ts:createRunFromTriggerEvent`.
- [x] **Enrichment writes non-transactional** — Addressed via `completeEnrichment` transactional write + outbox enqueue. Source: `packages/services/src/runs/service.ts:completeEnrichment`.
- [x] **Side-effects table unused** — Addressed; run/DM notifications now use side-effect idempotency keys. Source: `apps/worker/src/automation/notifications.ts`, `packages/services/src/side-effects/service.ts`.

---

## Source: `docs/specs/triggers.md`

# Triggers — System Spec

## 1. Scope & Purpose

### In Scope
- Trigger CRUD, trigger event listing, and skip flow (`apps/web/src/server/routers/triggers.ts`, `packages/services/src/triggers/service.ts`, `packages/services/src/triggers/db.ts`).
- Automation-scoped trigger creation and manual run trigger bootstrapping (`apps/web/src/server/routers/automations.ts`, `packages/services/src/automations/service.ts`).
- Trigger service runtime (`apps/trigger-service/src/index.ts`, `apps/trigger-service/src/server.ts`).
- Async webhook inbox ingestion and processing (`apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`).
- Poll-group scheduling and execution (`packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`, `packages/queue/src/index.ts`).
- Provider trigger registration and adapter contracts (`packages/triggers/src/service/register.ts`, `packages/triggers/src/service/registry.ts`, `packages/triggers/src/service/base.ts`).
- Trigger-to-run handoff via transactional outbox (`packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`).
- Schedule CRUD APIs (data management only) (`apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`).
- Webhook lifecycle routes that remain in web app (Nango auth/sync and GitHub installation lifecycle only) (`apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).

### Out of Scope
- Automation run enrichment/execute/finalize internals after outbox dispatch (`automations-runs.md`, `apps/worker/src/automation/index.ts`).
- OAuth connection lifecycle and integration UX (`integrations.md`, `packages/services/src/integrations/service.ts`).
- Session runtime semantics inside gateway hubs (`sessions-gateway.md`, `apps/gateway/src/hub`).
- Action execution and approval policy (`actions.md`).

### Mental Models
1. Triggers are an ingestion layer, not an execution layer. They decide whether an event should start a run; they do not run agent logic themselves (`apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/runs/service.ts`).
2. The durable unit of webhook work is `webhook_inbox`, not an HTTP request. Reliability comes from DB persistence plus async workers (`apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`).
3. Polling scale is integration-scoped. The system polls once per poll group and fans out to triggers in-memory (`packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`).
4. Trigger matching and trigger processing are separate concerns. Providers parse/filter event payloads; services own dedup, persistence, and run creation (`packages/triggers/src/service/base.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`).
5. Trigger events are audit facts and workflow state, not transient logs. Their status drives operator visibility and downstream reconciliation (`packages/db/src/schema/triggers.ts`, `apps/worker/src/automation/finalizer.ts`).
6. A trigger firing does not enqueue BullMQ directly; it writes outbox work in the same DB transaction as run/event creation (`packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`).
7. Registered runtime providers are explicit. A provider existing in code is not the same as being active in trigger-service registry (`packages/triggers/src/index.ts`, `packages/triggers/src/service/register.ts`).

### Things Agents Get Wrong
- Assuming Next.js API routes are in the trigger event path. Real trigger ingestion is in trigger-service (`apps/trigger-service/src/api/webhooks.ts`), while web app webhook routes now handle lifecycle-only flows (`apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).
- Assuming webhook handlers create runs synchronously. Run creation occurs in async workers after inbox claim (`apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`).
- Assuming one polling job per trigger. Runtime scheduling is per poll group (`packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`).
- Assuming `/providers` is the complete feature list for UI providers. UI also hardcodes standalone providers (`apps/trigger-service/src/api/providers.ts`, `apps/web/src/components/automations/trigger-config-form.tsx`).
- Assuming schedule CRUD in `schedules` drives runtime cron execution. Runtime cron triggers are `triggers.provider = "scheduled"` rows with `pollingCron`, executed by trigger-service workers (`apps/trigger-service/src/scheduled/worker.ts`, `packages/services/src/triggers/service.ts`).
- Assuming direct webhooks can be routed without identity. Direct webhook ingress now requires `integrationId` or `connectionId` and rejects requests that omit both (`apps/trigger-service/src/api/webhooks.ts`).
- Assuming trigger list pending counts represent queued work. Current query counts `status = "pending"`, but event lifecycle uses `queued` (`packages/services/src/triggers/db.ts`, `packages/db/src/schema/triggers.ts`).
- Assuming manual runs have a first-class trigger provider. Manual runs are represented as disabled webhook triggers with `config._manual = true` (`packages/services/src/automations/service.ts`, `packages/services/src/automations/db.ts`).

---

## 2. Core Concepts

### Async Webhook Inbox
- HTTP ingestion acknowledges quickly and defers real processing to workers.
- Inbox rows transition across `pending` / `processing` / `completed` / `failed` with GC cleanup.
- Evidence: `apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`, `apps/trigger-service/src/gc/inbox-gc.ts`.

### Nango-Forwarded Identity
- Current primary routing identity comes from Nango forward envelopes (`connectionId`, `providerConfigKey`).
- Integration resolution is done against integration provider `nango`.
- Evidence: `packages/triggers/src/service/adapters/nango.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`, `packages/services/src/integrations/db.ts`.

### Poll Groups
- Poll groups are persisted in `trigger_poll_groups` and keyed by org + provider + integration.
- Group cursor state lives on poll-group rows, not on trigger rows.
- Evidence: `packages/db/src/schema/schema.ts`, `packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`.

### Trigger Event + Run Handoff
- A trigger match creates a `trigger_events` row and an `automation_runs` row together.
- Outbox `enqueue_enrich` is inserted in the same transaction.
- Evidence: `packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`.

### Provider Contracts (Current vs Target)
- Current trigger-service runtime uses class-based `WebhookTrigger` / `PollingTrigger` and a runtime registry.
- Target architecture defines `ProviderTriggers` + `NormalizedTriggerEvent` in `@proliferate/providers`.
- Both coexist; trigger-service runtime still depends on class-based registry.
- Evidence: `packages/triggers/src/service/base.ts`, `packages/triggers/src/service/registry.ts`, `packages/providers/src/types.ts`.

### Trigger Event Lifecycle
- New trigger events start as `queued`.
- Execution path moves them to `processing` when session starts, then `completed` or `failed` when runs terminate/complete; unmatched or blocked events are `skipped`.
- Evidence: `packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`, `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`, `apps/worker/src/automation/finalizer.ts`.

---

_Sections 3 (File Tree) and 4 (Data Models) are intentionally removed. Code and schema files are the source of truth._

## 5. Conventions & Patterns

### Do
- Use trigger-service webhook routes only for ingress and durability boundaries; do matching/handoff asynchronously (`apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`).
- Keep DB writes in `packages/services` modules (`packages/services/src/triggers/db.ts`, `packages/services/src/webhook-inbox/db.ts`).
- Use poll groups for polling scheduling and cleanup (`packages/services/src/poll-groups/db.ts`, `packages/services/src/triggers/service.ts`).
- Persist skipped events for auditability when filters/automation state block execution (`apps/trigger-service/src/lib/trigger-processor.ts`).
- Use `createRunFromTriggerEvent()` for atomic event+run+outbox writes (`packages/services/src/runs/service.ts`).

### Don’t
- Don’t enqueue automation run jobs directly from trigger matching code; always write outbox (`packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`).
- Don’t treat `/providers` response as full product capability; it only reflects registered trigger-service definitions (`apps/trigger-service/src/api/providers.ts`, `packages/triggers/src/service/register.ts`).
- Don’t schedule per-trigger polling jobs in new logic (`apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`).
- Don’t assume `status = pending` means queued trigger work in current DB state (`packages/services/src/triggers/db.ts`, `packages/db/src/schema/triggers.ts`).

### Reliability and Safety Rules
- Inbox claim must remain lock-safe (`FOR UPDATE SKIP LOCKED`) for concurrent workers (`packages/services/src/webhook-inbox/db.ts`).
- Poll execution must hold a per-group distributed lock to avoid concurrent provider calls (`apps/trigger-service/src/polling/worker.ts`, `packages/queue/src/index.ts`).
- Signature checks must happen before trusting webhook identity (Nango route verifies through adapters; web app lifecycle routes verify their own signatures) (`packages/triggers/src/service/adapters/nango.ts`, `apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).

---

## 6. Subsystem Deep Dives (Invariants & Rules)

### 6.1 Ingestion Boundary Invariants (Status: Implemented/Partial)
- Invariant: Public webhook endpoints must durably persist inbound payloads before any run-side effects.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`.
- Invariant: Trigger-service webhook endpoints do not create `trigger_events` or `automation_runs` directly.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/runs/service.ts`.
- Invariant: `/webhooks/nango` and `/webhooks/direct/:providerId` are both wired into inbox processing, with different identity requirements.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.
- Rule: `/webhooks/direct/:providerId` must include routing identity (`integrationId` or `connectionId`), otherwise ingress fails with `400`.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`.

### 6.2 Webhook Inbox State Invariants (Status: Implemented)
- Invariant: Inbox rows are claimed in batches with row-level locking semantics.
  Evidence: `packages/services/src/webhook-inbox/db.ts:claimBatch`.
- Invariant: Successfully processed rows are marked `completed`; processing errors are marked `failed` with error text.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`, `packages/services/src/webhook-inbox/db.ts`.
- Invariant: Inbox table retention is bounded by periodic GC (default 7 days for completed/failed rows).
  Evidence: `apps/trigger-service/src/gc/inbox-gc.ts`, `packages/services/src/webhook-inbox/db.ts:gcOldRows`.

### 6.3 Webhook Matching Invariants (Status: Implemented/Partial)
- Invariant: Inbox processing resolves integration identity from Nango `connectionId` first, with direct-webhook `integrationId` fallback, then fetches active webhook triggers by integration ID.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`, `packages/services/src/triggers/db.ts:findActiveWebhookTriggers`.
- Invariant: Provider matching only runs when trigger row provider matches trigger definition provider.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`.
- Rule: If integration is absent or no active triggers exist, inbox rows are treated as completed no-op work.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`.
- Rule: Direct rows without both `connectionId` and `integrationId` fail with explicit missing-identity errors.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`.

### 6.4 Trigger Processing Invariants (Status: Implemented)
- Invariant: Automation enabled-state gates trigger execution; disabled automations produce skipped trigger events.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`.
- Invariant: Trigger config is validated with adapter schema (`safeParse`), then adapter filtering is applied per event.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`.
- Invariant: Dedup check is per `(trigger_id, dedup_key)` and enforced before run creation.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/triggers/db.ts:eventExistsByDedupKey`, `packages/db/src/schema/triggers.ts`.
- Invariant: Run-creation failures are recorded as skipped trigger events with `run_create_failed`.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`.

### 6.5 Poll Group Invariants (Status: Implemented)
- Invariant: Poll worker executes one provider poll call per poll group and fans results out to all active triggers in that group.
  Evidence: `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`.
- Invariant: Poll concurrency is guarded by a Redis lock per group with TTL.
  Evidence: `apps/trigger-service/src/polling/worker.ts`, `packages/queue/src/index.ts:REDIS_KEYS.pollGroupLock`.
- Invariant: Poll cursors are persisted in `trigger_poll_groups.cursor`.
  Evidence: `packages/services/src/poll-groups/db.ts:updateGroupCursor`, `packages/db/src/schema/schema.ts`.
- Rule: Orphan poll groups are removed when no active polling triggers remain; BullMQ repeatables are unscheduled accordingly.
  Evidence: `packages/services/src/triggers/service.ts`, `packages/services/src/poll-groups/db.ts`, `packages/queue/src/index.ts:removePollGroupJob`.

### 6.6 Trigger-to-Run Handoff Invariants (Status: Implemented)
- Invariant: `createRunFromTriggerEvent` atomically inserts trigger event, automation run, and outbox row (`enqueue_enrich`).
  Evidence: `packages/services/src/runs/service.ts`.
- Invariant: Outbox dispatcher is responsible for queueing enrich/execute work; trigger-service is not.
  Evidence: `apps/worker/src/automation/index.ts:dispatchOutbox`.
- Invariant: Trigger event IDs are carried through to session creation for run/session/event traceability.
  Evidence: `apps/worker/src/automation/index.ts`.

### 6.7 Trigger Event Status Invariants (Status: Implemented)
- Invariant: New matched events are created in `queued` state.
  Evidence: `packages/services/src/runs/service.ts`.
- Invariant: Event transitions to `processing` when execution session is created.
  Evidence: `apps/worker/src/automation/index.ts`.
- Invariant: Event transitions to `completed` on successful `automation.complete`, otherwise `failed` for failed/timed-out/no-completion paths.
  Evidence: `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`, `apps/worker/src/automation/finalizer.ts`.
- Rule: Non-matches / disabled automation / explicit operator skip are represented with `skipped` and specific `skipReason` values.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/triggers/service.ts:skipTriggerEvent`.

### 6.8 Provider Registry and Contract Invariants (Status: Partial)
- Invariant: Trigger-service runtime registry is populated only by explicit `registerDefaultTriggers()` calls.
  Evidence: `apps/trigger-service/src/index.ts`, `packages/triggers/src/service/register.ts`.
- Invariant: Runtime-registered defaults are GitHub/Linear/Sentry webhooks, plus Gmail polling only when Composio API key is configured.
  Evidence: `packages/triggers/src/service/register.ts`.
- Rule: `ProviderTriggers` in `@proliferate/providers` is the target architecture, but trigger-service currently runs class-based adapters.
  Evidence: `packages/providers/src/types.ts`, `packages/triggers/src/service/base.ts`.

### 6.9 Scheduled and Manual Trigger Invariants (Status: Implemented)
- Invariant: Schedule CRUD exists and validates cron format, but schedule CRUD itself does not execute runs.
  Evidence: `apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`.
- Invariant: Trigger create/update paths validate cron expressions before persisting scheduled trigger rows, and validate polling trigger `pollingCron` when provided.
  Evidence: `packages/services/src/triggers/service.ts`, `packages/services/src/automations/service.ts`, `apps/web/src/server/routers/triggers.ts`, `apps/web/src/server/routers/automations.ts`.
- Invariant: Trigger-service starts a scheduled worker and restores repeatable jobs for enabled cron triggers at startup.
  Evidence: `apps/trigger-service/src/index.ts`, `apps/trigger-service/src/scheduled/worker.ts`, `packages/services/src/triggers/service.ts:listEnabledScheduledTriggers`.
- Invariant: Scheduled trigger CRUD keeps BullMQ repeatable cron jobs in sync on create/update/delete paths.
  Evidence: `packages/services/src/automations/service.ts:createAutomationTrigger`, `packages/services/src/triggers/service.ts`.
- Invariant: Automation deletion cleans up queue artifacts left by cascading trigger deletion (scheduled repeatables and orphaned poll groups).
  Evidence: `packages/services/src/automations/service.ts:deleteAutomation`, `packages/services/src/automations/db.ts:listTriggerSchedulesForAutomation`, `packages/services/src/poll-groups/db.ts:deleteOrphanedGroups`.
- Invariant: Manual runs bypass external webhook/polling ingest by creating synthetic trigger events through a dedicated manual trigger marker (`config._manual = true`).
  Evidence: `packages/services/src/automations/service.ts:triggerManualRun`, `packages/services/src/automations/db.ts:findManualTrigger`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Automations/Runs | Triggers → Automations | `runs.createRunFromTriggerEvent()` | Atomic trigger event + run + outbox insertion. |
| Outbox/Workers | Triggers → Worker | `outbox.kind = enqueue_enrich` | Trigger system hands off via outbox, not direct queue push. |
| Integrations | Triggers → Integrations | `findByConnectionIdAndProvider()`, `findById()` | Nango `connectionId` resolution and poll-group connection lookup. |
| Queue/BullMQ | Triggers → Queue | `createWebhookInboxWorker`, `createPollGroupWorker`, repeatables | Inbox drain, poll groups, and GC scheduling. |
| Redis | Triggers → Redis | `REDIS_KEYS.pollGroupLock()` | Distributed lock for per-group poll mutual exclusion. |
| Providers Runtime | Trigger-service → `@proliferate/triggers` | `registry`, `WebhookTrigger`, `PollingTrigger` | Current runtime matching/parsing contract. |
| Providers Target Contract | Triggers ↔ `@proliferate/providers` | `ProviderTriggers`, `NormalizedTriggerEvent` | Migration target; not yet trigger-service runtime path. |
| Web App Lifecycle Webhooks | Web app ↔ Integrations | `/api/webhooks/nango`, `/api/webhooks/github-app` | Handles auth/sync and installation lifecycle, not trigger event execution. |

### Security & Auth
- Trigger CRUD APIs are org-scoped (`orgProcedure`) (`apps/web/src/server/routers/triggers.ts`).
- Trigger-service webhook routes are public and rely on signature/identity validation paths (`apps/trigger-service/src/api/webhooks.ts`, `packages/triggers/src/service/adapters/nango.ts`).
- Nango/GitHub lifecycle routes in web app have independent signature validation (`apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).
- Direct provider webhook route currently does not enforce provider-specific verification in trigger-service runtime path (`apps/trigger-service/src/api/webhooks.ts`).

### Observability
- Trigger-service uses structured child loggers by module (`apps/trigger-service/src/lib/logger.ts`, usage across workers/routes).
- Key identifiers: `inboxId`, `provider`, `connectionId`, `triggerId`, `groupId`, `sessionId` (`apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/polling/worker.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`).
- Inbox GC limits table growth and should be monitored alongside inbox backlog and poll-group lag (`apps/trigger-service/src/gc/inbox-gc.ts`).

---

## 8. Acceptance Gates

- [ ] `pnpm typecheck` passes.
- [ ] Trigger-service starts cleanly with registered default triggers and workers (`apps/trigger-service/src/index.ts`).
- [ ] Webhook ingress remains durable-first (payload persisted before run-side effects).
- [ ] Poll group lifecycle works end-to-end: schedule on create/update, cleanup on orphan.
- [ ] Scheduled trigger lifecycle works end-to-end: schedule on create/update/delete and execute by cron.
- [ ] Trigger event lifecycle remains coherent (`queued` → `processing` → terminal or skipped).
- [ ] This spec stays aligned with runtime invariants, mental models, and known failure modes.

---

## 9. Known Limitations & Tech Debt

- [ ] **Tick-engine migration not yet implemented (High):** runtime still centers on webhook inbox + trigger-event fanout. Planned direction is outbound cadence polling per long-running agent profile, with child-run spawn only when fresh source deltas exist. Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/polling/worker.ts`.
- [ ] **No per-agent/per-source durable cursor model yet (High):** cursor state is currently poll-group scoped (`trigger_poll_groups.cursor`) rather than attached to a dedicated manager-agent/source checkpoint model. Evidence: `packages/services/src/poll-groups/db.ts:updateGroupCursor`, `apps/trigger-service/src/polling/worker.ts`.
- [ ] **Trigger artifact retirement is not staged yet (High):** `triggers`, `trigger_events`, and `webhook_inbox` remain active runtime dependencies; migration must deprecate and dual-write/verify before dropping schema paths. Evidence: `packages/services/src/triggers/db.ts`, `packages/services/src/runs/service.ts:createRunFromTriggerEvent`, `packages/services/src/webhook-inbox/db.ts`.
- [x] **Direct webhook identity routing path (High):** direct webhooks now require `integrationId`/`connectionId` at ingress and worker resolution supports integration-id fallback for execution routing. Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.
- [ ] **Fast-ack duplicate parse path (Medium):** Ingress route currently calls dispatcher logic that may parse provider events, then inbox worker parses again. This violates strict "ingress-only" intent and adds duplicate CPU. Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.
- [ ] **PostHog runtime registration mismatch (Medium):** PostHog provider exists in package-level provider map but is not registered in trigger-service default registry; trigger-service `/providers` will not expose it as runnable. Evidence: `packages/triggers/src/posthog.ts`, `packages/triggers/src/service/register.ts`, `apps/trigger-service/src/api/providers.ts`.
- [ ] **Webhook URL path mismatch (Medium):** Trigger rows store `webhookUrlPath` values (for `/webhooks/t_*` style URLs), but trigger-service currently exposes `/webhooks/nango` and `/webhooks/direct/:providerId` only; web app form still shows legacy `/api/webhooks/automation/:id` and `/api/webhooks/posthog/:id` paths that do not exist. Evidence: `packages/services/src/triggers/service.ts`, `apps/trigger-service/src/api/webhooks.ts`, `apps/web/src/components/automations/trigger-config-form.tsx`, `apps/web/src/app/api/webhooks/`.
- [ ] **Dual provider abstraction layers (Medium):** `TriggerProvider` and class-based trigger adapters coexist with target `ProviderTriggers`; runtime is still class-based. Evidence: `packages/triggers/src/types.ts`, `packages/triggers/src/service/base.ts`, `packages/providers/src/types.ts`.
- [ ] **Pending count status bug (Medium):** Trigger list pending count query uses `status = "pending"` while canonical lifecycle uses `queued`; counts can under-report or stay zero. Evidence: `packages/services/src/triggers/db.ts:getPendingEventCounts`, `packages/db/src/schema/triggers.ts`.
- [ ] **Poll config fan-out coupling (Low/Medium):** Poll-group worker calls provider `poll()` with group-level empty config and first trigger definition; trigger-specific filters happen only after poll, which can increase provider/API load. Evidence: `apps/trigger-service/src/polling/worker.ts`.
- [ ] **Legacy polling fields still present (Low):** `triggers.polling_state` remains in schema and API mapper even though poll groups own cursor state in active flow. Evidence: `packages/db/src/schema/triggers.ts`, `packages/services/src/triggers/mapper.ts`, `packages/services/src/poll-groups/db.ts`.
- [ ] **HMAC helper duplication (Low):** Per-provider HMAC helpers are duplicated across trigger modules and webhook routes. Evidence: `packages/triggers/src/github.ts`, `packages/triggers/src/linear.ts`, `packages/triggers/src/sentry.ts`, `packages/triggers/src/posthog.ts`, `apps/web/src/app/api/webhooks/nango/route.ts`.

---

## Source: `docs/specs/actions.md`

# Actions — System Spec

## 1. Scope & Purpose

### In Scope
- Gateway-mediated action listing, invocation, approval, denial, and status polling.
- Three-mode policy resolution (`allow`, `require_approval`, `deny`) and mode-source attribution.
- Provider-backed action sources (Linear, Sentry, Slack, Jira) and connector-backed MCP action sources.
- Org-level and automation-level action mode overrides.
- User action source preferences (source-level enable/disable) in list/invoke paths.
- Invocation persistence, expiry sweep, redaction, and truncation.
- Org inbox query surface for pending approvals.
- Sandbox bootstrap guidance and CLI contracts (`proliferate actions list|guide|run`).

### Out of Scope
- Session lifecycle orchestration and WebSocket transport internals (`sessions-gateway.md`).
- OAuth connection lifecycle details (`integrations.md`).
- Trigger ingestion and run orchestration (`triggers.md`, `automations-runs.md`).
- Sandbox tool injection contracts and base system prompts (`agent-contract.md`).

### Mental Models
- **Actions are policy-gated side effects, not chat tools.** Every external side effect goes through gateway policy and audit rows (`action_invocations`), even when execution is immediate.
- **One catalog, two source archetypes.** Sessions see one merged catalog, but runtime execution is polymorphic (`ActionSource`) across static provider adapters and dynamic MCP connectors.
- **Two independent control planes exist.** User preferences control source visibility (`user_action_preferences`), while org/automation mode maps control execution policy (`action_modes` JSONB).
- **The CLI is synchronous UX over async workflow.** `proliferate actions run` may return immediately (allow), fail immediately (deny), or block with polling while waiting for human approval (require_approval).
- **Risk is only a default hint.** `riskLevel` informs inferred defaults; enforcement is always the resolved mode.

### Things Agents Get Wrong
- Mode map keys are `sourceId:actionId` (colon), not slash.
- `POST /approve` executes the action immediately after status transition; approval is not "mark-only".
- There is no gateway "approve with always mode" payload contract; "always allow" is implemented by a second org/automation mode write from web UI.
- Gateway `/invoke` now forwards `session.automationId` to `actions.invokeAction()`, so automation-level mode overrides apply in live automation sessions.
- Connector listing failures are degraded to empty tool lists; they do not fail the entire `/available` response.
- Connector drift guard only applies when a stored tool hash exists; absence of a stored hash means "not drifted".
- Sandbox callers can invoke/list/guide/status, but only user tokens with `owner|admin` can approve/deny.
- Result handling is not passthrough: DB writes always redact sensitive keys and structurally truncate JSON.

---

## 2. Core Concepts

### 2.1 Three-Mode Permissioning
Mode resolution is deterministic and centralized in `packages/services/src/actions/modes.ts`:

1. Automation override (`automations.action_modes["<sourceId>:<actionId>"]`)
2. Org default (`organization.action_modes["<sourceId>:<actionId>"]`)
3. Inferred default from action risk (`read→allow`, `write→require_approval`, `danger→deny`)

The resolved mode and mode source are stored on every invocation row.

### 2.2 `ActionSource` Polymorphism
All execution flows through `ActionSource` (`packages/providers/src/action-source.ts`):
- `ProviderActionSource` wraps static modules in `packages/providers/src/providers/*`.
- `McpConnectorActionSource` wraps org-scoped connector config and resolves tools dynamically (`packages/services/src/actions/connectors/action-source.ts`).

Gateway invocation code remains source-agnostic; it resolves source + action definition, validates params, and executes through a shared contract.

### 2.3 Schema Contract and Hashing
- Action params are Zod schemas (`ActionDefinition.params`), reused for runtime validation and JSON Schema export.
- Connector drift hashing uses stable stringification and normalized schemas that strip `description`, `default`, and `enum` (`packages/providers/src/helpers/schema.ts`).

### 2.4 Connector Risk Derivation
Connector risk level precedence (`packages/services/src/actions/connectors/risk.ts`):
1. Explicit connector per-tool override
2. MCP annotations (`destructiveHint` before `readOnlyHint`)
3. Connector default risk
4. Fallback `write` (safe default requiring approval)

### 2.5 Agent Bootstrap and CLI
- Sandbox setup writes `.proliferate/actions-guide.md` from `ACTIONS_BOOTSTRAP` (`packages/shared/src/sandbox/config.ts`).
- Actual runtime discovery always comes from `GET /actions/available` via `proliferate actions list`.
- `proliferate actions run` polls invocation status every 2s while pending (`packages/sandbox-mcp/src/proliferate-cli.ts`).

---

## 5. Conventions & Patterns

### Do
- Keep mode resolution logic in `modes.ts`; do not fork per integration/source.
- Build mode keys as `${sourceId}:${actionId}` consistently across all writers/readers.
- Validate params with action Zod schema before invocation creation.
- Route all source execution via `ActionSource.execute()`; keep adapters stateless.
- Resolve tokens/secrets server-side only (`integrations.getToken`, `secrets.resolveSecretValue`).
- Redact then truncate result payloads before persistence (`redactData` + `truncateJson`).
- Treat connector drift as fail-safe only: `allow → require_approval`, never relax `deny`.

### Don't
- Don't use `riskLevel` as direct enforcement.
- Don't persist raw provider responses or credential-shaped fields.
- Don't allow sandbox tokens to approve/deny.
- Don't assume connector permissions and drift state are discoverable from static UI metadata.
- Don't depend on legacy grant endpoints (`/actions/grants`) for policy management.

### Error Handling
- Service error classes map to explicit gateway statuses:
  - `ActionNotFoundError` → `404`
  - `ActionExpiredError` → `410`
  - `ActionConflictError` → `409`
  - `PendingLimitError` → `429`
- Execution failures map to `502` and mark invocation `failed`.

### Reliability
- Pending approvals expire after 5 minutes (`PENDING_EXPIRY_MS`).
- Max pending approvals per session is 10 (`MAX_PENDING_PER_SESSION`).
- Gateway invoke rate limit is 60/min/session (in-memory map).
- Connector tool cache TTL is 5 minutes per session (in-memory).
- Connector tool listing timeout is 15s; tool call timeout is 30s.

### Testing Conventions
- Current automated coverage is service-focused:
  - `packages/services/src/actions/service.test.ts`
  - `packages/services/src/actions/connectors/client.test.ts`
  - `packages/services/src/actions/connectors/risk.test.ts`
- Gateway route-level tests for `apps/gateway/src/api/proliferate/http/actions.ts` are currently absent.

---

## 6. Subsystem Invariants

### 6.1 Catalog Invariants
- `GET /:sessionId/actions/available` must return a merged catalog of:
  - Active session provider integrations with registered modules.
  - Enabled org connectors with non-empty discovered tool lists.
- Connector/tool discovery failures must degrade to omission, not global request failure.
- User source-level disable preferences must be enforced in both listing and invoke paths.

### 6.2 Invocation and Policy Invariants
- Every invocation must resolve to exactly one mode and one mode source.
- Mode resolution order must remain: automation override → org default → inferred default.
- Unknown/invalid stored mode values must fail safe to denied invocation with `unknown_mode:*`.
- Policy key format must remain `sourceId:actionId` across org and automation maps.

### 6.3 State Machine Invariants
- Allowed persisted statuses are: `pending`, `approved`, `executing`, `completed`, `denied`, `failed`, `expired`.
- `approveAction` and `denyAction` must only transition from `pending`; all other origins are conflicts.
- Pending records must have bounded lifetime (`expiresAt`) and be swept to `expired`.
- `allow` mode must create approved invocation before execution begins.
- `deny` mode must persist denied invocation (with policy reason) without execution.

### 6.4 Auth and Transport Invariants
- Only sandbox auth can call `/invoke`.
- Approval/denial requires user auth plus org role `owner|admin`.
- Session-scoped sandbox callers can only read invocations from their own session.
- User callers must belong to session org to list/inspect/approve/deny.

### 6.5 Execution and Persistence Invariants
- Gateway must mark execution lifecycle (`approved` → `executing` → `completed|failed`) around action execution.
- Persisted results must always be redacted for sensitive keys and structurally truncated to valid JSON.
- Gateway responses for executed actions may include truncated result payloads; DB persistence applies redaction/truncation regardless.
- External action credentials must never be returned to clients or sandbox filesystem by actions routes.

### 6.6 Approval and Notification Invariants
- Pending invocations must produce `action_approval_request` WS messages best-effort.
- Successful/failed executions after approval must produce `action_completed`.
- Explicit denials must produce `action_approval_result` with `status: denied`.
- Approval routes do not emit a distinct "approved" WS event before execution.

### 6.7 Connector Invariants
- Connector calls are stateless per operation (fresh MCP client/transport per list/call).
- 404/session invalidation on call retries once with re-initialized connection.
- Drift checks compare current definition hash against persisted connector override hash when available.
- Drift guard may only tighten policy; it must never relax policy.

### 6.8 UI Policy Surface Invariants
- Org-level mode management writes `organization.action_modes`.
- Automation-level mode management writes `automations.action_modes`.
- Inbox, integrations, and automation permission UIs all mutate the same mode maps and must preserve key format invariants.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()`, `integrations.getToken()` | Provider availability + token resolution |
| `integrations.md` | Actions ↔ Connectors | `connectors.listEnabledConnectors()`, `connectors.getConnector()`, `connectors.getToolRiskOverrides()` | Connector catalog + drift inputs |
| `secrets-environment.md` | Actions → Secrets | `secrets.resolveSecretValue(orgId, key)` | Connector auth secret resolution |
| `auth-orgs.md` | Actions → Orgs | `orgs.getUserRole(userId, orgId)` | Approval role checks |
| `agent-contract.md` | Contract → Actions | `ACTIONS_BOOTSTRAP`, system prompt CLI instructions | Agent discovery and usage model |
| `sessions-gateway.md` | Actions → Gateway WS | `action_approval_request`, `action_completed`, `action_approval_result` | Human-in-loop signaling |
| `automations-runs.md` | Actions ↔ Automations | automation mode APIs + integration-action resolver | Automation-scoped permissions UI/metadata |
| `user-action-preferences` | Actions ↔ Preferences | `getDisabledSourceIds()` | Source-level visibility/enforcement |

### Security & Auth
- Sandbox tokens are limited to invoke/list/guide/status session surfaces.
- Approval/denial is user-authenticated and role-gated.
- Provider OAuth tokens and connector secrets are resolved server-side only.
- Redaction removes common sensitive keys before DB persistence.

### Observability
- Service logger namespace: `module: "actions"` and connector child modules.
- Key lifecycle logs: invocation creation, policy denial, pending approval, expiry sweep counts, connector call outcomes.
- Gateway in-memory counters/caches include periodic cleanup loops.

---

## 8. Acceptance Gates

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `packages/services/src/actions/service.test.ts` passes.
- [ ] `packages/services/src/actions/connectors/client.test.ts` and `risk.test.ts` pass.
- [ ] Manual smoke: `/available`, `/invoke` (allow/deny/pending), `/approve`, `/deny`, pending expiry sweep.
- [ ] Mode keys remain colon-delimited and produce effective policy resolution.
- [ ] Spec is updated whenever mode semantics, auth boundaries, or lifecycle invariants change.

---

## 9. Known Limitations & Tech Debt

- [ ] **Post-approval revalidation gap (High):** `approveAction()` currently transitions `pending -> approved` without re-evaluating policy mode/drift/live org kill-switch state at approval time; execution path trusts invocation payload captured at request time. Evidence: `packages/services/src/actions/service.ts:approveAction`, `apps/gateway/src/api/proliferate/http/actions.ts`.
- [ ] **Explicit TOCTOU contract for revocation overrides is not codified (High):** the spec does not yet enforce a formal rule that live credential revocations and org-level emergency denies must override previously pending approvals before side effects execute. Evidence: `docs/specs/actions.md`, `packages/services/src/actions/modes.ts`.
- [ ] **In-memory rate limiting**: gateway per-session limit is process-local; multi-instance deployments do not share counters.
- [x] **Automation override wiring in invoke path**: gateway `/invoke` forwards `session.automationId` to `actions.invokeAction()`, so automation mode overrides now apply in that path (`apps/gateway/src/api/proliferate/http/actions.ts`).
- [ ] **Connector drift hash persistence gap**: drift checks read `org_connectors.tool_risk_overrides[*].hash`, but there is no first-class write flow in current connector CRUD/permissions UI to persist these hashes.
- [x] **Inbox "Always Allow" key format**: inbox writes org mode keys as `${integration}:${action}`, matching resolver expectations (`apps/web/src/components/inbox/inbox-item.tsx`).
- [ ] **Connector permission UX gap**: integration detail page shows placeholder text for connector tool permissions; connector action-mode editing is not fully exposed there.
- [ ] **Action-level user preferences not enforced in gateway**: preference schema supports `actionId`, but gateway enforcement currently checks disabled sources only.
- [ ] **Legacy grant CLI commands remain**: sandbox CLI still exposes `proliferate actions grant*` commands even though gateway grant routes are removed.
- [ ] **Gateway route test gap**: no route-level automated tests currently cover `apps/gateway/src/api/proliferate/http/actions.ts`.
- [ ] **Database connectors planned**: provider-backed + MCP connector-backed sources are implemented; DB-native action sources are still planned.

---

## Source: `docs/specs/llm-proxy.md`

# LLM Proxy - System Spec

## 1. Scope & Purpose

### In Scope
- LiteLLM integration contract for Proliferate services and sandboxes.
- Virtual key lifecycle (team provisioning, key generation, key revocation).
- URL contract (`LLM_PROXY_URL`, `LLM_PROXY_ADMIN_URL`, `LLM_PROXY_PUBLIC_URL`) and sandbox-facing base URL rules.
- Spend ingestion from LiteLLM Admin REST API (`GET /spend/logs/v2`) into billing events.
- Per-org cursor semantics for LLM spend sync.
- Model routing contract between canonical model IDs, OpenCode provider config, and LiteLLM YAML routing.
- Environment configuration for proxy and provider credentials.
- Non-sandbox server-side proxy usage that is part of current runtime behavior.

### Out of Scope
- Billing policy, plan economics, and credit state machine behavior (see `billing-metering.md`).
- Session lifecycle orchestration (see `sessions-gateway.md`).
- Sandbox boot mechanics beyond LLM credential/base URL contract (see `sandbox-providers.md`).
- Secret storage and encryption lifecycle (see `secrets-environment.md`).
- LiteLLM internals that are not part of Proliferate-owned integration code.

### Feature Status

| Feature | Status | Evidence |
|---|---|---|
| Per-session virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Team provisioning before key generation | Implemented | `packages/shared/src/llm-proxy.ts:ensureTeamExists`, `packages/shared/src/llm-proxy.ts:generateSessionAPIKey` |
| Key scoping (`team_id=org`, `user_id=session`) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Budget cap on key generation (`max_budget`) | Implemented | `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`, `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Public/admin URL split and `/v1` normalization | Implemented | `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`, `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Sandbox injection (Modal + E2B) | Implemented | `packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox` |
| LLM spend sync dispatcher + per-org workers | Implemented | `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts` |
| Per-org spend cursor | Implemented | `packages/services/src/billing/db.ts:getLLMSpendCursor`, `packages/services/src/billing/db.ts:updateLLMSpendCursor` |
| Spend REST client (`/spend/logs/v2`) | Implemented | `packages/services/src/billing/litellm-api.ts:fetchSpendLogs` |
| Key revocation on pause/exhaustion paths | Implemented | `apps/web/src/server/routers/sessions-pause.ts:pauseSessionHandler`, `packages/services/src/billing/org-pause.ts:pauseSessionWithSnapshot`, `packages/shared/src/llm-proxy.ts:revokeVirtualKey` |
| Model routing in LiteLLM YAML | Implemented | `apps/llm-proxy/litellm/config.yaml` |
| Server-side proxy usage outside sandboxes | Implemented | `apps/worker/src/automation/configuration-selector.ts:callLLM` |

### Mental Models

The LLM proxy is an external LiteLLM service and this spec is the Proliferate-side contract for using it. The code here defines identity boundaries, billing attribution boundaries, and integration rules. It does not define LiteLLM internals.

Treat the proxy as two planes with different auth models:
- Control plane: server-side admin/API calls with `LLM_PROXY_MASTER_KEY` for team management, key generation, spend reads, and selected worker-side LLM calls.
- Data plane: sandbox LLM traffic authenticated with short-lived virtual keys that never expose real provider credentials.

Spend ingestion is eventually consistent. Billing correctness depends on idempotent event insertion, not on perfect cursor monotonicity from LiteLLM.

Model routing is a three-surface contract:
- Canonical model IDs in Proliferate (`packages/shared/src/agents.ts`).
- OpenCode provider config generated in sandbox (`packages/shared/src/sandbox/opencode.ts`).
- LiteLLM model mapping and aliases in YAML (`apps/llm-proxy/litellm/config.yaml`).

### Things agents get wrong

- The proxy is optional unless `LLM_PROXY_REQUIRED=true`; otherwise sessions can fall back to direct `ANTHROPIC_API_KEY` (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- `LLM_PROXY_API_KEY` is a staging env var between services and providers. The sandbox runtime actually consumes `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` (`packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`).
- Key generation is replace-by-alias, not append-only. Existing key aliases are revoked before generating a new key for the same session (`packages/shared/src/llm-proxy.ts:generateVirtualKey`).
- Team creation is not a separate operational step for callers. `generateSessionAPIKey` always enforces team existence (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`).
- `LLM_PROXY_PUBLIC_URL` controls sandbox-facing URL, not admin traffic (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`).
- E2B snapshot resume intentionally strips proxy credentials from shell profile re-export and only passes them to the OpenCode process env (`packages/shared/src/providers/e2b.ts:createSandbox`).
- Spend sync is no longer a single `syncLLMSpend` loop. It is a dispatcher queue plus per-org jobs (`apps/worker/src/billing/worker.ts`, `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts`).
- LiteLLM spend API auth/header format differs from key-generation auth. Spend reads use `api-key`, key/team management uses `Authorization: Bearer` (`packages/services/src/billing/litellm-api.ts:fetchSpendLogs`, `packages/shared/src/llm-proxy.ts:generateVirtualKey`).
- LiteLLM spend API date format is not ISO8601 in this integration; it requires `YYYY-MM-DD HH:MM:SS` UTC (`packages/services/src/billing/litellm-api.ts:formatDateForLiteLLM`).
- Spend log ordering is not assumed stable. Client-side sorting by `startTime` + `request_id` is required before cursor advancement (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).
- Cursor progression alone is not the dedup guarantee. Billing idempotency keying (`llm:{request_id}`) and `billing_event_keys` are the dedup authority (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`, `packages/services/src/billing/shadow-balance.ts:bulkDeductShadowBalance`).
- Not all proxy usage is sandbox virtual-key traffic. Worker configuration selection calls `/v1/chat/completions` server-side with master key and explicit `team_id` metadata (`apps/worker/src/automation/configuration-selector.ts:callLLM`).

---

## 2. Core Concepts

### Virtual Keys
LiteLLM virtual keys are short-lived credentials for sandbox data-plane requests. Proliferate mints them per session and org, with `key_alias=sessionId` for deterministic revocation and replacement (`packages/shared/src/llm-proxy.ts:generateVirtualKey`).

### Team Mapping
LiteLLM `team_id` is the organization ID. Team creation is idempotent with read-before-create plus duplicate-tolerant create handling (`packages/shared/src/llm-proxy.ts:ensureTeamExists`).

### URL Roles
- `LLM_PROXY_ADMIN_URL` (or fallback `LLM_PROXY_URL`) is used for admin and spend REST calls.
- `LLM_PROXY_PUBLIC_URL` (or fallback `LLM_PROXY_URL`) is what sandboxes should see.
- Sandbox SDK-facing URL is normalized to exactly one `/v1` suffix (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`).

### Spend Ingestion Contract
Billing workers read spend logs from LiteLLM REST API per org and convert positive-spend rows into bulk ledger deductions (`packages/services/src/billing/litellm-api.ts:fetchSpendLogs`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).

### Model Routing Contract
Canonical IDs map to OpenCode IDs in `packages/shared/src/agents.ts:toOpencodeModelId`, then resolve to provider-specific models in `apps/llm-proxy/litellm/config.yaml`. Non-Anthropic models use the `litellm` OpenCode provider block and still route through the same proxy base URL (`packages/shared/src/sandbox/opencode.ts:getOpencodeConfig`).

---

## 5. Conventions & Patterns

### Do
- Use `buildSandboxEnvVars()` as the single entry point for session sandbox LLM env resolution (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- Use `generateSessionAPIKey()` for session keys instead of calling `generateVirtualKey()` directly (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`).
- Derive `maxBudget` from shadow balance only in the sandbox env builder where billing context exists (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- Keep spend ingestion per-org and idempotent by using `llm:{request_id}` keys and bulk deduction (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).

### Don't
- Do not pass `LLM_PROXY_MASTER_KEY` into sandbox env.
- Do not assume `LLM_PROXY_API_KEY` is directly consumed by OpenCode. Providers must map it to `ANTHROPIC_API_KEY` and set `ANTHROPIC_BASE_URL` when proxy mode is active.
- Do not query LiteLLM tables directly from app code. Use the REST client (`packages/services/src/billing/litellm-api.ts`).
- Do not assume REST response ordering from `/spend/logs/v2`.

### Error Handling
- If proxy is required and `LLM_PROXY_URL` is missing, sandbox env build fails hard (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- If proxy is enabled and key generation fails, session creation fails hard; there is no silent fallback.
- Revocation is best-effort by design and must not block pause/termination flows (`packages/shared/src/llm-proxy.ts:revokeVirtualKey`, call sites in pause/enforcement paths).

### Reliability
- Key alias pre-revocation avoids uniqueness conflicts on resume/recreate (`packages/shared/src/llm-proxy.ts:generateVirtualKey`).
- Per-org LLM sync jobs are retried by BullMQ and fanned out per org (`llm-sync:${orgId}` naming), limiting failure blast radius to the affected org path (`packages/queue/src/index.ts`, `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- Cursor advancement happens even when all fetched rows are skipped for zero/negative spend, preventing endless re-fetch loops (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).

### Testing Conventions
- There are currently no dedicated automated tests for this integration slice (virtual key lifecycle + spend sync).
- Validation is primarily runtime behavior plus worker logs and billing ledger outcomes.

---

## 6. Subsystem Deep Dives (Invariants and Rules)

### 6.1 Key Lifecycle Invariants
- Every session-scoped key must carry `team_id=orgId`, `user_id=sessionId`, and `key_alias=sessionId`.
- Team existence must be ensured before key generation.
- Key generation for an existing session alias must revoke prior alias-bound keys before minting a new key.
- Default key TTL is `LLM_PROXY_KEY_DURATION` or `24h` when unset.
- When billing context is available, `max_budget` must be derived from shadow balance dollars (`credits * 0.01`, clamped at `>= 0`).
- If proxy mode is active, inability to mint a key is a terminal session startup error.

### 6.2 Sandbox Injection and Routing Invariants
- Sandboxes must receive only virtual-key credentials (or direct key in fallback mode), never the master key.
- Proxy mode requires both `ANTHROPIC_API_KEY=<virtual-key>` and `ANTHROPIC_BASE_URL=<proxy-v1-url>` in runtime env.
- Providers must filter `ANTHROPIC_API_KEY`, `LLM_PROXY_API_KEY`, and `ANTHROPIC_BASE_URL` from generic pass-through env loops to avoid leaks and duplicate sources.
- E2B resume path must not persist proxy credentials in shell profile exports; credentials are process-scoped when launching OpenCode.
- If proxy mode is unavailable and not required, direct key fallback must remain functional.

### 6.3 Spend Sync Invariants
- LLM spend sync is a two-stage queue system: repeatable dispatcher (30s) plus per-org worker jobs.
- Only billable org states (`active`, `trial`, `grace`) are dispatched for sync.
- First sync for an org must start from a bounded lookback window (5 minutes) when no cursor exists.
- Spend API calls must include org scoping (`team_id`) and bounded time range (`start_date`, `end_date`).
- Log processing order must be deterministic (`startTime` asc, then `request_id` asc).
- Rows with `spend <= 0` are non-billable; rows with `total_tokens > 0 && spend <= 0` must raise anomaly logging.
- Billing event idempotency key is always `llm:{request_id}`.
- Cursor must advance to the latest processed log position even when no billable events are inserted.
- Enforcement decisions after deduction must follow billing service outputs (`shouldPauseSessions`, `shouldBlockNewSessions`) and preserve trial auto-activation and auto-top-up checks.

### 6.4 Revocation Invariants
- Revocation target is session alias, not raw key value.
- Revocation 404 responses are treated as success.
- Revocation is best-effort and non-blocking in pause/enforcement paths.
- Missing proxy URL or master key makes revocation a no-op, not a fatal error.

### 6.5 Model Routing Invariants
- Canonical model IDs must map deterministically to OpenCode provider IDs.
- LiteLLM YAML is the source of truth for final model/provider routing and aliases.
- Adding a user-selectable model requires synchronized updates across model catalog surfaces, not a one-file change.
- Non-Anthropic models must continue using the custom `litellm` provider configuration in OpenCode and route through the same proxy endpoint.

### 6.6 Server-Side Proxy Usage Invariants
- Server-side worker calls that use the proxy directly must authenticate with master key and must attach org attribution metadata when available.
- Server-side direct proxy calls are control-plane usage and must not be treated as sandbox virtual-key traffic.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions | Sessions -> LLM Proxy | `sessions.buildSandboxEnvVars()` | Session creation/resume chooses proxy vs direct key path and computes key budget input. |
| Sandbox Providers | Providers -> LLM Proxy | `getLLMProxyBaseURL()`, `envVars.LLM_PROXY_API_KEY` | Providers translate staging vars into OpenCode-consumable env and enforce filtering rules. |
| Billing | Billing -> LLM Proxy | `fetchSpendLogs()`, cursor CRUD, `bulkDeductShadowBalance()` | Billing owns charging policy; this integration owns spend ingestion contract and attribution fields. |
| Worker Queue | Worker -> LLM Proxy | Dispatch + per-org LLM sync jobs | Queue topology and retry behavior shape eventual consistency and failure isolation. |
| Agent Model Catalog | Shared -> LLM Proxy | `toOpencodeModelId()`, `getOpencodeConfig()`, LiteLLM YAML | Model IDs are stable only when shared model transforms and YAML routing stay aligned. |
| Automation Selector | Worker -> LLM Proxy | `configuration-selector.callLLM()` | Server-side LLM call path that uses proxy master key with org metadata, outside sandbox flow. |
| Environment Schema | Env -> LLM Proxy | `LLM_PROXY_*`, provider API key vars | Typed env schema is the contract surface for deployment configuration. |

### Security & Auth
- Master key scope is server-side only.
- Sandbox credentials are scoped virtual keys (or direct key in non-proxy fallback mode).
- Key/team admin endpoints use `Authorization: Bearer <masterKey>`.
- Spend REST endpoint uses `api-key: <masterKey>`.
- Provider env assembly explicitly strips proxy-sensitive keys from generic env forwarding paths.

### Observability
- Key generation success includes duration and optional max budget (`"Generated LLM proxy session key"` in `sandbox-env.ts`).
- Key generation failure is logged at error level before rethrow (`"Failed to generate LLM proxy session key"`).
- LLM sync dispatch emits org fan-out visibility (`"Dispatching LLM sync jobs"`).
- Per-org spend sync logs fetched/inserted totals and credit deductions (`"Synced LLM spend"`).
- Spend anomalies are explicitly logged for tokenized zero-spend rows.

---

## 8. Acceptance Gates

- [ ] Typecheck passes for touched TypeScript surfaces (if code changes are included with spec updates).
- [ ] `docs/specs/llm-proxy.md` reflects current worker job topology (dispatcher + per-org), not legacy `syncLLMSpend` wording.
- [ ] Section 6 remains invariant/rule based and avoids imperative step-by-step execution scripts.
- [ ] Section 3 and Section 4 are intentionally omitted; code is the source of truth for file tree and data models.
- [ ] Any newly introduced or changed `LLM_PROXY_*` env vars are reflected in `packages/environment/src/schema.ts`.

---

## 9. Known Limitations & Tech Debt

- No dedicated automated tests currently validate virtual-key lifecycle behavior end-to-end or spend-sync idempotency edge cases.
- Admin URL normalization is inconsistent across call paths: key/team management strips `/v1`, spend REST client does not. Misconfigured URLs can therefore behave differently between features.
- LLM sync dispatcher schedules every billable org every 30 seconds, even when an org has no recent spend, which can create avoidable control-plane traffic at scale.
- Worker-side configuration selection has a hardcoded model identifier (`claude-haiku-4-5-20251001`) and bypasses the shared model transform/YAML routing abstraction used by sandbox sessions.

---

## Source: `docs/specs/cli.md`

# CLI — System Spec

## 1. Scope & Purpose

### In Scope
- CLI runtime behavior (`proliferate`, `proliferate reset`, `--help`, `--version`)
- Device authentication lifecycle and token persistence
- Local state and config management under `~/.proliferate/`
- SSH key lifecycle (generate, reuse, upload public key)
- Gateway-native session creation and OpenCode attach
- Local-to-sandbox file sync semantics
- CLI-related service/router behavior used by auth, session metadata, and GitHub selection

### Out of Scope
- Gateway runtime internals after session creation (`sessions-gateway.md`)
- Sandbox provider boot internals (`sandbox-providers.md`)
- Global auth internals and key revocation UX (`auth-orgs.md`)
- Billing policy design (`billing-metering.md`)
- Nango/provider lifecycle outside CLI-specific handoff (`integrations.md`)

### Mental Models
- The CLI is an orchestrator, not a platform. It coordinates existing systems and exits.
- The authoritative runtime path is gateway-native for session creation and attach (`@proliferate/gateway-clients`).
- Device auth is a two-phase handshake: browser authorization marks state; poll completion mints the API key.
- `localPathHash` is device-scoped identity for a workspace, not a global repo identity.
- Sync is intentionally one-way (local -> sandbox) and best-effort relative to session startup.
- CLI UX is deterministic and linear: auth gate, config gate, session gate, sync, handoff to OpenCode.

### Things Agents Get Wrong
- Assuming API routes are in the streaming path. They are not; real-time flows are gateway-based.
- Assuming `/api/cli/*` routes are fully absent. This repo now provides compatibility handlers for `/api/cli/sessions`, `/api/cli/auth/device`, `/api/cli/auth/device/poll`, and `/api/cli/ssh-keys`, while broader CLI logic still lives under oRPC.
- Assuming device authorization itself creates the token. Token creation happens in poll completion (`pollDevice`).
- Assuming `hashLocalPath()` is the correct identifier for CLI sessions. Runtime uses `hashPrebuildPath()` (device-scoped).
- Assuming config precedence is env-over-file. `getConfig()` currently resolves `apiUrl` as file override first, then env/default.
- Assuming CLI session listings reflect gateway-created CLI sessions without drift. Legacy query filters still expect `session_type = "terminal"`.
- Assuming sync failure is fatal. Current runtime warns and continues.
- Assuming the CLI supports Windows. It exits early with a WSL2 recommendation.

---

## 2. Core Concepts

### 2.1 Device Auth Contract
- Device codes are short-lived, single-purpose records.
- User interaction happens on `/device`; CLI polling remains the source of completion for token issuance.
- Poll completion mints a better-auth API key and clears the consumed device-code row.
- Auth state is local-first and reused until health check fails.

Reference points:
- `packages/cli/src/state/auth.ts`
- `apps/web/src/server/routers/cli.ts` (`cliAuthRouter`)
- `packages/services/src/cli/service.ts`

### 2.2 Gateway-Native Session Contract
- CLI runtime creates sessions through `createSyncClient().createSession()` against gateway.
- `sessionType` and `clientType` are both explicitly `cli`.
- SSH-enabled CLI flows require immediate sandbox readiness (enforced in gateway session creator).
- Attach URL generation for OpenCode is a gateway proxy URL derived from token + session ID.

Reference points:
- `packages/cli/src/main.ts`
- `packages/gateway-clients/src/clients/sync/index.ts`
- `packages/gateway-clients/src/clients/external/opencode.ts`
- `apps/gateway/src/lib/session-creator.ts`

### 2.3 Device-Scoped Workspace Identity
- Workspace identity is derived from `{deviceId}::{path}` and hashed.
- Same path on different machines should not collide.
- Device ID persistence is local and stable after first generation.

Reference points:
- `packages/cli/src/lib/device.ts`
- `packages/cli/src/lib/ssh.ts`

### 2.4 Local State Security Baseline
- `~/.proliferate/` is created with restrictive directory permissions.
- Token/config/device-id writes are permissioned for single-user access.
- SSH private keys never leave the local machine.

Reference points:
- `packages/cli/src/state/config.ts`
- `packages/cli/src/state/auth.ts`
- `packages/cli/src/lib/ssh.ts`

### 2.5 API Surface Split
- CLI runtime currently mixes gateway HTTP, compatibility REST-style endpoints (`/api/cli/auth/*`, `/api/cli/ssh-keys`), and oRPC-backed server logic.
- oRPC is the authoritative router surface in web app code.
- Standalone compatibility routes bridge legacy CLI contracts while backend business logic remains service/oRPC-driven.

Reference points:
- `packages/cli/src/state/auth.ts`
- `apps/web/src/app/api/cli/sessions/route.ts`
- `apps/web/src/app/api/rpc/[[...rest]]/route.ts`
- `apps/web/src/server/routers/cli.ts`

---

## 5. Conventions & Patterns

### Do
- Keep the runtime path linear and explicit in `main.ts`.
- Use gateway clients for session creation, health checks, and OpenCode URL derivation.
- Use `hashPrebuildPath()` for CLI workspace identity.
- Preserve local file permission constraints (`0o700` dir, `0o600` state files).
- Treat gateway as source of truth for session creation semantics.

### Don’t
- Don’t introduce alternate orchestration paths in CLI command handling.
- Don’t route real-time/session streaming behavior through web API wrappers.
- Don’t assume `/api/cli/*` compatibility without verifying deployed routing.
- Don’t silently change session typing/origin semantics without updating gateway + services together.
- Don’t duplicate OpenCode binary resolution logic in new locations.

### Error Semantics
- Session creation errors are fatal and terminate the CLI process.
- Sync errors are warnings and do not block OpenCode launch.
- Token invalidation triggers state clear + re-auth path.
- Duplicate SSH key registration is treated as a safe, non-fatal condition in CLI auth flow.

### Reliability Semantics
- Device polling tolerates transient network failures and continues until timeout.
- CLI process exit code mirrors OpenCode child process exit.
- Missing SSH connectivity metadata (`sshHost`, `sshPort`) is treated as fatal for sync-enabled startup.

---

## 6. Subsystem Deep Dives (Invariants)

### 6.1 CLI Runtime Invariants
- CLI command surface is intentionally minimal: main flow plus reset.
- Unsupported platforms fail fast before any stateful operation.
- Unknown positional arguments do not create alternate commands; they fall through to main flow.
- Main flow ordering is fixed by dependency gates: auth must resolve before session creation.

Evidence:
- `packages/cli/src/index.ts`
- `packages/cli/src/main.ts`

### 6.2 Auth & Token Invariants
- Auth cache is optimistic but must pass gateway health check on each invocation.
- Device auth completion must return token + user + org before local auth state is written.
- Polling cadence is server-driven (`interval`) with hard attempt bounds in CLI.
- Device codes are single-use from a practical perspective: completion deletes the code record.
- SSH key bootstrap is part of post-auth readiness, but failure to register existing duplicates is non-fatal.

Evidence:
- `packages/cli/src/state/auth.ts`
- `apps/web/src/server/routers/cli.ts` (`createDeviceCode`, `authorizeDevice`, `pollDevice`)
- `packages/services/src/cli/service.ts`

### 6.3 Configuration & Identity Invariants
- Local config read must be side-effect free except for ensuring state directory existence.
- `apiUrl` resolution is deterministic and currently file-first over env/default.
- Device identity is lazily created once and reused.
- Workspace hash identity for CLI must remain device-scoped.

Evidence:
- `packages/cli/src/state/config.ts`
- `packages/cli/src/lib/device.ts`
- `packages/cli/src/lib/ssh.ts`

### 6.4 Session Creation Invariants
- Gateway session creation requires exactly one configuration source (`configurationId`, `managedConfiguration`, or `cliConfiguration`).
- SSH-enabled session requests are effectively immediate even if caller asks for deferred.
- Billing gate assertion runs before configuration resolution and session creation in gateway.
- CLI runtime session creation must include `cliConfiguration.localPathHash` and SSH public key.
- Gateway response is authoritative for whether sandbox connectivity is ready at return time.

Evidence:
- `packages/cli/src/main.ts`
- `apps/gateway/src/api/proliferate/http/sessions.ts`
- `apps/gateway/src/lib/configuration-resolver.ts`
- `apps/gateway/src/lib/session-creator.ts`

### 6.5 Sync Invariants
- File transfer direction is local-to-sandbox only.
- Missing local paths are filtered out rather than treated as hard errors.
- Remote writes occur as `root` over SSH, followed by ownership normalization to `user:user`.
- `.gitignore` filtering is conditional on `.gitignore` presence in each source directory.
- Sync job failure does not invalidate an already-created session.

Evidence:
- `packages/cli/src/lib/sync.ts`
- `packages/cli/src/main.ts`

### 6.6 OpenCode Handoff Invariants
- Attach URL is generated through gateway proxy semantics and includes encoded bearer token.
- Binary resolution must search development and installed layouts before failing.
- OpenCode child process inherits terminal stdio and runtime-filtered environment.
- Parent CLI exits with the child process exit code.

Evidence:
- `packages/gateway-clients/src/clients/external/opencode.ts`
- `packages/cli/src/agents/opencode.ts`
- `packages/cli/src/main.ts`

### 6.7 Web/Service CLI Surface Invariants
- Business logic for CLI metadata and auth state transitions lives in `packages/services/src/cli`.
- Web app CLI router exposes oRPC procedures under `/api/rpc`, not standalone REST handlers for every CLI domain.
- `/api/cli/sessions`, `/api/cli/auth/device`, `/api/cli/auth/device/poll`, and `/api/cli/ssh-keys` are standalone compatibility routes over service/oRPC logic.
- CLI GitHub selection is short-lived and consumed-on-success to avoid stale polling state.

Evidence:
- `apps/web/src/server/routers/cli.ts`
- `apps/web/src/app/api/rpc/[[...rest]]/route.ts`
- `apps/web/src/app/api/cli/sessions/route.ts`
- `packages/services/src/cli/service.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | CLI/Web -> Gateway | `createSyncClient`, `createOpenCodeClient`, `/proliferate/sessions` | Canonical session creation/attach contract |
| `sandbox-providers.md` | Gateway -> Provider | `create`, `snapshot`, `terminate` | SSH/immediate behavior is provider-backed |
| `auth-orgs.md` | CLI router -> Auth | `auth.api.createApiKey` | Poll completion mints API key |
| `billing-metering.md` | Gateway -> Billing | `assertBillingGateForOrg` | Enforced before session creation |
| `integrations.md` | CLI router/services -> Integrations/Nango | status/select/connect flows | GitHub connection check and selection handoff |
| `repos-prebuilds.md` | Gateway resolver -> Config/Repo linkage | CLI config+repo linking | Device-scoped workspace to configuration mapping |

### Security
- Device code TTL and one-time completion behavior reduce replay window.
- API keys produced by device flow are currently non-expiring.
- SSH private key material remains local; only public key is uploaded.
- Local auth/config/device identity files are permissioned for single-user access.

### Observability
- Gateway and web CLI paths emit structured logs with CLI-specific context.
- CLI process logging is user-facing (chalk/spinner UX), not centralized structured telemetry.

---

## 8. Acceptance Gates

- [ ] `docs/specs/cli.md` reflects current runtime contracts and drift points.
- [ ] Section 6 remains invariant-based (no imperative runbook steps).
- [ ] Mental model + agent-error guidance is updated from source behavior.
- [ ] Manual sanity checks pass for: auth flow, session creation, sync warning path, OpenCode handoff.
- [ ] Any behavior change introduced alongside this spec update is reflected in code and referenced specs.

---

## 9. Known Limitations & Tech Debt

- [x] **CLI auth endpoint compatibility surface**: compatibility handlers exist for `/api/cli/auth/*` and `/api/cli/ssh-keys` alongside `/api/cli/sessions`, reducing `/api/rpc` vs `/api/cli/*` contract drift (`apps/web/src/app/api/cli/auth/device/route.ts`, `apps/web/src/app/api/cli/auth/device/poll/route.ts`, `apps/web/src/app/api/cli/ssh-keys/route.ts`, `apps/web/src/app/api/cli/sessions/route.ts`).
- [ ] **Legacy session query filters**: CLI service list/resume queries still filter `session_type = "terminal"` while gateway CLI session creation uses `sessionType: "cli"`. Impact: stale CLI session views/resume logic risk.
- [ ] **`lib/api.ts` is stale and inconsistent**: it references endpoints and imports (`getAuth` from config module) that do not match current runtime path. Impact: dead-code traps and incorrect agent edits.
- [ ] **Duplicate OpenCode binary path logic**: both `packages/cli/src/lib/opencode.ts` and `packages/cli/src/agents/opencode.ts` implement similar resolution logic. Impact: drift risk and duplicated fixes.
- [ ] **Long-lived API keys**: device-flow API keys are created without expiration. Impact: credential lifetime risk.
- [ ] **Empty config sync defaults**: `CONFIG_SYNC_JOBS` is currently empty. Impact: user environment parity in sandbox relies mostly on repo contents and manual setup.

---

## Source: `docs/specs/repos-prebuilds.md`

# Repos & Configurations — System Spec

## 1. Scope & Purpose

### In Scope
- Repo CRUD, public GitHub search, and integration-scoped available repo listing.
- Repo connections (`repo_connections`) that bind repos to integrations for token resolution.
- Configuration CRUD (manual, managed, CLI) and configuration-repo associations via `configuration_repos`.
- Managed configuration resolution/creation for universal clients.
- CLI device-scoped configuration resolution/creation keyed by `userId + localPathHash`.
- Effective service command resolution (configuration override, repo fallback).
- Configuration env file spec persistence and gateway-side `save_env_files` interception.
- Base snapshot build worker (Layer 1) with queue + DB deduplication.
- Configuration snapshot build worker (Layer 2) including GitHub token resolution and failure handling.
- Setup finalization (snapshot capture + configuration update/create + optional session stop).

### Out of Scope
- Snapshot resolution at sandbox boot (`resolveSnapshotId`) and provider boot semantics — see `sandbox-providers.md`.
- Session lifecycle orchestration (create/pause/resume/delete, WebSocket runtime) — see `sessions-gateway.md`.
- Secret storage/encryption internals — see `secrets-environment.md`.
- OAuth lifecycle and org-scoped connector management — see `integrations.md`.
- Action runtime behavior using connectors — see `actions.md`.

### Mental Models

**Configuration is the runtime unit (legacy name: prebuild).**
A configuration is the reusable workspace contract used by session creation: repo set + workspace paths + optional snapshot + service/env defaults. The code has broadly migrated from `prebuild` naming to `configuration` entities (`packages/services/src/configurations/service.ts`, `apps/gateway/src/lib/configuration-resolver.ts`).

**Repo records and configuration records are intentionally decoupled.**
A repo can exist without a configuration, and a configuration is only org-authoritative through linked repos (not a direct `organization_id` column). Org checks traverse `configuration_repos -> repos` (`packages/services/src/configurations/service.ts:configurationBelongsToOrg`).

**Snapshot status encodes capability, not just progress.**
`default` means a clone-only configuration snapshot (fast boot, no dependency guarantees). `ready` means a finalized snapshot that includes setup work and should enable service command auto-start. The gateway derives `snapshotHasDeps` from status and snapshot provenance (`apps/gateway/src/lib/session-creator.ts`, `apps/gateway/src/lib/session-store.ts`).

**Service/env persistence is configuration-scoped and setup-session gated.**
`save_service_commands` and `save_env_files` write onto the configuration only during setup sessions (`apps/gateway/src/hub/capabilities/tools/save-service-commands.ts`, `apps/gateway/src/hub/capabilities/tools/save-env-files.ts`).

**Base and configuration snapshots are build-time concerns here; runtime selection is elsewhere.**
This spec owns build workers and status transitions (`apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`). Provider-layer snapshot selection is owned by `sandbox-providers.md`.

---

## 2. Core Concepts

### Configuration Types
- `manual`: user-created via web/API create flows (`packages/services/src/configurations/service.ts:createConfiguration`).
- `managed`: auto-created for universal clients (`apps/gateway/src/lib/configuration-resolver.ts:resolveManaged`, `packages/services/src/managed-configuration.ts`).
- `cli`: device-scoped configuration rows (`packages/services/src/cli/db.ts:createCliConfigurationPending`).

### Workspace Path
- Stored in `configuration_repos.workspace_path`, not derived at runtime.
- Single-repo create flows default to `"."`; multi-repo create flows use repo slug (`githubRepoName.split("/").pop()`).
- Resolution and sandbox boot consume persisted `workspacePath` directly (`packages/services/src/configurations/db.ts:getConfigurationReposWithDetails`, `apps/gateway/src/lib/session-creator.ts`).

### Snapshot Layers
- Base snapshot (Layer 1): OpenCode + shared tooling, tracked in `sandbox_base_snapshots` (`packages/services/src/base-snapshots/*`).
- Configuration snapshot (Layer 2): base + repos cloned, tracked on `configurations.snapshot_id/status` (`apps/worker/src/configuration-snapshots/index.ts`).
- Finalized snapshot (Layer 3): setup-captured workspace state promoted to `status = "ready"` (`apps/web/src/server/routers/configurations-finalize.ts`, `apps/gateway/src/hub/session-hub.ts:saveSnapshot`).

### GitHub Token Hierarchy
Both gateway runtime and worker build paths prefer repo-linked integrations, then fall back to org-wide integrations. They are independent implementations and can drift if edited separately (`apps/gateway/src/lib/session-creator.ts:resolveGitHubToken`, `apps/worker/src/github-token.ts:resolveGitHubToken`).

### Things Agents Get Wrong
- Calling this subsystem "prebuilds" as if that is still the active domain model. Runtime creation/resolution is configuration-based.
- Assuming configuration authorization is direct; it is relation-derived from linked repos.
- Assuming every configuration has repos at all times. Creation/rollback paths create transient repo-less states.
- Assuming one repo maps to one configuration. Repo-to-configuration is many-to-many via `configuration_repos`.
- Assuming `status = "default"` implies dependencies are installed. Gateway treats `default` as clone-only.
- Assuming service commands should be read from `repos.service_commands` directly; runtime must use shared resolver precedence.
- Assuming env file specs are API-only. The primary write path is intercepted agent tools in gateway setup sessions.
- Assuming configuration snapshots build for E2B. Non-Modal providers are marked default with no snapshot.
- Assuming managed configuration lookup is org-indexed in DB. Current implementation loads managed rows then filters in memory.
- Assuming CLI path uses distinct "prebuild" tables. It uses `configurations` plus compatibility naming in some clients/docs.
- Assuming `workspacePath` self-heals when repos are attached/detached. It does not normalize existing entries.
- Assuming public GitHub search is authenticated. It currently uses unauthenticated API calls from the web router.

---

## 5. Conventions & Patterns

### Do
- Route all DB access through services (`packages/services/src/repos`, `packages/services/src/configurations`, `packages/services/src/base-snapshots`).
- Use org checks that traverse repo ownership (`configurationBelongsToOrg`, `repoExists`) before serving configuration/repo data.
- Use shared command parsing/resolution from `@proliferate/shared/sandbox` (`parseServiceCommands`, `resolveServiceCommands`).
- Treat snapshot job dispatch as fire-and-forget; make queue failures non-fatal to repo/config creation (`requestConfigurationSnapshotBuild`).
- Use status transition helpers in `packages/services/src/configurations/db.ts` rather than ad-hoc updates in worker code.

### Don’t
- Don’t bypass services and query Drizzle directly in routers.
- Don’t infer org ownership from configuration row fields; no direct org FK exists on `configurations`.
- Don’t assume snapshot availability implies dependency availability (`default` vs `ready` semantics differ).
- Don’t persist service/env tool output outside setup sessions.
- Don’t assume Managed/CLI flows have identical status semantics.

### Error Handling
- Services throw `Error`; routers map to `ORPCError` codes (`apps/web/src/server/routers/repos.ts`, `apps/web/src/server/routers/configurations.ts`).
- Some side effects are best-effort with logging (for example repo-connection insert and auto-config creation), but configuration-repo link writes are fail-fast to preserve configuration integrity.

### Reliability
- Base snapshot queue: attempts `3`, exponential backoff `10s`, worker concurrency `1` (`packages/queue/src/index.ts`).
- Configuration snapshot queue: attempts `3`, exponential backoff `5s`, worker concurrency `2` (`packages/queue/src/index.ts`).
- Base snapshot dedupe is dual-layer: BullMQ `jobId` + unique DB key `(versionKey, provider, modalAppName)`.
- Configuration snapshot jobs intentionally use timestamped `jobId` to avoid stale failed-job dedupe (`packages/services/src/configurations/service.ts:requestConfigurationSnapshotBuild`).

### Testing Conventions
- There is no dedicated, focused test suite for repos/configurations/base-snapshot services today.
- Existing coverage is indirect (route/integration flows and worker tests in adjacent subsystems).
- High-value candidates: configuration org auth, workspace-path behavior on attach/detach, status transition guards.

---

## 6. Subsystem Invariants & Rules

### 6.1 Repo Lifecycle Invariants
- Repo identity is unique per org by `(organization_id, github_repo_id)` (`packages/db/src/schema/schema.ts:repos`).
- `createRepo` must be idempotent on that key; existing rows are returned instead of duplicated (`packages/services/src/repos/service.ts:createRepo`).
- Repo connection linking must be safe under retries (`onConflictDoNothing`) (`packages/services/src/repos/db.ts:createConnection`).
- `createRepoWithConfiguration` must not roll back repo creation if configuration auto-create fails; the repo remains valid (`packages/services/src/repos/service.ts:createRepoWithConfiguration`).

### 6.2 Configuration Lifecycle Invariants
- Configuration creation requires at least one repo ID and org ownership validation before inserts (`packages/services/src/configurations/service.ts:createConfiguration`).
- Configuration records are write-first, link-second; failed link insertion triggers explicit rollback delete.
- Configuration creation must always trigger snapshot build request (or default-without-snapshot fallback when Modal is unavailable).
- Configuration org authorization is relation-based and depends on at least one linked repo in the org.
- Managed and CLI creation paths must converge on the same tables (`configurations`, `configuration_repos`) even if naming differs externally.

### 6.3 Workspace Path Invariants
- `workspacePath` is immutable configuration metadata until explicitly rewritten in DB.
- Single-repo initial creation uses `"."`; multi-repo initial creation uses repo slug.
- CLI linkage always uses `"."` (`packages/services/src/cli/db.ts:upsertConfigurationRepo`).
- Attach/detach operations do not retroactively normalize other repo paths.

### 6.4 Service Command Invariants
- Stored command JSONB is untrusted and must be parsed/validated via shared schemas before runtime use.
- Resolution precedence is fixed: configuration-level commands win when non-empty; otherwise merge repo defaults with workspace context (`packages/shared/src/sandbox/config.ts:resolveServiceCommands`).
- Setup tooling may persist commands only when `session_type = "setup"` and configuration context exists (`apps/gateway/src/hub/capabilities/tools/save-service-commands.ts`).

### 6.5 Env File Invariants
- Env file specs are configuration-scoped JSONB and can be absent/null.
- Setup tooling may persist env file specs only in setup sessions (`save_env_files`).
- Env specs used during snapshotting must be scrubbed before snapshot and re-applied afterward when provider command execution is available (`apps/gateway/src/hub/session-hub.ts:saveSnapshot`).
- Env file spec paths are constrained to safe relative paths by tool input validation.

### 6.6 Base Snapshot Invariants
- Base snapshot freshness is keyed by `computeBaseSnapshotVersionKey()` plus provider/app-name dimensions.
- At most one canonical row exists per `(versionKey, provider, modalAppName)`; failed rows are reset to building on retry (`packages/services/src/base-snapshots/service.ts:startBuild`).
- Base snapshot builds are Modal-provider operations invoked by worker code only.

### 6.7 Configuration Snapshot Invariants
- Worker must skip rebuild when snapshot already exists and status is `default` or `ready`, unless `force = true`.
- Non-Modal configurations must be marked `default` without snapshot instead of failing.
- Private repos without a resolved GitHub token must fail the configuration build.
- Successful worker builds transition configuration to `status = "default"` with snapshot set, guarded by `status = "building" AND snapshot_id IS NULL`.
- Snapshot build requests are best-effort queue writes; queue failure must not fail configuration creation paths.

### 6.8 Resolver Invariants (Gateway)
- Exactly one resolution mode is valid: direct ID, managed, or CLI (`apps/gateway/src/lib/configuration-resolver.ts:resolveConfiguration`).
- Managed resolution without explicit repo IDs prefers an existing managed configuration for org, preferring one that already has a snapshot.
- CLI resolution is device-scoped by `(userId, localPathHash)` and may create both a CLI configuration and a local repo.
- CLI configuration-repo link failure is fatal in resolver/session-create flows; session creation does not proceed with partially linked configuration state.

### 6.9 Setup Finalization Invariants
- Finalization requires a setup session with sandbox and matching org.
- Repo resolution is deterministic but multi-repo + secrets requires explicit `repoId`.
- Snapshot capture must succeed before configuration promotion.
- Existing configuration update has precedence (`updateSnapshotId` then `session.configurationId`), otherwise a new configuration is created and linked.
- `keepRunning = false` triggers best-effort sandbox termination followed by session stop.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | Gateway → This | `resolveConfiguration()`, `configurations.getConfigurationReposWithDetails()` | Session creation depends on configuration resolution and repo linkage. |
| `sandbox-providers.md` | Worker/Gateway → Provider | `createBaseSnapshot()`, `createConfigurationSnapshot()`, `snapshot()` | This spec owns when these are called; provider spec owns how. |
| `integrations.md` | This → Integrations | `repo_connections`, installation/OAuth token resolution APIs | Used by worker and gateway GitHub token resolution. |
| `agent-contract.md` | Agent tools → This | `save_service_commands`, `save_env_files` interception | Gateway tools persist configuration runtime metadata. |
| `secrets-environment.md` | Finalize → Secrets | `secrets.upsertSecretByRepoAndKey()` | Finalization stores encrypted secrets out-of-scope here. |
| `actions.md` | Runtime usage | org connector lookup by org/session | Configuration-level connectors are legacy; runtime actions use org connectors. |

### Security & Auth
- Web routers rely on `orgProcedure` membership checks before calling services.
- Configuration access checks are enforced via repo linkage to org.
- Public repo search is unauthenticated against GitHub API with explicit user-agent.

### Observability
- Worker modules emit structured logs (`module: "base-snapshots"`, `module: "configuration-snapshots"`).
- Routers emit handler-scoped logs for create/update/failure paths.
- Critical logs include build start/complete/failure and token-resolution failure cases.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] Spec terminology is configuration-first and consistent with current code
- [ ] Section 6 remains declarative (invariants/rules), not imperative step-by-step execution

---

## 9. Known Limitations & Tech Debt

- [ ] **Managed configuration lookup is not org-indexed in DB query** — `findManagedConfigurations()` loads all managed rows and filters in memory by org. Impact: linear scan growth.
- [ ] **Configuration listing auth is post-query filtering** — `listConfigurations()` loads rows then filters by repo org in memory. Impact: unnecessary data scan and cross-org exposure risk surface in service layer.
- [ ] **Workspace path normalization is incomplete** — attach/detach flows do not rebalance existing paths (e.g., single `"."` to multi-repo layout). Impact: mixed path semantics across older/newer configs.
- [ ] **Setup finalization orchestration remains router-heavy** — snapshot, secret persistence, config mutation, and session updates are co-located in router code. Impact: reuse/testability friction.
- [ ] **Public GitHub search uses unauthenticated requests** — rate-limited to low default GitHub API quotas. Impact: degraded UX under load.
- [ ] **No webhook-driven automatic configuration snapshot refresh** — snapshots are primarily created on configuration creation/finalization, not on repo pushes. Impact: staleness until session-time git freshness.
- [ ] **Legacy repo snapshot columns still exist** (`repo_snapshot_*`) and are still read as fallback in gateway snapshot/deps heuristics. Impact: model complexity and drift between legacy/current snapshot paths.
- [ ] **Naming drift across layers** — some docs/CLI client APIs still expose `prebuild` terminology while backend entities are configuration-based. Impact: agent/operator confusion and migration friction.
- [ ] **Schema/API drift exists in compatibility shims** — service mappers currently emit compatibility defaults (e.g., `isPrivate: false`, `sandboxProvider: null`) that do not fully represent canonical schema state. Impact: risk of incorrect assumptions by callers.

---

## Source: `docs/specs/secrets-environment.md`

# Secrets & Environment — System Spec

## 1. Scope & Purpose

### In Scope
- Secret CRUD (create, list, delete, existence checks) through `apps/web/src/server/routers/secrets.ts` and `packages/services/src/secrets/`.
- Secret scoping across org-wide, repo-scoped, and configuration-linked contexts (`packages/services/src/secrets/db.ts`).
- Bulk `.env` import into encrypted secret records (`packages/services/src/secrets/service.ts:bulkImportSecrets`, `packages/shared/src/env-parser.ts:parseEnvFile`).
- Runtime environment submission to active sandboxes, including per-secret persistence decisions (`apps/web/src/server/routers/sessions-submit-env.ts`).
- Session boot env var assembly from encrypted secrets (`packages/services/src/sessions/sandbox-env.ts`).
- Configuration env file spec persistence via intercepted `save_env_files` (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `packages/services/src/configurations/db.ts:updateConfigurationEnvFiles`).
- Secret file CRUD (encrypted content at rest, metadata-only reads) for configuration workflows, plus optional live apply to an active session sandbox on upsert and boot-time decrypt/write into sandboxes (`apps/web/src/server/routers/secret-files.ts`, `packages/services/src/secret-files/`, `packages/services/src/sessions/sandbox-env.ts`).
- Org-level secret resolution for connector auth (`packages/services/src/secrets/service.ts:resolveSecretValue`).

### Out of Scope
- Tool schema definitions and sandbox tool injection (`agent-contract.md` §6, `sandbox-providers.md` §6.3).
- Sandbox provider internals for `createSandbox({ envVars, envFiles })` and `writeEnvFile()` (`sandbox-providers.md` §6.4).
- Configuration lifecycle and snapshot orchestration beyond env-file persistence (`repos-prebuilds.md`).
- Action execution policy and approval semantics that consume connector secrets (`actions.md`).
- UI interaction design for Environment panel and tool cards (`sessions-gateway.md` §6.1).

### Mental Models

The subsystem has three distinct planes that agents often conflate:

- **Vault plane (key/value):** `secrets` holds encrypted key/value records, with optional repo scope and optional configuration linkage. Runtime env injection reads from this plane (`packages/services/src/secrets/db.ts`, `packages/services/src/sessions/sandbox-env.ts`).
- **File-spec plane (declarative):** `configurations.envFiles` stores a declarative spec of which env files should be generated at sandbox boot (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `apps/gateway/src/lib/session-creator.ts`).
- **Secret-file plane (content blobs):** `secret_files` stores encrypted file contents and metadata. API reads remain metadata-only, while boot-time services paths decrypt content and materialize files in sandbox workspaces (`packages/services/src/secret-files/db.ts`, `packages/services/src/sessions/sandbox-env.ts`, `apps/web/src/server/routers/secret-files.ts`).

The encryption model is deployment-wide AES-256-GCM (`iv:authTag:ciphertext`) using `USER_SECRETS_ENCRYPTION_KEY` (`packages/services/src/db/crypto.ts`, `packages/shared/src/lib/crypto.ts`).

---

## 2. Core Concepts

### AES-256-GCM Encryption
Both secret values and secret-file contents are encrypted with AES-256-GCM before persistence. Decryption happens server-side only when needed for runtime injection or connector auth resolution.
- Reference: `packages/services/src/db/crypto.ts`, `packages/services/src/secret-files/service.ts`, `packages/services/src/sessions/sandbox-env.ts`.

### Secret Scope Axes
Secret reads are scope-sensitive:
- Session boot path: org-wide + repo-scoped + configuration-linked secrets, with deterministic precedence (`resolveSessionBootSecretMaterial`).
- Session boot file path: configuration-linked `secret_files` rows are decrypted and returned as file writes.
- Configuration checks: configuration-linked keys + org-wide fallback (`findExistingKeysForConfiguration`).
- Connector auth: org-wide keys only (`getSecretByOrgAndKey` requires `repo_id IS NULL`).
- Reference: `packages/services/src/secrets/db.ts`.

### Configuration Linking Is a Junction Concern
`createSecret` can receive `configurationId`, but linkage is written through `configuration_secrets` junction rows (`linkSecretToConfiguration`), which are then consumed during runtime session boot precedence resolution.
- Reference: `packages/services/src/secrets/service.ts:createSecret`, `packages/services/src/secrets/db.ts:linkSecretToConfiguration`.

### Runtime Submission Is Split-Path
`submitEnvHandler` always writes submitted values to sandbox runtime env (`provider.writeEnvFile`), but persistence and runtime writes are separate operations with different failure behavior.
- Reference: `apps/web/src/server/routers/sessions-submit-env.ts`.

### Env File Specs Are Declarative, Not Secret Storage
`save_env_files` stores a declarative spec on `configurations.envFiles`; providers apply that spec during boot. The spec does not itself store secret values.
- Reference: `apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `packages/services/src/configurations/db.ts`, `apps/gateway/src/lib/session-creator.ts`.

### Things Agents Get Wrong
- Secret bundles are no longer the active runtime model; current schema comment explicitly marks `secret_files` as replacing bundles (`packages/db/src/schema/schema.ts`).
- `packages/db/src/schema/secrets.ts` still defines bundle-era tables but is not the canonical export path (`packages/db/src/schema/index.ts` exports `schema.ts` + `relations.ts`).
- `request_env_variables` is not gateway-intercepted; it is a sandbox tool surfaced in UI via tool events (`packages/shared/src/opencode-tools/index.ts`, `apps/web/src/components/coding-session/runtime/message-handlers.ts`).
- `save_env_files` is gateway-intercepted and setup-session-only (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`).
- `checkSecrets` behavior changes when `configuration_id` is present; repo filtering is bypassed in that branch (`packages/services/src/secrets/service.ts:checkSecrets`).
- Session boot secret resolution is centralized in `resolveSessionBootSecretMaterial()` with precedence `configuration > repo > org` (`packages/services/src/sessions/sandbox-env.ts`).
- Secret-file API reads still return metadata only; decrypted file content is only surfaced through the internal boot path (`packages/services/src/secret-files/db.ts`, `packages/services/src/sessions/sandbox-env.ts`).

---

## 5. Conventions & Patterns

### Do
- Encrypt on every write path before DB insert/upsert (`packages/services/src/secrets/service.ts`, `packages/services/src/secret-files/service.ts`).
- Keep routers thin and delegate DB/business logic to services modules (`apps/web/src/server/routers/secrets.ts`, `apps/web/src/server/routers/secret-files.ts`).
- Return metadata only on read endpoints for secrets and secret files.
- Treat runtime env writes (`submitEnv`) and vault persistence (`createSecret`/`bulkImport`) as separate operations with separate error handling.

### Don't
- Do not return `encrypted_value` or `encrypted_content` through API responses.
- Do not log plaintext secret values; logs should only include safe identifiers (for example `secretKey`).
- Do not assume `save_env_files` persists values; it persists only file-generation spec metadata.

### Error Handling
- `DuplicateSecretError` and `EncryptionError` are translated by the secrets router to `409` and `500` respectively (`apps/web/src/server/routers/secrets.ts`).
- `submitEnvHandler` treats duplicate persistence as non-fatal (`alreadyExisted: true`) and continues processing (`apps/web/src/server/routers/sessions-submit-env.ts`).
- Secret file router enforces `admin`/`owner` for upsert/delete and returns `FORBIDDEN` otherwise (`apps/web/src/server/routers/secret-files.ts`).

### Reliability
- Encryption key validation is lazy per operation (`getEncryptionKey()`), not preflight startup validation.
- `buildSandboxEnvVars` tolerates per-secret decryption failures and continues with remaining keys.
- `submitEnvHandler` may persist some secrets before failing the overall request if sandbox write fails.
- Bulk import pre-filters existing org-scoped keys (`repo_id IS NULL`, `configuration_id IS NULL`) before insert, then returns `created` vs `skipped`.
- Tool callback idempotency for intercepted tools is provided in gateway memory by `tool_call_id` caching.

### Testing Conventions
- `packages/services/src/secrets/service.test.ts` validates core CRUD/import behavior with mocked DB+crypto.
- `apps/web/src/test/unit/sessions-submit-env.test.ts` validates per-secret persistence semantics and sandbox write behavior.
- `packages/shared/src/env-parser.test.ts` validates parser and path helper behavior used by bulk import.

---

## 6. Subsystem Deep Dives

### 6.1 Secret CRUD & Existence Checks (`Implemented`)
**What it does:** Manages encrypted key/value secrets and non-sensitive metadata APIs.

**Invariants:**
- Secret create writes must encrypt plaintext before DB insert.
- Secret list/check responses must never include ciphertext or plaintext.
- When `configurationId` is supplied to create, linkage is added through `configuration_secrets`.
- `checkSecrets` with `configuration_id` must resolve against configuration-linked keys plus org-wide fallback; without it, checks are org/repo scoped.

**Rules the system must follow:**
- Keep domain error translation explicit (`DuplicateSecretError`, `EncryptionError`).
- Preserve org isolation on every query predicate.

**Files:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/secrets/db.ts`.

### 6.2 Bulk Import (`Implemented`)
**What it does:** Converts pasted `.env` text into encrypted secret rows.

**Invariants:**
- Parser accepts `KEY=VALUE`, quoted values, and `export` prefix.
- Invalid/blank/comment-only lines are ignored rather than failing the import.
- Bulk insert must be idempotent for existing org-scoped keys (`repo_id IS NULL`, `configuration_id IS NULL`) via pre-filter + insert.
- API response must expose deterministic `created` count and explicit `skipped` keys.

**Rules the system must follow:**
- Encryption key must be required before bulk encrypting entries.
- Import path must not return secret values back to the caller.

**Files:** `packages/services/src/secrets/service.ts:bulkImportSecrets`, `packages/shared/src/env-parser.ts`, `packages/services/src/secrets/db.ts:bulkCreateSecrets`.

### 6.3 Secret-to-Sandbox Runtime Injection (`Implemented`)
**What it does:** Builds sandbox env vars during session creation and runtime boot.

**Invariants:**
- Runtime env assembly resolves all boot-time secret sources through `resolveSessionBootSecretMaterial({ orgId, repoIds, configurationId })`.
- Precedence is deterministic: configuration-scoped > repo-scoped > org-scoped.
- Boot-time resolver returns both merged env vars and decrypted secret file writes.
- Decrypt failures must not abort the full env assembly; failing keys are skipped and logged.
- Generated env vars merge with non-secret runtime keys (proxy keys, git token fallbacks).

**Rules the system must follow:**
- Secret decryption must happen server-side only.
- Provider invocation receives assembled env vars; provider internals remain out of scope for this spec.

**Files:** `packages/services/src/sessions/sandbox-env.ts`, `apps/gateway/src/lib/session-creator.ts`.

### 6.4 Runtime Submission & Persistence Toggle (`Implemented`)
**What it does:** Accepts environment values during a live session and optionally persists secrets.

**Invariants:**
- Every submitted secret/env var is written to sandbox runtime env map for the active session.
- Per-secret `persist` overrides the global `saveToConfiguration` fallback.
- Duplicate persistence attempts are non-fatal and surfaced as `alreadyExisted`.
- Sandbox write failure fails the request, even if some persistence already succeeded.

**Rules the system must follow:**
- Session ownership and active sandbox presence must be validated before writes.
- Persistence and runtime injection outcomes must be observable in returned `results`.

**Files:** `apps/web/src/server/routers/sessions.ts:submitEnv`, `apps/web/src/server/routers/sessions-submit-env.ts`.

### 6.5 Setup Finalization Secret Upsert (`Implemented`)
**What it does:** Stores repo-scoped secrets during setup finalization flows.

**Invariants:**
- Finalization secrets are encrypted before upsert.
- Upsert path targets repo-scoped secret records with conflict target aligned to schema uniqueness (`organization_id`, `repo_id`, `key`, `configuration_id` with `configuration_id = NULL` for repo-scoped writes).
- Multi-repo finalization must require explicit repo disambiguation when secret payload is present.

**Rules the system must follow:**
- Finalization must fail hard if secret persistence fails.

**Files:** `apps/web/src/server/routers/configurations-finalize.ts`, `packages/services/src/secrets/db.ts:upsertByRepoAndKey`.

### 6.6 Env File Spec Persistence via `save_env_files` (`Implemented`)
**What it does:** Persists configuration-level env file generation spec in setup sessions.

**Invariants:**
- Only setup sessions may call `save_env_files`.
- A valid configuration ID is required to persist the spec.
- File spec validation enforces relative paths, `format: "dotenv"`, `mode: "secret"`, and bounded file/key counts.
- Persisted spec is read during session creation and passed to provider as `envFiles`.

**Rules the system must follow:**
- The stored spec must remain declarative (no secret plaintext).
- Tool callback idempotency must use `tool_call_id` for retry safety.

**Files:** `apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `apps/gateway/src/api/proliferate/http/tools.ts`, `packages/services/src/configurations/db.ts`, `apps/gateway/src/lib/session-creator.ts`.

### 6.7 Secret Files (`Implemented`)
**What it does:** Stores encrypted file-content blobs keyed by configuration and path.

**Invariants:**
- Upsert encrypts content before persistence.
- Upsert can optionally apply file content to a live sandbox when `sessionId` is provided by the caller.
- Live apply path validation requires a relative workspace path (no absolute/traversal paths).
- List endpoint returns metadata only (ID/path/description/timestamps), never content.
- Delete is org-scoped by `secret_files.id` + `organization_id`.
- Upsert/delete require org `owner` or `admin`.
- List/upsert validate that `configurationId` belongs to the caller organization before touching `secret_files`.
- Session boot decrypts configuration-linked `secret_files` and injects them as file writes.

**Rules the system must follow:**
- Secret file content may only be decrypted in internal runtime paths (boot resolver and optional live apply); API responses remain metadata-only.
- Runtime live-apply uses provider `execCommand` without logging file content.

**Files:** `apps/web/src/server/routers/secret-files.ts`, `packages/services/src/secret-files/service.ts`, `packages/services/src/secret-files/db.ts`.

### 6.8 Connector Secret Resolution (`Implemented`)
**What it does:** Resolves org-level secrets for connector auth at runtime.

**Invariants:**
- Resolution targets org-wide keys (`repo_id IS NULL`) and returns decrypted plaintext or `null`.
- Resolution failures degrade gracefully to `null` and callers decide fallback behavior.

**Rules the system must follow:**
- Connector secret values must never be exposed in API responses or logs.

**Files:** `packages/services/src/secrets/service.ts:resolveSecretValue`, `apps/gateway/src/api/proliferate/http/actions.ts`, `apps/web/src/server/routers/integrations.ts`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions / Gateway | This → Sessions | `buildSandboxEnvVars()` | Resolves boot secret material (env vars + file writes) with precedence and decrypts values |
| Sessions / Gateway | This → Sessions | `submitEnvHandler()` | Writes runtime env values and optional persistence results |
| Gateway Tool Callbacks | This ← Gateway | `save_env_files` intercepted tool | Persists declarative env file spec to `configurations.envFiles` |
| Sandbox Providers | This → Providers | `provider.createSandbox({ envVars, envFiles, secretFileWrites })` | Providers receive assembled env vars, declarative env specs, and decrypted file writes |
| Sandbox Providers | This → Providers | `provider.writeEnvFile(sandboxId, envVarsMap)` | Runtime env submission path |
| Sandbox Providers | This → Providers | `provider.execCommand(sandboxId, ["sh","-lc", ...])` | Secret-file upsert optional live apply into active sandbox workspace |
| Actions / Integrations | Other → This | `resolveSecretValue(orgId, key)` | Connector auth resolves org-level secret by key |
| Configurations | This ↔ Configurations | `updateConfigurationEnvFiles`, `getConfigurationEnvFiles` | Env file spec persistence and retrieval |
| Config: `packages/environment` | This → Config | `USER_SECRETS_ENCRYPTION_KEY` | Required for all encrypt/decrypt paths |

### Security & Auth
- Secret and secret-file routes use `orgProcedure`; secret-file writes additionally require `owner`/`admin`.
- Ciphertext is persisted in DB; plaintext is only materialized in memory for runtime injection and connector resolution.
- List/check APIs intentionally omit secret plaintext and ciphertext fields.

### Observability
- `sandbox-env.ts` logs fetch/decrypt timings and per-key decrypt failures without values.
- `sessions-submit-env.ts` logs request counts, persistence stats, and sandbox write timings.
- Gateway tool callback route logs tool execution and deduplicates retries by `tool_call_id`.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/services/src/secrets/service.test.ts` passes
- [ ] `apps/web/src/test/unit/sessions-submit-env.test.ts` passes
- [ ] `packages/shared/src/env-parser.test.ts` passes
- [ ] Spec deep dives are invariant/rule based (no imperative execution recipes)
- [ ] Spec no longer documents bundle-era file-tree/data-model snapshots as source of truth

---

## 9. Known Limitations & Tech Debt

- [ ] **Stale bundle-era schema file remains in tree** — `packages/db/src/schema/secrets.ts` still models `secret_bundles`, while canonical exports point to `schema.ts`/`relations.ts`. Impact: easy agent confusion and wrong imports.
- [ ] **Configuration-linked secrets are not consumed in session boot path** — `getSecretsForConfiguration()` exists but `buildSandboxEnvVars()` currently reads `getSecretsForSession()` only. Impact: configuration-linked secret expectations can diverge from runtime injection behavior.
- [ ] **Secret file content is currently write-only in services layer** — no decrypt/read path exists beyond encrypted persistence and metadata listing. Impact: file-based secret UX is only partially wired to backend runtime flows.
- [x] **Conflict target alignment for repo-scoped writes** — `upsertByRepoAndKey` and `bulkCreateSecrets` now use schema-aligned conflict targets including `configurationId` and explicitly write `configurationId: null` for repo-scoped rows (`packages/services/src/secrets/db.ts`).
- [ ] **Potential duplicate-key ambiguity with nullable scope columns** *(inference from PostgreSQL NULL uniqueness semantics)* — uniqueness constraints that include nullable scope columns may permit duplicates where scope columns are null, and runtime query order does not define deterministic winner for duplicate keys. Impact: nondeterministic secret value selection in `buildSandboxEnvVars()` / `resolveSecretValue()`.
- [ ] **`createSecret` + configuration link is non-transactional** — secret insert and junction insert are separate operations. Impact: linkage can fail after secret row is created.
- [ ] **`submitEnv` can return failure after partial persistence** — secret persistence happens before sandbox write, and write failure aborts request. Impact: DB and runtime state may temporarily diverge.
- [ ] **Snapshot scrub/re-apply does not yet cover `secretFileWrites`** — snapshot scrub currently targets `configurations.envFiles` spec only. Impact: file-based secrets materialized from `secret_files` may persist in snapshots until scrub parity is added. Tracking: `TODO(secretfilewrites-snapshot-scrub-parity)` (see ISSUE-####).
- [x] **Finalize setup enforces upsert success** — finalize now treats failed `upsertSecretByRepoAndKey()` writes as fatal and returns an error instead of false success (`apps/web/src/server/routers/configurations-finalize.ts`).
- [ ] **No first-class secret value update endpoint** — users rotate by add/delete workflows instead of direct update.
- [ ] **No dedicated audit trail for secret mutations** — `created_by` exists but no append-only audit table records secret read/write/delete intent.
- [x] **Secret-file configuration ownership validation** — secret-file list/upsert now verify `configurationId` belongs to the caller org before proceeding (`apps/web/src/server/routers/secret-files.ts`).

---

## Source: `docs/specs/integrations.md`

# Integrations — System Spec

## 1. Scope & Purpose

### In Scope
- External connectivity lifecycle for org-scoped OAuth integrations (`nango`, `github-app`) and Slack workspace installations.
- OAuth session creation and callback persistence for Sentry, Linear, Jira, and optional GitHub-via-Nango.
- GitHub App installation callback persistence and lifecycle webhook state reconciliation.
- Nango auth/sync webhook reconciliation for integration status.
- Token resolution primitives for downstream runtimes (`getToken`, `resolveTokens`, `getIntegrationsForTokens`, `getEnvVarName`).
- Integration list/update/disconnect behavior, including visibility filtering and creator/admin permissions.
- Slack installation lifecycle (OAuth install, status, disconnect, support-channel setup, config strategy).
- Sentry/Linear/Jira metadata read APIs used during trigger/action configuration.
- Org-scoped MCP connector catalog lifecycle (CRUD, atomic secret provisioning, validation preflight).
- Integration request intake (`requestIntegration`) and connector/tooling support endpoints (`slackMembers`, `slackChannels`).

### Out of Scope
- Trigger runtime ingestion, normalization, dispatch, and polling ownership. See `docs/specs/triggers.md`.
- Action execution, grants, approvals, and risk enforcement for connector-backed tools. See `docs/specs/actions.md`.
- Session runtime behavior that consumes integration tokens. See `docs/specs/sessions-gateway.md`.
- Automation run behavior that consumes integration bindings/tokens. See `docs/specs/automations-runs.md`.
- Repo lifecycle beyond integration binding/orphan signaling. See `docs/specs/repos-prebuilds.md`.

### Mental Models
- Integrations is a control plane, not an execution plane: it stores connectivity references and resolves credentials; it does not run external actions itself.
- There are three credential substrates:
  - Nango-managed OAuth references in `integrations` (`provider="nango"`).
  - GitHub App installation references in `integrations` (`provider="github-app"`).
  - Slack bot credentials in `slack_installations` (encrypted token at rest), plus connector auth that resolves via org secrets.
- Provider modules are declarative capability descriptors (`ConnectionRequirement`), while broker wiring lives in integrations framework code.
- Webhooks/callbacks are state-reconciliation channels, not the source of runtime business logic.
- Connector catalog ownership is split intentionally: Integrations owns configuration persistence; Actions owns runtime tool execution policy.

### Things Agents Get Wrong
- GitHub does not have a single auth path. Default is GitHub App; Nango GitHub is optional behind `NEXT_PUBLIC_USE_NANGO_GITHUB` (`apps/web/src/lib/nango.ts`).
- Slack OAuth is not stored in `integrations`; it is stored in `slack_installations` (`packages/db/src/schema/slack.ts`).
- Nango OAuth callback persistence is an authenticated oRPC mutation (`integrations.callback`), not a public provider webhook endpoint (`apps/web/src/server/routers/integrations.ts`).
- `apps/web/src/app/api/webhooks/nango/route.ts` handles auth/sync reconciliation only; `forward` payloads are acknowledged as migrated to trigger-service.
- `apps/web/src/app/api/webhooks/github-app/route.ts` handles installation lifecycle only; non-installation events are acknowledged and not processed there.
- Visibility is enforced at SQL query time in `listByOrganization`, not in UI mappers (`packages/services/src/integrations/db.ts`).
- Disconnect authorization is not admin-only: members may disconnect only integrations they created (`apps/web/src/server/routers/integrations.ts:disconnect`).
- Integration callback persistence is idempotent by `connectionId`; re-auth updates status to `active` (`packages/services/src/integrations/service.ts:saveIntegrationFromCallback`).
- Nango-managed OAuth access tokens are never persisted locally; they are fetched from Nango at use time (`packages/services/src/integrations/tokens.ts`).
- Slack disconnect is best-effort upstream revocation: local status is still revoked even if Slack revoke fails.
- Connector validation is a preflight (`tools/list`) with diagnostics; it is not runtime policy enforcement.
- `getToken()` is the runtime token boundary for consumers; direct token reads from DB are not a supported pattern.

---

## 2. Core Concepts

### 2.1 Integration Record Types
- `integrations.provider` distinguishes auth mechanism:
  - `"nango"` for Nango-managed OAuth connections.
  - `"github-app"` for GitHub App installations.
- `integrationId` identifies the provider config key (`sentry`, `linear`, env-driven GitHub integration ID, or `github-app`).
- `connectionId` is the durable lookup key for token resolution (Nango connection ID or `github-app-{installationId}`).
- `status` is lifecycle state used by status endpoints and webhook reconciliation (`active`, `error`, `deleted`, `suspended`, etc.).
- Evidence: `packages/services/src/integrations/db.ts`, `packages/services/src/integrations/service.ts`, `packages/db/src/schema/integrations.ts`.

### 2.2 Provider Declarations vs Broker Mapping
- Provider modules declare abstract connection requirements via `ConnectionRequirement` (`type`, `preset`, optional label).
- Integrations framework maps those presets to concrete Nango integration IDs and session endpoints.
- Broker-specific SDK logic is intentionally outside provider action modules.
- Evidence: `packages/providers/src/types.ts`, `apps/web/src/lib/nango.ts`, `apps/web/src/server/routers/integrations.ts`.

### 2.3 OAuth Session Surfaces
- Session creation endpoints (`githubSession`, `sentrySession`, `linearSession`) are admin/owner-gated and return Nango connect session tokens.
- Callback persistence endpoint (`callback`) is also admin/owner-gated and writes integration references only.
- Evidence: `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`.

### 2.4 GitHub Auth Topology
- GitHub App path: install callback verifies installation, upserts `github-app` integration, optionally auto-adds installation repos.
- Nango path: enabled only when `NEXT_PUBLIC_USE_NANGO_GITHUB=true`; uses Nango connect session + callback persistence.
- Evidence: `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/hooks/use-github-app-connect.ts`, `apps/web/src/lib/nango.ts`.

### 2.5 Slack Installation Topology
- Slack uses a dedicated OAuth flow and table (`slack_installations`) with encrypted bot token.
- Slack status/config/member/channel APIs operate on active installation(s) scoped to org.
- Slack disconnect revokes upstream token best-effort, then marks local installation revoked.
- Evidence: `apps/web/src/app/api/integrations/slack/oauth/route.ts`, `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`.

### 2.6 Connector Catalog Topology
- Connectors are org-scoped `org_connectors` records managed via Integrations router + connectors service.
- Preset quick-setup can atomically create an org secret and connector in one DB transaction.
- Validation preflight resolves secret, calls MCP `tools/list` through Actions connector client, and returns diagnostics.
- Evidence: `packages/services/src/connectors/service.ts`, `packages/services/src/connectors/db.ts`, `apps/web/src/server/routers/integrations.ts`.

### 2.7 Token Resolution Boundary
- `getToken(integration)` chooses provider-specific retrieval:
  - GitHub App installation token (JWT + GitHub API, cached).
  - Nango connection token via `nango.getConnection`.
- `resolveTokens` deliberately returns partial successes and errors.
- `getIntegrationsForTokens` filters to active integrations in the caller org before token resolution.
- Evidence: `packages/services/src/integrations/tokens.ts`, `packages/services/src/integrations/github-app.ts`.

### 2.8 Visibility and Authorization Model
- Integration listing enforces visibility at query layer (`org`/`null` visible to all, `private` only creator).
- Sensitive mutations (`callback`, session creation, Slack connect/disconnect, connector CRUD) require admin/owner.
- Disconnect allows creator-or-admin semantics.
- Evidence: `packages/services/src/integrations/db.ts:listByOrganization`, `apps/web/src/server/routers/integrations.ts`.

Sections 3 and 4 were intentionally removed in this spec revision. File tree and data model structure are treated as code-owned source of truth.

---

## 5. Conventions & Patterns

### Do
- Keep all integration data access inside `packages/services/src/integrations/db.ts` and `packages/services/src/connectors/db.ts`.
- Keep router handlers thin and delegate business logic to services.
- Enforce org-role checks at router boundaries before mutation paths.
- Encrypt Slack bot tokens before persistence; decrypt only at call sites that need runtime API access.
- Use `getToken()` and `resolveTokens()` for runtime token retrieval flows.
- Treat connector validation as non-destructive preflight and return structured diagnostics.

### Don't
- Persist raw OAuth access tokens for Nango-managed integrations.
- Bypass org scoping for installation/connector lookup mutations.
- Couple provider action modules to Nango/GitHub/Slack SDK implementation details.
- Put connector runtime approval/risk enforcement in Integrations; that belongs to Actions.
- Route trigger forward events through web app webhook handlers during normal operation.

### Error Handling
- Normalize Nango SDK axios-shaped failures into explicit `ORPCError` messages (`handleNangoError`).
- Keep Slack revoke failures non-fatal during disconnect to prevent stuck local state.
- Return connector validation failures as `{ ok: false, diagnostics }` rather than throwing for expected connectivity/auth errors.

### Reliability
- GitHub installation tokens are cached in memory for 50 minutes in services and gateway auth helpers.
- Slack lookup/list endpoints use bounded request timeouts and pagination.
- Connector `createWithSecret` retries on unique-key races and auto-suffixes secret keys.
- Webhook handlers are idempotent status reconcilers and return success for migrated event types to avoid retry storms.

### Testing Conventions
- Prefer service-level tests for token resolution, callback idempotency, and status transitions.
- Mock Nango/GitHub/Slack/Sentry/Linear network calls in all integration tests.
- Add regression tests when touching authorization gates (`requireIntegrationAdmin`, creator-or-admin disconnect).

---

## 6. Subsystem Deep Dives

### 6.1 Integration Listing and Visibility Invariants — `Implemented`
- Listing must only return integrations in caller org.
- Visibility must be enforced in SQL (`org` + `null` visible to all members, `private` only creator).
- Provider summary booleans (`github/sentry/linear.connected`) must derive from returned visible set, not hidden rows.
- Integration update must only mutate `displayName` for an integration owned by org.
- Evidence: `packages/services/src/integrations/db.ts:listByOrganization`, `packages/services/src/integrations/service.ts:listIntegrations`, `packages/services/src/integrations/service.ts:updateIntegration`.

### 6.2 OAuth Session + Callback Invariants — `Implemented`
- `githubSession`, `sentrySession`, and `linearSession` must require admin/owner role.
- Session creation must bind Nango connect session to both end-user identity and org identity.
- GitHub Nango session endpoint must be feature-flag gated (`NEXT_PUBLIC_USE_NANGO_GITHUB`).
- Callback persistence must require admin/owner role.
- Callback persistence must be idempotent by `connectionId`; existing row must transition back to `active`.
- New callback persistence must create `integrations` row with `provider="nango"`, `status="active"`, `visibility="org"`.
- Evidence: `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`.

### 6.3 GitHub App Installation Invariants — `Implemented`
- Callback must authenticate caller (or redirect to sign-in with callback retry URL).
- OAuth start must require an admin/owner caller and mint base64url JSON state containing org/user context + nonce + timestamp + optional return URL, signed with server-side HMAC.
- Callback may receive missing `state` for direct GitHub install/manage callbacks (`setup_action=install|update`) and may fall back to the authenticated session active org.
- When present, signed state must be verified and rejected when tampered or expired before trusting state fields.
- Callback may accept GitHub opaque UUID-like state for direct install/manage callbacks (`setup_action=install|update`) by falling back to the authenticated session active org.
- Callback must re-validate that the authenticated user is an admin/owner in the resolved org before persistence (state org for signed payloads, active org for opaque fallback).
- Callback return URL must be sanitized to approved relative-path prefixes.
- Installation must be verified against GitHub API before persistence.
- Persistence must upsert by `(connectionId, organizationId)` using `connectionId = github-app-{installationId}`.
- Re-installation must reactivate status and refresh display name.
- Repo auto-add after installation is best-effort and must not block successful integration persistence.
- Evidence: `apps/web/src/app/api/integrations/github/oauth/route.ts`, `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/lib/github-app.ts`, `packages/services/src/integrations/db.ts:upsertGitHubAppInstallation`.

### 6.4 Disconnect and Orphan Handling Invariants — `Implemented`
- Disconnect must fail if integration is missing or not in caller org.
- Authorization: admin/owner may disconnect any; member may disconnect only rows they created.
- For Nango-backed rows, upstream Nango connection delete must be attempted before DB delete.
- For GitHub-related rows, repo orphan reconciliation must run after delete.
- Orphan reconciliation currently scans non-orphaned repos and counts repo connections per repo.
- Evidence: `apps/web/src/server/routers/integrations.ts:disconnect`, `packages/services/src/integrations/service.ts:deleteIntegration`.

### 6.5 Slack Lifecycle Invariants — `Implemented`
- Slack OAuth start must require authenticated session with active org and admin/owner role.
- OAuth state must embed org/user context + nonce + timestamp + optional relative return URL and must be HMAC-signed server-side.
- OAuth callback must reject missing params, invalid/unsigned/tampered state, and state older than 5 minutes.
- OAuth callback must re-validate that the authenticated callback user matches state user and is still an admin/owner in the state org.
- Slack token from OAuth exchange must be encrypted before persistence.
- Save path must upsert by `(organizationId, teamId)` semantics (create or reactivate/update existing install).
- Slack disconnect must mark local installation revoked even if upstream `auth.revoke` fails.
- Slack support-channel connect must persist at least support channel ID + invite URL on active install.
- Slack config updates must validate strategy constraints and org ownership of configuration IDs.
- Evidence: `apps/web/src/app/api/integrations/slack/oauth/route.ts`, `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`, `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`.

### 6.6 Metadata Query Invariants (Sentry/Linear/Jira) — `Implemented`
- Metadata endpoints must only operate on integration row in caller org.
- Metadata endpoints must require integration status `active` before external API calls.
- Credentials must be pulled from live Nango connection at request time.
- Sentry metadata must return `{ projects, environments, levels }` with fixed severity level set.
- Linear metadata must return teams/states/labels/users/projects from GraphQL response.
- Jira metadata must return `{ sites, selectedSiteId, projects, issueTypes }` via Atlassian Cloud REST API v3. Multi-site accounts are supported via `siteId` parameter; defaults to first accessible site.
- Evidence: `apps/web/src/server/routers/integrations.ts:sentryMetadata`, `apps/web/src/server/routers/integrations.ts:linearMetadata`, `apps/web/src/server/routers/integrations.ts:jiraMetadata`.

### 6.7 Token Resolution Invariants — `Implemented`
- Runtime token resolution must flow through `getToken()` provider branching.
- GitHub App token branch must use installation token retrieval with in-memory cache.
- Nango token branch must retrieve `credentials.access_token` via `nango.getConnection`.
- `resolveTokens()` must continue on per-integration failures and surface error list.
- `getIntegrationsForTokens()` must only return active integrations in caller org.
- `getEnvVarName()` must generate deterministic token env var names from integration type + short ID.
- Evidence: `packages/services/src/integrations/tokens.ts`, `packages/services/src/integrations/github-app.ts`.

### 6.8 Connector Catalog Invariants — `Implemented`
- Connectors must be org-scoped records with explicit `enabled` state.
- Connector CRUD mutations must require admin/owner role.
- Preset-based quick setup with `secretValue` must atomically create org secret + connector.
- Transactional quick setup must resolve secret-key collisions with `_2`, `_3`, ... suffixing.
- Validation must resolve secret value then run connector `tools/list`; failure must map to diagnostics classes (`auth`, `timeout`, `unreachable`, `protocol`, `unknown`).
- Integrations owns connector persistence only; action risk/approval/grants/audit remain in Actions.
- Evidence: `apps/web/src/server/routers/integrations.ts:createConnectorWithSecret`, `apps/web/src/server/routers/integrations.ts:validateConnector`, `packages/services/src/connectors/db.ts:createWithSecret`, `packages/services/src/connectors/service.ts`.

### 6.9 Webhook Reconciliation Invariants — `Implemented`
- Nango webhook signature verification must run when `NANGO_SECRET_KEY` is configured.
- Nango `auth` webhooks must update integration status transitions (`creation|override` success => `active`, `refresh` failure => `error`).
- Nango `forward` webhooks must be acknowledged as migrated, not processed in this route.
- GitHub App webhook must verify signature and only reconcile installation lifecycle statuses (`deleted`, `suspended`, `active`).
- Non-lifecycle GitHub events must be acknowledged as migrated to trigger-service.
- Evidence: `apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`.

### 6.10 Auxiliary Endpoint Invariants — `Implemented`
- `requestIntegration` is best-effort: it returns success even when email provider is missing/failing.
- `slackMembers` and `slackChannels` must verify installation belongs to caller org before listing data.
- Slack list endpoints must use decrypted installation bot token and exclude invalid member rows where applicable.
- Evidence: `apps/web/src/server/routers/integrations.ts:requestIntegration`, `apps/web/src/server/routers/integrations.ts:slackMembers`, `apps/web/src/server/routers/integrations.ts:slackChannels`, `packages/services/src/integrations/service.ts`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `docs/specs/actions.md` | Actions -> Integrations | `getToken()`, `resolveTokens()`, connector catalog reads | Actions consumes credentials + connector definitions; Actions owns runtime policy enforcement. |
| `docs/specs/triggers.md` | Triggers <-> Integrations | Nango/GitHub lifecycle status lookups and updates | Trigger-service owns forward event ingestion; integrations routes only reconcile auth/lifecycle state. |
| `docs/specs/sessions-gateway.md` | Sessions -> Integrations | GitHub/Nango token helpers, integration bindings | Session runtime consumes resolved credentials, not raw DB token fields. |
| `docs/specs/automations-runs.md` | Automations -> Integrations | integration bindings + token resolution | Automations use integration references for enrichment/execution context. |
| `docs/specs/repos-prebuilds.md` | Repos <-> Integrations | repo connection bindings, orphan signaling | Disconnect can mark repos orphaned if all links removed. |
| `docs/specs/secrets-environment.md` | Integrations -> Secrets | connector secret resolution and storage | Connector auth references org secrets; quick setup can create secret + connector together. |
| `docs/specs/auth-orgs.md` | Integrations -> Auth | `orgProcedure`, role lookup | All integration surfaces are org-scoped and role-gated for mutations. |
| `packages/providers` | Integrations -> Providers | `ConnectionRequirement` declarations | Provider declarations remain broker-agnostic; integrations maps presets to broker config. |

### Security & Auth
- All integration router handlers are org-scoped through `orgProcedure`.
- Mutation endpoints with credential impact enforce admin/owner checks.
- Disconnect uses explicit creator-or-admin guardrail.
- OAuth/bot secrets are never returned in API responses.
- Slack bot tokens are encrypted at rest and decrypted only for outbound Slack API calls.
- GitHub/Nango webhook handlers verify signatures when secrets are configured.

### Observability
- Integrations endpoints use structured logging with handler/module child loggers.
- Webhook handlers log lifecycle transitions and signature failures.
- Connector validation emits classified diagnostic failures for operator feedback.

---

## 8. Acceptance Gates

- [ ] Spec claims map to code paths in `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/`, `packages/services/src/connectors/`, and webhook/callback routes.
- [ ] Section 6 uses declarative invariants and rules (no imperative runbooks).
- [ ] Mental models and "things agents get wrong" are present and grounded in current code.
- [ ] No guidance suggests persisting raw OAuth tokens.
- [ ] Role and org scoping rules are explicit for every mutation class.
- [ ] Webhook boundary with trigger-service migration is explicit.
- [ ] Connector ownership split (Integrations persistence vs Actions enforcement) is explicit.

---

## 9. Known Limitations & Tech Debt

- [ ] **User-scoped credential resolution is not implemented.** `user_connections` was dropped and `getToken()` has no user-attribution branch yet. This blocks first-class user-authored external actions. Evidence: `packages/db/drizzle/0031_drop_user_connections.sql`, `packages/services/src/integrations/tokens.ts`.
- [ ] **GitHub App auth logic is duplicated across layers.** JWT/private-key import/token-cache logic exists in services, web lib, and gateway. Evidence: `packages/services/src/integrations/github-app.ts`, `apps/web/src/lib/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`.
- [ ] **Slack support-channel schema drift exists between generated and hand-written schema files.** `support_*` fields exist in `schema.ts` but are absent in `schema/slack.ts`; service code still reads/writes support fields. Evidence: `packages/db/src/schema/schema.ts`, `packages/db/src/schema/slack.ts`, `packages/services/src/integrations/db.ts`.
- [ ] **Slack support-channel mutation currently drops some inputs.** `updateSlackSupportChannel` ignores `channelName` and `inviteId` parameters (only ID + invite URL are persisted in this module). Evidence: `packages/services/src/integrations/db.ts:updateSlackSupportChannel`, `packages/services/src/integrations/service.ts:updateSlackSupportChannel`.
- [ ] **`packages/shared/src/contracts/integrations.ts` is not a full mirror of the active oRPC router surface.** Several live endpoints (connector CRUD/validate, Slack config/installations, requestIntegration) are router-only. Evidence: `packages/shared/src/contracts/integrations.ts`, `apps/web/src/server/routers/integrations.ts`.
- [ ] **Nango callback idempotency assumes globally unique `connectionId`.** Persistence lookup is by `connectionId` only, not `(orgId, providerConfigKey)`. Evidence: `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`, `packages/services/src/integrations/db.ts:findByConnectionId`.
- [ ] **Orphaned repo reconciliation is O(n) with per-repo count queries.** This can degrade with large org repo counts. Evidence: `packages/services/src/integrations/service.ts:handleOrphanedRepos`.
- [ ] **Nango webhook signature verification is bypassed when `NANGO_SECRET_KEY` is unset.** Useful for local dev but unsafe if misconfigured in shared environments. Evidence: `apps/web/src/app/api/webhooks/nango/route.ts:verifyNangoWebhook`.
- [ ] **Integration subsystem test coverage remains thin for critical edge cases.** Callback idempotency, role guards, and webhook status transitions need stronger regression coverage.

---

## Source: `docs/specs/auth-orgs.md`

# Auth, Orgs & Onboarding — System Spec

## 1. Scope & Purpose

### In Scope
- User authentication via better-auth (email/password plus GitHub/Google OAuth)
- Email verification flow (Resend-backed, environment-gated)
- Auth provider metadata for login UI
- Gateway WebSocket token issuance for authenticated users
- Organization model: personal org bootstrapping, team org creation, active-org switching
- Member management and invitation lifecycle
- Domain suggestions from organization allowed domains
- Onboarding status, onboarding completion, and trial activation handoff
- API key issuance/verification for CLI authentication
- Admin identity surface: super-admin checks, user/org listing, impersonation and org switching while impersonating
- Auth middleware chain: session resolution, API-key fallback, impersonation overlay

### Out of Scope
- Billing policy, credit math, metering, and enforcement logic (see `billing-metering.md`)
- Gateway-side WebSocket auth middleware and real-time session lifecycle (see `sessions-gateway.md`)
- Full CLI device-auth product flow and local runtime behavior (see `cli.md`)
- OAuth connection lifecycle via Nango/GitHub App (see `integrations.md`)
- Action execution policy beyond org-level mode persistence/read APIs (see `actions.md`)

### Mental Models
- Identity is a composed context, not a single token check. The effective actor is built from auth source resolution (`apps/web/src/lib/auth-helpers.ts`), optional impersonation overlay (`apps/web/src/lib/super-admin.ts`), and active organization context (`apps/web/src/server/routers/middleware.ts`).
- Organization membership is the primary authorization primitive. Most org-scoped reads re-check membership at service level, even when upstream middleware already required auth (`packages/services/src/orgs/service.ts`).
- `activeOrganizationId` is a routing hint, not a universal authorization guarantee. It is required for `orgProcedure`, but access to a specific org ID is still validated by membership checks in org services.
- better-auth owns identity write surfaces for core auth/org tables and plugin routes. The Proliferate service layer mainly adds read composition, enrichment, and product-specific behavior around those primitives.
- Onboarding completion is organization state, but UX safety behavior is user-aware: completion can be propagated across all user org memberships to prevent looping (`apps/web/src/server/routers/onboarding.ts`, `packages/services/src/orgs/db.ts`).
- Impersonation is an overlay on top of a real super-admin session. It does not create a second auth session; it rewrites effective user/org context for downstream handlers.

### Things Agents Get Wrong
- better-auth organization operations are server endpoints, not client-only helpers. The client SDK calls plugin-backed routes mounted under `apps/web/src/app/api/auth/[...all]/route.ts`.
- Org/member/invitation writes are mostly plugin-owned (`organization.create`, `organization.setActive`, `organization.inviteMember`, `organization.updateMemberRole`, `organization.removeMember`, `organization.acceptInvitation`) and are invoked in frontend code (`apps/web/src/components/settings/members/use-members-page.ts`, `apps/web/src/app/invite/[id]/page.tsx`).
- `orgProcedure` does not mean "input org ID equals active org ID". It only requires an active org to exist; service methods still enforce membership against the requested org ID (`apps/web/src/server/routers/orgs.ts`, `packages/services/src/orgs/service.ts`).
- Auth resolution precedence is strict: dev bypass, then API key, then cookie session (`apps/web/src/lib/auth-helpers.ts:getSession`).
- `DEV_USER_ID` bypass is active only in non-production and only when `CI` is false; this logic exists both in auth helpers and better-auth GET session route wrapper (`apps/web/src/lib/auth-helpers.ts`, `apps/web/src/app/api/auth/[...all]/route.ts`).
- "First organization" fallback is deterministic: membership rows are ordered by `member.createdAt` then `member.organizationId` (`packages/services/src/orgs/db.ts:getUserOrgIds`, `packages/services/src/cli/db.ts:getUserFirstOrganization`).
- Invitation acceptance is two-phase: pre-auth basic invite resolution via server action/service, then authenticated better-auth invitation fetch with email-match enforcement in UI (`apps/web/src/app/invite/actions.ts`, `apps/web/src/app/invite/[id]/page.tsx`).
- Personal-org deletion after invite acceptance is best-effort and intentionally blocked when org-scoped sessions still exist (`packages/services/src/orgs/db.ts:deletePersonalOrg`).
- API keys are created at CLI poll completion, not at device authorization submission (`apps/web/src/server/routers/cli.ts:pollDevice`).
- Super-admin status is environment-driven (`SUPER_ADMIN_EMAILS`), not persisted in DB (`apps/web/src/lib/super-admin.ts`).
- `admin.getStatus` is auth-required but not super-admin-only by design (it returns `isSuperAdmin: false` for normal users), while `adminProcedure` gates privileged admin endpoints (`apps/web/src/server/routers/admin.ts`).
- Onboarding gates are enforced in layout-level client routing using onboarding status and billing state, not only in route handlers (`apps/web/src/app/(command-center)/layout.tsx`, `apps/web/src/app/(workspace)/layout.tsx`).

---

## 2. Core Concepts

### better-auth
better-auth is the source framework for authentication/session/account lifecycle and plugin-backed org/API-key behavior.
- Reference: `apps/web/src/lib/auth.ts`

### Auth Context Composition
Auth context is built from middleware helpers, not directly from cookies everywhere. `requireAuth()` produces the effective user/session/org context and optional impersonation metadata consumed by oRPC middleware.
- Reference: `apps/web/src/lib/auth-helpers.ts`, `apps/web/src/server/routers/middleware.ts`

### Organization Plugin Ownership
The organization plugin is the write-plane for most organization lifecycle operations. Proliferate-specific oRPC routes primarily expose read composition and app-specific adjunct behavior.
- Reference: `apps/web/src/lib/auth-client.ts`, `apps/web/src/server/routers/orgs.ts`

### Invitation + Onboarding Coupling
Invitation acceptance is identity/org membership behavior, but post-accept UX (active-org switch and optional personal-org cleanup) is implemented in the invite experience and org service.
- Reference: `apps/web/src/app/invite/[id]/page.tsx`, `apps/web/src/app/invite/actions.ts`, `packages/services/src/orgs/service.ts`

### API Key Path for CLI
API keys are better-auth resources used as Bearer credentials in web middleware and internal verification routes. Org context can come from a validated `x-org-id` membership match, or from deterministic fallback membership lookup when no header is supplied.
- Reference: `apps/web/src/server/routers/cli.ts`, `apps/web/src/lib/auth-helpers.ts`, `apps/web/src/app/api/internal/verify-cli-token/route.ts`

### Super-Admin Impersonation
Impersonation is a cookie-backed overlay gated by super-admin checks and membership validation before activation or org switching.
- Reference: `apps/web/src/server/routers/admin.ts`, `packages/services/src/admin/service.ts`, `apps/web/src/lib/super-admin.ts`

---

## 5. Conventions & Patterns

### Do
- Use `protectedProcedure` for authenticated routes and `orgProcedure` when active-org context is required (`apps/web/src/server/routers/middleware.ts`).
- Re-check organization membership in service layer before returning org-scoped data (`packages/services/src/orgs/service.ts`).
- Use mapper functions to convert Drizzle rows into contract-facing shapes (`packages/services/src/orgs/mapper.ts`).
- Keep DB operations in `packages/services/src/**/db.ts` and keep routers thin.

### Don't
- Do not bypass better-auth plugin write endpoints with ad hoc router writes for org/invitation/member lifecycle.
- Do not treat `activeOrganizationId` as sufficient authorization for arbitrary org IDs.
- Do not add auth-table writes outside better-auth lifecycle hooks/plugins unless explicitly justified.
- Do not rely on frontend gating alone for security-sensitive checks.

### Error Handling
- Service-layer authz failures commonly return `null` or typed error results; routers map these to `ORPCError` status codes (`apps/web/src/server/routers/orgs.ts`, `packages/services/src/orgs/service.ts`).
- Admin impersonation validation uses typed domain errors (`ImpersonationError`) that routers translate to API error semantics (`packages/services/src/admin/service.ts`, `apps/web/src/server/routers/admin.ts`).

### Reliability
- Session duration is 7 days, with 24-hour update age (`apps/web/src/lib/auth.ts:session`).
- Invitation expiration is 7 days (`apps/web/src/lib/auth.ts:organization({ invitationExpiresIn })`).
- Impersonation cookie is httpOnly, strict sameSite, 24-hour max age (`apps/web/src/lib/super-admin.ts:setImpersonationCookie`).
- Personal org creation/deletion paths are intentionally best-effort and non-blocking relative to auth success UX.

### Testing Conventions
- Test service functions and route handlers (Vitest), especially auth context assembly and org membership enforcement.
- Validate both cookie-session and API-key auth paths when changing auth middleware behavior.
- Keep `DEV_USER_ID` bypass assumptions explicit in tests that cover local development vs CI/prod auth behavior.

---

## 6. Subsystem Invariants

### 6.1 Authentication Context Resolution — `Implemented`

**Invariants**
- Exactly one auth source produces the request identity: dev bypass, API key, or cookie session, in that precedence order.
- API-key auth is only valid when `auth.api.verifyApiKey` returns a valid key and backing user exists.
- If `x-org-id` is provided with API key auth, organization context is only accepted when membership exists; otherwise auth fails closed (no fallback org resolution).
- `requireAuth` never silently returns unauthenticated context; missing/invalid auth yields explicit unauthorized result.
- Impersonation overlay only applies when the real authenticated user is a super-admin.

**Rules**
- New authenticated surfaces must consume `requireAuth` or middleware built on it, not custom ad hoc auth parsing.
- Any new auth source must preserve deterministic precedence and explicit failure semantics.

**Evidence**
- `apps/web/src/lib/auth-helpers.ts`
- `apps/web/src/server/routers/middleware.ts`

### 6.2 Signup & Personal Organization Bootstrapping — `Partial`

**Invariants**
- User creation attempts personal org creation and owner membership creation via better-auth DB hooks.
- Personal org creation failure does not block user signup completion.
- Session creation attempts to stamp `activeOrganizationId` from first discovered membership.

**Rules**
- Keep this path non-blocking for auth UX, but treat failures as observable operational debt.
- Any change to personal-org semantics must preserve idempotency/safety across retries and collisions.

**Evidence**
- `apps/web/src/lib/auth.ts:databaseHooks`

### 6.3 Email Verification & Invitation Email Delivery — `Implemented`

**Invariants**
- Email verification enforcement is environment-gated and can hard-block login until verification.
- If email delivery is enabled, `RESEND_API_KEY` and `EMAIL_FROM` are required at startup.
- Invitation records can still be created when email delivery is unavailable; email send is skipped with warning.

**Rules**
- Verification requirements and invitation delivery behavior must remain configuration-driven, not hardcoded by environment assumptions.

**Evidence**
- `apps/web/src/lib/auth.ts`

### 6.4 Organization Reads/Writes Authorization Boundary — `Partial`

**Invariants**
- Custom oRPC org routes provide read operations (org list, org detail, members, invitations, domain suggestions, action modes) with service-level authz checks.
- Most org/member/invitation writes are performed through better-auth organization plugin endpoints called by frontend client SDK.
- `setActionMode` is an explicit exception handled in service/router with owner/admin enforcement.
- Service-layer write helpers for domains/member-role/member-removal exist but are not currently wired to oRPC routes.

**Rules**
- Keep write ownership explicit: either plugin-owned or service-owned, never ambiguous duplicate paths without clear rationale.
- Any org-scoped read route must validate membership against requested org ID.

**Evidence**
- `apps/web/src/server/routers/orgs.ts`
- `packages/services/src/orgs/service.ts`
- `apps/web/src/components/settings/members/use-members-page.ts`

### 6.5 Invitation Acceptance Experience — `Implemented`

**Invariants**
- Public basic invitation lookup only resolves pending, non-expired invitation metadata.
- Full invitation details require authenticated better-auth flow and intended email alignment.
- Successful acceptance switches active org to invited org and may attempt personal-org cleanup as best-effort.
- Rejection does not auto-create replacement org context; UX redirects to onboarding path.

**Rules**
- Preserve email-alignment guardrails on invite acceptance flows.
- Keep personal-org cleanup optional and failure-tolerant.

**Evidence**
- `packages/services/src/orgs/service.ts:getBasicInvitationInfo`
- `apps/web/src/app/invite/actions.ts`
- `apps/web/src/app/invite/[id]/page.tsx`

### 6.6 Onboarding & Trial Activation — `Implemented`

**Invariants**
- Onboarding status is org-scoped and returns safe defaults when no active org exists.
- `markComplete` updates the active org and attempts to mark all user orgs as complete to avoid onboarding loops.
- `getStatus` can auto-complete active org onboarding when another user org is already complete.
- Trial start chooses billing-enabled vs billing-disabled path; billing policy remains delegated to billing services.

**Rules**
- Keep billing policy and credit calculations out of auth/onboarding domain logic.
- Preserve loop-prevention behavior across org switching unless explicitly redesigned.

**Evidence**
- `apps/web/src/server/routers/onboarding.ts`
- `packages/services/src/onboarding/service.ts`
- `packages/services/src/orgs/db.ts`
- `apps/web/src/app/(command-center)/layout.tsx`
- `apps/web/src/app/(workspace)/layout.tsx`

### 6.7 API Key Lifecycle — `Implemented`

**Invariants**
- CLI API key issuance happens during device poll completion, not during device authorization submit.
- API key verification for web requests runs through better-auth and resolves org context via header-validated membership or deterministic fallback membership when no header is provided.
- Internal CLI token verification route is protected by service-to-service token and returns user plus best-effort org context.

**Rules**
- Keep API key value handling delegated to better-auth (hashing/verification), not custom crypto paths.
- Keep internal token-verification endpoints isolated behind service auth headers.

**Evidence**
- `apps/web/src/server/routers/cli.ts:pollDevice`
- `apps/web/src/lib/auth-helpers.ts:getApiKeyUser`
- `apps/web/src/app/api/internal/verify-cli-token/route.ts`

### 6.8 Super-Admin & Impersonation — `Partial`

**Invariants**
- Super-admin authority is derived from `SUPER_ADMIN_EMAILS` list.
- Privileged admin mutations (`listUsers`, `listOrganizations`, `impersonate`, `stopImpersonate`, `switchOrg`) require `adminProcedure` super-admin checks.
- Impersonation start and org switch both require membership validation against the impersonated user.
- Impersonation cookie state may become stale; admin status APIs degrade to non-impersonating state when referenced user/org no longer exists.

**Rules**
- Impersonation must remain an overlay with explicit audit identity (`realUserId`, `realUserEmail`) in middleware context.
- Any new privileged admin endpoint must explicitly choose between "auth-required" and "super-admin-required" semantics.

**Evidence**
- `apps/web/src/server/routers/admin.ts`
- `packages/services/src/admin/service.ts`
- `apps/web/src/lib/super-admin.ts`
- `apps/web/src/lib/auth-helpers.ts:requireAuth`

### 6.9 Organization Creation & Active Org Switching — `Implemented`

**Invariants**
- Team org creation is allowed via better-auth organization plugin with creator role set to owner.
- Active org switching is plugin-managed for normal users (`organization.setActive`) and cookie-overlay managed for impersonating super-admins.
- UI surfaces call plugin client methods directly for org create/switch in onboarding and dashboard settings flows.

**Rules**
- Keep plugin as default owner for org create/switch lifecycle unless there is a deliberate migration plan.

**Evidence**
- `apps/web/src/lib/auth.ts:organization`
- `apps/web/src/components/onboarding/step-create-org.tsx`
- `apps/web/src/components/dashboard/org-switcher.tsx`
- `apps/web/src/server/routers/admin.ts:switchOrg`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `billing-metering.md` | This → Billing | `autumnCreateCustomer()`, `autumnAttach()`, `TRIAL_CREDITS`, `initializeBillingState()` | Onboarding triggers billing initialization; billing owns policy and reconciliation |
| `cli.md` | CLI → This | `auth.api.createApiKey()`, `auth.api.verifyApiKey()`, device auth routes | Device auth mints API keys; auth middleware and internal routes verify them |
| `sessions-gateway.md` | Gateway → This | Web token claims (`sub`, `email`, `orgId`), auth helpers | Gateway trusts issued JWTs and user/org claim semantics |
| `integrations.md` | This → Integrations | `onboarding.getIntegrationForFinalization()`, GitHub integration status | Onboarding depends on org-bound integration state |
| `repos-prebuilds.md` | This → Repos | `getOrCreateManagedConfiguration()`, onboarding repo upsert path | Onboarding finalization provisions repo/configuration scaffolding |
| `actions.md` | This ↔ Actions | Org-level `actionModes` read/write surface | Auth/org scope stores org-level default action mode values |

### Security & Auth
- better-auth owns session/auth/account primitives and API key verification (`apps/web/src/lib/auth.ts`).
- oRPC authz tiers are explicit: `publicProcedure`, `protectedProcedure`, `orgProcedure` (`apps/web/src/server/routers/middleware.ts`).
- Impersonation metadata is propagated for audit-aware downstream behavior (`apps/web/src/lib/auth-helpers.ts`).
- Super-admin trust root is environment configuration, not mutable DB state (`apps/web/src/lib/super-admin.ts`).

### Observability
- Auth logger module: `apps/web/src/lib/auth.ts`
- Auth helper logger module: `apps/web/src/lib/auth-helpers.ts`
- Onboarding router logger: `apps/web/src/server/routers/onboarding.ts`
- Admin/router paths rely mostly on structured ORPC error mapping with contextual logs in services/routers

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Auth/org/onboarding/admin-related tests pass
- [ ] Spec reflects current architecture with Sections 3 and 4 intentionally removed, and Section 6 expressed as declarative invariants

---

## 9. Known Limitations & Tech Debt

- [ ] **Personal org creation is best-effort only** — signup hook uses `ON CONFLICT (slug) DO NOTHING`; collision/failure can leave user without auto-provisioned org. (`apps/web/src/lib/auth.ts`)
- [ ] **Service-layer org write paths are partially unwired** — `updateDomains`, `updateMemberRole`, `removeMember` exist in `packages/services/src/orgs/service.ts` but primary product writes use better-auth plugin calls from frontend. Ownership is duplicated and unclear.
- [ ] **First-org fallback is non-deterministic** — fallback org resolution uses first matched membership without explicit ordering in multiple paths (`packages/services/src/orgs/db.ts:getUserOrgIds`, `packages/services/src/cli/db.ts:getUserFirstOrganization`).
- [x] **Active org context can drift from current membership** — mitigated: `orgProcedure` middleware and `requireOrgAuth()` now verify membership on every request (`apps/web/src/server/routers/middleware.ts`, `apps/web/src/lib/auth-helpers.ts`). Remaining non-oRPC routes that only need auth (not org) still use `requireAuth()`.
- [ ] **Personal-org cleanup after invite accept is opportunistic** — deletion is skipped when org-scoped sessions exist, leaving extra personal orgs for some users (`packages/services/src/orgs/db.ts:deletePersonalOrg`).
- [ ] **`admin.sentryTestError` is publicly callable in oRPC router** — endpoint is not behind auth middleware in current code (`apps/web/src/server/routers/admin.ts`). If this is intended only for controlled environments, scope should be tightened or explicitly gated.

---

## Source: `docs/specs/billing-metering.md`

# Billing & Metering — System Spec

## 1. Scope & Purpose

### In Scope
- Billing state machine and enforcement per organization
- Shadow balance (local credit counter) and atomic deductions
- Compute metering for running sessions
- LLM spend sync from LiteLLM Admin API
- Credit gating for session lifecycle operations
- Billing event outbox posting to Autumn
- Reconciliation (nightly and on-demand fast reconcile)
- Trial credit provisioning and trial auto-activation
- Overage policy execution (`pause` vs `allow` with auto-top-up)
- Checkout flows for plan activation and credit purchases
- Snapshot quota and retention cleanup policies
- Atomic concurrent session admission enforcement
- Billing BullMQ workers and schedules

### Out of Scope
- LLM key minting/model routing (`llm-proxy.md`)
- Onboarding UX and org lifecycle (`auth-orgs.md`)
- Session runtime mechanics beyond billing contracts (`sessions-gateway.md`)
- Sandbox provider implementation details (`sandbox-providers.md`)

### Mental Model
Billing is a local-first control system with external reconciliation.

1. **Hot path is local and fail-closed.** Session start/resume decisions are made from org state + shadow balance in Postgres, not live Autumn reads.
2. **Ledger before side effects.** Usage is written locally as immutable billing events with deterministic idempotency keys, then posted to Autumn asynchronously.
3. **State machine drives access.** `billingState` controls whether new sessions are blocked and whether running sessions must be paused.
4. **Two independent cost streams, one balance.** Compute and LLM usage both deduct from the same `shadowBalance` and Autumn `credits` feature.
5. **Enforcement is pause-first, not destructive.** Credit enforcement attempts to preserve resumability via pause/snapshot flows.

### Things Agents Get Wrong
- Autumn is not part of the session start/resume gate; `checkBillingGateForOrg` is local (`packages/services/src/billing/gate.ts`).
- The shadow balance can be negative; overdraft is allowed briefly and then enforced (`packages/services/src/billing/shadow-balance.ts`).
- `trial` depletion transitions directly to `exhausted`; only `active` enters `grace` (`packages/shared/src/billing/state.ts`).
- `session_resume` skips the minimum-credit and concurrent-limit checks; it still enforces state-level blocking (`packages/shared/src/billing/gating.ts`).
- Gate concurrency checks are advisory; authoritative concurrent-limit enforcement happens at session insert under advisory lock (`packages/services/src/sessions/db.ts`).
- Trial/unconfigured orgs still get billing events inserted (`status: "skipped"`) for idempotency safety (`packages/services/src/billing/shadow-balance.ts`).
- LLM per-org sync jobs are not enqueue-deduped by `jobId`; idempotency is at billing-event level (`apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- Grace with `NULL graceExpiresAt` is treated as expired (fail-closed) (`packages/services/src/orgs/db.ts`, `packages/shared/src/billing/state.ts`).
- Billing feature flag off (`NEXT_PUBLIC_BILLING_ENABLED=false`) disables both gate enforcement and billing workers.
- `cli_connect` exists as a gate operation type but currently has no direct caller in runtime flows.

---

## 2. Core Concepts

### Autumn
External billing provider for subscriptions, checkout, and authoritative feature balances.
- Used in checkout, outbox posting, trial activation, and reconciliation.
- Not used in session admission hot path.
- Reference: `packages/shared/src/billing/autumn-client.ts`

### Shadow Balance
Per-org local credit balance used by the gate.
- Stored on `organization.shadow_balance`.
- Deducted atomically with billing event insertion.
- Reconciled asynchronously against Autumn.
- Reference: `packages/services/src/billing/shadow-balance.ts`

### Billing State Machine
Org FSM that controls admission and enforcement behavior.
- States: `unconfigured`, `trial`, `active`, `grace`, `exhausted`, `suspended`.
- `exhausted` and `suspended` require pause enforcement for running sessions.
- Reference: `packages/shared/src/billing/state.ts`

### Billing Event Ledger + Outbox
`billing_events` is both immutable local usage ledger and outbox queue.
- Events are inserted first, then posted to Autumn later.
- Retry/backoff and permanent-failure signaling are outbox responsibilities.
- Reference: `packages/services/src/billing/outbox.ts`

### Overage
Optional auto-top-up behavior when credits go negative.
- `pause`: fail-closed enforcement.
- `allow`: attempt card charge in fixed packs with guardrails.
- Reference: `packages/services/src/billing/auto-topup.ts`

### Reconciliation
Corrects drift between local shadow balance and Autumn balances.
- Nightly full reconcile + on-demand fast reconcile.
- Reconciliation writes auditable records.
- Reference: `apps/worker/src/jobs/billing/reconcile.job.ts`, `apps/worker/src/jobs/billing/fast-reconcile.job.ts`

---

## 5. Conventions & Patterns

### Do
- Deduct credits only via `deductShadowBalance` / `bulkDeductShadowBalance`.
- Use deterministic idempotency keys:
  - Compute interval: `compute:{sessionId}:{fromMs}:{toMs}`
  - Compute finalization: `compute:{sessionId}:{fromMs}:final`
  - LLM event: `llm:{requestId}`
- Keep billing gate checks in service-layer gate helpers (`assertBillingGateForOrg`, `checkBillingGateForOrg`).

### Don’t
- Don’t call Autumn in session start/resume hot path.
- Don’t update `shadowBalance` directly from route handlers.
- Don’t bypass admission guard for billable session creation paths.

### Error Handling
- Billing gate is fail-closed on lookup/load failures.
- Worker processors isolate per-org/per-event failures where possible and continue batch progress.

### Reliability
- Metering/outbox/grace/reconcile/snapshot-cleanup/partition-maintenance workers run with BullMQ concurrency `1`.
- LLM org sync worker runs with concurrency `5`.
- Fast reconcile worker runs with concurrency `3`.
- Outbox retry uses exponential backoff (`60s` base, `1h` cap, `5` max attempts).

---

## 6. Subsystem Deep Dives (Declarative Invariants)

### 6.1 Compute Metering — `Implemented`

**Invariants**
- Only `sessions.status = 'running'` are metered (`packages/services/src/billing/metering.ts`).
- A compute interval is billable at most once by deterministic idempotency key.
- Metering skips intervals under `METERING_CONFIG.minBillableSeconds`.
- Dead-sandbox finalization bills only through last-known-alive bound, not detection time.
- Dead sandboxes are transitioned to `paused` with `pauseReason: "inactivity"` (resumable behavior).

**Rules**
- Metered time boundary moves forward only after deduct attempt.
- Idempotency correctness is more important than real-time boundary smoothness.

### 6.2 Shadow Balance + Atomic Ledger Writes — `Implemented`

**Invariants**
- Deductions are atomic with event insert in one DB transaction with `FOR UPDATE` org row lock.
- Global idempotency is enforced by `billing_event_keys` before event insert.
- Duplicate idempotency key means no additional balance movement.
- Trial/unconfigured deductions write events as `status: "skipped"` (idempotency preserved, outbox ignored).
- State transitions are derived from post-deduction balance (`active|trial` depletion, grace overdraw).
- Overdraft cap is enforced after deduction (`GRACE_WINDOW_CONFIG.maxOverdraftCredits`).

**Rules**
- `addShadowBalance` and `reconcileShadowBalance` are the only non-deduct balance mutation paths.
- All balance corrections must write reconciliation records.

### 6.3 Credit Gating — `Implemented`

**Invariants**
- Service gate is the authoritative API for billing admission checks.
- Gate denies on load errors (fail-closed).
- When billing feature flag is disabled, gate allows by design.
- `session_start` and `automation_trigger` enforce:
  - state allow-list
  - minimum credits (`MIN_CREDITS_TO_START = 11`)
  - concurrent session limit
- `session_resume` and `cli_connect` enforce state rules only (no minimum-credit/concurrency check).

**Rules**
- Grace expiry denial should trigger best-effort state cleanup (`expireGraceForOrg`).
- UI helper checks (`canPossiblyStart`) are informative only; gate methods remain authoritative.

### 6.4 Atomic Concurrent Admission — `Implemented`

**Invariants**
- Concurrent limit enforcement at session insert is serialized per org using `pg_advisory_xact_lock(hashtext(orgId || ':session_admit'))`.
- Count set for admission is `status IN ('starting','pending','running')`.
- Session row insert and concurrency check happen in the same transaction.
- Setup-session admission uses the same lock and counting rules.

**Rules**
- Fast gate concurrency checks are not sufficient by themselves.
- Any new session-create path must use admission-guard variants when billing is enabled.

### 6.5 LLM Spend Sync — `Implemented`

**Invariants**
- Dispatcher periodically enumerates billable orgs and enqueues per-org jobs.
- Per-org worker pulls spend logs from LiteLLM Admin REST API, sorts deterministically, and converts positive spend to ledger events.
- Deduction path is bulk and idempotent (`llm:{request_id}` keys).
- Tokenized zero/negative spend records are treated as anomaly logs and are not billed.
- Cursor advancement occurs after deduction attempt.

**Rules**
- Duplicate org jobs are tolerated; idempotency keys protect financial correctness.
- Cursor movement and deductions should be reasoned about as eventually consistent, not atomic.

### 6.6 Outbox Processing — `Implemented`

**Invariants**
- Outbox only processes events in retryable states with due retry time.
- Outbox resolves Autumn customer identity from `organization.autumnCustomerId`; missing customer ID fails closed.
- Autumn denial attempts overage top-up before forcing `exhausted` enforcement.
- Event status transitions to `posted` only after denial/top-up/enforcement branches complete.
- Retry metadata (`retryCount`, `nextRetryAt`, `lastError`) is updated on failure.
- Permanent failures emit alerting logs.

**Rules**
- `skipped` events are never part of outbox processing.
- Outbox idempotency must rely on the original event idempotency key.
- If credits-exhausted enforcement fails to pause all targeted sessions, outbox processing throws so the event remains retryable.

### 6.7 Org Enforcement (Pause/Snapshot) — `Implemented`

**Invariants**
- Credit exhaustion enforcement iterates currently running sessions and applies lock-safe pause/snapshot.
- Per-session enforcement is migration-lock guarded (`runWithMigrationLock`).
- Snapshot strategy order is provider-capability aware: memory snapshot, then pause snapshot, then filesystem snapshot.
- CAS update with sandbox fencing prevents stale actors from overwriting advanced state.
- Enforcement prefers `paused` with reason codes over destructive terminal states.

**Rules**
- Failed pauses are logged and counted; failures do not abort entire org enforcement pass.
- Enforcement callers must expect partial success and re-entry in later cycles.

### 6.8 Overage Auto-Top-Up — `Implemented`

**Invariants**
- Auto-top-up executes only when policy is `allow` and circuit breaker is not active.
- Top-up path is outside shadow-balance deduction transaction.
- Per-org auto-top-up concurrency is serialized via dedicated advisory lock (`:auto_topup`).
- Monthly counters are lazily reset by `overage_cycle_month`.
- Guardrails: per-cycle velocity limit, minimum interval rate limit, optional cap, card-decline circuit breaker.
- Successful charge credits are applied via `addShadowBalance` after lock transaction commit.

**Rules**
- Top-up sizing is deficit-aware (`abs(deficit) + increment`), then pack-rounded and cap-clamped.
- Circuit breaker paths should fail closed and trigger enforcement.

### 6.9 Trial Activation + Checkout — `Implemented`

**Invariants**
- Trial provisioning sets plan selection and initializes trial balance when org is `unconfigured`.
- Trial depletion can attempt automatic paid plan activation (`tryActivatePlanAfterTrial`).
- Plan activation and credit purchase may return checkout URLs or immediate success.
- Immediate purchases attempt local balance credit and then enqueue fast reconcile.
- Legacy `/api/billing/*` endpoints are adapters; oRPC router is the primary API surface.

**Rules**
- Billing settings and plan mutations require admin/owner permissions.
- Customer ID drift from Autumn responses must be persisted back to org metadata.

### 6.10 Snapshot Quota Management — `Implemented`

**Invariants**
- Snapshot creation is guarded by `ensureSnapshotCapacity` in pause/snapshot handlers.
- Eviction order is deterministic: expired snapshots first, then oldest snapshots by `pausedAt`.
- Global cleanup worker evicts expired snapshots daily with bounded batch size.
- Snapshot resources are treated as free within quota (no credit charge).

**Rules**
- Snapshot DB reference clearing requires successful delete callback contract.
- Current provider delete callback is a no-op placeholder; eviction still clears DB refs through that contract.

### 6.11 Reconciliation — `Implemented`

**Invariants**
- Nightly reconciliation runs against billable orgs with Autumn customer IDs.
- Fast reconcile is on-demand and keyed by `jobId = orgId` to avoid queue spam per org.
- Reconciliation writes balance deltas to audit table and updates `lastReconciledAt`.
- Drift thresholds produce tiered warn/error/critical signals.

**Rules**
- Reconciliation should correct drift, not be part of hot-path admission.
- Staleness detection is part of operational health, not user-facing gating.

### 6.12 Billing Worker Topology — `Implemented`

| Queue | Cadence | Worker Concurrency | Purpose |
|---|---|---|---|
| `billing-metering` | every 30s | 1 | compute metering |
| `billing-outbox` | every 60s | 1 | Autumn posting retries |
| `billing-grace` | every 60s | 1 | grace expiry enforcement |
| `billing-reconcile` | daily 00:00 UTC | 1 | nightly shadow reconcile |
| `billing-llm-sync-dispatch` | every 30s | 1 | per-org LLM sync fan-out |
| `billing-llm-sync-org` | on-demand | 5 | org-level LLM spend sync |
| `billing-fast-reconcile` | on-demand | 3 | rapid balance correction |
| `billing-snapshot-cleanup` | daily 01:00 UTC | 1 | snapshot retention cleanup |
| `billing-partition-maintenance` | daily 02:00 UTC | 1 | partition/key retention maintenance |

**Rules**
- Worker startup is gated by `NEXT_PUBLIC_BILLING_ENABLED`.
- Repeatable schedules must stay idempotent under restarts.

### 6.13 Billing Event Partition Maintenance — `Implemented`

**Invariants**
- `billing_event_keys` provides global idempotency independent of table partitioning strategy.
- Daily maintenance attempts next-month partition creation and safely no-ops if `billing_events` is not partitioned.
- Old idempotency keys are cleaned based on hot-retention window.
- Candidate partition detachment is currently signaled via logs (operator runbook), not auto-detached.

**Rules**
- Financial correctness must not depend on whether physical partitioning is enabled.

### 6.14 Removed Subsystems — `Removed`

- Distributed lock helper was removed; BullMQ queue/worker semantics are used.
- Billing token subsystem and `sessions.billing_token_version` were removed.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `auth-orgs.md` | Billing ↔ Orgs | `orgs.getBillingInfoV2`, `orgs.initializeBillingState`, `orgs.expireGraceForOrg` | Billing state fields live on `organization` row. |
| `sessions-gateway.md` | Sessions → Billing | `assertBillingGateForOrg`, `checkBillingGateForOrg`, `getOrgPlanLimits` | Enforced in oRPC create, gateway HTTP create, setup-session flows, runtime resume path. |
| `sessions-gateway.md` | Billing → Sessions | `sessions.meteredThroughAt`, `sessions.lastSeenAliveAt`, session status transitions | Metering/enforcement update session lifecycle columns. |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes`, snapshot/pause/snapshot+terminate methods | Used by metering liveness and enforcement pause/snapshot. |
| `llm-proxy.md` | LLM → Billing | LiteLLM Admin spend logs API | Billing consumes spend logs via REST, not cross-schema SQL. |
| `automations-runs.md` | Automations → Billing | `automation_trigger` gate operation | Automation-created sessions use the same gate contract. |

### Security & Auth
- Billing procedures are org-scoped and role-gated (admin/owner for settings and purchasing).
- Billing events intentionally avoid prompt payloads and secrets.
- Runtime auth remains session/gateway-token based; no billing token layer exists.

### Observability
- Billing modules emit structured logs with module tags (`metering`, `outbox`, `org-pause`, `llm-sync`, `auto-topup`, `reconcile`).
- Alert-like log fields are used for permanent outbox failures, drift thresholds, and LLM anomaly detection.
- Outbox stats are queryable via `getOutboxStats` for operational dashboards.

---

## 8. Acceptance Gates

- Behavior changes in billing code must update this spec’s invariants in the same PR.
- Keep this spec implementation-referential; avoid static file-tree or schema snapshots.
- New billable admission paths must explicitly call billing gate helpers and admission guards.
- New balance mutation paths must go through existing shadow-balance service functions.
- New asynchronous billing jobs must define idempotency and retry semantics before merging.
- Update `docs/specs/feature-registry.md` when billing feature status or ownership changes.

---

## 9. Known Limitations & Tech Debt

### Behavioral / Financial Risk
- [x] **Enforcement retry path from outbox denial flow (P0)** — denied events now throw when credits-exhausted enforcement leaves failed targets, so outbox retries re-drive enforcement (`packages/services/src/billing/outbox.ts`, `packages/services/src/billing/org-pause.ts`).
- [ ] **LLM cursor update is not atomic with deduction (P1)** — cursor advance happens after `bulkDeductShadowBalance`, so worker crashes can replay logs (idempotent but noisy) (`apps/worker/src/jobs/billing/llm-sync-org.job.ts`).
- [x] **Outbox customer ID source (P1)** — outbox now posts against persisted `organization.autumnCustomerId` and fails closed when missing (`packages/services/src/billing/outbox.ts`).

### Reliability / Operational Risk
- [ ] **Metered-through crash window (P2)** — session `meteredThroughAt` update is separate from deduction transaction; idempotency prevents overcharge but can cause replay noise (`packages/services/src/billing/metering.ts`).
- [ ] **LLM dispatcher has no enqueue dedupe by org (P2)** — multiple jobs for same org can coexist under backlog conditions; correctness depends on idempotency keys (`apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- [ ] **Grace-null behavior is implicit (P2)** — `graceExpiresAt IS NULL` is treated as immediately expired (fail-closed) without explicit schema-level guardrails (`packages/services/src/orgs/db.ts`, `packages/shared/src/billing/state.ts`).

### Data Lifecycle / Drift
- [ ] **Partition archival remains operator-driven (P1)** — maintenance logs detachment candidates but does not auto-archive old partitions (`apps/worker/src/jobs/billing/partition-maintenance.job.ts`).
- [ ] **Snapshot provider deletion is placeholder (P2)** — provider delete hook is no-op until provider APIs exist (`packages/services/src/billing/snapshot-limits.ts`).
- [ ] **Fast reconcile trigger coverage is narrow (P2)** — direct enqueue currently happens in billing purchase/activation routes; other drift-inducing paths rely on nightly reconcile unless additional triggers are added (`apps/web/src/server/routers/billing.ts`).

---

## Source: `docs/specs/streaming-preview.md`

# Streaming & Preview Transport — System Spec (V2 "AnyRun" Architecture)

**Status:** `ACTIVE_IMPLEMENTATION_SPEC`

**Objective:** A unified, event-driven, zero-trust transport architecture for real-time agent devboxes. This replaces HTTP polling, embedded IDE servers, and direct browser-to-provider routing with a gateway-controlled daemon transport.

## 0. Clean-Slate Mandate

- **VS Code server is removed** from the target architecture.
- **HTTP polling is banned** for runtime freshness surfaces (terminal, changes, services, preview readiness).
- **Browser never sees provider tunnel URLs** (`*.e2b.dev` or equivalent).
- **`sandbox-daemon` replaces `sandbox-mcp` and in-sandbox Caddy** as the runtime transport/control component.

## 1. Transport Topology Decision (Single Source of Truth)

This spec uses one network model for runtime transport:

1. **Browser -> Gateway (Hop 1):**
- Browser uses stable Gateway endpoints only:
- `WSS /v1/sessions/:sessionId/stream`
- `HTTPS /v1/sessions/:sessionId/fs/*`
- `HTTPS :previewPort-:sessionId--preview.<gateway-domain>/*` (wildcard preview host)

2. **Gateway -> Sandbox (Hop 2):**
- Gateway dials sandbox ingress via provider tunnel host.
- For E2B, host is resolved by port using `sandbox.getHost(port)`.
- Gateway signs each request with `X-Proliferate-Sandbox-Signature` (`HMAC(method + path + body_hash + exp + nonce)`).
- `sandbox-daemon` validates signature + expiry + nonce replay cache.

Important:
- This V2 transport **does not** depend on a sandbox-initiated outbound control websocket for runtime readiness.
- Readiness is based on successful signed health check over provider ingress.
- For Kubernetes self-host mode, gateway must route to sandbox-daemon over internal cluster networking (service DNS/pod IP), not per-session public ingress.

## 2. `sandbox-daemon` Responsibilities

`/sandbox-daemon` runs as PID 1 and owns runtime transport.

Process supervision requirement:
- Sandbox runtime must correctly reap child processes and forward signals.
- Acceptable patterns:
  - `tini`/`dumb-init` as PID 1 launching `sandbox-daemon`, or
  - daemon implementation explicitly handling init-style reaping/signal duties.

### 2.1 Unified in-sandbox router (no Caddy)
`/sandbox-daemon` binds to one exposed sandbox port and routes in memory:
- `/_proliferate/pty/*` -> PTY attach/input/replay APIs
- `/_proliferate/fs/*` -> file tree/read/write APIs
- `/_proliferate/events` -> unified event stream feed
- `/*` -> dynamic reverse proxy to active preview app port

No runtime Caddyfile rewrite/reload loop in target architecture.

Preview proxy compatibility requirements:
- Daemon reverse proxy must preserve `Host` and forwarding headers needed by modern dev servers.
- Daemon reverse proxy must support HTTP upgrade and bidirectional websocket proxying for HMR (Vite/Next.js/Fast Refresh).

### 2.2 PTY replay contract
- Per-process ring buffer: max `10,000` lines OR `8MB`.
- Max line length: `16KB` (truncate over limit).
- Reconnect uses `last_seq` for delta replay.
- Cold restart resets daemon buffer; client falls back to durable DB history surfaces.

### 2.3 FS jail contract
- Workspace root is canonicalized by `realpath`.
- Reject null byte paths.
- Resolve target via workspace-relative path.
- Reject traversal (`..`) and absolute escapes.
- Re-check resolved symlink targets under workspace before read/write.
- `/fs/write` max payload: `10MB`.

### 2.4 Dynamic preview port discovery
- Preferred path: harness/runner explicitly registers preview intent with daemon (port + intent metadata).
- Fallback path: daemon polls `ss -tln` every `500ms` when explicit registration is unavailable.
- Track safe candidate ports and select active preview target with stability gating.
- Only proxy allowlisted preview port ranges by policy (default `3000-9999`).
- Never proxy denylisted infra/internal ports (`22`, `2375`, `2376`, `4096`, `26500`) even if in range.
- Emit `port_opened` only after stability window/health check to avoid short-lived test-port flicker.
- Emit `port_closed` on durable closure.
- Gateway maps preview requests by host pattern (`:previewPort-:sessionId--preview`) to target session and safe port.

### 2.5 Daemon runtime modes
- `sandbox-daemon --mode=worker`:
  - Full PTY + FS + preview port watchers + agent stream ingestion.
- `sandbox-daemon --mode=manager`:
  - Minimal transport/control mode for lean manager sandboxes.
  - No FS watcher and no preview port watcher loops by default.

## 3. Unified Event Protocol

All runtime streams are multiplexed through one versioned envelope:

```json
{
  "v": "1",
  "stream": "pty_out | fs_change | agent_event | port_opened | sys_event",
  "seq": 1045,
  "event": "data | close | error",
  "payload": { "text": "npm install complete\\n" },
  "ts": 1708123456789
}
```

Backpressure:
- Per-client queue cap in Gateway: `1000` messages OR `2MB`.
- On overflow, disconnect slow consumer (`1011`) without affecting other viewers.

Gateway horizontal scale contract:
- Separate control-plane and data-plane streaming:
  - Control-plane events (invocation status, approvals, session state) may use shared backplane.
  - Data-plane events (`pty_out` and other high-frequency runtime streams) stay on session owner gateway path.
- Multiple gateway replicas require a shared control backplane (Redis Pub/Sub or equivalent).
- Session owner gateway maintains primary daemon data stream attachment.
- Browser connections must resolve to session owner gateway (owner lookup + redirect/proxy/consistent-hash strategy).
- Sticky sessions can improve locality but are not a complete correctness mechanism.
- On owner loss, ownership transfers and new owner reattaches using replay/reconciliation contracts.

Initial hydration requirement:
- Before applying websocket deltas, UI must fetch baseline runtime state:
  - `GET /v1/sessions/:id/fs/tree`
  - `GET /v1/sessions/:id/preview/ports`
- Websocket events are deltas layered on top of this baseline.

Reconnect reconciliation requirement:
- On daemon/harness reconnect after pause/resume, runtime must fetch pending invocation outcomes from gateway (for example approvals resolved while sandbox slept).
- Resume correctness must not depend solely on in-flight websocket push events.

## 4. E2B-Specific Contracts (from docs)

### 4.1 Ingress host resolution
- E2B requires explicit port host resolution (`getHost(port)`).
- Gateway resolves host by daemon ingress port for runtime transport.
- Preview traffic is routed through daemon reverse-proxy path on the same ingress endpoint.

### 4.2 Pause/resume behavior
- `betaPause()` persists filesystem + memory state.
- Reconnect via `connect()` resumes paused sandbox.
- While paused, in-sandbox services are unreachable and client connections are dropped.
- After resume, clients must re-establish stream/proxy connections.

### 4.3 Auto-pause
- Auto-pause may be enabled for idle cost control.
- Default idle timeout for this spec pack is `10m`.
- Gateway/runtime must treat paused sandboxes as expected reconnect events, not hard failures.

## 5. Provider Contract (Agnostic, but strict)

Any provider used with this architecture must support:
- inbound HTTP/WS tunnel to sandbox daemon port,
- websocket upgrades,
- low-latency request/response for interactive transport.

If provider cannot satisfy these transport primitives, it is out of contract.

Kubernetes self-host contract:
- Gateway must run in the same cluster/VPC network plane as sandbox pods.
- Gateway reaches sandbox-daemon via internal addresses (K8s Service DNS or pod IP), without dynamic external ingress objects per session.

## 6. Billing and Telemetry Intercept Requirements

Gateway is not a dumb pipe. `event-processor` must extract runtime telemetry from `agent_event` frames for UX/observability and compute lifecycle accounting.

Metering contract:
- LLM token billing truth is owned by LiteLLM spend ingestion (`15-llm-proxy-architecture.md`).
- Gateway stream frames must not be the source-of-truth for billable token usage.
- Gateway records compute lifecycle cut points and correlation metadata.

On terminal/final state, Gateway writes compute-side billing outbox/event rows for worker reconciliation.

## 7. Success Metrics (SLOs)

Measured at Gateway with OpenTelemetry, aggregated in Datadog/Prometheus (rolling 5-minute windows):

1. Attach time (`p95`) < `150ms`
2. PTY replay recovery (`p95`) < `100ms`
3. FS read roundtrip (`p95`) < `150ms`
4. FS change -> UI event delivery (`p95`) < `50ms`
5. Idle memory reduction vs old code-server baseline > `150MB`

## 8. Implementation File Map (Target-State Owners)

```text
apps/gateway/src/
  api/proliferate/ws/           # unified stream endpoint
  api/proxy/                    # fs/preview/terminal proxy surfaces
  api/proliferate/http/         # runtime reconciliation endpoints
  hub/session-runtime.ts        # runtime ensure + reconnect
  hub/event-processor.ts        # event normalization + metering intercept
  hub/backplane.ts              # cross-replica stream fanout

packages/shared/src/providers/
  e2b.ts                        # provider tunnel host resolution
  modal-libmodal.ts             # alternate provider parity

packages/sandbox-daemon/        # new daemon package (replaces sandbox-mcp)
  src/server.ts
  src/pty.ts
  src/fs.ts
  src/ports.ts
  src/router.ts
```

## 9. Core Data Model Surfaces

| Model | Why transport cares | File |
|---|---|---|
| `sessions` | runtime tunnel/daemon metadata, status, reconnect context | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | streamed approval/completion transitions | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | streamed long-running run updates | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `billing_events` | transport-level usage metering persistence | `packages/db/src/schema/billing.ts` |
