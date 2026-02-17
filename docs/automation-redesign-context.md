# Automation Editing/Viewing Page — Full Redesign Context

> Compiled research for the automation detail page redesign. Covers all frontend, backend, data models, fake/unused fields, action permissions, run/execute logic, and design inspiration.

---

## Table of Contents

1. [Design Inspiration (Tembo Reference)](#1-design-inspiration-tembo-reference)
2. [Current File Tree](#2-current-file-tree)
3. [Current Automation Detail Page — Full Source](#3-current-automation-detail-page)
4. [Fake / Unused / Redundant Fields Audit](#4-fake--unused--redundant-fields-audit)
5. [Frontend Components](#5-frontend-components)
6. [Frontend Hooks](#6-frontend-hooks)
7. [Data Types & Models](#7-data-types--models)
8. [Database Schema](#8-database-schema)
9. [Backend Services](#9-backend-services)
10. [API Layer (oRPC Routers)](#10-api-layer-orpc-routers)
11. [Action Permissions System](#11-action-permissions-system)
12. [Run / Execute Pipeline](#12-run--execute-pipeline)
13. [Worker Architecture](#13-worker-architecture)
14. [Summary of What Needs to Change](#14-summary-of-what-needs-to-change)

---

## 1. Design Inspiration (Tembo Reference)

**File**: `inspiration/tembo/automation.html`

The Tembo design uses a clean, Notion-like property table layout:

**Key design patterns:**
- **Title**: Inline-editable input at the top, with a "Run" button + "Edited now" timestamp in the top-right
- **Property rows**: Key-value pairs with left-aligned labels (`Runs`, `Properties`, `Repositories`, `Agent`) and right-aligned values as chips/buttons
  - `Runs` → "Next run in 23 hours" chip with clock icon
  - `Properties` → User avatar chip ("Pablo")
  - `Repositories` → Repo selector chip ("onyx") with up/down arrows
  - `Agent` → Model selector chip ("Claude Code: Opus 4.6") with provider icons
- **Schedules section**: Titled `h3`, rounded container with schedule chips ("Daily at 8:00am") as a button group (schedule + clock icon + X delete), plus a "+" add button
- **Triggers section**: Titled `h3`, just a "+" add button (empty by default)
- **Divider**: Simple `bg-black/[0.06]` line
- **Instructions section**: "Instructions" title with a "Save" button, then a `contenteditable` div for freeform text

**What to take from Tembo:**
- Property table layout (key-value rows) instead of sidebar columns
- "Run" button in the header with warning icon
- Clean schedule chips with inline edit/delete
- Flat sections (Schedules, Triggers, Instructions) with clear headings
- Minimal chrome, lots of whitespace

**Full HTML:**
```html
<div class="text-black/[0.6] flex-col flex-grow text-sm pb-10 px-4 relative flex bg-zinc-50">
    <div class="flex-col flex-grow flex">
        <div>
            <div class="items-center justify-between flex gap-2">
                <div class="flex-col flex-grow flex text-xl text-black/[0.92]"><input placeholder="Title of automation"
                        class="cursor-text w-[36.56rem] h-6" /></div>
                <div class="items-center flex gap-2">
                    <span class="text-black/[0.24]">Edited now</span><button
                        class="bg-white items-center cursor-pointer justify-center flex w-7 h-7 rounded-lg text-black/[0.4]">
                        <!-- vertical dots icon -->
                    </button><button
                        class="text-black/[0.24] bg-black/[0.04] items-center justify-center px-2 text-center flex w-16 h-7 rounded-lg">
                        Run<!-- warning triangle icon -->
                    </button>
                </div>
            </div>
            <div class="flex-col flex gap-2">
                <div class="items-start flex">
                    <p class="text-black/[0.4] pt-1">Runs</p>
                    <div class="items-center flex-wrap flex text-black/[0.8]">
                        <button class="bg-black/[0.04] items-center justify-center px-1.5 text-center flex w-40 h-6 rounded-lg">
                            <!-- clock icon -->Next run in 23 hours
                        </button>
                    </div>
                </div>
                <div class="items-start flex">
                    <p class="text-black/[0.4] pt-1">Properties</p>
                    <div class="items-center flex-wrap flex text-black/[0.8]">
                        <button class="bg-black/[0.04] items-center justify-center px-1.5 relative text-center flex w-16 h-6 rounded-lg gap-[0.13rem]">
                            <img src="..." class="w-4 h-4 rounded-full" />
                            <span>Pablo</span>
                        </button>
                    </div>
                </div>
                <div class="items-start flex">
                    <p class="text-black/[0.4] pt-1">Repositories</p>
                    <div class="items-center flex-wrap flex">
                        <button class="bg-white items-center cursor-pointer justify-center px-1 text-center flex w-20 h-6 rounded-md gap-[0.13rem]">
                            <!-- github icon --><span class="text-ellipsis">onyx</span><!-- sort icon -->
                        </button>
                    </div>
                </div>
                <div class="items-start flex">
                    <p class="text-black/[0.4] pt-1">Agent</p>
                    <div class="items-center flex-wrap flex text-black/[0.8]">
                        <button class="bg-white items-center cursor-pointer justify-center px-1.5 text-center flex w-52 h-6 rounded-md gap-[0.13rem]">
                            <!-- anthropic + claude icons -->
                            <span class="text-ellipsis">Claude Code: Opus 4.6</span><!-- sort icon -->
                        </button>
                    </div>
                </div>
            </div>
            <div>
                <div>
                    <h3 class="text-black/[0.8] font-semibold">Schedules</h3>
                    <div class="bg-black/[0.04] border-2 border-black/[0.06] border-solid rounded-xl p-1">
                        <div class="items-center flex-wrap flex gap-2">
                            <div class="items-stretch flex">
                                <button class="text-black/[0.8] bg-white items-center rounded-bl-lg rounded-tl-lg cursor-pointer justify-center px-1.5 text-center flex w-32 h-6">
                                    <!-- refresh icon -->Daily at 8:00am</button>
                                <button class="bg-white items-center cursor-pointer justify-center flex w-6 h-6 text-black/[0.4]">
                                    <!-- clock icon --></button>
                                <button class="bg-white items-center rounded-br-lg rounded-tr-lg cursor-pointer justify-center flex w-6 h-6 text-black/[0.4]">
                                    <!-- X icon -->
                                </button>
                            </div>
                            <button class="bg-white items-center cursor-pointer justify-center flex w-6 h-6 rounded-lg text-black/[0.4]">
                                <!-- plus icon -->
                            </button>
                        </div>
                    </div>
                </div>
                <div>
                    <h3 class="text-black/[0.8] font-semibold">Triggers</h3>
                    <div class="items-center flex-wrap flex text-black/[0.4]">
                        <button class="bg-white items-center cursor-pointer justify-center flex w-6 h-6 rounded-lg">
                            <!-- plus icon -->
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="bg-black/[0.06]"></div>
        <div class="items-center justify-between flex">
            <h2 class="text-black/[0.92] text-xl">Instructions</h2>
            <button class="bg-white items-center cursor-pointer justify-center px-2 text-center flex w-11 h-7 rounded-lg">Save</button>
        </div>
        <div class="flex-col flex text-black/[0.8]">
            <div contenteditable="true" style="line-break: after-white-space;" class="flex-grow p-5">ladida ladidity</div>
        </div>
    </div>
</div>
```

---

## 2. Current File Tree

```
apps/web/src/
├── app/(command-center)/dashboard/automations/
│   ├── page.tsx                          # Automations list page
│   └── [id]/
│       ├── page.tsx                      # ★ Automation detail/edit page (REDESIGN TARGET)
│       └── events/
│           └── page.tsx                  # Automation runs/events page
│
├── components/automations/
│   ├── add-trigger-button.tsx            # AddTriggerButton (Popover + TriggerConfigForm)
│   ├── automation-card.tsx               # AutomationCard (unused? list uses row now)
│   ├── automation-list-row.tsx           # AutomationListRow (list page table row)
│   ├── model-selector.tsx               # ModelSelector (Popover dropdown)
│   ├── recipe-cards.tsx                  # RecipeCards (2x2 preset grid)
│   ├── template-picker-dialog.tsx        # TemplatePickerDialog (full template catalog)
│   ├── trigger-chip.tsx                  # TriggerChip (display trigger with edit/delete)
│   └── trigger-config-form.tsx           # TriggerConfigForm (★ most complex - all providers)
│
├── components/integrations/
│   └── permission-control.tsx            # PermissionControl (Allow/Approval/Deny toggle)
│
├── components/actions/
│   └── action-invocation-card.tsx        # ActionInvocationCard (approval UI)
│
├── hooks/
│   ├── use-automations.ts               # All automation CRUD + runs + triggers hooks
│   ├── use-triggers.ts                   # Trigger CRUD hooks
│   ├── use-trigger-providers.ts          # Trigger provider metadata
│   ├── use-action-modes.ts              # Action permission mode hooks
│   ├── use-actions.ts                    # Action invocation + approval hooks
│   ├── use-action-preferences.ts         # User action preference hooks
│   └── use-templates.ts                  # Template catalog hooks
│
├── lib/
│   ├── action-adapters.ts               # Static frontend metadata for Linear + Sentry adapters
│   └── permissions.ts                    # Permission check utilities
│
└── server/routers/
    ├── automations.ts                    # Automation oRPC procedures
    ├── actions.ts                        # Action invocation listing
    ├── triggers.ts                       # Trigger CRUD procedures
    └── orgs.ts                           # Org-level action modes
```

**Backend:**
```
packages/services/src/
├── automations/
│   ├── service.ts                        # Automation CRUD + action modes
│   └── db.ts                             # Automation DB queries
├── actions/
│   ├── service.ts                        # Action invocation lifecycle
│   ├── modes.ts                          # Three-tier mode resolution cascade
│   ├── modes-db.ts                       # Mode persistence helpers
│   └── db.ts                             # Action invocation queries
├── runs/
│   ├── service.ts                        # Run lifecycle (create, claim, transition, complete)
│   └── db.ts                             # Run DB queries
├── triggers/
│   ├── service.ts                        # Trigger CRUD + polling
│   └── db.ts                             # Trigger DB queries
└── notifications/
    └── service.ts                        # Run notification enqueuing

apps/worker/src/
├── index.ts                              # Worker entry point (starts automation workers)
└── automation/                           # BullMQ workers: enrich, execute, outbox, finalizer

apps/trigger-service/src/
├── index.ts                              # Trigger service entry point
├── server.ts                             # Express server (webhook receiver)
├── webhook-inbox/worker.ts               # Webhook processing worker
├── polling/worker.ts                     # Poll group worker
└── gc/inbox-gc.ts                        # Inbox garbage collection

apps/gateway/src/api/proliferate/http/
└── actions.ts                            # Gateway action invoke/approve routes
```

---

## 3. Current Automation Detail Page

**File**: `apps/web/src/app/(command-center)/dashboard/automations/[id]/page.tsx` (786 lines)

### Current Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ Header: [StatusDot] [Name editor] [Edited Xm ago]  [Events] [⋮] [Toggle] │
├────────────────────────────────────┬────────────────────────────┤
│ Left Column (flex-1)               │ Right Column (w-80)        │
│                                    │                            │
│ [Instructions textarea]            │ TRIGGERS                   │
│                                    │ ┌─ TriggerChip ──────────┐│
│ [Event Filter textarea]            │ ├─ TriggerChip ──────────┤│
│                                    │ └─ + Add Trigger ────────┘│
│ [Analysis Instructions textarea]   │                            │
│  (only if tools enabled)           │ MODEL                      │
│                                    │ ┌─ ModelSelector ────────┐│
│                                    │ └────────────────────────┘│
│                                    │                            │
│                                    │ ACTIONS                    │
│                                    │ ┌─ ☐ Slack (config) ─────┐│
│                                    │ ├─ ☐ Linear (config) ────┤│
│                                    │ ├─ ☐ Email (config) ─────┤│
│                                    │ └─ ☑ Agent Session ──────┘│
│                                    │                            │
│                                    │ PERMISSIONS                │
│                                    │ ┌─ Linear: list_issues ──┐│
│                                    │ │  [Allow|Approval|Deny]  ││
│                                    │ ├─ Linear: get_issue ────┤│
│                                    │ │  [Allow|Approval|Deny]  ││
│                                    │ ├─ Linear: create_issue ─┤│
│                                    │ │  [Allow|Approval|Deny]  ││
│                                    │ ├─ ... (10 total rows) ──┤│
│                                    │ └────────────────────────┘│
└────────────────────────────────────┴────────────────────────────┘
```

### Component Tree
```
AutomationDetailPage
├── Loading / Error states
├── Header
│   ├── StatusDot
│   ├── InlineEdit (name)
│   ├── "Edited Xm ago"
│   ├── Link → Events page
│   ├── DropdownMenu (Delete)
│   └── Switch (enabled/disabled)
├── Two-Column Layout
│   ├── Left: TextAreaWithFooter × 3 (instructions, filter, analysis)
│   └── Right:
│       ├── Triggers section (TriggerChip[] + AddTriggerButton)
│       ├── Model section (ModelSelector)
│       ├── Actions section (ToolListItem[] × 4)
│       └── AutomationPermissions
│           └── PermissionControl[] (one per action × adapter)
└── AlertDialog (delete confirmation)
```

---

## 4. Fake / Unused / Redundant Fields Audit

### FUNCTIONAL — Wired to backend, affects behavior

| Field | UI Element | Backend Column | Status |
|-------|-----------|---------------|--------|
| `name` | InlineEdit | `automations.name` | Functional |
| `enabled` | Switch toggle | `automations.enabled` | Functional |
| `agentInstructions` | Instructions textarea | `automations.agent_instructions` | Functional |
| `llmFilterPrompt` | Event Filter textarea | `automations.llm_filter_prompt` | Functional |
| `llmAnalysisPrompt` | Analysis Instructions textarea | `automations.llm_analysis_prompt` | Functional |
| `modelId` | ModelSelector | `automations.model_id` | Functional |
| `enabledTools` | ToolListItem toggles | `automations.enabled_tools` (JSONB) | Functional |
| `enabledTools.slack_notify.channelId` | Input | In JSONB | Functional |
| `enabledTools.create_linear_issue.teamId` | Input | In JSONB | Functional |
| `enabledTools.email_user.defaultTo` | Input | In JSONB | Functional |
| `notificationSlackInstallationId` | Select | `automations.notification_slack_installation_id` | Functional |
| Triggers | TriggerChip + TriggerConfigForm | `triggers` table | Functional |
| Action modes | PermissionControl | `automations.action_modes` (JSONB) | Functional |

### PARTIALLY FUNCTIONAL — Exists in UI and backend but questionable value

| Field | Issue |
|-------|-------|
| `enabledTools.create_session` toggle | Always enabled by default, badge says "Default". The toggle exists but the agent session is the primary action — disabling it would make the automation mostly useless. Questionable whether users should even be able to disable it. |

### FAKE / MISLEADING — UI elements not fully wired or misleading

| Element | Issue |
|---------|-------|
| **Permissions section shows ALL static adapter actions regardless of what's enabled** | If you haven't enabled Linear or Sentry integrations on this automation, the permissions list still shows all 10 Linear+Sentry actions. These permissions would never fire because the actions aren't connected. This is misleading — permissions should only show for actions that are actually possible on this automation. |
| **Permission list is unstructured** | All 10 actions shown as a flat list with no grouping by integration. Hard to scan. The format "Linear: list_issues" with a risk badge below is hard to parse at a glance. |
| **Static adapters only** | Permissions UI only shows Linear and Sentry actions (from `action-adapters.ts`). Connector-backed actions (MCP tools) are NOT shown at all — those permissions exist in the backend (`sourceId:actionId` supports `connector:<uuid>:tool_name`) but have no UI. |
| **"Analysis Instructions" textarea appears/disappears** | Only shown when `hasEnabledTools` (Slack, Linear, or Email enabled). But the field is always saved to the backend and could be useful even without those tools. The conditional display is confusing. |
| **No "Run Now" button** | Scheduled automations cannot be manually triggered from the UI. The backend supports creating runs from trigger events, but there's no "Run Now" path for manual testing. |
| **No run history visible on detail page** | You have to navigate to a separate Events page. No inline preview of recent runs. |

### UNUSED BACKEND FIELDS — Exist in schema but not in current UI

| Backend Field | Note |
|--------------|------|
| `automations.description` | Not editable in the detail page UI |
| `automations.agent_type` | Not exposed in UI (hardcoded to OpenCode) |
| `automations.default_prebuild_id` | Not in detail page UI |
| `automations.allow_agentic_repo_selection` | Not in detail page UI |
| `automations.notification_channel_id` | Not in detail page UI (only `notification_slack_installation_id` is shown) |
| `automations.source_template_id` | Metadata only, not shown |
| `schedules` table | Schedules exist as a separate table but the UI treats "scheduled" as a trigger type instead of using the schedules system |

---

## 5. Frontend Components

### PermissionControl (`components/integrations/permission-control.tsx`)

```tsx
type ActionMode = "allow" | "require_approval" | "deny";

// Three-button segmented control: [Allow] [Approval] [Deny]
// Simple toggle — no grouping, no context about what the action does
export function PermissionControl({ value, onChange, disabled }: PermissionControlProps)
```

### ModelSelector (`components/automations/model-selector.tsx`)

```tsx
// Popover with list of Claude models
// Shows current model name + icon
// Options: Claude 4.5 Sonnet, Claude 4 Opus, Claude 3.5 Haiku
Props: { modelId: ModelId, onChange, disabled?, variant?, triggerClassName? }
```

### TriggerChip (`components/automations/trigger-chip.tsx`)

```tsx
// Displays a configured trigger with edit/delete
// variant="stacked" → full-width row
// Shows provider icon + label + summary (e.g., "Daily at 8:00am", "In Progress, High, created/updated")
// Click opens Popover with TriggerConfigForm for editing
// X button deletes trigger
Props: { trigger, automationId, onDeleted?, variant?, isFirst?, isLast? }
```

### TriggerConfigForm (`components/automations/trigger-config-form.tsx`)

**The most complex component** — configures all 6 trigger types:

| Provider | Config Fields |
|----------|--------------|
| `linear` | Team selector, state filters, priority filters, action filters (create/update) |
| `sentry` | Project slug, environments, min level |
| `github` | Event types, action filters, conclusion filters |
| `posthog` | Event names CSV, property filters CSV, signature verification |
| `webhook` | URL display, secret display, signature verification toggle |
| `scheduled` | Cron expression picker with human-readable display |

### AddTriggerButton (`components/automations/add-trigger-button.tsx`)

```tsx
// Popover with TriggerConfigForm in create mode
// variant="stacked" → full-width button in trigger list
Props: { automationId, onAdded?, variant?, isFirst?, isLast? }
```

### Action Adapters (`lib/action-adapters.ts`)

Static metadata for the permissions list. Only two adapters defined:

```ts
ACTION_ADAPTERS = [
  { integration: "linear", displayName: "Linear", actions: [
    { name: "list_issues", riskLevel: "read" },
    { name: "get_issue", riskLevel: "read" },
    { name: "create_issue", riskLevel: "write" },
    { name: "update_issue", riskLevel: "write" },
    { name: "add_comment", riskLevel: "write" },
  ]},
  { integration: "sentry", displayName: "Sentry", actions: [
    { name: "list_issues", riskLevel: "read" },
    { name: "get_issue", riskLevel: "read" },
    { name: "list_issue_events", riskLevel: "read" },
    { name: "get_event", riskLevel: "read" },
    { name: "update_issue", riskLevel: "write" },
  ]},
]
```

**Problem**: This is duplicated from backend adapter definitions and only covers Linear + Sentry. Connector actions (MCP tools) are not represented at all.

---

## 6. Frontend Hooks

### use-automations.ts
```ts
useAutomations()                        // List all automations
useAutomation(id)                       // Get single with triggers
useCreateAutomation()                   // Create blank
useUpdateAutomation(id)                 // Update fields
useDeleteAutomation()                   // Delete
useAutomationRuns(id, options?)         // List runs with status filter
useAssignRun(id)                        // Claim run
useUnassignRun(id)                      // Release run
useMyClaimedRuns()                      // User's claimed runs
useOrgPendingRuns(options?)             // Org-wide pending runs
useAutomationTriggers(id)              // List triggers
useCreateAutomationTrigger(id)          // Create trigger
useAutomationSchedules(id)              // List schedules
useCreateAutomationSchedule(id)         // Create schedule
useAutomationConnections(id)            // List connections
useAddAutomationConnection(id)          // Add connection
useRemoveAutomationConnection(id)       // Remove connection
```

### use-action-modes.ts
```ts
useActionModes()                         // Org-level modes
useSetActionMode()                       // Set org-level mode
useAutomationActionModes(automationId)   // Automation-level modes
useSetAutomationActionMode(automationId) // Set automation-level mode
// Modes: "allow" | "require_approval" | "deny"
```

### use-triggers.ts
```ts
useTriggers()                            // List all triggers
useTrigger(id)                           // Get with recent events
useCreateTrigger()                       // Create
useUpdateTrigger()                       // Update
useDeleteTrigger()                       // Delete
useTriggerEvents(options?)               // List events
useSkipTriggerEvent()                    // Skip event
```

### use-templates.ts
```ts
useTemplateCatalog()                     // Get template catalog
useCreateFromTemplate()                  // Create automation from template
```

---

## 7. Data Types & Models

### Core Automation Type
```ts
interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;

  // Agent config
  agent_instructions?: string;
  agent_type?: string;
  model_id?: ModelId;
  default_prebuild_id?: string;
  allow_agentic_repo_selection?: boolean;

  // LLM pipeline
  llm_filter_prompt?: string | null;
  llm_analysis_prompt?: string | null;

  // Tools & notifications
  enabled_tools?: Record<string, unknown>;
  notification_slack_installation_id?: string | null;

  // Relations
  _count: { triggers: number; schedules: number };
  triggers?: AutomationTrigger[];
  activeProviders: string[];
}
```

### Trigger Types
```ts
type AutomationTrigger = {
  id: string;
  provider: "webhook" | "scheduled" | "linear" | "sentry" | "github" | "posthog";
  config: TriggerConfig;
  enabled: boolean;
  integration_id?: string;
  integration?: { display_name: string };
  polling_cron?: string;
  webhook_secret?: string;
  webhook_url?: string;
};

type TriggerConfig =
  | LinearTriggerConfig    // teamId, stateFilters, priorityFilters, actionFilters
  | SentryTriggerConfig    // projectSlug, environments, minLevel
  | GitHubTriggerConfig    // eventTypes, actionFilters, conclusionFilters
  | PostHogTriggerConfig   // eventNames, propertyFilters, requireSignatureVerification
  | { requireSignatureVerification?: boolean }; // webhook
```

### Run Types
```ts
type AutomationRunStatus =
  | "queued" | "enriching" | "ready" | "running"
  | "succeeded" | "failed" | "needs_human" | "timed_out"
  | "canceled" | "skipped" | "filtered";

interface AutomationRun {
  id: string;
  status: AutomationRunStatus;
  status_reason?: string;
  error_message?: string;
  queued_at?: string;
  session_id?: string;
  assignee?: { id, name, image };
  trigger?: { provider: string };
  trigger_event?: {
    provider_event_type?: string;
    parsed_context?: ParsedEventContext;
  };
}
```

### EnabledTools Shape (JSONB)
```ts
interface EnabledTools {
  slack_notify?: { enabled: boolean; channelId?: string };
  create_linear_issue?: { enabled: boolean; teamId?: string };
  email_user?: { enabled: boolean; defaultTo?: string };
  create_session?: { enabled: boolean };
}
```

### Action Modes
```ts
type ActionMode = "allow" | "require_approval" | "deny";
type ActionModesMap = Record<string, ActionMode>;
// Key format: "sourceId:actionId" (e.g., "sentry:update_issue", "connector:<uuid>:tool_name")
```

---

## 8. Database Schema

### `automations` table
```sql
id                                UUID PK
organization_id                   TEXT FK → organization
name                              TEXT
description                       TEXT
enabled                           BOOLEAN (default true)
agent_instructions                TEXT
agent_type                        TEXT
model_id                          TEXT
default_prebuild_id               UUID FK → configurations
allow_agentic_repo_selection      BOOLEAN
llm_filter_prompt                 TEXT
llm_analysis_prompt               TEXT
enabled_tools                     JSONB
notification_channel_id           TEXT
notification_slack_installation_id TEXT
action_modes                      JSONB  -- {"sourceId:actionId": "allow"|"deny"|"require_approval"}
source_template_id                TEXT
created_by                        TEXT
created_at                        TIMESTAMPTZ
updated_at                        TIMESTAMPTZ
```

### `triggers` table
```sql
id                UUID PK
automation_id     UUID FK → automations
organization_id   TEXT
integration_id    UUID FK → integrations (optional)
trigger_type      TEXT ("webhook" | "polling")
provider          TEXT ("sentry" | "linear" | "github" | "custom" | "webhook")
enabled           BOOLEAN
webhook_secret    TEXT
webhook_url_path  TEXT
polling_cron      TEXT
polling_endpoint  TEXT
polling_state     JSONB
config            JSONB (provider-specific)
last_polled_at    TIMESTAMPTZ
```

### `trigger_events` table
```sql
id                  UUID PK
trigger_id          UUID FK → triggers
organization_id     TEXT
external_event_id   TEXT
provider_event_type TEXT
status              TEXT ("queued"|"processing"|"completed"|"failed"|"skipped")
raw_payload         JSONB
parsed_context      JSONB
dedup_key           TEXT (unique per trigger, 5-min window)
enriched_data       JSONB
llm_filter_result   JSONB
llm_analysis_result JSONB
error_message       TEXT
skip_reason         TEXT
```

### `automation_runs` table
```sql
id                      UUID PK
organization_id         TEXT
automation_id           UUID FK → automations
trigger_id              UUID FK → triggers
trigger_event_id        UUID FK → trigger_events
status                  TEXT ("queued"|"enriching"|"ready"|"executing"|"succeeded"|"failed"|"needs_human"|"timed_out")
status_reason           TEXT
failure_stage           TEXT
session_id              UUID
lease_owner             TEXT
lease_expires_at        TIMESTAMPTZ
lease_version           INTEGER
queued_at               TIMESTAMPTZ
enrichment_started_at   TIMESTAMPTZ
enrichment_completed_at TIMESTAMPTZ
execution_started_at    TIMESTAMPTZ
prompt_sent_at          TIMESTAMPTZ
completed_at            TIMESTAMPTZ
deadline_at             TIMESTAMPTZ
enrichment_json         JSONB
completion_id           TEXT
completion_json         JSONB
completion_artifact_ref TEXT
error_code              TEXT
error_message           TEXT
assigned_to             TEXT
assigned_at             TIMESTAMPTZ
```

### `action_invocations` table
```sql
id               UUID PK
session_id       UUID
organization_id  TEXT
integration_id   UUID
integration      TEXT  -- adapter name or "connector:<uuid>"
action           TEXT  -- action name
risk_level       TEXT  -- "read" | "write" | "danger"
mode             TEXT  -- "allow" | "require_approval" | "deny"
mode_source      TEXT  -- "automation_override" | "org_default" | "inferred_default"
params           JSONB
status           TEXT  -- "pending"|"approved"|"executing"|"completed"|"denied"|"failed"|"expired"
result           JSONB
error            TEXT
denied_reason    TEXT
duration_ms      INTEGER
approved_by      TEXT
approved_at      TIMESTAMPTZ
completed_at     TIMESTAMPTZ
expires_at       TIMESTAMPTZ
```

### `schedules` table (unused by current UI)
```sql
id               UUID PK
automation_id    UUID FK → automations
name             TEXT
cron_expression  TEXT
timezone         TEXT
enabled          BOOLEAN
last_run_at      TIMESTAMPTZ
next_run_at      TIMESTAMPTZ
```

---

## 9. Backend Services

### Automations Service (`packages/services/src/automations/service.ts`)

```ts
listAutomations(orgId)
getAutomation(id, orgId)                    // Returns automation with triggers
createAutomation(orgId, userId, input)
updateAutomation(id, orgId, input)
deleteAutomation(id, orgId)
automationExists(id, orgId)
getAutomationActionModes(id, orgId)         // Read action_modes JSONB
setAutomationActionMode(id, orgId, key, mode) // Merge-patch single mode
listAutomationEvents(automationId, orgId, options)
getAutomationEvent(automationId, eventId, orgId)
listAutomationTriggers(automationId, orgId, gatewayUrl)
createAutomationTrigger(automationId, orgId, userId, input, gatewayUrl)
listAutomationConnections(automationId, orgId)
addAutomationConnection(automationId, orgId, integrationId)
removeAutomationConnection(automationId, orgId, integrationId)
findWebhookTrigger(automationId)
findTriggerForAutomationByProvider(automationId, provider)
createTriggerEvent(input)
```

### Runs Service (`packages/services/src/runs/service.ts`)

```ts
createRunFromTriggerEvent(input)            // Create run + trigger event in transaction
claimRun(runId, allowedStatuses, leaseOwner, leaseTtlMs)
transitionRunStatus(runId, toStatus, updates, data)
markRunFailed(options)                      // Mark failed + notify
completeRun(input)                          // Mark succeeded/failed/needs_human + notify
saveEnrichmentResult(input)
completeEnrichment(input)                   // Atomic: persist + transition ready + enqueue
listRunsForAutomation(automationId, orgId, options)
assignRunToUser(runId, orgId, userId)
unassignRun(runId, orgId)
resolveRun(input)                           // Manual resolution of needs_human/failed/timed_out
```

### Actions Service (`packages/services/src/actions/service.ts`)

```ts
invokeAction(input)                         // Resolve mode + create invocation
// Returns: { invocation, needsApproval }
// Mode resolution: automation override → org default → risk inference

markExecuting(invocationId)
markCompleted(invocationId, result, durationMs)
markFailed(invocationId, error, durationMs)
approveAction(invocationId, orgId, userId)
denyAction(invocationId, orgId, userId)
getActionStatus(invocationId, orgId)
listSessionActions(sessionId)
listPendingActions(sessionId)
listOrgActions(orgId, options)
expireStaleInvocations()                    // Expire pending after 5 minutes
```

---

## 10. API Layer (oRPC Routers)

### `automations` router (`apps/web/src/server/routers/automations.ts`)

```ts
list                    // List automations for org
get                     // Get automation with triggers
create                  // Create blank automation
createFromTemplate      // Create from template (single transaction)
update                  // Update automation config
delete                  // Delete automation
listEvents              // List trigger events for automation
getEvent                // Get single event detail
listTriggers            // List triggers
createTrigger           // Add trigger
listSchedules           // List schedules
createSchedule          // Add schedule
listConnections         // List connected integrations
addConnection           // Link integration
removeConnection        // Unlink integration
getActionModes          // Get action mode overrides
setActionMode           // Set single action mode
listOrgPendingRuns      // Org-wide pending runs
listRuns                // List runs for automation
assignRun               // Claim run
unassignRun             // Release run
myClaimedRuns           // User's claimed runs
resolveRun              // Manual resolution
```

---

## 11. Action Permissions System

### Three-Mode Cascade

Every action invocation resolves to exactly one mode:

1. **Automation override** — `automations.action_modes["sourceId:actionId"]` (highest priority)
2. **Org default** — `organizations.action_modes["sourceId:actionId"]`
3. **Inferred default** — from risk hint:
   - `read` → `allow`
   - `write` → `require_approval`
   - `danger` → `deny`

**Drift guard**: If a connector tool's definition has changed since admin review, `allow` → `require_approval` (but `deny` stays `deny`).

### Mode Values
- **`allow`** — Execute immediately, no human approval
- **`require_approval`** — Create pending invocation, wait for human (5-min timeout)
- **`deny`** — Reject immediately

### Key Format
```
"sourceId:actionId"
```
Examples:
- `"linear:create_issue"` — Linear adapter create action
- `"sentry:update_issue"` — Sentry adapter update action
- `"connector:abc123:list_items"` — MCP connector tool

### Current UI Problems

1. **Flat, unstructured list**: All 10 Linear+Sentry actions shown in a single flat list. No grouping by integration, no visual hierarchy.
2. **Static only**: Only shows Linear (5 actions) and Sentry (5 actions) from hardcoded `ACTION_ADAPTERS`. Connector-backed actions have no UI.
3. **Shows irrelevant actions**: Permissions for Linear/Sentry shown even if those integrations aren't connected to the automation.
4. **No explanation of modes**: No inline help explaining what "Allow", "Approval", "Deny" mean in practice.

### PermissionControl Component
```tsx
// Simple three-button segmented control
<div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
  <button>[Allow]</button>
  <button>[Approval]</button>
  <button>[Deny]</button>
</div>
```

---

## 12. Run / Execute Pipeline

### Pipeline Stages
```
Trigger Event → queued → enriching → ready → executing → succeeded/failed/needs_human
                                                              ↓
                                                         timed_out (2h deadline)
```

### How Runs Are Created

1. **Webhook/polling trigger** fires in trigger-service
2. `createRunFromTriggerEvent()` creates both a `trigger_event` and an `automation_run` in a single transaction
3. An outbox entry (`enqueue_enrich`) is created
4. Worker picks up the outbox entry and starts enrichment
5. Enrichment completes → outbox entries for `write_artifacts` + `enqueue_execute`
6. Execute worker runs the agent session
7. Agent completes → `completeRun()` marks status + creates outbox for `notify_run_terminal`

### Manual Run Trigger — Does NOT Exist

**There is no "Run Now" / manual trigger path in the current codebase.** To add this:

- Need a new API endpoint (e.g., `automations.triggerManualRun`)
- It would create a trigger event with a synthetic payload + create a run
- The run would then follow the normal pipeline (enrich → execute)
- Alternative: create a "webhook" trigger type and POST to it, but that's roundabout

### Worker Architecture

Workers are started in `apps/worker/src/index.ts`:

```ts
const automationWorkers = startAutomationWorkers(logger.child({ module: "automation" }));
// Workers: enrich, execute, outbox, finalizer (BullMQ-based)
```

The trigger service (`apps/trigger-service/src/index.ts`) handles:
- Webhook inbox processing
- Poll group scheduling
- Inbox garbage collection

### Run Statuses & Their Meaning

| Status | Meaning |
|--------|---------|
| `queued` | Run created, waiting for enrichment |
| `enriching` | LLM enrichment in progress |
| `ready` | Enrichment done, waiting for execution |
| `executing` | Agent session running |
| `succeeded` | Completed successfully |
| `failed` | Failed at any stage |
| `needs_human` | Agent flagged for human review |
| `timed_out` | Exceeded 2-hour deadline |
| `canceled` | Manually canceled |
| `skipped` | Skipped by filter logic |
| `filtered` | Filtered out by LLM filter |

### Deadline
- Default: **2 hours** (`DEFAULT_RUN_DEADLINE_MS = 2 * 60 * 60 * 1000`)

---

## 13. Worker Architecture

### Automation Workers (BullMQ)
Started in `apps/worker/src/automation/`:
- **Enrich worker**: Picks up `enqueue_enrich` outbox items, runs LLM enrichment
- **Execute worker**: Picks up `enqueue_execute` outbox items, starts agent session
- **Outbox worker**: Processes outbox items (artifact writes, notifications)
- **Finalizer worker**: Handles stale/timed-out runs

### Trigger Service (`apps/trigger-service/`)
- **Webhook inbox worker**: Processes incoming webhooks → creates trigger events
- **Poll group worker**: Runs scheduled polling (cron-based)
- **Inbox GC**: Cleans up old processed webhook entries

### Action Expiry Sweeper
- Runs in the worker process
- Expires pending action invocations after 5 minutes

---

## 14. Summary of What Needs to Change

### Must Fix
1. **Add "Run Now" button** — New endpoint + UI button to manually trigger a run for testing scheduled automations
2. **Collapse Actions + Permissions together** — Currently separate sections; permissions should be inline with each action
3. **Remove fake logic** — Don't show permission controls for actions that aren't connected to this automation
4. **Structure the permissions UI** — Group by integration, only show relevant actions, make modes clearer

### Design Direction (from Tembo)
5. **Property table layout** — Move model, triggers, repo into key-value rows instead of sidebar
6. **Cleaner header** — Title input + "Run" button + timestamp + menu
7. **Schedule chips** — Inline schedule management with add/edit/delete
8. **Single-column layout** — Consider replacing two-column with single-column Notion-style

### Nice to Have
9. **Inline run preview** — Show last few runs on the detail page
10. **Dynamic permission list** — Fetch available actions from backend instead of hardcoded `ACTION_ADAPTERS`
11. **Connector action permissions** — UI for MCP connector tool permissions (currently backend-only)
