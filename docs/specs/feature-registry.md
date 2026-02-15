# Feature Registry

> **Purpose:** Single source of truth for every product feature, its implementation status, and which spec owns it.
> **Status key:** `Implemented` | `Partial` | `Planned` | `Deprecated`
> **Updated:** 2026-02-15. UI renamed connectors to tools; code model remains `connector`.
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
| `save_env_files` tool | Removed | `packages/shared/src/opencode-tools/index.ts` | Deleted; env files now managed via secret files |
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
| Gateway auth middleware | Implemented | `apps/gateway/src/middleware/auth.ts` | Token verification |
| Gateway CORS | Implemented | `apps/gateway/src/middleware/cors.ts` | CORS policy |
| Gateway error handler | Implemented | `apps/gateway/src/middleware/error-handler.ts` | Centralized error handling |
| Gateway request logging | Implemented | `apps/gateway/src/` | pino-http via `@proliferate/logger` |

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
| Slack async client | Implemented | `apps/worker/src/slack/client.ts` | Full bidirectional session via Slack |
| Slack inbound handlers | Implemented | `apps/worker/src/slack/handlers/` | Text, todo, verify, default-tool |
| Slack receiver worker | Implemented | `apps/worker/src/slack/` | BullMQ-based message processing |
| Run claiming / manual update | Implemented | `apps/web/src/server/routers/automations.ts` | Claim, unclaim, resolve runs via `assignRun`/`unassignRun`/`resolveRun` routes |
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
| Cron scheduling | Implemented | `apps/trigger-service/src/scheduled/worker.ts` | SCHEDULED worker creates runs from cron-only triggers |
| GitHub provider | Implemented | `packages/triggers/src/github.ts` | Webhook triggers |
| Linear provider | Implemented | `packages/triggers/src/linear.ts` | Webhook + polling |
| Sentry provider | Implemented | `packages/triggers/src/sentry.ts` | Webhook only — `poll()` explicitly throws |
| PostHog provider | Implemented | `packages/triggers/src/posthog.ts` | Webhook only, HMAC validation |
| Gmail provider | Partial | `packages/triggers/src/service/adapters/gmail.ts` | Full polling impl via Composio, but not in HTTP provider registry (`getProviderByType()` returns null) |
| Provider registry | Implemented | `packages/triggers/src/index.ts` | Maps provider types to implementations |
| PubSub session events | Implemented | `apps/worker/src/pubsub/` | Subscriber for session lifecycle events |

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

---

## 7. LLM Proxy (`llm-proxy.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` | Per-session/org temp keys via LiteLLM API |
| Key scoping (team/user) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` | Team = org, user = session for cost isolation |
| Key duration config | Implemented | `packages/environment/src/schema.ts:LLM_PROXY_KEY_DURATION` | Configurable via env |
| Dynamic `max_budget` enforcement | Implemented | `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars` | Maps shadow balance -> USD and passes as `max_budget` |
| Key revocation on session end (best-effort) | Implemented | `packages/shared/src/llm-proxy.ts:revokeVirtualKey`, `packages/services/src/billing/org-pause.ts` | Revoked on pause/finalize/enforcement/migration paths |
| Model routing | Implemented | External LiteLLM service | Not a local app — external dependency |
| Spend logs ingestion (REST) | Implemented | `packages/services/src/billing/litellm-api.ts:listSpendLogsV2`, `apps/worker/src/billing/worker.ts` | Uses LiteLLM Admin REST API (`/spend/logs/v2`) |
| LLM spend cursors (per-org) | Implemented | `packages/db/src/schema/schema.ts:llmSpendCursors` | One cursor row per org (no global singleton) |

> **Note:** The LLM proxy is an external LiteLLM service, not a locally built app. This spec covers the integration contract (key generation, spend queries) and the conventions for how sessions use it.

---

## 8. CLI (`cli.md`) — Removed

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Device auth flow | Removed | `packages/cli/` | CLI package removed |
| Local config management | Removed | `packages/cli/` | CLI package removed |
| File sync (local → sandbox) | Removed | `packages/cli/` | CLI package removed |
| OpenCode launch | Removed | `packages/cli/` | CLI package removed |
| CLI API routes (auth) | Removed | `apps/web/src/server/routers/cli.ts` | CLI routes removed |
| CLI API routes (repos) | Removed | `apps/web/src/server/routers/cli.ts` | CLI routes removed |
| CLI API routes (sessions) | Removed | `apps/web/src/server/routers/cli.ts` | CLI routes removed |
| CLI API routes (SSH keys) | Removed | `apps/web/src/server/routers/cli.ts` | CLI routes removed |
| CLI API routes (GitHub) | Removed | `apps/web/src/server/routers/cli.ts` | CLI routes removed |
| CLI API routes (configurations) | Removed | `apps/web/src/server/routers/cli.ts` | CLI routes removed |
| GitHub repo selection | Removed | `packages/db/src/schema/cli.ts` | CLI schema removed |
| SSH key storage | Removed | `packages/db/src/schema/cli.ts` | CLI schema removed |

---

## 9. Repos & Configurations (`repos.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Repo CRUD | Implemented | `apps/web/src/server/routers/repos.ts` | List/get/create/delete |
| Repo search | Implemented | `apps/web/src/server/routers/repos.ts:search` | Search available repos |
| Repo connections | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Integration bindings |
| Configuration CRUD | Implemented | `apps/web/src/server/routers/configurations.ts` | List/create/update/delete |
| Configuration-repo associations | Implemented | `packages/db/src/schema/schema.ts:configurationRepos` | Many-to-many (`configuration_repos` table) |
| Effective service commands | Removed | — | Read directly from configuration; dedicated resolver removed |
| Base snapshot builds | Implemented | `apps/worker/src/base-snapshots/index.ts` | Worker queue, deduplication |
| Repo snapshot builds | Implemented | `apps/worker/src/repo-snapshots/index.ts` | GitHub token hierarchy, commit tracking |
| Configuration resolver | Implemented | `apps/gateway/src/lib/configuration-resolver.ts` | Resolves configuration at session start |
| Service commands persistence | Implemented | `packages/db/src/schema/schema.ts:configurations.serviceCommands` | JSONB on configurations |
| Env file persistence | Removed | — | Deleted; replaced by `secret_files` table |
| Configuration connector config | Removed | — | Deleted; migrated to org-scoped `org_connectors` table via `0022_org_connectors.sql` |
| Org-scoped connector catalog | Implemented | `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/` | `org_connectors` table with full CRUD via Integrations routes |
| Org connector management UI | Implemented | `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts` | Settings → Tools page with presets, secret picker, validation |
| Org connector validation endpoint | Implemented | `apps/web/src/server/routers/integrations.ts:validateConnector` | `tools/list` preflight with diagnostics |
| Base snapshot status tracking | Implemented | `packages/db/src/schema/schema.ts:sandboxBaseSnapshots` | Building/ready/failed |
| Repo snapshot status tracking | Removed | — | Repo snapshots removed; superseded by first-class snapshots table |

---

## 9b. Configurations & Snapshots (`configurations-snapshots.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| First-class snapshots table | Implemented | `packages/db/src/schema/schema.ts:snapshots` | Lifecycle: building/ready/failed, `has_deps` property |
| Snapshot repos (commit tracking) | Implemented | `packages/db/src/schema/schema.ts:snapshotRepos` | Per-repo commit SHA per snapshot (not populated in PR1) |
| Active snapshot on configurations | Implemented | `packages/db/src/schema/schema.ts:configurations.activeSnapshotId` | FK → snapshots, set on markReady |
| Organization ID on configurations | Implemented | `packages/db/src/schema/schema.ts:configurations.organizationId` | Backfilled from configuration_repos → repos |
| Secret files (config-scoped env) | Implemented | `packages/db/src/schema/schema.ts:secretFiles` | Replaces env_files JSONB and legacy secret_bundles |
| Configuration secrets | Implemented | `packages/db/src/schema/schema.ts:configurationSecrets` | Per-key encrypted values for secret files |
| Secret files CRUD API | Implemented | `apps/web/src/server/routers/secrets.ts:secretFilesRouter` | List/create/delete files, upsert/delete secrets |
| Snapshots service | Implemented | `packages/services/src/snapshots/` | Create, markReady, markFailed, getActiveSnapshot |
| Secret files service | Implemented | `packages/services/src/secret-files/` | CRUD, encryption, boot decryption, saveEnvFileSpec |
| Snapshot dual-write (save_snapshot) | Implemented | `apps/gateway/src/hub/session-hub.ts` | Writes to old configurations + new snapshots table |
| Snapshot dual-write (finalize) | Implemented | `apps/web/src/server/routers/repos-finalize.ts` | Writes to old configurations + new snapshots table |
| Snapshot fallback reads | Implemented | `apps/gateway/src/lib/session-creator.ts` | active_snapshot → legacy snapshot → repo snapshot |
| snapshotHasDeps fallback | Implemented | `apps/gateway/src/lib/session-creator.ts`, `session-store.ts` | Matches snapshot ID before using has_deps |
| Migration (expand) | Implemented | `packages/db/drizzle/0024_configurations_snapshots_expand.sql` | Create tables, backfill, migrate data |

---

## 10. Secrets & Environment (`secrets-environment.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Secret CRUD | Implemented | `apps/web/src/server/routers/secrets.ts` | Create/delete/list |
| Secret check (exists?) | Implemented | `apps/web/src/server/routers/secrets.ts:check` | Check without revealing value |
| Secret bundles CRUD | Removed | `apps/web/src/server/routers/secrets.ts` | Replaced by secret files (`secret_files` table) |
| Bundle metadata update | Removed | `apps/web/src/server/routers/secrets.ts` | Replaced by secret files |
| Bulk import | Implemented | `apps/web/src/server/routers/secrets.ts:bulkImport` | `.env` paste flow |
| Secret encryption | Implemented | `packages/services/src/secrets/` | Encrypted at rest |
| Per-secret persistence toggle | Implemented | Recent PR `c4d0abb` | Toggle whether secret persists across sessions |
| Secret encryption (DB) | Implemented | `packages/services/src/secrets/service.ts` | AES-256 encrypted in PostgreSQL; S3 is NOT used for secrets (only verification uploads) |

---

## 11. Integrations (`integrations.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Integration list/update | Implemented | `apps/web/src/server/routers/integrations.ts` | Generic integration routes |
| GitHub OAuth (GitHub App) | Implemented | `apps/web/src/server/routers/integrations.ts:githubStatus/githubSession` | Via Nango |
| Sentry OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:sentryStatus/sentrySession` | Via Nango |
| Linear OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:linearStatus/linearSession` | Via Nango |
| Slack OAuth | Implemented | `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts` | Workspace install stored in `slack_installations` (not Nango-managed) |
| Slack installations | Implemented | `packages/db/src/schema/slack.ts:slackInstallations` | Workspace-level |
| Slack conversations cache | Implemented | `packages/db/src/schema/slack.ts:slackConversations` | Channel cache |
| Nango callback handling | Implemented | `apps/web/src/server/routers/integrations.ts:callback` | OAuth callback |
| Integration disconnect | Implemented | `apps/web/src/server/routers/integrations.ts:disconnect` | Remove connection |
| Connection binding (repos) | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Repo-to-integration |
| Connection binding (automations) | Implemented | `packages/db/src/schema/automations.ts:automationConnections` | Automation-to-integration |
| Connection binding (sessions) | Implemented | `packages/db/src/schema/sessions.ts:sessionConnections` | Session-to-integration |
| Sentry metadata | Implemented | `apps/web/src/server/routers/integrations.ts:sentryMetadata` | Sentry project/org metadata |
| Linear metadata | Implemented | `apps/web/src/server/routers/integrations.ts:linearMetadata` | Linear team/project metadata |
| GitHub auth (gateway) | Implemented | `apps/gateway/src/lib/github-auth.ts` | Gateway-side GitHub token resolution |
| Org-scoped MCP connector catalog | Implemented | `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/` | Org-level connector CRUD with atomic secret provisioning |
| Org-scoped connector management UI | Implemented | `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts` | Settings → Tools page with preset quick-setup, advanced form, and connection validation |

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
| Credit gating | Implemented | `packages/services/src/billing/gate.ts`, `apps/gateway/src/api/proliferate/http/sessions.ts` | Enforced in web oRPC and gateway HTTP session creation |
| Shadow balance | Implemented | `packages/services/src/billing/shadow-balance.ts` | Fast balance approximation |
| Bulk shadow balance deductions | Implemented | `packages/services/src/billing/shadow-balance.ts:bulkDeductShadowBalance` | Single org lock + bulk insert for high-frequency sources |
| Org termination on zero balance (V2) | Implemented | `packages/services/src/billing/org-pause.ts:handleCreditsExhaustedV2` | Terminates running sessions on exhaustion |
| Trial credits | Implemented | `packages/services/src/billing/trial-activation.ts` | Auto-provision on signup |
| Billing reconciliation | Implemented | `packages/db/src/schema/schema.ts:billingReconciliations` | Manual adjustments with audit |
| Nightly Autumn reconciliation | Implemented | `apps/worker/src/billing/worker.ts` | Drift sync via `autumn-reconcile` job |
| Billing events | Implemented | `packages/db/src/schema/schema.ts:billingEvents` | Usage event log |
| LLM spend sync (REST + per-org fan-out) | Implemented | `apps/worker/src/billing/worker.ts`, `packages/services/src/billing/litellm-api.ts` | BullMQ dispatcher + per-org jobs |
| Distributed locks (billing) | Deprecated | `packages/queue/src/index.ts` | Replaced by BullMQ repeatable jobs |
| Billing worker | Implemented | `apps/worker/src/billing/worker.ts` | BullMQ repeatable jobs (metering/outbox/grace/reconcile) |
| Autumn integration | Implemented | `packages/shared/src/billing/` | External billing provider client |
| Overage policy (pause/allow) | Deprecated | `apps/web/src/components/settings/billing/overage-section.tsx` | UI exists, but enforcement is V2 terminate-only |

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
