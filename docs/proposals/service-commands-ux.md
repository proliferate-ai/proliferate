# Per-Repo Auto-Start Commands: UX Proposal

## Context

We've implemented per-repo auto-start service commands (slices 1-5 from the original plan). The backend, plumbing, provider execution, agent tool, and a basic settings UI are all working. This proposal addresses the UX gap: where and how users configure these commands.

### What's Built

**Data model**: `repos.service_commands` (jsonb), `service_commands_updated_at`, `service_commands_updated_by` columns. Migration `0009_service_commands.sql`.

**API**: `repos.getServiceCommands` and `repos.updateServiceCommands` oRPC endpoints with zod validation (max 10 commands, name/command required, cwd optional).

**Type system**: `ServiceCommand` interface, `RepoSpec.serviceCommands`, `CreateSandboxOpts.snapshotHasDeps`, `Repo.isConfigured` (computed: has service commands + has ready prebuild).

**Plumbing**: Service commands flow from DB through `getPrebuildReposWithDetails` -> all three provisioning paths (web session creation, gateway creator, gateway store/runtime) -> into provider `createSandbox`/`ensureSandbox` calls. `snapshotHasDeps` is derived (never stored) by comparing `snapshot_id` against repo snapshot fallback IDs.

**Provider execution**: Both Modal and E2B providers run auto-start commands after Caddy starts, gated on `snapshotHasDeps`. Fire-and-forget shell processes with output to `/tmp/svc-{workspace}-{index}-{slug}.log`. Shell escaping via `shellEscape()`.

**Agent tool**: `save_service_commands` intercepted tool. Agent can propose commands, user confirms, agent calls the tool -> gateway persists to DB.

**Settings UI (current)**: Repo card shows "Configured" badge. Expanded card has Snapshots/Auto-start tabs. Auto-start tab has inline editor. This works but is disconnected from the actual setup experience.

---

## Problem

The settings page editor works, but it's the wrong place. When a user configures a repo, they're in a **setup session** -- they've just gotten `pnpm dev` working and can see the preview. That's the natural moment to save startup commands, not navigating to settings afterward.

The current flow:
1. User runs a setup session, gets dev server working
2. User saves a snapshot
3. User goes to Settings > Repositories > expands repo > Auto-start tab
4. User manually types the same commands they just ran

This is clunky. The commands should be saveable right where the user is working.

---

## Proposal: "Auto-start" Panel in Session Sidebar

### New Panel in the Right Sidebar

Add a new panel type to the existing right sidebar system (alongside Preview, Session Info, Snapshots, File Viewer).

**Panel contents:**
- 2-line explainer: "These commands run automatically in future sessions that restore from a saved environment snapshot."
- Read-only list of current auto-start commands (if any), showing "Last saved at/by"
- "Edit" button -> inline editor (name, command, cwd fields)
- "Save" button -> calls `repos.updateServiceCommands`

**Header button**: Wrench icon in the session header toolbar (next to Globe, Settings, HardDrive). Toggles the auto-start panel. Tooltip: "Auto-start settings". Always visible regardless of session type -- users may want to configure auto-start from any session.

**No running status in v1.** Detecting which commands are running via log files is flaky (commands can run without logging, logs may not exist yet, process could be dead but log stale). If we want "running" status later, do it properly with PID files or a supervisor manifest. For v1, show "Last saved at/by" and a "Logs" link (if log files are present) instead.

### Where It Fits in the Existing Architecture

The sidebar uses `usePreviewPanelStore` with a single-panel mode system. The current store uses `mode.type` with values like `"none"`, `"url"`, `"session-info"`, `"snapshots"`, etc. Add `"service-commands"` as another case -- don't rename or restructure the existing union:

```typescript
// In stores/preview-panel.ts -- add to existing union, don't change "none"
| { type: "service-commands" }
```

Add `togglePanel("service-commands")` -- same pattern as `togglePanel("snapshots")` and `togglePanel("session-info")`.

### Handling Null Repo ID

Some sessions can have `repoId` null (multi-repo prebuilds, older records, CLI flows). The panel degrades gracefully:
- If no `repoId`: show "Auto-start config is per-repo. This session isn't linked to a single repo." with a link to Settings > Repositories.
- Multi-repo service command support is a future concern. Don't block v1 on it.

### The Improved Flow

**Manual configuration (sidebar):**
1. User runs setup session, gets dev server working
2. User clicks wrench icon in header -> auto-start panel opens
3. User adds "dev-server" / `pnpm dev`
4. User clicks Save
5. User saves snapshot (via Snapshots panel or agent)
6. Done -- future sessions auto-start the dev server

**Agent-driven configuration:**
1. Agent sets up project, starts dev server, verifies it works
2. User says "save those startup commands"
3. Agent calls `save_service_commands({ commands: [...] })`
4. Commands appear in the sidebar panel immediately (query invalidation)
5. Agent calls `save_snapshot()`
6. Done

**Combined (recommended UX):**
1. Agent does setup, calls `save_service_commands`
2. Sidebar panel shows the saved commands (live update)
3. User can review/edit before snapshot
4. Agent calls `save_snapshot`

### Two Editors: Settings (Secondary) + Session Panel (Primary)

Both keep full edit capability. The hierarchy is explicit:

- **Session panel (primary)**: framed as "recommended". Includes the "these will be used for future sessions" explainer. This is where the user is when they know the commands are correct.
- **Settings page (secondary)**: smaller UI, no wizard framing. For quick fixes like typo corrections without starting a session.

This avoids forcing users to start a session just to fix a typo, while making the session panel the clear "blessed" path.

### Snapshots Panel: Passive Hint, No Prompts

In the Snapshots panel, add a small non-blocking status line:
- "Auto-start: not configured" (with "Open Auto-start panel" link) if empty
- "Auto-start: 3 commands configured" if set

No modal prompts, no "save commands + snapshot" bundling. Keep them as separate actions.

---

## Implementation

### Files to Create/Modify

| File | Change |
|------|--------|
| `apps/web/src/stores/preview-panel.ts` | Add `"service-commands"` to mode union, add `openServiceCommands()` action, extend `togglePanel` to accept `"service-commands"` |
| `apps/web/src/components/coding-session/auto-start-panel.tsx` | **New**. Panel component: explainer text, read-only list with "last saved at/by", edit mode with name/command/cwd form. Uses `useServiceCommands` + `useUpdateServiceCommands` hooks. Null repoId -> graceful fallback message. |
| `apps/web/src/components/coding-session/right-panel.tsx` | Add case for `mode.type === "service-commands"` rendering `AutoStartPanel` |
| `apps/web/src/components/coding-session/session-header.tsx` | Add wrench icon button with tooltip "Auto-start settings", toggles `"service-commands"` panel |
| `apps/web/src/components/coding-session/snapshots-panel.tsx` | Add passive auto-start status hint with link to open auto-start panel |

### Data Flow

The panel needs the **repo ID** for the current session. Available from `useSessionData()` -> `session.repoId`. Already in the component tree. Pass through to `AutoStartPanel` via props or read from the session data hook directly.

### What Stays (No Changes)

- All backend/plumbing/provider code
- Agent tool (`save_service_commands`)
- Hooks in `use-repos.ts` (reused by the new panel)
- Settings page Auto-start tab (keeps full editor as secondary path)

### Not in v1 (Future)

- **Running status**: Requires PID files or supervisor manifest. Don't infer from logs.
- **Log viewer**: Link to `/tmp/svc-*.log` files via file viewer panel. Nice-to-have.
- **Auto-suggest**: Parse agent's terminal commands to suggest auto-start entries. Future enhancement.
- **"Copy from current"**: Quick action to copy currently-running dev server commands into the form. Future enhancement.
- **Multi-repo**: Repo selector in the panel for multi-repo sessions. Handle null cleanly in v1, expand later.

---

## UI Copy

Use **"Auto-start"** everywhere in the UI (not "service commands"). Call the saved data **"auto-start commands"**.

Panel explainer text:
> "These commands run automatically when future sessions start from a saved environment snapshot."

Settings page badge: "Configured" (when `isConfigured` = has auto-start commands + has ready prebuild).

Snapshots panel hint:
> "Auto-start: not configured" / "Auto-start: 3 commands configured"
