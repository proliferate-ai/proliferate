# Automation Templates — Implementation Spec

> **Purpose:** Complete implementation spec for the automation template library feature. Incorporates initial context brief + principal engineer architectural review. All open questions are resolved — this document is ready for implementation.

---

## 1. Executive Summary

**What we're building:** A browsable template library for automations — similar in UI to our existing integration picker modal — that lets users select from prebuilt automation recipes. Selecting a template atomically creates a fully-configured automation (instructions, triggers, actions, model, permissions) in a single server-side transaction. Required integrations are gated in the UI — the user must connect them before the template can be instantiated.

**Why:** Creating a fully-configured automation today requires manually: writing agent instructions, adding triggers with provider-specific config, configuring actions (Slack, Linear, Email), selecting a model, binding a repo/prebuild, and setting permissions. This is a cold-start problem — users don't know what a good automation looks like. Templates solve this by encoding opinionated, proven configurations that users can adopt in one click and customize from there.

---

## 2. Current State: What Exists Today

### 2.1 Recipe Cards (Primitive Templates)

We have a minimal "recipe" system. It's a hardcoded array of 4 entries rendered as cards on the empty state of the automations page:

```typescript
// apps/web/src/components/automations/recipe-cards.tsx
const RECIPES = [
  { name: "Sentry Auto-Fixer",       icon: Bug,           agentInstructions: "When a Sentry issue..." },
  { name: "Linear PR Drafter",       icon: GitPullRequest, agentInstructions: "When a Linear issue..." },
  { name: "Scheduled Code Review",   icon: Clock,          agentInstructions: "Run a weekly code review..." },
  { name: "Custom Automation",       icon: Plus,           agentInstructions: "" },
];
```

**What a recipe does today:**
- Creates an automation with `name` + `agentInstructions` pre-filled
- Navigates the user to the automation detail page
- Everything else (triggers, actions, model, repo, permissions) is left for manual setup

**What a recipe does NOT do:**
- Pre-configure triggers (no trigger type, provider, filter config, or integration binding)
- Pre-configure actions (Slack, Linear, Email toggles + config)
- Pre-select a model
- Pre-bind a repo/prebuild
- Indicate which integrations are required or missing
- Show any categorization, search, or browsing experience

**Where recipes appear:**
- Only on the automations list page when `automations.length === 0` (empty state)
- Not accessible once you have at least one automation
- Not accessible from the automation detail page

### 2.2 Integrations Picker Modal (The UI Pattern to Replicate)

Our integrations modal is the gold standard for the template browser UI. It's a two-panel dialog:

```
+------------------------------------------------------------------+
|  Add integration                                            [X]  |
+----------------+-------------------------------------------------+
|                |  Source Control          [Search integrations]   |
| All            |                                                 |
| Source Ctrl    |  +----------+  +----------+  +----------+       |
| Monitoring     |  | [icon]   |  | [icon]   |  | [icon]   |       |
| Project Mgmt   |  | GitHub   |  | GitLab   |  | Bitbucket|       |
| Communication  |  | Source.. X|  | Source.. |  | Source.. |       |
| Dev Tools      |  +----------+  +----------+  +----------+       |
|                |                                                 |
|                |  +----------+  +----------+  +----------+       |
|                |  | [icon]   |  | [icon]   |  | [icon]   |       |
|                |  | Sentry   |  | Linear   |  | Slack    |       |
|                |  | Monitor..|  | Project..|  | Commun.. |       |
|                |  +----------+  +----------+  +----------+       |
+----------------+-------------------------------------------------+
```

**Key properties:**
- `max-w-[1100px]`, `max-h-[75vh]`, `rounded-xl`
- Left sidebar (240px): category filter buttons with active state (`bg-muted`)
- Right panel: search bar + 3-column grid of cards
- Each card: icon + name + description (2-line clamp) + connected badge (checkmark) if applicable
- Empty search state: "No integrations found" + request form
- Categories: Source Control, Monitoring, Project Management, Communication, Developer Tools

**File:** `apps/web/src/components/integrations/integration-picker-dialog.tsx`

### 2.3 The Automation Detail Page (Where Users Land After Template Application)

After applying a template, users are routed to `/dashboard/automations/[id]` — a two-column layout:

**Left column (flexible):**
- Instructions textarea (auto-saves with 1s debounce)
- Event Filter textarea (LLM-based filtering — field exists but pipeline not yet executing)
- Analysis Instructions textarea (conditional on having actions enabled)

**Right column (320px fixed):**
- **Triggers section:** List of trigger chips + "Add trigger" button -> opens `TriggerConfigForm` modal
- **Model selector:** Dropdown with Claude model options
- **Actions section:** Toggle list — Slack (+ channel ID), Linear (+ team ID), Email (+ recipient), Agent Session (default on)
- **Permissions section:** Per-action approval mode (allow / require_approval / deny) for each registered action adapter

**File:** `apps/web/src/app/(command-center)/dashboard/automations/[id]/page.tsx`

### 2.4 The Automations List Page

**Layout:**
- "+ New" button (top-right) — currently creates blank automation
- Empty state: heading + recipe cards (4-card grid)
- Populated state: tab bar (All / Active / Paused with counts) + search + table with columns: Name, Scope, Triggers, Actions, Created, Updated

**File:** `apps/web/src/app/(command-center)/dashboard/automations/page.tsx`

---

## 3. The Automation Data Model (Full Anatomy)

Understanding what a template needs to encode requires understanding every configurable dimension of an automation.

### 3.1 Core Automation Fields

| Field | Type | Default | What it controls |
|-------|------|---------|-----------------|
| `name` | TEXT | "Untitled Automation" | Display name |
| `description` | TEXT | null | Optional description |
| `enabled` | BOOLEAN | true | Active/paused toggle |
| `agent_instructions` | TEXT | null | System prompt for the agent — the core "what to do" |
| `model_id` | TEXT | "claude-sonnet-4-20250514" | Which LLM model to use |
| `agent_type` | TEXT | "opencode" | Sandbox agent type |
| `default_prebuild_id` | UUID FK | null | Target repo/environment |
| `allow_agentic_repo_selection` | BOOLEAN | false | Can the agent dynamically pick a different repo? |
| `llm_filter_prompt` | TEXT | null | LLM-based event filtering instructions (not yet executing) |
| `llm_analysis_prompt` | TEXT | null | Analysis instructions (not yet executing) |
| `enabled_tools` | JSONB | {} | Action toggles + config (Slack channel, Linear team, etc.) |
| `notification_channel_id` | TEXT | null | Slack channel for run status notifications |
| `notification_slack_installation_id` | UUID FK | null | Which Slack workspace |
| `source_template_id` | TEXT | null | **NEW** — Template ID this automation was created from (telemetry) |

### 3.2 Triggers (0..N per automation)

Each trigger is a separate DB row with:

| Field | Type | What it controls |
|-------|------|-----------------|
| `provider` | TEXT | "github" \| "linear" \| "sentry" \| "posthog" \| "gmail" \| "custom" |
| `trigger_type` | TEXT | "webhook" \| "polling" |
| `integration_id` | UUID FK | Which OAuth connection to use (required for github/linear/sentry/gmail) |
| `config` | JSONB | Provider-specific filters (see below) |
| `enabled` | BOOLEAN | Toggle |
| `webhook_secret` | TEXT | Auto-generated for webhook verification |
| `webhook_url_path` | TEXT | Auto-generated (e.g., `/webhooks/t_{uuid}`) |
| `polling_cron` | TEXT | Cron expression (for polling triggers) |

**Provider-specific config shapes:**

| Provider | Key config fields | Required integration |
|----------|------------------|---------------------|
| **GitHub** | Event types (issues, PRs, push, etc.), actions (opened, closed, labeled), branch/label/repo filters, conclusion filters | GitHub App or Nango OAuth |
| **Linear** | Team ID, state filters, priority filters, trigger-on (created/updated) | Linear (Nango OAuth) |
| **Sentry** | Project slug, environments, min severity level | Sentry (Nango OAuth) |
| **PostHog** | Event names, property filters, signature verification toggle | None (webhook-only, optional HMAC) |
| **Gmail** | Label IDs, spam/trash inclusion, result limit | Gmail (Composio OAuth) |
| **Custom** | Webhook URL (auto-generated), optional HMAC verification | None |
| **Scheduled** | Cron expression, timezone | None |

### 3.3 Actions (Configured via `enabled_tools` JSONB)

The automation's `enabled_tools` field controls which actions the agent can invoke:

```typescript
interface EnabledTools {
  slack_notify?:         { enabled: boolean; channelId?: string };
  create_linear_issue?:  { enabled: boolean; teamId?: string };
  email_user?:           { enabled: boolean; defaultTo?: string };
  create_session?:       { enabled: boolean };  // Agent Session — default on
}
```

### 3.4 Action Adapters (What the Agent Can Actually Do)

Beyond the `enabled_tools` toggles, the agent has access to action adapters during execution:

| Adapter | Actions | Risk Level | Required Integration |
|---------|---------|------------|---------------------|
| **Linear** | list_issues (read), get_issue (read), create_issue (write), update_issue (write), add_comment (write) | Mixed | Linear OAuth |
| **Sentry** | list_issues (read), get_issue (read), list_issue_events (read), get_event (read), update_issue (write) | Mixed | Sentry OAuth |
| **Slack** | send_message (write) | Write | Slack bot token |
| **MCP Connectors** | Dynamic per connector | Varies | Org secrets |

### 3.5 Permissions (Per-Action Approval Modes)

Each action can be set to one of three modes per automation:
- **allow** — auto-execute without approval
- **require_approval** — queue for human approval (default for write actions)
- **deny** — block the action entirely

Stored in `automations.enabled_tools` JSONB under action keys like `"linear:create_issue"`.

### 3.6 Automation Connections (Integration Bindings)

The `automation_connections` junction table links integrations (OAuth connections) to automations. This controls which OAuth tokens are available for action execution. Each row is an `(automation_id, integration_id)` pair.

---

## 4. The Automation Lifecycle (End-to-End)

```
1. CREATE automation (name, instructions, model)
2. CONFIGURE triggers (add trigger -> pick provider -> select integration -> set filters)
3. CONFIGURE actions (toggle Slack/Linear/Email, set channel IDs, team IDs)
4. BIND repo (select prebuild or enable agentic repo selection)
5. SET permissions (per-action allow/require_approval/deny)
6. ENABLE (toggle active)

At runtime:
7. TRIGGER fires (webhook/poll -> trigger-service or API route)
8. EVENT parsed (provider adapter extracts context)
9. DEDUP check (unique key per trigger)
10. RUN created (trigger_event + automation_run + outbox — all in one transaction)
11. ENRICHMENT (worker extracts structured context from event)
12. TARGET RESOLUTION (determine which repo/prebuild to use)
13. SESSION CREATION (gateway creates sandbox with model + instructions)
14. PROMPT SENT (trigger context + enrichment + agent instructions)
15. AGENT EXECUTES (invokes actions, creates PRs, sends messages)
16. COMPLETION (agent calls automation.complete -> run succeeds/fails)
17. ARTIFACTS (completion JSON written to S3)
18. NOTIFICATION (Slack message to configured channel)
```

**Key reliability patterns:**
- Transactional outbox for inter-stage delivery (at-least-once)
- Lease-based concurrency control (5-min TTL)
- Deduplication via unique constraint on (trigger_id, dedup_key)
- Finalizer (every 60s) catches stale/stuck runs
- 2-hour deadline per run

---

## 5. Integration Dependency Graph

Templates must declare which integrations they need, and the UI gates instantiation on required ones.

```
Template: "Sentry Auto-Fixer"
|-- REQUIRES: Sentry integration (Nango OAuth)     -> trigger source
|-- REQUIRES: GitHub integration (App or Nango)     -> repo access for agent
|-- OPTIONAL: Slack integration                     -> notifications
|-- OPTIONAL: Linear integration                    -> issue tracking
+-- REQUIRES: At least one repo/prebuild            -> agent workspace

Template: "Linear PR Drafter"
|-- REQUIRES: Linear integration (Nango OAuth)      -> trigger source + actions
|-- REQUIRES: GitHub integration                    -> PR creation
|-- OPTIONAL: Slack integration                     -> notifications
+-- REQUIRES: At least one repo/prebuild            -> agent workspace
```

**Integration availability check:** The existing hooks (`useConnections()` or similar) determine which providers the user has connected. The template detail modal cross-references template requirements against connected integrations.

---

## 6. Design Constraints

### 6.1 Design System Rules (Mandatory)

From `docs/design-system.md`:

- **Minimalist, clean, professional** — Linear/Raycast/Perplexity-inspired
- **Neutral monochrome** — whites, grays, near-blacks; color only for actionable elements and status signals
- **Product density** — `text-xs`/`text-sm`, `p-4`-`p-6`, `gap-2`-`gap-4`
- **No tinted callout boxes** — no green success boxes, no blue info boxes
- **No filler UI** — every element must be functional
- **Semantic tokens only** — `bg-background`, `text-foreground`, `border-border`, etc. No raw Tailwind colors like `bg-blue-500`

### 6.2 Anti-Patterns to Avoid

- Placeholder stat cards with no function
- Repetitive decorative icons
- `font-mono` for metadata
- Raw Tailwind color utilities for surfaces/text
- Tinted callout boxes, nested card borders, pill-style step indicators

### 6.3 Approved Patterns for Status/Dependency Indicators

For showing "this integration is missing," the design system allows:
- **StatusDot component** — small dot with semantic meaning
- **Amber border + icon** — the `connection-card.tsx` "inline" variant uses `bg-amber-500/10 border-amber-500/20` with an `AlertTriangle` icon for missing connections (this is the established pattern)
- **CheckCircle2** — for "connected" / "ready" state

### 6.4 Component Toolkit

- shadcn/ui: Dialog, Button, Input, Select, Switch, Tabs, Tooltip, etc.
- Custom: StatusDot, InlineEdit, ProviderIcon, ConnectorIcon, Text
- Layouts: two-panel dialog (integrations modal pattern), card grid, stacked list

---

## 7. Architectural Decisions (Resolved)

All open questions have been resolved via architectural review. These are binding decisions for implementation.

### D1. Template Data Source — Hardcoded, API-Served

Define templates in `template-catalog.ts` on the backend (inside `packages/services/` or `apps/web/src/server/`). Do NOT import this file directly into frontend components. Serve it via a read-only oRPC procedure (`templates.list`). This ensures the backend can validate definitions against DB enums, and allows seamlessly swapping to a database in V2 without touching frontend code.

### D2. Template Application Atomicity — Single Server-Side Transaction

**No client-side API orchestration.** Build a single oRPC procedure: `automations.createFromTemplate({ templateId, integrationBindings })`. The backend assembles the automation row, inserts the JSONB tool configs, inserts the triggers, and maps the permissions inside a single database transaction. If any step fails, the entire transaction rolls back. No zombie automations.

The `integrationBindings` parameter is a map of `{ [provider]: integrationId }` — the frontend resolves which integration to use for each required provider and passes it in the request. The backend validates that each integration belongs to the org and is active.

### D3. Trigger Creation Without Integration — Gate the Application

If a template *requires* an OAuth-backed trigger (e.g., Sentry), do NOT let the user instantiate the template until they've connected the integration. The CTA in the Template Detail Modal dynamically changes:
- All required integrations connected: **"Use Template"** (enabled)
- Missing required integration: **"Connect {Provider} to Use Template"** (launches OAuth flow inline)

Optional integrations (e.g., Slack for notifications) can be safely skipped and flagged as missing on the detail page after creation.

**Rationale:** The DB schema requires `integration_id` for OAuth-backed triggers. Making it nullable introduces tech debt in the execution engine. Gating is cleaner.

### D4. Template Versioning — Fire-and-Forget

Templates are "stencils," not "linked symbols." Once applied, the automation is entirely independent. If a template's prompt is updated, it only affects future creations. No retroactive syncing.

### D5. Template Categories — Use-Case Oriented

Integrations are categorized by *tool* (Monitoring, Source Control). Templates are categorized by *Jobs-to-be-Done*:

| Category | Sidebar Label | Examples |
|----------|--------------|---------|
| `bug-fixing` | Bug Fixing | Sentry auto-fixer, error responder |
| `code-quality` | Code Quality | PR review bot |
| `project-management` | Project Management | Linear PR drafter, issue triage |
| `devops` | DevOps | CI failure fixer, deploy watcher |

### D6. Repo Binding — Leave for the Detail Page

Do NOT force repo selection inside the template preview modal — it adds friction to browsing. When the user lands on the detail page, display a prominent amber `AlertTriangle` warning indicating they must select a repo before the automation can be enabled.

### D7. "Browse Templates" Placement — Hijack the `+ New` Button

Clicking `+ New` opens the Template Picker Modal. The first card in the grid (distinctly styled) is **"Blank Automation"**. This matches the industry standard for template discovery (Vercel, Figma, Notion, Zapier).

The old recipe cards component (`recipe-cards.tsx`) is retired. The empty state on the automations page also opens the same template picker modal.

### D8. Community/Shared Templates — YAGNI

Ignored for V1. Building multi-tenant template sharing requires a massive shift in permissions, moderation, and attribution. Build for the single-player MVP first.

---

## 8. Security Invariants

### S1. Force `require_approval` for All Write Actions

Templates that pre-configure `actionModes` to `allow` (auto-execute) for write-actions are a security risk. A user might click a template without reading the prompt and an agent starts spamming their Slack workspace.

**The `createFromTemplate` backend must force all write-actions to `require_approval`**, regardless of what the template definition suggests. The user must explicitly downgrade to `allow` on the Detail Page after instantiation.

Implementation: After inserting the automation row with the template's `actionModes`, run a post-insert sweep that overrides any `allow` mode on write-risk actions to `require_approval`.

### S2. Default to Paused State

Template-created automations default to `enabled: false`. Do NOT let a Sentry auto-fixer immediately fire on production webhooks before the user has selected their target repository or filled in prompt placeholders. The user explicitly enables it on the detail page.

### S3. Validate Integration Ownership

The `createFromTemplate` procedure must validate that every `integrationId` in the `integrationBindings` map:
- Belongs to the requesting user's org
- Has an `active` status (not expired, revoked, deleted, or suspended)
- Matches the expected provider type for the template's trigger

---

## 9. Telemetry: `source_template_id` Column

Add a nullable `source_template_id` (TEXT) column to the `automations` table. Set it during `createFromTemplate`. This enables:
- Measuring which templates drive the most activation
- Comparing execution success rate of template-created vs. scratch-built automations
- Identifying which templates need prompt improvements

**Migration:** Simple `ALTER TABLE automations ADD COLUMN source_template_id TEXT;` — no FK constraint (template IDs are hardcoded strings, not DB rows).

---

## 10. Template Data Shape

```typescript
interface AutomationTemplate {
  // Identity
  id: string;                    // unique key (e.g., "sentry-auto-fixer")
  name: string;                  // display name
  description: string;           // 1-2 sentence summary for the card
  longDescription?: string;      // longer description for the detail view
  icon: string;                  // lucide icon name or custom icon key
  category: TemplateCategory;    // for sidebar filtering

  // Agent config
  agentInstructions: string;     // pre-written system prompt (may contain {{PLACEHOLDERS}})
  modelId?: string;              // default: "claude-sonnet-4-20250514"

  // Trigger config
  triggers: TemplateTrigger[];   // 0..N trigger definitions

  // Action config
  enabledTools: {
    slack_notify?:        { enabled: boolean };
    create_linear_issue?: { enabled: boolean };
    email_user?:          { enabled: boolean };
    create_session?:      { enabled: boolean };
  };

  // Permissions (NOTE: write-action modes are forced to require_approval by backend — see S1)
  actionModes?: Record<string, "allow" | "require_approval" | "deny">;

  // Dependencies
  requiredIntegrations: IntegrationRequirement[];
  requiresRepo: boolean;         // if true, detail page shows amber warning until repo is selected
}

type TemplateCategory = "bug-fixing" | "code-quality" | "project-management" | "devops";

interface TemplateTrigger {
  provider: "github" | "linear" | "sentry" | "posthog" | "gmail" | "custom";
  triggerType: "webhook" | "polling";
  config: Record<string, unknown>;  // provider-specific defaults
  cronExpression?: string;          // for polling triggers
}

interface IntegrationRequirement {
  provider: "github" | "linear" | "sentry" | "slack" | "posthog" | "gmail";
  reason: string;       // human-readable: "Trigger source", "PR creation", "Notifications", etc.
  required: boolean;    // true = gates instantiation, false = optional (skipped, flagged on detail page)
}
```

**Prompt Placeholders:** Template `agentInstructions` may contain user-specific context that needs manual replacement. Use strict `{{PLACEHOLDER_NAME}}` convention (e.g., `{{TEAM_NAME}}`, `{{SLACK_CHANNEL}}`). The detail page should visually highlight these so users know what to replace.

---

## 11. UX Flow: Template Application

### 11.1 Entry Point

The `+ New` button on the automations page opens the Template Picker Modal. "Blank Automation" is the first card. The empty state (no automations) also triggers this modal.

### 11.2 Template Picker Modal

Reuses the integration picker dialog layout:

```
+------------------------------------------------------------------+
|  New automation                                             [X]  |
+----------------+-------------------------------------------------+
|                |  Bug Fixing              [Search templates]     |
| All            |                                                 |
| Bug Fixing     |  +----------+  +----------+  +----------+      |
| Code Quality   |  | [+]      |  | [bug]    |  | [git-pr] |      |
| Project Mgmt   |  | Blank    |  | Sentry   |  | Linear   |      |
| DevOps         |  | Start .. |  | Auto-Fix |  | PR Draft |      |
|                |  +----------+  +----------+  +----------+      |
|                |                                                 |
|                |  +----------+  +----------+                     |
|                |  | [alert]  |  | [git]    |                     |
|                |  | CI Fail  |  | GitHub   |                     |
|                |  | Fixer    |  | Issue ...|                     |
|                |  +----------+  +----------+                     |
+----------------+-------------------------------------------------+
```

**Card content:**
- Icon + Name + Description (2-line clamp)
- Small provider icons in the bottom-right showing which integrations are involved (Sentry logo, Linear logo, etc.) — functional, not decorative
- No readiness indicators on the grid cards (that's for the detail view)

**"Blank Automation" card** is visually distinct (dashed border or muted styling) and appears first in every category view.

### 11.3 Template Detail View

Clicking a template card opens a detail view (within the modal, replacing the grid — or as a slide-over panel):

```
+------------------------------------------------------------------+
|  [<- Back]  Sentry Auto-Fixer                              [X]  |
+------------------------------------------------------------------+
|                                                                  |
|  Auto-fix Sentry issues when they occur. Analyzes the error     |
|  stacktrace and source code, then creates a PR with a fix.      |
|                                                                  |
|  WHAT THIS TEMPLATE CONFIGURES                                   |
|  +---------------------------------------------------------+    |
|  | Instructions  Pre-written agent prompt              [eye]|    |
|  | Trigger       Sentry webhook (issue events)              |    |
|  | Model         Claude Sonnet 4                            |    |
|  | Actions       Slack notify, Agent Session                |    |
|  +---------------------------------------------------------+    |
|                                                                  |
|  REQUIRED INTEGRATIONS                                           |
|  +---------------------------------------------------------+    |
|  | [v] GitHub        Connected                              |    |
|  | [!] Sentry        Not connected          [Connect]       |    |
|  +---------------------------------------------------------+    |
|                                                                  |
|  OPTIONAL INTEGRATIONS                                           |
|  +---------------------------------------------------------+    |
|  | [--] Slack        Not connected (optional)               |    |
|  | [--] Linear       Not connected (optional)               |    |
|  +---------------------------------------------------------+    |
|                                                                  |
|  +---------------------------------------------------+          |
|  | Connect Sentry to Use Template                     |          |
|  +---------------------------------------------------+          |
|  (or "Use Template" if all required integrations met)            |
+------------------------------------------------------------------+
```

**CTA button states:**
- All required integrations connected: **"Use Template"** (primary button, enabled)
- Missing required integration(s): **"Connect {Provider} to Use Template"** (primary button, launches OAuth flow inline; after connection completes, button text updates to "Use Template")

**Readiness indicators:**
| State | Indicator | UX |
|-------|-----------|-----|
| Connected | `CheckCircle2` icon, muted text | Ready |
| Not connected (required) | `AlertTriangle` icon, `bg-amber-500/10 border-amber-500/20` | "Connect" action button inline |
| Not connected (optional) | Muted text, no warning | "Optional — connect later" |

### 11.4 Template Application

When user clicks "Use Template":

1. Frontend resolves `integrationBindings`: `{ sentry: "integration-uuid-123", github: "integration-uuid-456" }`
2. Calls `automations.createFromTemplate({ templateId: "sentry-auto-fixer", integrationBindings })`
3. Backend (single transaction):
   a. Insert automation row (`name`, `agent_instructions`, `model_id`, `enabled_tools`, `source_template_id`, `enabled: false`)
   b. Insert triggers (binding `integration_id` from `integrationBindings`)
   c. Insert `automation_connections` for each bound integration
   d. Set action modes (forced to `require_approval` for all write actions — see S1)
4. Return `{ automation: { id, ... } }`
5. Frontend navigates to `/dashboard/automations/{id}`
6. Detail page shows the pre-filled automation in **paused** state with:
   - Instructions containing any `{{PLACEHOLDER}}` values highlighted
   - Triggers pre-configured and visible
   - Actions toggled on per template
   - Amber warning if no repo/prebuild is selected
   - User enables the automation when ready

### 11.5 "Blank Automation" Flow

Clicking "Blank Automation" calls the existing `automations.create({})` and navigates to the detail page — same behavior as current `+ New` button, just triggered from inside the modal.

---

## 12. Known Issues, Tech Debt & Constraints

### 12.1 Existing System Limitations

1. **Scheduled triggers don't execute** — The SCHEDULED BullMQ queue exists but no worker is running. **Do NOT ship a "Scheduled Code Review" template until the cron worker tech debt is resolved.** Omit it from the V1 catalog.

2. **LLM filter/analysis prompts are not executing** — The `llm_filter_prompt` and `llm_analysis_prompt` fields exist in the DB and UI, but the enrichment pipeline doesn't process them. Templates can pre-fill these fields, but they won't have runtime effect yet.

3. **Dual webhook ingestion paths** — Webhooks come in via both the trigger-service and Next.js API routes. Doesn't affect templates directly but means trigger URL generation varies by provider.

4. **Trigger creation requires an integration_id** — For OAuth-backed providers (GitHub, Linear, Sentry, Gmail), triggers can't be created without a connected integration. This is why we gate template application (Decision D3).

5. **Action config is JSONB, not relational** — The `enabled_tools` field is a loose JSONB blob. Templates can set it directly, but there's no schema validation beyond TypeScript types.

### 12.2 Recipe System (Being Retired)

The current `recipe-cards.tsx` will be retired and replaced by the template picker modal. The empty state on the automations page will open the same modal instead of rendering inline recipe cards.

---

## 13. Initial Template Catalog (V1)

Ship ~4 highly polished templates. Each needs battle-tested `agentInstructions` and sensible trigger defaults.

| Template ID | Name | Category | Trigger | Required Integrations | Key Actions |
|-------------|------|----------|---------|----------------------|-------------|
| `sentry-auto-fixer` | Sentry Auto-Fixer | Bug Fixing | Sentry webhook (issue events, severity >= error) | Sentry, GitHub | Agent Session, Slack (optional) |
| `linear-pr-drafter` | Linear PR Drafter | Project Management | Linear webhook (issue moved to In Progress) | Linear, GitHub | Agent Session, Slack (optional) |
| `github-issue-solver` | GitHub Issue Solver | Bug Fixing | GitHub webhook (issues: opened, labeled) | GitHub | Agent Session, Linear (optional), Slack (optional) |
| `ci-failure-fixer` | CI Failure Fixer | DevOps | GitHub webhook (check_run: conclusion=failure) | GitHub | Agent Session, Slack (optional) |

**Omitted from V1:** "Scheduled Code Review" (cron worker not running), Gmail-based templates (Composio dependency), PostHog-based templates (niche).

---

## 14. File Map

### New Files
```
# Template catalog (backend — served via API)
packages/services/src/templates/catalog.ts           # Template definitions array
packages/services/src/templates/types.ts             # AutomationTemplate, TemplateTrigger, etc.
packages/services/src/templates/index.ts             # Barrel export

# Template application logic (backend)
packages/services/src/automations/create-from-template.ts  # Transaction logic

# oRPC routes
apps/web/src/server/routers/templates.ts             # templates.list, automations.createFromTemplate

# Frontend components
apps/web/src/components/automations/template-picker-dialog.tsx   # Two-panel browser modal
apps/web/src/components/automations/template-detail-view.tsx     # Detail + readiness + CTA
apps/web/src/hooks/use-templates.ts                              # oRPC query hook

# DB migration
packages/db/drizzle/XXXX_source_template_id.sql      # Add source_template_id column
```

### Files to Modify
```
# Automations page — replace + New behavior, retire recipe cards empty state
apps/web/src/app/(command-center)/dashboard/automations/page.tsx

# Automation detail page — add amber warning for missing repo, highlight {{placeholders}}
apps/web/src/app/(command-center)/dashboard/automations/[id]/page.tsx

# Automations router — add createFromTemplate procedure
apps/web/src/server/routers/automations.ts

# DB schema — add source_template_id column
packages/db/src/schema/schema.ts

# Retire
apps/web/src/components/automations/recipe-cards.tsx  # DELETE or gut
```

### Existing Files to Reference (Read-Only)
```
# UI pattern to replicate
apps/web/src/components/integrations/integration-picker-dialog.tsx
apps/web/src/components/integrations/integration-detail-dialog.tsx
apps/web/src/components/integrations/connection-card.tsx  # inline variant

# Provider icons
apps/web/src/components/integrations/provider-icon.tsx

# Connection status hooks
apps/web/src/hooks/use-integrations.ts

# Automation CRUD hooks
apps/web/src/hooks/use-automations.ts

# Trigger creation logic (to replicate in createFromTemplate)
packages/services/src/automations/service.ts  # createAutomationTrigger

# Design system
docs/design-system.md
```

### Specs to Update
```
docs/specs/automations-runs.md       # Add template system documentation
docs/specs/feature-registry.md       # Add "Automation Templates" feature entry
```

---

## 15. Implementation Sequence

1. **DB migration:** Add `source_template_id` column to `automations` table
2. **Backend types:** Create `packages/services/src/templates/types.ts` with `AutomationTemplate` interface
3. **Template catalog:** Create `packages/services/src/templates/catalog.ts` with 4 V1 templates
4. **Backend transaction:** Create `packages/services/src/automations/create-from-template.ts` — single-transaction automation creation with security invariants (S1: force require_approval, S2: default paused, S3: validate integrations)
5. **oRPC routes:** Add `templates.list` (read-only) and `automations.createFromTemplate` procedures
6. **Frontend hooks:** Create `use-templates.ts` for fetching template catalog
7. **Template Picker Modal:** Build `template-picker-dialog.tsx` (replicate integration picker layout)
8. **Template Detail View:** Build `template-detail-view.tsx` (readiness indicators, gated CTA, inline OAuth flow)
9. **Wire up automations page:** Replace `+ New` button behavior, retire recipe cards empty state
10. **Detail page enhancements:** Amber repo warning, `{{placeholder}}` highlighting
11. **Specs:** Update `automations-runs.md` and `feature-registry.md`
