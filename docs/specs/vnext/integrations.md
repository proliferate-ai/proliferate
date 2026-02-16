# Integrations — System Spec

> **vNext (target architecture)** — This spec describes the intended Integrations control plane after the unified integrations redesign.
>
> Current implemented spec: `../integrations.md`  
> Design change set: `../../../integrations_architecture.md`

Terminology note: this spec uses `IntegrationProvider` / "integration module" for external service integrations (Linear/Sentry/etc). This is distinct from sandbox compute providers (Modal/E2B) in `./sandbox-providers.md`.

## 1. Scope & Purpose

### In Scope
- External credential and connectivity lifecycle (OAuth integrations + GitHub App + Slack installs).
- Connection requirements declared by code-defined integration modules (`IntegrationProvider.connections`).
- OAuth preset mapping (framework-level) from `preset` keys to the active OAuth broker implementation (Nango today, Arctic later).
- Token resolution for downstream consumers (`getToken()`), including optional user-scoped credentials.
- Org-scoped MCP connector catalog lifecycle (CRUD, validation, enable/disable).
- Persistence of MCP connector tool mode overrides and tool drift metadata (storage + CRUD only; runtime enforcement is owned by Actions).
- Connection binding tables: `repo_connections`, `automation_connections`, `session_connections`.
- Slack workspace-level installations and OAuth.
- Slack conversations cache (schema only — runtime use belongs to `automations-runs.md`).
- Sentry and Linear metadata queries (projects, teams, labels, etc.).
- GitHub App installation flow.
- Integration disconnect with orphaned-repo cleanup.

### Out of Scope
- Action permissioning and execution (allow/deny/require_approval, approvals, auditing) — see `./actions.md`.
- Trigger ingestion (webhooks, polling, event normalization) — see `./triggers.md`.
- Automation run pipeline and notifications — see `automations-runs.md`.
- Session runtime and sandbox lifecycle — see `./sessions-gateway.md`, `./sandbox-providers.md`.

### Mental Model

Integrations is Proliferate's **external connectivity control plane**. It stores which external services an org can talk to, handles OAuth flows, and abstracts how to obtain live credentials for them at runtime.

Integrations does **not** execute actions and does **not** ingest triggers; it only provides records and token resolution primitives (`getToken()`) that those subsystems consume.

In vNext, code-defined integrations are self-contained modules in `packages/providers/` that declare their connection requirements (OAuth scopes, org/user scopes) without binding to a specific OAuth broker. Integrations uses these declarations to drive connect UX and to validate that a session/automation has the right connectivity configured, while `getToken()` remains the single boundary for resolving live access tokens.

**Core entities:**
- **Integration** — an org-scoped external connection reference (Nango connection ID, GitHub App installation ID, Slack bot token reference).
- **User connection** — a user-scoped credential for a provider used when actions need user attribution (optional, provider-specific).
- **Connector** — an org-scoped MCP endpoint configuration (`org_connectors`), including per-tool mode overrides and drift hash metadata.
- **Connection binding** — a junction row linking an integration to a repo, automation, or session.
- **Slack Installation** — a workspace-level Slack bot installation with encrypted bot tokens.

**Key invariants:**
- **Stateless Modules:** Providers declare what they need (`type: "oauth2"`, `scopes`, `preset`) but never *how* it is fulfilled. There are no Nango or Arctic references in `packages/providers/src/`.
- **Single Enforced Boundary:** `getToken()` is the only runtime path that yields a bearer token. Triggers and Actions never read tokens from storage directly.
- **Catalog Persistence:** Integrations owns the storage and CRUD lifecycle of the `org_connectors` table, including persisting the MCP tool drift hashes (though runtime enforcement of those hashes is owned by Actions).

---

## 2. Core Concepts & Reference Implementations

### 2.1 Connection Requirements (Provider-Declared)
Providers declare what credentials they require. They do not declare how those credentials are fulfilled by a specific OAuth broker.

```typescript
// packages/providers/src/types.ts
export type ConnectionType = "oauth2" | "app_installation" | "bot_token" | "api_key" | "none";

export interface ConnectionRequirement {
  type: ConnectionType;
  preset?: string; // Stable framework lookup key, e.g. "sentry"
  scopes?: string[];
  optional?: boolean;
}

export interface IntegrationProvider {
  id: string; // e.g. "sentry"
  displayName: string;
  category: "issue_tracker" | "source_control" | "monitoring" | "custom";
  
  // 1. CONTROL PLANE: What credentials do I need?
  // Notice there is NO `oauthConfigKey` here. That is an implementation leak.
  connections: {
    org?: ConnectionRequirement;
    user?: ConnectionRequirement; // Enables optional Git commit authorship
  };

  // 2. DATA PLANE: (See actions.md)
  actions?: ProviderActions;
  
  // 3. INGESTION PLANE: (See triggers.md)
  triggers?: ProviderTriggers;
}

```

* Key detail agents get wrong: provider modules are broker-agnostic declarations; Nango/Arctic mapping belongs to Integrations framework code.

### 2.2 Decoupling OAuth Brokers (The Preset Mapping)

Because `IntegrationProvider` declares a stable `preset: "sentry"`, the provider code doesn't change even if we swap OAuth brokers. The backend Integrations router maintains a static mapping:

```typescript
// packages/services/src/integrations/presets.ts
export const OAUTH_PRESETS = {
  sentry: { brokerKey: "sentry", requiredScopes: ["event:read"] },
  linear: { brokerKey: "linear", requiredScopes: ["read", "write"] },
  github: { brokerKey: "github", requiredScopes: ["repo", "read:user"] },
} as const;

```

When a user clicks "Connect Sentry", the UI looks up this preset, triggers the underlying OAuth flow (Nango today), and saves the resulting connection string to the `integrations` table.

### 2.3 Token Resolution (`getToken`)

`getToken()` is the runtime enforcement boundary that resolves a live token. By accepting `opts.userId`, we enable optional user-attributed execution (for example, user-authored GitHub commits).

**CRITICAL TRAP:** Integration modules receive tokens as arguments injected into their `execute()` or `poll()` functions; they do not query PostgreSQL or secret stores themselves.

```typescript
// packages/services/src/integrations/tokens.ts
export async function getToken(
  integrationId: string, 
  orgId: string, 
  opts?: { userId?: string }
): Promise<string> {
  // 1. If opts.userId is passed, check `user_connections` first (for user attribution)
  if (opts?.userId) {
     const userConn = await db.userConnections.find(opts.userId, integrationId);
     if (userConn) return resolveTokenFromBroker(userConn);
  }
  
  // 2. Fall back to org-scoped connections (integrations table)
  const orgConn = await db.orgConnections.find(orgId, integrationId);
  if (!orgConn) throw new Error(`No connection found for ${integrationId}`);
  
  return resolveTokenFromBroker(orgConn);
}

// Internal framework helper that actually calls Nango, GitHub API, etc.
async function resolveTokenFromBroker(conn: ConnectionRow): Promise<string> {
  if (conn.provider === "nango") {
    return nango.getConnection(conn.connection_id).access_token;
  }
  if (conn.provider === "github-app") {
    return githubApp.getInstallationToken(conn.github_installation_id);
  }
  // handle bot_token, etc...
}

```

---

## 3. File Tree

Target file ownership remains split between "credentials/control plane" (this spec) and "provider modules" (consumed by Actions/Triggers).

```text
packages/services/src/integrations/
├── index.ts                          # Module exports
├── service.ts                        # Business logic (list, create, delete, status)
├── db.ts                             # Drizzle queries
├── mapper.ts                         # DB row → API response transforms
├── tokens.ts                         # getToken() (org + user scope)
├── presets.ts                        # OAuth preset mapping (broker-specific)
└── github-app.ts                     # GitHub App JWT + installation token utilities

packages/services/src/connectors/
├── index.ts                          # Module exports
├── db.ts                             # Drizzle queries for org_connectors
└── service.ts                        # Connector CRUD + validation

packages/providers/src/               # (Dependency) Code-defined integration modules
├── types.ts                          # IntegrationProvider interface
└── registry.ts                       # ProviderRegistry (static Map)

packages/db/src/schema/
├── integrations.ts                   # integrations + binding tables
├── slack.ts                          # slack_installations tables
├── connectors.ts                     # org_connectors (includes tool_risk_overrides)
└── user-connections.ts               # user_connections (new)

apps/web/src/lib/
├── nango.ts                          # Nango SDK singleton
├── slack.ts                          # Slack API helpers (OAuth, postMessage, revoke)
└── github-app.ts                     # GitHub App JWT + installation verification

apps/web/src/server/routers/
└── integrations.ts                   # oRPC router (all integration + connector endpoints)

apps/web/src/app/settings/
└── tools/page.tsx                    # Org-level connector management UI

apps/web/src/app/api/integrations/
├── github/callback/route.ts          # GitHub App installation callback
├── slack/oauth/route.ts              # Slack OAuth initiation (redirect)
└── slack/oauth/callback/route.ts     # Slack OAuth callback (token exchange)

apps/gateway/src/lib/
└── github-auth.ts                    # Gateway-side GitHub token resolution

```

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
├── github_installation_id TEXT                -- GitHub App only
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
    UNIQUE(connection_id, organization_id)
    INDEX(organization_id)
    INDEX(github_installation_id)

-- Connection Bindings
repo_connections
├── id                  UUID PK
├── repo_id             UUID NOT NULL FK(repos) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── UNIQUE(repo_id, integration_id)

automation_connections
├── id                  UUID PK
├── automation_id       UUID NOT NULL FK(automations) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── UNIQUE(automation_id, integration_id)

session_connections
├── id                  UUID PK
├── session_id          UUID NOT NULL FK(sessions) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── UNIQUE(session_id, integration_id)

-- New in vNext: User-level integration connections
user_connections
├── id               UUID PK
├── user_id          TEXT NOT NULL FK(users)
├── organization_id  TEXT NOT NULL FK(organization)
├── provider         TEXT NOT NULL        -- e.g. "github"
├── connection_id    TEXT NOT NULL        -- OAuth connection reference
├── display_name     TEXT
├── status           TEXT NOT NULL DEFAULT 'active'
├── metadata         JSONB
├── created_at       TIMESTAMPTZ
└── updated_at       TIMESTAMPTZ
    UNIQUE(user_id, organization_id, provider, connection_id)
    INDEX(user_id)
    INDEX(organization_id)

-- Existing table extended in vNext
org_connectors
├── id                  UUID PK DEFAULT gen_random_uuid()
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── name                TEXT NOT NULL
├── transport           TEXT NOT NULL DEFAULT 'remote_http'
├── url                 TEXT NOT NULL
├── auth                JSONB NOT NULL
├── risk_policy         JSONB
├── tool_risk_overrides JSONB            -- { "<toolName>": { mode, hash }, ... }
├── enabled             BOOLEAN NOT NULL DEFAULT true
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ DEFAULT now()
└── updated_at          TIMESTAMPTZ DEFAULT now()
    INDEX(organization_id)

-- Slack Specific Tables
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

* Resolve a user token uses `UNIQUE(user_id, provider)` on `user_connections`.
* Connector mode overrides are stored as JSONB on `org_connectors` and read by Actions at session runtime.
* Webhook handlers resolve integrations by `github_installation_id`.

---

## 5. Conventions & Patterns

### Do

* Treat provider-declared connection requirements as declarative input only; never call Nango/Arctic from provider modules.
* Keep `getToken()` as the only bearer token boundary used by Actions/Triggers.
* Encrypt bot tokens and secrets at rest via `@/lib/crypto` before storing; never log token material.
* Store connector tool overrides and hashes on the connector record; keep enforcement in Actions.
* Use `packages/services/src/integrations/` for all DB reads/writes — never query directly from routers.

### Don't

* Do not store raw OAuth tokens for broker-managed connections in PostgreSQL (Nango/Arctic owns refresh+storage).
* Do not couple provider modules to OAuth broker identifiers (Nango integration keys, Arctic provider IDs).
* Do not implement per-tool permissioning in Integrations (it is persisted here, enforced in Actions).

### Reliability

* Token resolution should be idempotent and safe to retry; external brokers may have transient failures.
* GitHub App installation tokens are cached for 50 min (expire at 60 min).
* Slack API calls use exponential backoff with retry on 429 (`ratelimited`), max 3-5 retries.

---

## 6. Subsystem Deep Dives

### 6.1 Connect An OAuth Integration

**What it does:** Starts an OAuth flow for a provider, then persists the resulting connection reference as an org integration record.

**Happy path:**

1. UI selects a provider (by `IntegrationProvider.id`) and reads its `connections.org` requirement for scopes + preset.
2. Integrations auth layer maps the provider `preset` to broker-specific config and starts the OAuth handshake.
3. Callback persists an `integrations` row referencing the broker connection ID and marks it `active`.
4. Session/automation binds the integration via `session_connections` / `automation_connections`.

**Edge cases:**

* Provider declares `type: "oauth2"` but no scopes → warn during provider registry validation (boot-time), fail safe at connect-time.
* Broker implementation swap (Nango → Arctic) → preset key remains stable; only framework mapping changes.

### 6.2 Slack OAuth & Installations

**What it does:** Workspace-level Slack bot installation with encrypted token storage. Not Nango-managed.

**Happy path:**

1. `GET /api/integrations/slack/oauth` verifies auth, generates base64url-encoded state, redirects to Slack.
2. User authorizes in Slack.
3. `GET /api/integrations/slack/oauth/callback` validates state (5-min expiry), exchanges code for token.
4. Bot token is encrypted via `encrypt()` from `@/lib/crypto`.
5. Checks for existing `(org, team_id)` pair in `slack_installations`, updates or creates.

### 6.3 Onboard An MCP Connector (Persist Tool Modes)

**What it does:** Stores per-tool mode overrides and drift hashes as part of connector configuration.

**Happy path:**

1. Admin creates `org_connectors` (url + auth mapping).
2. System connects to the MCP server, calls `tools/list`, and computes definition hashes from normalized tool schemas (stripping `enum`, `description`, `default`).
3. Admin confirms per-tool mode (`allow | require_approval | deny`); Integrations persists `{ mode, hash }` to `tool_risk_overrides` JSONB.
4. Actions consumes these values at runtime (see `./actions.md`).

### 6.4 GitHub App Installation

**What it does:** Installs a GitHub App on the user's account/org, saves the installation, and auto-adds repos.

**Happy path:**

1. User clicks "Install GitHub App", authenticates.
2. GitHub redirects to `GET /api/integrations/github/callback` with `installation_id` and `state`.
3. Route verifies auth, parses `state`, and calls `verifyInstallation()` to confirm via GitHub API.
4. Upserts into `integrations` table with `provider='github-app'`, `connection_id='github-app-{installationId}'`.
5. Auto-adds all repos from the installation.

### 6.5 Integration Disconnect

**What it does:** Removes an integration, cleans up upstream broker connection, and detects orphaned repos.

**Happy path:**

1. `integrationsRouter.disconnect` fetches the integration, checks org ownership.
2. For broker-managed connections: calls the broker API (e.g., `nango.deleteConnection()`) to revoke upstream.
3. Deletes the row from `integrations` (cascades to bindings).
4. For GitHub: runs `handleOrphanedRepos()` to mark repos with zero `repo_connections` as `isOrphaned=true`.

### 6.6 Metadata Queries (Sentry / Linear)

**What it does:** Fetches provider-specific metadata (projects, environments, teams, workflow states) for trigger/action configuration in the UI.

**Happy path:**

1. UI requests metadata for `connectionId`.
2. Router verifies integration, fetches live token via `getToken()`.
3. Issues specific API requests:
* Sentry: `GET /api/0/organizations/` → `projects/` → `environments/`.
* Linear: Single GraphQL query for teams, states, labels, users, projects.



---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
| --- | --- | --- | --- |
| Actions | Actions → Integrations | `getToken()` | Runtime token resolution for provider-backed actions. |
| Triggers | Triggers → Integrations | `getToken()` | Token resolution for polling and optional `hydrate()`. |
| Secrets | Integrations → Secrets | `resolveSecretValue()` | Connector auth secrets. |
| Providers package | Integrations → Providers | `IntegrationProvider.connections` | Connection requirement declarations. |
| Repos | Repos → Integrations | `repo_connections` table | Repos bind to integrations for GitHub access |
| Automations | Automations → Integrations | `automation_connections` table | Runs resolve tokens for enrichment context |
| Sessions | Sessions → Integrations | `session_connections` table | Sessions use tokens for git operations |

### Security & Auth

* All connector CRUD and OAuth flows are org-scoped and require admin/owner privileges (`orgProcedure` middleware).
* Never return tokens in API responses; only return connection metadata.
* Encrypt Slack bot tokens and database connector secrets at rest; never log token material.

---

## 8. Acceptance Gates

* [ ] Providers declare abstract connection requirements; they never import Nango or Arctic.
* [ ] `getToken()` correctly checks `user_connections` before falling back to org-level connections.
* [ ] MCP Connector onboarding securely persists the initial tool definition hashes to `tool_risk_overrides`.
* [ ] Slack, Sentry Metadata, and GitHub App integrations function perfectly through the new framework.

---

## 9. Known Limitations & Tech Debt

* [ ] `user_connections` UI flows (allowing an individual user to OAuth their personal account) are planned and may be deferred until a design partner strictly requires user attribution.
* [ ] OAuth broker implementation details vary (Nango vs Arctic). Presets must remain stable across broker swaps.
* [ ] Duplicated GitHub App JWT logic (`packages/services/src/integrations/github-app.ts` vs `apps/gateway/src/lib/github-auth.ts`) should be consolidated.
* [ ] **Orphaned repo detection is O(n)** — `handleOrphanedRepos` iterates all non-orphaned repos and runs a count query per repo. Should be a single query.

