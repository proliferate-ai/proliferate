# Secrets & Environment Configuration — Architecture Spec for Review

**Purpose:** Package up all context on the current secrets/environment implementation so a principal engineer with no codebase access can give actionable guidance on the right approach.

---

## 1. What Proliferate Does (30-second context)

Proliferate is a cloud IDE that runs AI coding agents in sandboxed environments. Users connect GitHub repos, configure snapshot environments (prebuilds), and launch sessions where an agent works on their code.

A **setup session** is a special first-run where the agent discovers what the project needs (dependencies, env files, services) and captures a reusable snapshot. Future sessions boot instantly from that snapshot.

---

## 2. The Two-Part Env File System

Environment files are split into **spec** and **values**:

### The Spec (what's needed)
- Stored as JSONB on `configurations.env_files`, **per-configuration (prebuild)**
- Created automatically by the agent during setup via a `save_env_files()` intercepted tool
- Declares which `.env` files the project needs and what keys each file requires
- Example:
```json
[
  {
    "workspacePath": ".",
    "path": ".env.local",
    "format": "dotenv",
    "mode": "secret",
    "keys": [
      { "key": "DATABASE_URL", "required": true },
      { "key": "STRIPE_SECRET_KEY", "required": true },
      { "key": "REDIS_URL", "required": true }
    ]
  }
]
```

### The Values (what's stored)
- Stored in `secrets` table, encrypted with AES-256-GCM
- Scoped by `(organization_id, key, repo_id)` — repo_id is optional (null = org-wide)
- Users never see decrypted values after creation

### At Session Boot
1. Gateway reads env file spec from the prebuild's `env_files` JSONB
2. Fetches all matching secrets from DB (org-wide + repo-scoped for attached repos)
3. Decrypts values
4. Passes spec + values to `proliferate env apply --spec <JSON>` inside the sandbox
5. The sandbox CLI writes the actual `.env` files to disk
6. Agent starts with environment configured

---

## 3. Current Implementation — Where Secrets Are Managed

There are currently **four** separate places where users interact with secrets. This is the core problem.

### Place 1: SettingsModal → SecretsTab (org-level CRUD)

**File:** `apps/web/src/components/settings/tabs/secrets-tab.tsx`

A modal with 5 tabs (Repositories, Connections, Secrets, Organization, Configuration). The Secrets tab is a simple list:
- Shows all org secrets as key + optional description (no values shown)
- "Add Secret" button expands a form: Key (auto-uppercased), Value (password input with eye toggle), Description
- Delete button per secret
- No concept of which configuration or env file a secret belongs to — it's a flat org-wide list

**Accessed from:** "Manage Secrets" button in the workspace right sidebar's Info tab. Also accessible from dashboard navigation.

**Problem:** This is org-level. User sees a flat list of all secrets with no context about which project needs them or whether they're complete.

### Place 2: EnvRequestToolUI (inline in chat during agent execution)

**File:** `apps/web/src/components/coding-session/tool-ui/env-request-tool.tsx`

When the agent calls `request_env_variables`, a form renders **inline in the chat thread**. Features:
- Checks which keys already exist via `secrets.check`
- Shows "Value already set" with Override option for existing secrets
- Per-secret persistence toggle: "Save for future sessions" (defaults true)
- Support for suggestions (pre-filled option buttons)
- Optional variables can be skipped
- On submit: writes values to running sandbox immediately, optionally persists to DB
- Appends "Configuration submitted." to chat to unblock the agent

**Problem:** This only appears when the agent explicitly requests it. During setup, the agent may call `save_env_files()` to record the spec but never call `request_env_variables` — leaving the user with no prompt to fill in values. The spec is saved but values are never collected.

### Place 3: ManageSecretsDialog on Repos Page (just built)

**File:** `apps/web/src/app/(command-center)/dashboard/repos/page.tsx`

We just added this as part of the repos page redesign. Each configuration row shows an `EnvFileSummary` (e.g., `.env.local (1/3 keys)`) and a "Manage Secrets" button opens a dialog showing:
- Keys grouped by env file path
- Existing keys shown with checkmark + "Set"
- Missing keys shown with password input
- Save creates secrets scoped to the repo

**Problem:** This is outside the workspace — users have to leave the session context to manage secrets. It's also duplicative of what should happen during setup.

### Place 4: `/settings/secrets` page

A separate dashboard page that renders the same `SecretsTab` component. Flat org-wide list, same as the modal.

---

## 4. Current Workspace Right Sidebar Structure

**File:** `apps/web/src/components/coding-session/settings-panel.tsx`

The right sidebar's Settings panel has 3 tabs:

| Tab | Component | Content |
|-----|-----------|---------|
| **Info** | `SessionInfoContent` | Session status, environment info, "Manage Secrets" button (opens SettingsModal) |
| **Snapshots** | `SnapshotsContent` | Save snapshot button, current snapshot ID, auto-start hint |
| **Auto-start** | `AutoStartContent` | View/edit auto-start commands per prebuild or repo |

The sidebar also has other panel modes (Git, Terminal, VS Code, Preview, Artifacts) but those are separate from Settings.

**Tab system:** Uses shadcn `Tabs` component. The `PreviewMode` type supports `{ type: "settings", tab?: "info" | "snapshots" | "auto-start" }` — adding a new tab is straightforward.

---

## 5. The SettingsModal — Why It Should Die

The SettingsModal (`apps/web/src/components/dashboard/settings-modal.tsx`) is a 5-tab modal accessed from within a workspace session. Every tab is redundant with existing dashboard pages:

| Modal Tab | Dashboard Page | Status |
|-----------|---------------|--------|
| Repositories | `/dashboard/repos` (just redesigned) | Fully redundant |
| Connections | `/dashboard/integrations` | Fully redundant |
| Secrets | `/settings/secrets` | Would move to sidebar |
| Organization | `/dashboard/settings` | Fully redundant |
| Configuration | `/dashboard/settings` | Fully redundant |

The modal is used in exactly one place: `coding-session.tsx` line 373-377, opened when user clicks "Manage Secrets" in the Info tab. Removing it means the "Manage Secrets" button needs a new target.

---

## 6. The Setup Session UX Gap

Here's the actual problem we're trying to solve:

1. User starts a setup session for a repo
2. Agent discovers the project needs `.env.local` with `DATABASE_URL`, `STRIPE_KEY`, `REDIS_URL`
3. Agent calls `save_env_files()` — spec is persisted to the prebuild's JSONB
4. Agent may or may not call `request_env_variables` — if it doesn't, the user is never prompted
5. Agent finalizes the snapshot
6. User now has a configured environment **without the secrets filled in**
7. Next session boots from this snapshot, `proliferate env apply` runs, but the `.env` files have empty values for unfilled keys
8. User has to figure out that secrets are missing and go find the right place to add them

**The gap:** There's no persistent, visible place during setup that says "these env files need these keys, here's what's filled and what's missing." The `request_env_variables` inline form is ephemeral (only appears if the agent requests it, and scrolls away in the chat). The repos page summary is outside the session.

---

## 7. What We Want Guidance On

We want to add a **Secrets/Environment tab to the workspace right sidebar** that:

1. **During setup sessions:** Is highly visible — possibly auto-opened or badged — showing the env file spec as it's discovered, with inline secret entry
2. **During normal sessions:** Serves as the single place to view and manage secrets for this session's configuration
3. **Replaces:** The SettingsModal entirely, and potentially the ManageSecretsDialog on the repos page

### Design questions:

**a) Scope: configuration-level vs org-level?**
The current SecretsTab shows a flat org-wide list. The env file spec is per-configuration. Should the sidebar show:
- Only the keys this configuration needs (grouped by `.env` file)?
- All org secrets with the configuration's needs highlighted?
- Both views (tabs within the tab)?

**b) How should this interact with `request_env_variables`?**
The agent's inline prompt already collects values. Should the sidebar:
- Replace the inline prompt entirely (agent's request opens the sidebar tab instead)?
- Complement it (inline prompt for first-time entry, sidebar for review/editing)?
- Mirror it (show the same data, stay in sync)?

**c) How prominent during setup?**
Options:
- Auto-open the sidebar to the Secrets tab when `save_env_files()` is called
- Badge the tab with a count of missing keys
- Show a banner/toast when env files are discovered
- Default to the Secrets tab instead of Info during setup sessions

**d) Should we keep the repos page env file summary?**
The repos page currently shows `.env.local (2/3 keys)` per configuration. Should this:
- Stay as read-only indicator with a link to open the workspace sidebar?
- Keep the ManageSecretsDialog for quick fixes outside sessions?
- Remove entirely (secrets only managed in workspace)?

**e) What about the `/settings/secrets` page?**
Should org-wide secrets (not tied to any configuration) still have their own page? Or does everything live in the workspace sidebar?

---

## 8. Technical Constraints

1. **Env file specs are per-configuration, secrets are per-(org, key, repo).** A secret with `repoId=null` is org-wide and available to all sessions. A secret with `repoId=X` is only available to sessions using repo X. The sidebar needs to handle both.

2. **The spec is discovered during setup.** It doesn't exist until the agent calls `save_env_files()`. The sidebar needs to handle the "no spec yet" state gracefully during early setup.

3. **Values can't be read back.** Secrets are write-only after creation (encrypted at rest). The UI can only show "exists" or "missing" — no editing of existing values, only delete + recreate.

4. **`request_env_variables` writes directly to the sandbox.** Even if a user doesn't persist a secret, the value is written to the running sandbox's `.env` file. The sidebar would need to work with this dual (persisted vs session-only) model.

5. **The sidebar tab system is Zustand-based.** `PreviewMode` is a discriminated union. Adding a new tab type is a simple type + component addition.

6. **Rate limit on existence checks.** `secrets.check` queries the DB. Calling it on every sidebar render for many keys should be batched (which it already is — single array of keys).

---

## 9. File Inventory

| File | What it does | Lines |
|------|-------------|-------|
| `apps/web/src/components/coding-session/settings-panel.tsx` | Right sidebar Settings panel (Info/Snapshots/Auto-start tabs) | 139 |
| `apps/web/src/components/coding-session/session-info-panel.tsx` | Info tab with "Manage Secrets" button | 218 |
| `apps/web/src/components/coding-session/coding-session.tsx` | Main session component, owns SettingsModal state | ~385 |
| `apps/web/src/components/dashboard/settings-modal.tsx` | 5-tab settings modal (to be removed) | ~200 |
| `apps/web/src/components/settings/tabs/secrets-tab.tsx` | Org-level secrets CRUD UI | 184 |
| `apps/web/src/hooks/use-secrets.ts` | useSecrets, useCreateSecret, useDeleteSecret hooks | ~60 |
| `apps/web/src/components/coding-session/tool-ui/env-request-tool.tsx` | Inline agent env request form | ~300 |
| `apps/web/src/stores/preview-panel.ts` | Zustand store for sidebar panel modes | ~80 |
| `apps/web/src/app/(command-center)/dashboard/repos/page.tsx` | Repos page with EnvFileSummary + ManageSecretsDialog | ~640 |
| `apps/web/src/hooks/use-repos.ts` | usePrebuildEnvFiles, useCheckSecrets, useCreateSecret hooks | ~170 |
| `apps/web/src/server/routers/prebuilds.ts` | prebuilds.getEnvFiles oRPC endpoint | ~255 |
| `apps/web/src/server/routers/secrets.ts` | secrets.check, secrets.create oRPC endpoints | ~120 |
| `apps/gateway/src/hub/capabilities/tools/save-env-files.ts` | Gateway intercepted tool for env file spec persistence | ~100 |
| `apps/gateway/src/lib/session-creator.ts` | Session boot: reads spec, fetches secrets, passes to sandbox | ~700 |
| `packages/services/src/prebuilds/db.ts` | getPrebuildEnvFiles DB function | ~460 |
| `packages/services/src/secrets/service.ts` | createSecret, checkSecrets service functions | ~200 |
| `packages/services/src/sessions/sandbox-env.ts` | Decrypts secrets, builds env vars for sandbox | 134 |
