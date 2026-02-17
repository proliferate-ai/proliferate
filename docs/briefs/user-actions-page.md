# Brief: User-Scoped Actions Page

> Context document for external principal engineer review.
> No codebase access needed — this brief is self-contained.

---

## 1. What We Want to Build

A new **"Actions"** page scoped to the individual user (not the org admin). Based on what global integrations and connectors the org admins have configured, each user can choose which action sources (tools) they want enabled in their coding sessions.

Think of it as: **Admin configures what's available. User configures what they personally use.**

---

## 2. Current Architecture (How It Works Today)

### 2.1 Two Types of Action Sources

All actions in Proliferate flow through a single polymorphic interface (`ActionSource`). There are two concrete types today:

| Type | Examples | How Configured | Scope |
|------|----------|---------------|-------|
| **OAuth Adapter Actions** | Linear (5 actions), Sentry (5 actions), Slack (1 action) | Admin connects OAuth via Nango/GitHub App. Code-defined, statically registered. | Org-level |
| **MCP Connector Actions** | Context7, PostHog, Firecrawl, Neon, Stripe, custom | Admin adds remote MCP server URL + auth credentials. Tools discovered dynamically at runtime via `tools/list`. | Org-level |

Both share the same invocation pipeline: risk classification → mode resolution → execute or queue for approval.

### 2.2 Permission Model (Three-Mode Cascade)

Every action invocation resolves to one mode: `allow` (auto-execute), `require_approval` (human must approve), or `deny` (reject).

Resolution is a three-tier cascade:

```
1. Automation override    →  automations.action_modes["sourceId:actionId"]
2. Org default            →  organizations.action_modes["sourceId:actionId"]
3. Inferred default       →  risk hint: read→allow, write→require_approval, danger→deny
```

Both `action_modes` fields are JSONB columns on existing tables. Keys are `"sourceId:actionId"` (e.g., `"linear:create_issue"`, `"connector:uuid-abc:search_docs"`).

**Key insight**: There is currently NO user-level tier in this cascade.

### 2.3 How Actions Reach the Agent

1. **Session boot**: Agent gets a static bootstrap guide (`.proliferate/actions-guide.md`) explaining how to use the `proliferate actions` CLI.
2. **Runtime discovery**: Agent calls `GET /:sessionId/actions/available` which merges:
   - OAuth adapter actions (from `session_connections` — which integrations are linked to this session)
   - MCP connector actions (from `org_connectors` — all enabled connectors for the org)
3. **Invocation**: Agent calls `POST /:sessionId/actions/invoke` → gateway resolves mode → executes or queues.

**What determines which actions appear for a session?**
- OAuth actions: only if the integration is linked via `session_connections` (junction table). Sessions auto-inherit connections from their repo's `repo_connections`.
- MCP connector actions: ALL enabled org connectors appear for every session. No per-session or per-user filtering.

### 2.4 Existing Admin UI

- **Integrations page** (`/dashboard/integrations`): Admin connects OAuth providers, adds MCP connectors.
- **Integration detail page** (`/dashboard/integrations/[id]`): Two tabs — "Connection" and "Agent Permissions". Permissions tab shows per-action mode toggles (Allow / Approval / Deny) that write to `organizations.action_modes`.
- **Inbox tray**: Shows pending action approvals across the org for admin review.

### 2.5 Existing User-Level Infrastructure

| What Exists | Status | Notes |
|-------------|--------|-------|
| `user_connections` table | Schema exists, partially wired | Stores per-user integration connections (userId + orgId + provider + connectionId). Used for user-attributed git commits (GitHub token fallback). |
| `userSshKeys` table | Implemented | Per-user SSH keys for CLI. |
| `cliGithubSelections` | Implemented | Per-user GitHub selection history. |
| User preferences table | **Does not exist** | No general-purpose user preferences/settings infrastructure. |

---

## 3. The Proposal

### 3.1 User Actions Page

A page at `/dashboard/actions` (or `/settings/actions`) where each authenticated user sees:

1. **All action sources available in their org** — both OAuth adapters and MCP connectors that admins have configured.
2. **Per-source toggle**: Enable/disable each source for their sessions. When disabled, the source's actions don't appear in `GET /available` for that user's sessions.
3. **Possibly per-action granularity** within a source (e.g., enable Linear `list_issues` but disable `create_issue`).

### 3.2 Open Design Questions

These are the decisions we need advice on:

**Q1: Where does "user preferences" sit in the mode cascade?**

Option A — **User preferences as a filter layer BEFORE mode resolution:**
The user's enabled/disabled choices act as a pre-filter. Disabled sources never reach the mode cascade — they simply don't appear in `GET /available`. The three-tier cascade (automation → org → inferred) stays unchanged for anything that passes through.

Option B — **User preferences as a NEW tier in the mode cascade:**
Add a fourth tier: `automation override → user preference → org default → inferred default`. User can set `allow`/`deny`/`require_approval` per action, overriding org defaults (but still under automation overrides). This is more powerful but more complex.

Option C — **User preferences as a LOWER tier (below org, above inferred):**
Same four tiers but user preferences only override the inferred default, never the org admin's explicit setting. Org admin retains hard control.

**Q2: Data model for user action preferences?**

Option A — **New JSONB column on `member` table:**
```sql
ALTER TABLE member ADD COLUMN action_preferences JSONB;
-- { "linear": true, "connector:uuid": false, "sentry:update_issue": false }
```
Pros: Simple, no new table. Scoped to org membership (user might want different prefs per org).
Cons: `member` table is owned by better-auth; adding columns may complicate auth upgrades.

Option B — **New `user_action_preferences` table:**
```sql
CREATE TABLE user_action_preferences (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  source_id TEXT NOT NULL,         -- "linear", "connector:uuid", etc.
  action_id TEXT,                  -- NULL = entire source, specific = per-action
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, organization_id, source_id, action_id)
);
```
Pros: Clean, extensible, row-per-preference. Easy to query, index, and extend.
Cons: More tables, more queries.

Option C — **Extend `user_connections` table:**
This table already exists and links users to integrations at a per-org scope. Could add an `enabled` boolean or extend `metadata` JSONB.
Pros: Reuses existing infrastructure.
Cons: Semantically wrong — `user_connections` is for OAuth token attribution, not preference storage.

**Q3: What's the default when a user hasn't set any preferences?**

Option A — **All enabled by default.** User must explicitly disable sources they don't want. (Fewest surprises for existing users.)

Option B — **All disabled by default.** User must explicitly enable sources. (Most intentional, but friction for new users.)

Option C — **Inherit from a suggested set or onboarding flow.** Show a picker during first session/onboarding.

**Q4: Can org admins force-enable or force-disable per user?**

Should the org admin be able to:
- Force a source ON (user cannot disable it) — e.g., "everyone must have Sentry actions available"
- Force a source OFF for specific users — e.g., "interns can't use Slack actions"

This is role-based access control territory. Today roles are simple (owner/admin/member) with no per-integration RBAC.

**Q5: How does this interact with `session_connections`?**

OAuth adapter actions currently require the integration to be linked to the session via `session_connections` (which inherits from `repo_connections`). MCP connectors bypass this — all enabled org connectors appear for all sessions.

If user preferences disable an OAuth integration, do we:
A. Skip linking it in `session_connections` entirely?
B. Link it but filter it out at `GET /available` time?
C. Unify both OAuth and connector filtering through the new user preferences layer?

---

## 4. Key Entities & Relationships (Reference)

```
Organization
├── integrations[]          (OAuth: GitHub, Sentry, Linear, Slack)
│   ├── repo_connections[]  (links integrations → repos)
│   ├── session_connections[] (links integrations → sessions, inherited from repo)
│   └── automation_connections[]
├── org_connectors[]        (MCP: Context7, PostHog, Neon, custom servers)
│   └── tool_risk_overrides (per-tool mode + drift hash)
├── action_modes: JSONB     (org-level mode overrides: "sourceId:actionId" → mode)
├── members[]
│   └── user
│       └── user_connections[] (per-user OAuth token attribution, partially wired)
├── automations[]
│   └── action_modes: JSONB (automation-level mode overrides)
└── sessions[]
    └── action_invocations[] (audit trail of all action calls)
```

**Action source types today:**
- `"linear"` — Linear OAuth adapter (5 actions: list_issues, get_issue, create_issue, update_issue, add_comment)
- `"sentry"` — Sentry OAuth adapter (5 actions: list_issues, get_issue, list_issue_events, get_event, update_issue)
- `"slack"` — Slack adapter (1 action: send_message)
- `"connector:<uuid>"` — MCP connector (N actions, dynamically discovered)

**Gateway action routes** (all under `/:sessionId/actions/`):
- `GET /available` — merged catalog of all sources + actions for this session
- `POST /invoke` — invoke an action (risk → mode → execute or queue)
- `POST /invocations/:id/approve` — approve pending (admin/owner only)
- `POST /invocations/:id/deny` — deny pending (admin/owner only)
- `GET /guide/:integration` — markdown guide for a source

---

## 5. Suggested Implementation Sketch

This is a rough outline, not a directive. Seeking feedback on the approach.

### Phase 1: Data Model + Backend

1. Create `user_action_preferences` table (Q2 Option B).
2. Add oRPC routes: `userActions.list` (returns all org sources with user's enabled/disabled state), `userActions.update` (toggle a source or action).
3. Modify `GET /:sessionId/actions/available` in gateway to filter by user preferences (Q1 Option A — pre-filter before mode cascade). Requires resolving the session's creator user and loading their preferences.

### Phase 2: Frontend

1. New page at `/dashboard/actions` or `/settings/actions`.
2. Lists all action sources available in the org (both OAuth adapters and MCP connectors).
3. Each source shows: icon, name, description, list of actions with risk levels, enable/disable toggle.
4. User-scoped — each user sees their own toggle state.

### Phase 3: Refinements

1. Per-action granularity (not just per-source).
2. Admin force-enable/force-disable policies.
3. Onboarding flow integration.

---

## 6. Constraints & Gotchas

- **`member` table is better-auth managed** — adding columns there is risky for auth library upgrades. Prefer a separate table.
- **MCP connectors are org-wide today** — no session-level or user-level binding exists. Adding user filtering is net-new for connectors.
- **OAuth adapters flow through `session_connections`** — this junction table determines which OAuth integrations a session can use. User preferences would need to intersect with this.
- **Grants system is being replaced** — the old `action_grants` table (CAS-based reusable permissions) is being removed in vnext in favor of the three-mode cascade. Don't build on grants.
- **Drift detection for MCP tools** — connector tools can change at runtime. If a user enables a connector, and later the tool definition drifts, the drift guard still applies (admin must re-review). User preferences don't bypass drift guards.
- **No user preferences infrastructure exists** — this would be the first user-level settings feature beyond SSH keys and CLI selections. Worth designing the table generically enough to support future user preferences (or keeping it action-specific and simple).
