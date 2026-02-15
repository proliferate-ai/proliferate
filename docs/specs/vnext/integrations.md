# Integrations — System Spec

> **vNext (target architecture)** — This spec describes the intended Integrations control plane after the unified integrations redesign and may not match `main` yet.
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

### Out of Scope
- Action permissioning and execution (allow/deny/require_approval, approvals, auditing) — see `./actions.md`.
- Trigger ingestion (webhooks, polling, event normalization) — see `./triggers.md`.
- Automation run pipeline and notifications — see `automations-runs.md`.
- Session runtime and sandbox lifecycle — see `./sessions-gateway.md`, `./sandbox-providers.md`.

### Mental Model

Integrations is Proliferate's external connectivity control plane. It stores which external services an org can talk to and how to obtain credentials for them at runtime. Integrations does not execute actions and does not ingest triggers; it only provides records and token resolution primitives that those subsystems consume.

In vNext, code-defined integrations are self-contained modules in `packages/providers/` that declare their connection requirements (OAuth scopes, whether they need org or user tokens, etc.) without binding to a specific OAuth broker. Integrations uses these declarations to drive connect UX and to validate that a session/automation has the right connectivity configured, while `getToken()` remains the single boundary for resolving live access tokens.

**Core entities:**
- **Integration** — an org-scoped external connection reference (Nango connection ID, GitHub App installation ID, Slack bot token reference).
- **User connection** — a user-scoped credential for a provider used when actions need user attribution (optional, provider-specific).
- **Connector** — an org-scoped MCP endpoint configuration (`org_connectors`), including per-tool mode overrides and drift hash metadata.
- **Connection binding** — a junction row linking an integration to a repo, automation, or session.

**Key invariants:**
- Providers declare what they need (`type: "oauth2"`, `scopes`, `preset`) but never how it is fulfilled (no Nango/Arctic references in provider code).
- `getToken()` is the only runtime path that yields a bearer token; other subsystems do not read tokens from storage.
- Connector definitions are org-scoped; sessions consume enabled connectors at runtime (see `./actions.md` for execution semantics).

---

## 2. Core Concepts

### Connection Requirements (Provider-Declared)
Code-defined integration modules declare connection needs via `IntegrationProvider.connections` (required org-scoped credential, optional user-scoped credential, scopes, and a stable `preset` key).
- Key detail agents get wrong: these declarations are not a Nango API. They are broker-agnostic requirements that Integrations maps to whatever auth layer is active.
- Reference: `../../../integrations_architecture.md` §4, §11

### OAuth Presets (Framework Mapping)
`ConnectionRequirement.preset` is a stable string key (`"linear"`, `"sentry"`, `"jira"`, `"github"`) that Integrations maps to broker-specific OAuth configuration (authorization URL, token URL, issuer quirks).
- Key detail agents get wrong: provider code must never depend on preset implementation details. Only the Integrations auth layer uses the mapping.
- Reference: `../../../integrations_architecture.md` §11

### Token Resolution (`getToken`)
`getToken()` resolves a live access token for a given integration reference. In vNext it also supports optional user-scoped credentials by accepting `opts.userId`.
- Key detail agents get wrong: `getToken()` is the enforcement boundary for "provider code is stateless". Integration modules receive tokens as arguments; they do not query PostgreSQL or secrets stores.
- Reference: `packages/services/src/integrations/tokens.ts`, `../../../integrations_architecture.md` §11

### User-Scoped Connections (Optional)
Some providers benefit from user-attributed actions (for example, GitHub authorship). vNext introduces a `user_connections` table so `getToken()` can prefer user credentials when an action requests it, with an org-level fallback.
- Key detail agents get wrong: user-scoped connections are optional and should be gated by real product need; org-scoped bot/app tokens remain the default.
- Reference: `../../../integrations_architecture.md` §11

### Connector Catalog Tool Overrides (Persistence)
When an admin onboards a connector, the system lists tools and stores per-tool mode overrides on the connector record (`org_connectors.tool_risk_overrides`). Each entry includes the chosen mode and a definition hash for drift detection.
- Key detail agents get wrong: Integrations owns persistence and CRUD; Actions owns enforcement and runtime mode resolution.
- Reference: `../../../integrations_architecture.md` §5, §12

---

## 3. File Tree

Target file ownership remains split between "credentials/control plane" (this spec) and "provider modules" (consumed by Actions/Triggers). The vNext additions below are the expected landing spots.

```
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
├── types.ts                          # IntegrationProvider interface (connections/actions/triggers)
└── registry.ts                       # ProviderRegistry (static Map)

packages/db/src/schema/
├── integrations.ts                   # integrations + binding tables
├── slack.ts                          # slack_installations tables
├── connectors.ts                     # org_connectors (includes tool_risk_overrides)
└── user-connections.ts               # user_connections (new)
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
-- New in vNext
user_connections
├── id               UUID PK
├── user_id          TEXT NOT NULL FK(users)
├── provider         TEXT NOT NULL        -- e.g. "github"
├── connection_id    TEXT NOT NULL        -- OAuth connection reference
├── status           TEXT NOT NULL        -- "active" | "inactive"
├── created_at       TIMESTAMPTZ
└── updated_at       TIMESTAMPTZ
    UNIQUE(user_id, provider)
```

```sql
-- Existing table extended in vNext
org_connectors
├── id                  UUID PK
├── organization_id     TEXT NOT NULL
├── name                TEXT NOT NULL
├── url                 TEXT NOT NULL
├── auth                JSONB NOT NULL
├── enabled             BOOLEAN NOT NULL
├── tool_risk_overrides JSONB            -- { "<toolName>": { mode, hash }, ... } (new)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
```

### Core TypeScript Types

```ts
// packages/providers/src/types.ts (dependency)
type ConnectionType =
	| "oauth2"
	| "app_installation"
	| "bot_token"
	| "api_key"
	| "none";

interface ConnectionRequirement {
	type: ConnectionType;
	scope: "org" | "user";
	scopes?: string[];
	optional?: boolean;
	preset?: string;
}
```

### Key Indexes & Query Patterns
- Resolve a user token uses `UNIQUE(user_id, provider)` on `user_connections`.
- Connector mode overrides are stored as JSONB on `org_connectors` and read by Actions at session runtime.

---

## 5. Conventions & Patterns

### Do
- Treat provider-declared connection requirements as declarative input only; never call Nango/Arctic from provider modules.
- Keep `getToken()` as the only bearer token boundary used by Actions/Triggers.
- Encrypt bot tokens and secrets at rest; never log token material.
- Store connector tool overrides and hashes on the connector record; keep enforcement in Actions.

### Don't
- Do not store raw OAuth tokens for broker-managed connections in PostgreSQL (Nango/Arctic owns refresh+storage).
- Do not couple provider modules to OAuth broker identifiers (Nango integration keys, Arctic provider IDs).
- Do not implement per-tool permissioning in Integrations (it is persisted here, enforced in Actions).

### Reliability
- Token resolution should be idempotent and safe to retry; external brokers may have transient failures.

---

## 6. Subsystem Deep Dives

### 6.1 Connect An OAuth Integration

**What it does:** Starts an OAuth flow for a provider, then persists the resulting connection reference as an org integration record.

**Happy path:**
1. UI selects a provider (by `IntegrationProvider.meta.id`) and reads its `connections.org` requirement for scopes + preset.
2. Integrations auth layer maps `preset` to broker config and starts the OAuth handshake.
3. Callback persists an `integrations` row referencing the broker connection ID and marks it `active`.
4. Session/automation binds the integration via `session_connections` / `automation_connections`.

**Edge cases:**
- Provider declares `type: "oauth2"` but no scopes → warn during provider registry validation (boot-time), fail safe at connect-time.

### 6.2 Resolve A Token For Runtime Use

**What it does:** Returns a live access token to Actions/Triggers.

**Happy path:**
1. Actions/Triggers call `getToken(integration, { userId? })`.
2. If `userId` is present and a user connection exists for this provider, return the user token.
3. Otherwise return the org-scoped token (OAuth broker token or GitHub App installation token).

### 6.3 Onboard An MCP Connector (Persist Tool Modes)

**What it does:** Stores per-tool mode overrides and drift hashes as part of connector configuration.

**Happy path:**
1. Admin creates `org_connectors` (url + auth mapping).
2. System lists tools and computes definition hashes.
3. Admin confirms per-tool mode; Integrations persists `{ mode, hash }` to `tool_risk_overrides`.
4. Actions consumes these values at runtime (see `./actions.md`).

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Actions | Actions → Integrations | `getToken()` | Runtime token resolution for provider-backed actions. |
| Triggers | Triggers → Integrations | `getToken()` | Token resolution for polling and optional `hydrate()`. |
| Secrets | Integrations → Secrets | `resolveSecretValue()` | Connector auth secrets. |
| Providers package | Integrations → Providers | `IntegrationProvider.connections` | Connection requirement declarations. |

### Security & Auth
- All connector CRUD is org-scoped and requires admin/owner privileges.
- Never return tokens in API responses; only return connection metadata.

---

## 8. Acceptance Gates

- [ ] Specs updated in `docs/specs/vnext/` when changing any integration/connectivity behavior.
- [ ] Typecheck passes
- [ ] Relevant integration/connectors tests updated or added (if implementing code)

---

## 9. Known Limitations & Tech Debt

- [ ] `user_connections` is planned and may be deferred until a design partner requires user attribution. See `../../../integrations_architecture.md` §11.
- [ ] OAuth broker implementation details vary (Nango vs Arctic). Presets must remain stable across broker swaps.
