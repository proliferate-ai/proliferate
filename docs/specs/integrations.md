# Integrations — System Spec

## 1. Scope & Purpose

### In Scope
- OAuth connection lifecycle for GitHub, Sentry, Linear, and Slack
- Nango as the unified OAuth broker for Sentry, Linear, and (optionally) GitHub
- GitHub App installation flow (non-Nango path)
- Connection binding tables: `repo_connections`, `automation_connections`, `session_connections`
- Slack workspace-level installations and OAuth
- Slack conversations cache (schema only — runtime use belongs to `automations-runs.md`)
- Token resolution for downstream consumers (gateway, worker, trigger-service)
- Sentry and Linear metadata queries (projects, teams, labels, etc.)
- Integration disconnect with orphaned-repo cleanup
- Gateway-side GitHub token resolution
- Org-scoped MCP connector catalog lifecycle (CRUD, validation, settings UI)

### Out of Scope
- What repos/automations/sessions **do** with connections at runtime — see `repos-prebuilds.md`, `automations-runs.md`, `sessions-gateway.md`
- Slack async client and message handling — see `automations-runs.md`
- Action adapters for Linear/Sentry — see `actions.md`
- Connector execution lifecycle (risk/approval/grants/audit) — see `actions.md`
- Trigger providers for GitHub/Linear/Sentry — see `triggers.md`
- GitHub App webhook dispatch to triggers — see `triggers.md`

### Mental Model

Integrations is the external credential/connectivity control plane. Implemented today: OAuth-backed integrations (GitHub, Sentry, Linear, Slack) where users complete OAuth flows and downstream systems resolve live tokens at runtime. Planned direction: add an org-scoped MCP connector catalog in this domain so connector-backed Actions are configured once per org and reused across all sessions/automations by default.

**Core entities:**
- **Integration** — A stored OAuth connection scoped to an organization. Provider is either `nango` (Sentry/Linear/GitHub-via-Nango) or `github-app` (GitHub App installation). Lifecycle: `active` → `expired`/`revoked`/`deleted`/`suspended`.
- **Slack Installation** — A workspace-level Slack bot installation, stored separately from `integrations` because Slack uses its own OAuth flow with encrypted bot tokens. Lifecycle: `active` → `revoked`.
- **Connection binding** — A junction row linking an integration to a repo, automation, or session. Cascades on delete.
- **Connector** — An org-scoped MCP endpoint configuration (`org_connectors` table) with auth mapping, used by Actions to discover and invoke connector-backed tools. Managed via Settings → Tools UI.

**Key invariants:**
- One integration record per `(connection_id, organization_id)` pair (unique constraint).
- Slack installations are unique per `(organization_id, team_id)`.
- Deleting a GitHub integration triggers orphaned-repo detection.
- Bot tokens for Slack are encrypted at rest; never logged.
- `NEXT_PUBLIC_INTEGRATIONS_ENABLED` gates all Nango-based OAuth flows.

---

## 2. Core Concepts

### Nango
Nango is an external OAuth broker that manages token refresh, storage, and the OAuth handshake for Sentry, Linear, and optionally GitHub. Proliferate creates a "connect session" via the Nango SDK, the user completes OAuth in Nango's UI, and a callback saves the `connection_id` + `providerConfigKey` locally.
- Key detail agents get wrong: Nango manages the OAuth tokens — Proliferate never stores raw OAuth tokens for Nango-managed integrations. Token retrieval is always via `nango.getConnection()`.
- Reference: `apps/web/src/lib/nango.ts`, `packages/services/src/integrations/tokens.ts`

### GitHub App vs Nango GitHub
GitHub has two auth paths. The default is a GitHub App installation (provider `github-app`), where Proliferate registers as a GitHub App and gets an `installation_id`. The alternative (behind `NEXT_PUBLIC_USE_NANGO_GITHUB` feature flag) routes GitHub OAuth through Nango.
- Key detail agents get wrong: The two paths produce different `provider` values in the `integrations` table (`github-app` vs `nango`) and use different token resolution logic.
- Reference: `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/server/routers/integrations.ts:githubSession`

### Token Resolution
A generic layer that abstracts over GitHub App installation tokens and Nango OAuth tokens. Given an `IntegrationForToken`, it returns a live access token. Used by the gateway (for git operations), worker (for enrichment), and trigger-service (for polling).
- Key detail agents get wrong: GitHub App tokens are cached for 50 minutes (they expire after 1 hour). Nango tokens are fetched live and refreshed by Nango internally.
- Reference: `packages/services/src/integrations/tokens.ts`, `apps/gateway/src/lib/github-auth.ts`

### Visibility
Integrations have a `visibility` field: `org` (visible to all org members), `private` (visible only to the creator), or `null` (legacy, treated as `org`). Visibility is enforced at the DB query level in `listByOrganization(orgId, userId)` using a SQL WHERE clause.
- Key detail agents get wrong: Visibility is filtered in the Drizzle query, not in application code. The old `filterByVisibility` mapper function has been deleted.
- Reference: `packages/services/src/integrations/db.ts:listByOrganization`

### Connector Catalog
Org-scoped MCP connector definitions are stored in the `org_connectors` table and managed through Integrations CRUD routes. Each connector defines a remote MCP server endpoint, auth method (org secret reference or custom header), and optional risk policy. The gateway loads enabled connectors by org at session runtime and merges their tools into `/actions/available`.
- Key detail agents get wrong: connectors complement OAuth integrations; they do not replace them. OAuth integrations resolve tokens via Nango/GitHub App, while connectors resolve org secrets for MCP auth.
- Key detail agents get wrong: connector execution (risk/approval/grants/audit) is still owned by Actions (`actions.md`). Integrations owns the catalog lifecycle only.
- Reference: `packages/services/src/connectors/`, `apps/web/src/server/routers/integrations.ts`, `apps/web/src/app/settings/tools/page.tsx`

---

## 3. File Tree

```
packages/db/src/schema/
├── integrations.ts              # integrations + repo_connections tables
├── slack.ts                     # slack_installations + slack_conversations tables
└── schema.ts                    # automation_connections + session_connections tables

packages/services/src/integrations/
├── index.ts                     # Module exports
├── service.ts                   # Business logic (list, create, delete, status)
├── db.ts                        # Raw Drizzle queries
├── mapper.ts                    # DB row → API response transforms
├── tokens.ts                    # Generic token resolution (Nango + GitHub App)
└── github-app.ts                # GitHub App JWT + installation token utilities

packages/shared/src/contracts/
└── integrations.ts              # Zod schemas + ts-rest contract definition

apps/web/src/lib/
├── nango.ts                     # Nango SDK singleton + integration ID helpers
├── slack.ts                     # Slack API helpers (OAuth, postMessage, revoke)
└── github-app.ts                # GitHub App JWT + installation verification

packages/services/src/connectors/
├── index.ts                     # Module exports
├── db.ts                        # Drizzle queries for org_connectors table
└── service.ts                   # Business logic (list, create, update, delete, toConnectorConfig)

apps/web/src/server/routers/
└── integrations.ts              # oRPC router (all integration + connector endpoints)

apps/web/src/app/(command-center)/dashboard/integrations/
└── page.tsx                     # Unified integrations page (OAuth + MCP, admin + user views)

apps/web/src/components/integrations/
├── connector-icon.tsx           # Connector icon + findPresetKey utility
├── connector-form.tsx           # Full connector config form (URL, transport, auth)
├── integration-detail-dialog.tsx  # Detail dialog (connect tab + about tab)
├── integration-picker-dialog.tsx  # Catalog picker with search + categories
├── provider-icon.tsx            # OAuth provider icon + display name helpers
└── quick-setup-form.tsx         # API-key-only setup form for MCP presets

apps/web/src/hooks/
└── use-org-connectors.ts        # React hooks for org-level connector CRUD

apps/web/src/app/api/integrations/
├── github/callback/route.ts     # GitHub App installation callback
├── slack/oauth/route.ts         # Slack OAuth initiation (redirect)
└── slack/oauth/callback/route.ts # Slack OAuth callback (token exchange)

apps/web/src/app/api/webhooks/
└── github-app/route.ts          # GitHub App webhook handler (lifecycle events)

apps/gateway/src/lib/
└── github-auth.ts               # Gateway-side GitHub token resolution
```

Connector catalog: `packages/services/src/connectors/` owns DB access and business logic. `org_connectors` table stores connector definitions with backfill migration from legacy `prebuilds.connectors` JSONB.

---

## 4. Data Models & Schemas

### Database Tables

```sql
integrations
├── id                  UUID PK
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── provider            TEXT NOT NULL          -- 'nango' | 'github-app'
├── integration_id      TEXT NOT NULL          -- 'github' | 'sentry' | 'linear' | 'github-app'
├── connection_id       TEXT NOT NULL          -- Nango connection ID or 'github-app-{installationId}'
├── display_name        TEXT
├── scopes              TEXT[]
├── status              TEXT DEFAULT 'active'  -- 'active' | 'expired' | 'revoked' | 'deleted' | 'suspended'
├── visibility          TEXT DEFAULT 'org'     -- 'org' | 'private'
├── github_installation_id TEXT               -- GitHub App only
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
    UNIQUE(connection_id, organization_id)
    INDEX(organization_id)
    INDEX(github_installation_id)
```

```sql
repo_connections
├── id                  UUID PK
├── repo_id             UUID NOT NULL FK(repos) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── created_at          TIMESTAMPTZ
    UNIQUE(repo_id, integration_id)

automation_connections
├── id                  UUID PK
├── automation_id       UUID NOT NULL FK(automations) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── created_at          TIMESTAMPTZ
    UNIQUE(automation_id, integration_id)

session_connections
├── id                  UUID PK
├── session_id          UUID NOT NULL FK(sessions) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── created_at          TIMESTAMPTZ
    UNIQUE(session_id, integration_id)
```

```sql
org_connectors
├── id                  UUID PK DEFAULT gen_random_uuid()
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── name                TEXT NOT NULL
├── transport           TEXT NOT NULL DEFAULT 'remote_http'
├── url                 TEXT NOT NULL
├── auth                JSONB NOT NULL           -- { type: 'none' | 'secret' | 'custom_header', secretKey?, headerName?, headerValue? }
├── risk_policy         JSONB                    -- { defaultRisk: 'read' | 'write' | 'danger' }
├── enabled             BOOLEAN NOT NULL DEFAULT true
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ DEFAULT now()
└── updated_at          TIMESTAMPTZ DEFAULT now()
    INDEX(organization_id)
```

```sql
slack_installations
├── id                  UUID PK
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── team_id             TEXT NOT NULL
├── team_name           TEXT
├── encrypted_bot_token TEXT NOT NULL
├── bot_user_id         TEXT NOT NULL
├── scopes              TEXT[]
├── installed_by        TEXT FK(user)
├── status              TEXT DEFAULT 'active'  -- 'active' | 'revoked'
├── connect_channel_id  TEXT
├── invite_url          TEXT
├── support_channel_id  TEXT                   -- Slack Connect support channel
├── support_channel_name TEXT                  -- Support channel display name
├── support_invite_id   TEXT                   -- Slack Connect invite ID
├── support_invite_url  TEXT                   -- Slack Connect invite URL
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
    UNIQUE(organization_id, team_id)
    INDEX(organization_id)
    INDEX(team_id)

slack_conversations
├── id                  UUID PK
├── slack_installation_id UUID NOT NULL FK(slack_installations) CASCADE
├── channel_id          TEXT NOT NULL
├── thread_ts           TEXT NOT NULL
├── session_id          UUID FK(sessions) SET NULL
├── repo_id             UUID FK(repos)
├── started_by_slack_user_id TEXT
├── status              TEXT DEFAULT 'active'
├── pending_prompt      TEXT
├── created_at          TIMESTAMPTZ
└── last_message_at     TIMESTAMPTZ
    UNIQUE(slack_installation_id, channel_id, thread_ts)
```

### Key Indexes & Query Patterns
- `idx_integrations_org` on `organization_id` — all list/status queries filter by org
- `idx_integrations_github_installation` on `github_installation_id` — webhook handler resolves integration by installation ID
- `idx_slack_installations_team` on `team_id` — Slack events handler resolves installation by team
- `idx_slack_conversations_thread` on `(channel_id, thread_ts)` — message routing looks up existing conversation by thread

### Core TypeScript Types

```typescript
// packages/shared/src/contracts/integrations.ts
interface Integration {
  id: string;
  organization_id: string;
  provider: string;
  integration_id: string | null;
  connection_id: string | null;
  display_name: string | null;
  status: string | null;
  visibility: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface IntegrationWithCreator extends Integration {
  creator: { id: string; name: string | null; email: string | null } | null;
}

// packages/services/src/integrations/tokens.ts
interface IntegrationForToken {
  id: string;
  provider: string;        // 'nango' | 'github-app'
  integrationId: string;   // 'linear' | 'sentry' | 'github'
  connectionId: string;
  githubInstallationId?: string | null;
}
```

---

## 5. Conventions & Patterns

### Do
- Use `packages/services/src/integrations/` for all DB reads/writes — never query directly from routers
- Use `tokens.ts:getToken()` to resolve live OAuth tokens — it abstracts over both provider types
- Encrypt Slack bot tokens at rest via `@/lib/crypto` before storing

### Don't
- Store raw OAuth tokens for Nango-managed integrations — Nango owns token storage and refresh
- Log Slack bot tokens, OAuth tokens, or any credential material
- Call `nango.getConnection()` outside the integrations module — use the token resolution layer

### Error Handling

```typescript
// Nango SDK errors are axios-shaped; extract response details
function handleNangoError(err: unknown, operation: string): never {
  const axiosResponse = (err as { response?: { status?: number; data?: unknown } }).response;
  if (axiosResponse) {
    throw new ORPCError("BAD_REQUEST", { message: `${operation}: ${message}` });
  }
  throw err;
}
```

### Reliability
- GitHub App installation tokens: cached 50 min (expire at 60 min)
  - `packages/services/src/integrations/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`
- Slack API calls: exponential backoff with retry on 429 / `ratelimited`, max 3-5 retries
  - `apps/web/src/lib/slack.ts:fetchWithRetry`
- Slack OAuth state: 5-minute expiry with nonce for CSRF protection
  - `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`

### Testing Conventions
- No dedicated integration tests exist for this subsystem today
- Mock Nango SDK (`@nangohq/node`) and external API calls (Sentry REST, Linear GraphQL, GitHub API) in any future tests
- Slack token encryption/decryption should use test encryption keys, never production secrets

---

## 6. Subsystem Deep Dives

### 6.1 Integration List and Update — `Implemented`

**What it does:** Lists all integrations for an org (filtered by visibility) and allows renaming. Also includes `slackStatus` (returns team info + support channel), `slackInstallations` (lists active Slack workspaces for notification selector), `sentryStatus`, `linearStatus`, and `githubStatus` endpoints.

**Happy path (list):**
1. `integrationsRouter.list` calls `integrations.listIntegrations(orgId, userId)` (`apps/web/src/server/routers/integrations.ts`)
2. Service fetches integration rows for the org, filtered by visibility at the SQL level — `org` and `null` are visible to all; `private` only to the creator (`db.ts:listByOrganization(orgId, userId)`)
3. Creator info is batch-fetched and attached (`mapper.ts:attachCreators`)
4. Grouped by provider (`mapper.ts:groupByProvider`) and returned with per-provider `connected` booleans

**Happy path (update):**
1. `integrationsRouter.update` verifies the integration belongs to the org
2. Calls `db.ts:updateDisplayName` — trims whitespace, sets `null` for empty strings

**Files touched:** `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`, `packages/services/src/integrations/mapper.ts`

### 6.2 GitHub App Installation (OAuth) — `Implemented`

**What it does:** Installs a GitHub App on the user's account/org, saves the installation, and auto-adds repos.

**Happy path:**
1. User clicks "Install GitHub App" which redirects to `https://github.com/apps/{slug}/installations/new`
2. GitHub redirects to `GET /api/integrations/github/callback` with `installation_id` and `state` (`apps/web/src/app/api/integrations/github/callback/route.ts`)
3. Route verifies auth, parses `state` (contains `returnUrl`, optional `targetOrgId` for CLI flows)
4. Calls `verifyInstallation()` to confirm the installation exists on GitHub (`apps/web/src/lib/github-app.ts`)
5. Calls `integrations.saveGitHubAppInstallation()` which upserts into `integrations` table with `provider='github-app'`, `connection_id='github-app-{installationId}'` (`packages/services/src/integrations/service.ts`, `db.ts:upsertGitHubAppInstallation`)
6. Auto-adds all repos from the installation via `listInstallationRepos()` + `repos.createRepo()`
7. Redirects to `returnUrl` with `?success=github`

**Edge cases:**
- Re-installation: upsert conflict on `(connection_id, organization_id)` updates `display_name` and sets `status='active'`
- Uninstall action: redirects to dashboard with `?github=uninstalled` (no DB change here — handled by webhook)
- Missing auth: redirects to sign-in with the callback URL as return parameter

**Files touched:** `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/lib/github-app.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`

### 6.3 GitHub via Nango (Optional) — `Implemented`

**What it does:** Alternative GitHub OAuth flow through Nango, gated behind `NEXT_PUBLIC_USE_NANGO_GITHUB`.

**Happy path:**
1. `integrationsRouter.githubSession` checks the feature flag, creates a Nango connect session with `allowed_integrations: [githubIntegrationId]`
2. Frontend completes OAuth in Nango's UI
3. Nango calls back; frontend calls `integrationsRouter.callback` with `connectionId` and `providerConfigKey`
4. Service saves integration with `provider='nango'`

**Files touched:** `apps/web/src/server/routers/integrations.ts:githubSession`, `apps/web/src/lib/nango.ts`

### 6.4 Sentry / Linear OAuth (via Nango) — `Implemented`

**What it does:** OAuth connection for Sentry and Linear via Nango connect sessions.

**Happy path (identical for both providers):**
1. `sentrySession` / `linearSession` creates a Nango connect session scoped to the provider
2. Returns `sessionToken` for the frontend Nango UI
3. On completion, frontend calls `integrationsRouter.callback` which calls `service.ts:saveIntegrationFromCallback`
4. If `connection_id` already exists: re-authorization → updates status to `active`
5. If new: inserts with `provider='nango'`, `visibility='org'`

**Files touched:** `apps/web/src/server/routers/integrations.ts:sentrySession,linearSession,callback`, `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`

### 6.5 Slack OAuth — `Implemented`

**What it does:** Workspace-level Slack bot installation with encrypted token storage. Not Nango-managed.

**Happy path:**
1. `GET /api/integrations/slack/oauth` verifies auth, generates base64url-encoded state with `{orgId, userId, nonce, timestamp, returnUrl}`, redirects to Slack OAuth URL (`apps/web/src/app/api/integrations/slack/oauth/route.ts`)
2. User authorizes in Slack
3. `GET /api/integrations/slack/oauth/callback` validates state (5-min expiry), calls `exchangeCodeForToken()` (`apps/web/src/lib/slack.ts`)
4. Bot token is encrypted via `encrypt()` from `@/lib/crypto`
5. Calls `integrations.saveSlackInstallation()` — checks for existing `(org, team_id)` pair, updates or creates (`packages/services/src/integrations/service.ts:saveSlackInstallation`)
6. Redirects with `?success=slack&tab=connections`

**Edge cases:**
- Re-authorization of same workspace: updates existing row (token, scopes, status → `active`)
- OAuth denied by user: redirects with `?error=slack_oauth_denied`
- State expired (>5 min): redirects with `?error=slack_oauth_expired`

**Files touched:** `apps/web/src/app/api/integrations/slack/oauth/route.ts`, `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`, `apps/web/src/lib/slack.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`

### 6.6 Integration Disconnect — `Implemented`

**What it does:** Removes an integration, cleans up Nango connection, and detects orphaned repos.

**Permission model:** Admins and owners can disconnect any integration. Members can only disconnect integrations they created (`integration.created_by === userId`). Non-creator members receive a 403 FORBIDDEN.

**Happy path:**
1. `integrationsRouter.disconnect` fetches the integration, checks org membership (via `orgProcedure`)
2. Verifies the caller is admin/owner OR the integration creator
3. For Nango-managed connections (`provider !== 'github-app'`): calls `nango.deleteConnection()` to revoke upstream
4. Calls `service.ts:deleteIntegration()` which deletes the row from `integrations`
5. For GitHub-related integrations: runs `handleOrphanedRepos()` — iterates non-orphaned repos, checks if any have zero `repo_connections`, marks them as `isOrphaned=true`

**Files touched:** `apps/web/src/server/routers/integrations.ts:disconnect`, `packages/services/src/integrations/service.ts:deleteIntegration`

### 6.7 Slack Disconnect — `Implemented`

**What it does:** Revokes a Slack bot token and marks the installation as revoked.

**Happy path:**
1. `integrationsRouter.slackDisconnect` finds the active installation for the org
2. Decrypts the bot token, calls `revokeToken()` against Slack API (`apps/web/src/lib/slack.ts:revokeToken`)
3. Marks installation `status='revoked'` via `db.ts:revokeSlackInstallation`

**Edge cases:**
- Slack API revocation fails: logged and swallowed — local revocation proceeds regardless

**Files touched:** `apps/web/src/server/routers/integrations.ts:slackDisconnect`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`

### 6.8 Sentry Metadata Queries — `Implemented`

**What it does:** Fetches Sentry projects, environments, and severity levels for trigger/action configuration.

**Happy path:**
1. `integrationsRouter.sentryMetadata` receives `connectionId` (integration UUID) and optional `projectSlug`
2. Verifies integration is active, fetches credentials from Nango via `nango.getConnection()`
3. Calls `fetchSentryMetadata()` which queries Sentry REST API:
   - `GET /api/0/organizations/` → first org slug
   - `GET /api/0/organizations/{slug}/projects/`
   - `GET /api/0/projects/{org}/{project}/environments/` (for the target project)
4. Returns `{ projects, environments, levels }` where `levels` is the static list `['debug','info','warning','error','fatal']`

**Files touched:** `apps/web/src/server/routers/integrations.ts:sentryMetadata,fetchSentryMetadata`

### 6.9 Linear Metadata Queries — `Implemented`

**What it does:** Fetches Linear teams, workflow states, labels, users, and projects via GraphQL.

**Happy path:**
1. `integrationsRouter.linearMetadata` receives `connectionId` and optional `teamId`
2. Verifies integration, fetches token from Nango
3. Calls `fetchLinearMetadata()` which sends a single GraphQL query to `https://api.linear.app/graphql`
4. Returns `{ teams, states, labels, users, projects }`

**Edge cases:**
- `teamId` filter: when provided, `workflowStates` and `issueLabels` are filtered by team

**Files touched:** `apps/web/src/server/routers/integrations.ts:linearMetadata,fetchLinearMetadata`

### 6.10 Token Resolution — `Implemented`

**What it does:** Generic layer to get live OAuth tokens for any integration type. Tokens are always org-scoped; there is no user-level token resolution (the legacy `user_connections` table and `resolveUserToken` function have been removed).

**Happy path:**
1. Caller provides an `IntegrationForToken` (from `db.ts:getIntegrationsForTokens` lookup)
2. `tokens.ts:getToken(integration)` checks provider type:
   - `github-app` + `githubInstallationId`: generates JWT, calls GitHub API for installation token (cached 50 min)
   - `nango` + `connectionId`: calls `nango.getConnection()` to get `access_token`
3. `resolveTokens()` processes multiple integrations in parallel via `Promise.allSettled`, collecting successes and errors separately
4. `getEnvVarName()` generates environment variable names like `LINEAR_ACCESS_TOKEN_abc12345` for sandbox injection

**Files touched:** `packages/services/src/integrations/tokens.ts`, `packages/services/src/integrations/github-app.ts`

### 6.11 GitHub Auth (Gateway-Side) — `Implemented`

**What it does:** Resolves GitHub tokens inside the gateway for git operations (clone, pull, push).

**Happy path:**
1. `getGitHubTokenForIntegration()` receives a `GitHubIntegration` object
2. If `github_installation_id` is set: generates JWT + fetches installation token (same logic as services layer, duplicated in gateway for independence)
3. If `connection_id` is set (Nango path): calls `nango.getConnection()` via gateway's own Nango client
4. `getNangoConnectionToken()` is a generic helper for any Nango connection (used for non-GitHub tokens in the gateway)

**Files touched:** `apps/gateway/src/lib/github-auth.ts`

### 6.12 Slack Connect (Support Channel) — `Implemented`

**What it does:** Creates a Slack Connect channel and invites a customer for support.

**Happy path:**
1. `integrationsRouter.slackConnect` gets user email, calls `sendSlackConnectInvite()`
2. Creates a public channel via `conversations.create` (handles `name_taken` by finding existing)
3. Adds default team members from `PROLIFERATE_SLACK_CONNECT_EMAILS` env var
4. Sends Slack Connect invite to customer via `conversations.inviteShared` (with retry on rate limits)
5. Stores `supportChannelId` and `supportInviteUrl` on the Slack installation

**Files touched:** `apps/web/src/server/routers/integrations.ts:slackConnect`, `apps/web/src/lib/slack.ts:sendSlackConnectInvite`, `packages/services/src/integrations/db.ts:updateSlackSupportChannel`

### 6.13 GitHub App Webhook (Lifecycle Events) — `Implemented`

**What it does:** Handles installation lifecycle events from GitHub (deleted, suspended, unsuspended). Trigger dispatch for non-lifecycle events is documented in `triggers.md`.

**Happy path:**
1. `POST /api/webhooks/github-app` verifies HMAC signature against `GITHUB_APP_WEBHOOK_SECRET`
2. For `installation` events:
   - `deleted` → sets integration status to `deleted`
   - `suspend` → sets status to `suspended`
   - `unsuspend` → sets status to `active`
3. For other events: resolves integration by `installation_id`, finds active triggers, dispatches. See `triggers.md` §6 for dispatch details.

**Files touched:** `apps/web/src/app/api/webhooks/github-app/route.ts`, `packages/services/src/integrations/db.ts:updateStatusByGitHubInstallationId`

### 6.14 Org-Scoped Connector Catalog — `Implemented`

**What it does:** Defines a single org-level source of truth for MCP connector configuration used by Actions discovery/invocation.

**Behavior:**
1. Admin/owner configures connectors via the unified Integrations page (`/dashboard/integrations`). Connectors appear in the same list as OAuth integrations.
2. Config is stored in `org_connectors` table using the shared `ConnectorConfig` schema (`packages/shared/src/connectors.ts`).
3. Gateway Actions loads enabled connectors by org/session context, not by prebuild.
4. Connector-backed actions continue using the same `connector:<uuid>` integration prefix and existing approval/audit pipeline in `actions.md`.
5. MCP presets always use `QuickSetupForm` (API key only) — URL, transport, and auth are auto-filled from preset defaults.
6. Custom MCP Server: a catalog entry (`type: "custom-mcp"`) opens the full `ConnectorForm` with URL, transport, auth, and risk policy. This is the only path to full connector configuration.
7. Admin dropdown menu on connector rows: Edit (inline form), Toggle enabled/disabled, Delete (with confirmation dialog).
8. Non-admin users see connectors in the same unified list with source-level enable/disable toggles.

**Key files:**
- DB: `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/db.ts`
- Service: `packages/services/src/connectors/service.ts`
- Router: `apps/web/src/server/routers/integrations.ts` (connectors section)
- UI: `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts`
- Components: `connector-icon.tsx` (icon + `findPresetKey`), `quick-setup-form.tsx`, `connector-form.tsx`, `integration-detail-dialog.tsx`
- Presets: `packages/shared/src/connectors.ts:CONNECTOR_PRESETS`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `repos-prebuilds.md` | Repos → This | `repo_connections` table, `getRepoConnectionsWithIntegrations()` | Repos bind to integrations for GitHub access |
| `automations-runs.md` | Automations → This | `automation_connections` table, `resolveTokens()` | Runs resolve tokens for enrichment context |
| `sessions-gateway.md` | Sessions → This | `session_connections` table, `getGitHubTokenForIntegration()` | Sessions use tokens for git operations |
| `triggers.md` | Triggers → This | `integrations.triggers` relation, `findActiveByGitHubInstallationId()` | Trigger-service resolves integration for webhook dispatch |
| `triggers.md` | Triggers → This | `findByConnectionIdAndProvider()`, `updateStatus()` | Nango webhook handler updates connection status on token lifecycle events |
| `actions.md` | Actions → This | `getToken()` | Action adapters resolve tokens for API calls |
| `actions.md` | Actions ↔ This | `connectors.listEnabledConnectors()` | Org-scoped connector catalog read path for action discovery |
| `auth-orgs.md` | This → Auth | `orgProcedure` middleware | All integration routes require org membership |
| `secrets-environment.md` | This → Secrets | `getEnvVarName()` | Token env var naming for sandbox injection |

### Security & Auth
- All oRPC routes use `orgProcedure` (org membership required)
- OAuth session creation (`callback`, `githubSession`, `sentrySession`, `linearSession`) and Slack endpoints (`slackConnect`, `slackDisconnect`) require `requireIntegrationAdmin` (admin/owner role)
- Disconnect uses a creator-or-admin check: admins disconnect anything, members only their own integrations
- Connector CRUD endpoints require `requireIntegrationAdmin`
- Slack OAuth state includes nonce + 5-min timestamp for CSRF protection
- GitHub App callback validates `installation_id` via GitHub API before saving
- GitHub App webhook validates HMAC-SHA256 signature
- Slack bot tokens encrypted at rest; decrypted only for API calls
- Nango `NANGO_SECRET_KEY` is server-side only (never exposed to client)

### Observability
- Structured logging via `@proliferate/logger` with child loggers per handler
- Key log fields: `orgId`, `installationId`, `teamId`, `connectionId`
- Nango API errors log full response body for debugging

---

## 8. Acceptance Gates

- [ ] Typecheck passes
- [ ] Relevant tests pass
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] No OAuth tokens or secrets in log output
- [ ] Nango connection IDs are never exposed to unauthenticated callers

---

## 9. Known Limitations & Tech Debt

- [ ] **Duplicated GitHub App JWT logic** — `apps/web/src/lib/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`, and `packages/services/src/integrations/github-app.ts` each contain independent JWT generation and PKCS key conversion. Should be consolidated into the services package. — Medium impact on maintenance.
- [ ] **Slack schema drift** — The `support_*` columns (`support_channel_id`, `support_channel_name`, `support_invite_id`, `support_invite_url`) exist in the production DB (reflected in `packages/db/src/schema/schema.ts:1350-1353`) but are missing from the hand-written schema in `packages/db/src/schema/slack.ts`. The service code (`db.ts:updateSlackSupportChannel`) wraps access in try/catch commenting "columns may not exist yet". The hand-written schema should be updated to include these columns. — Low impact but creates confusion.
- [ ] **No token refresh error handling** — If Nango returns an expired/invalid token, the error propagates directly to the caller. No automatic retry or re-auth flow exists. — Medium impact for long-running sessions.
- [x] **Visibility filtering in memory** — Resolved. `listByOrganization` now filters by visibility at the SQL level. The old `filterByVisibility` mapper function has been deleted.
- [x] **`user_connections` table dropped** — The legacy `user_connections` table has been removed (migration `0031_drop_user_connections.sql`). The `resolveUserToken` function in `tokens.ts` has been deleted. All token resolution is now org-scoped only.
- [ ] **Orphaned repo detection is O(n)** — `handleOrphanedRepos` iterates all non-orphaned repos and runs a count query per repo. Should be a single query. — Low impact at current scale.
