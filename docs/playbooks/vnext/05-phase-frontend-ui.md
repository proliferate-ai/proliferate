# Phase 5: Frontend UI & Information Architecture

**Branch:** `vnext/phase-5-frontend-ui`
**Base:** `main` (after Phase 4 is merged)
**PR Title:** `feat: vNext Phase 5 — frontend UI & information architecture`

**Role:** You are a Staff Principal Frontend Engineer and UX Architect working on Proliferate. We have completed our vNext backend refactor.

**Context:** You are executing Phase 5. The backend now treats OAuth apps and MCP Connectors as unified "Integrations", handles Zapier-style automations, and uses a 3-Mode Permissioning cascade. You are redesigning the Next.js frontend IA so the user's mental model matches this perfectly.

## Instructions

1. Create branch `vnext/phase-5-frontend-ui` from `main`.

2. **The Sidebar & Routing:** Group the main navigation sidebar (`apps/web/src/components/layout/`) into three pillars:
   - **WORKSPACE:** Chats (`/dashboard/sessions`), Inbox (`/dashboard/inbox` with a red badge for pending items).
   - **AGENTS:** Automations (`/dashboard/automations`), Repositories (`/dashboard/repositories`), Integrations (`/dashboard/integrations`).
   - **SETTINGS:** Workspace Settings, Members, Global Secrets, Billing.
   - *Ensure `/dashboard/triggers` redirects to Automations, and `/settings/tools` redirects to Integrations.*

3. **The Unified "App Store" (`/dashboard/integrations`):**
   - Merge First-Party OAuth (Linear, GitHub) and MCP Connectors into a single grid. To the user, they are all just "Capabilities".
   - Build `/dashboard/integrations/:id` with two tabs:
     1. **Connection:** (OAuth status button or API Key input).
     2. **Agent Permissions:** A data table listing every action this integration exposes. Next to each row, render a segmented control: `[ Allow | Require Approval | Deny ]`. This must write to `organizations.action_modes`.
   - **CRITICAL TRAP PATCH:** If `org_connectors.tool_risk_overrides` indicates a tool hash has drifted, you MUST flag it in the Agent Permissions table with a yellow warning icon ("Review Required") and visually force the admin to re-approve the segmented control.

4. **Zapier-style Automations Builder (`/dashboard/automations/new`):**
   - Remove "Triggers" as a standalone noun in the UI. It is now just the "WHEN" block of an Automation.
   - Rebuild the Automation creation flow as a wizard:
     - **WHEN (Trigger):** Select Integration -> Select Event -> Set Filters.
     - **WHERE (Repo):** Select codebase/configuration.
     - **WHAT (Prompt):** Agent instructions.
     - **HOW (Permission Overrides):** A UI stating *"This automation inherits your Workspace Permissions. Add overrides below."* Let users set `allow/deny` overrides specifically for this automation (writes to `automations.action_modes`).

5. **The Inbox Hero Feature (`/dashboard/inbox`):**
   - Update `/dashboard` to automatically redirect to `/dashboard/inbox` if the user has pending action approvals.
   - Build the Inbox Item Card. It must clearly state: *"Agent wants to run `[actionId]` with params `[JSON]`."*
   - **CRITICAL TRAP PATCH:** Add three resolution buttons: `[ Approve Once ]`, `[ Deny ]`, and **`[ Approve & Always Allow ]`**. The latter must approve the current `action_invocation` AND send a mutation to update `organizations.action_modes` for that specific `sourceId:actionId` pair to `allow` so they aren't pinged again.

6. **Secret Files UI:**
   - In the Configuration Settings view, build the Vercel-style Secret Files editor. Include a File Path Picker (e.g. `app/.env.local`) and a Key/Value paste-supported editor that writes to the new `secret_files` and `configuration_secrets` tables.

7. Run `pnpm typecheck` and `pnpm lint` to verify everything compiles.
8. Commit, push, and open a PR against `main`.

## Critical Guardrail

- The user should never see the words "MCP", "OAuth", or "IntegrationProvider" in the main UI. To them, they are just "Integrations" the agent has access to.
