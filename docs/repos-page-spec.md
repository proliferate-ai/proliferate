# Repositories Page — Design Spec

**Status:** Draft
**Page:** `/dashboard/repos`
**Current file:** `apps/web/src/app/(command-center)/dashboard/repos/page.tsx`

---

## 1. Purpose & Framing

This is a **configuration page**, not a GitHub mirror. Repositories are the organizing unit, but the real job is managing everything an agent needs to work on a codebase: snapshot environments and their required environment files.

The page answers four questions:

1. **What repos are connected?** — See all GitHub repos in the org at a glance.
2. **Are they configured?** — Each repo can have one or more snapshot configurations (prebuilds). A configured repo has a captured working environment that sessions boot from instantly.
3. **What environment do they need?** — Each configuration declares which `.env` files and keys it requires (auto-detected by the agent during setup). Users can see this spec and manage the corresponding secret values.
4. **How do I add a repo that isn't here?** — Public GitHub search for repos outside the org's GitHub App installation.

### What this page is NOT

- **Not the place to manage GitHub connectivity.** Reconnecting, reinstalling, or expanding the GitHub App permissions belongs on `/dashboard/integrations`. Connected repos flow in automatically from the integration.
- **Not the place to edit service commands inline.** Auto-start commands are configured during the setup flow (in the workspace) and can be tweaked per-session via the workspace settings panel.

### How Environment Files Work (Architecture Context)

Env files are a **two-part system**:

1. **The Spec** — stored as JSONB on `prebuilds.env_files`, **per-configuration (not per-repo)**. During the setup flow, the agent discovers which `.env` files the project needs (e.g., `.env.local` with keys `STRIPE_KEY`, `DATABASE_URL`) and calls `save_env_files()` to persist the spec to the prebuild.

2. **The Values** — stored in the `secrets` table, encrypted with AES-256-GCM. Scoped by `(organization_id, repo_id, key, prebuild_id)`. Users manage these on `/settings/secrets` or are prompted to provide them at runtime via the `request_env_variables` tool.

At session boot, the gateway reads the env file spec from the prebuild, fetches matching secret values from the secrets table, and writes the `.env` files into the sandbox before the agent starts.

**Key implication:** The repos page does not need a "paste your `.env` file" editor. The agent handles spec discovery during setup. The repos page surfaces this spec as **read-only visibility** per-configuration so users can see what's needed and whether the matching secrets exist.

---

## 2. Problems with the Current Page

1. **Accordion overload.** Three levels of expand/collapse: repo rows expand to show snapshots + service commands, "Add Repository" expands to show connected repos, and a second accordion expands for public search. The page feels like a developer settings panel, not a product surface.
2. **Core value is hidden.** Snapshot configurations — the main thing users manage here — are buried inside an expand. You can't see them without clicking each repo.
3. **"Add Repository" is half the page.** Two collapsible sections for connected repos and public search dominate the layout. Connected repos shouldn't be here at all (that's an integrations concern).
4. **Inline service commands editor.** A full CRUD editor for auto-start commands lives inside the expanded repo row. This is too much detail for a list view and duplicates what the workspace settings panel already provides.
5. **No table structure.** Repo rows lack column headers, making it unclear what each piece of data represents.
6. **No external links.** Users can't jump to the repo on GitHub from the list.
7. **No env file visibility.** Users can't see which environment files a configuration requires without opening a session. There's no quick way to check "does this config have its secrets set up?"

---

## 3. Design Direction

**Primary inspiration:** Tembo's GitHub page (data table layout).

Tembo uses a clean data table with column headers, inline metadata, external links, and a simple "Add another repository" button. We adapt this for our domain where repos have **snapshot configurations** that declare env file requirements.

The expanded row shows configurations with their env file status. Each configuration shows: name, snapshot status, and an inline summary of required env files with a "missing keys" indicator so users know at a glance if secrets still need to be added.

**Design system compliance:** Follow `docs/design-system.md` strictly. Semantic tokens only. Data table row pattern. No tinted callouts, no decorative icons, no `font-mono` for metadata.

---

## 4. Functional Requirements

### Job 1: View repos and their configuration status

**What the user sees:**
- A table of all repos in the org.
- Each row shows: repo name (clickable to GitHub), default branch, number of snapshot configs, configuration status badge, and an overflow menu.
- A search input in the header for client-side filtering by repo name (handles orgs with many repos).
- Status badge: "Configured" (has at least one ready snapshot) or "Not configured" (no snapshots).

**Data source:**
- `repos.list` → returns `Repo[]` with `prebuildStatus`, `prebuildId`, `githubRepoName`, `defaultBranch`, `githubUrl`.

### Job 2: View and manage snapshot configurations per repo

**What the user sees on expand:**
- Each configuration row shows: name (or "Untitled"), status (`ready`/`building`/`failed`), creation date, created by.
- **Env file summary per configuration:** Below each configuration, a compact line shows which `.env` files it requires and whether secrets are populated:
  - e.g., `.env.local (3/3 keys)` — all secrets present
  - e.g., `.env.local (1/3 keys)` — missing secrets, shown with a warning indicator
  - If no env files declared: nothing shown (no noise for configs that don't need env files)
- Actions per configuration:
  - **View** — opens the historical setup session (read-only playback).
  - **Edit** — re-opens the setup session as an editable session to recapture the snapshot.
  - **Manage Secrets** — navigates to `/settings/secrets` (filtered to this repo context, or deep-links to the relevant keys). Only shown if the config has env file specs.
- A "+ New configuration" button at the bottom launches the setup flow.
- For unconfigured repos with zero configurations, a single "Configure" button replaces the list.

**Data source:**
- `repos.listSnapshots` → returns `RepoSnapshot[]` with `id`, `snapshotId`, `status`, `name`, `notes`, `createdAt`, `createdBy`, `setupSessions[]`.
- Env file spec: `prebuilds.getEnvFiles(prebuildId)` → returns the JSONB env file spec (file paths + required keys).
- Secret existence check: `secrets.checkKeys({ orgId, repoId, keys })` → returns which keys already have values stored.
- Both loaded on expand (not eagerly for every repo).

**Navigation:**
- "Configure" / "+ New configuration" → `/workspace/new?repoId={id}&type=setup`
- "View" snapshot → `openHistoricalSession(setupSessionId, snapshotName)`
- "Edit" snapshot → `openEditSession({ sessionId, snapshotId, snapshotName, prebuildId })`
- "Manage Secrets" → `/settings/secrets` (potentially with query params to filter/highlight relevant keys)

### Job 3: Add a public GitHub repo

**What the user sees:**
- A "+ Add Repository" button in the page header (PageShell actions slot).
- Clicking it opens a dialog with a search input.
- User types a query (min 2 chars) or an exact `owner/repo` path.
- Results show: repo name, stars, language, default branch.
- Repos already in the org are shown as disabled with a "Connected" label (not hidden — prevents confusion about whether integration is working).
- Click "Add" → repo is created in the org, dialog closes, table refreshes.

**Data source:**
- `repos.search` → unauthenticated GitHub API, 60 req/hr rate limit.
- `repos.create` → adds repo, auto-triggers Layer 2 snapshot build (Modal only).

**What's removed:**
- The "From Connected Repos" accordion. Connected repos are an integrations concern. If the user needs repos from their GitHub org, they go to `/dashboard/integrations` to manage their GitHub App installation scope.

---

## 5. Page Layout

### Main table (collapsed state)

```
PageShell
  title: "Repositories"
  actions: [ Search repositories... ]  [ + Add Repository ]

  ┌─ Table ─────────────────────────────────────────────────────────┐
  │  Name                    Branch     Configurations    Status    │
  ├─────────────────────────────────────────────────────────────────┤
  │  ▸ org/repo-one ↗        main       2 configs        Ready   ⋮ │
  ├─────────────────────────────────────────────────────────────────┤
  │  ▸ org/repo-two ↗        develop    —                Pending  ⋮ │
  ├─────────────────────────────────────────────────────────────────┤
  │  ▸ org/repo-three ↗      main       1 config         Ready   ⋮ │
  └─────────────────────────────────────────────────────────────────┘
```

### Expanded repo row (with configurations)

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  ▾ org/repo-one ↗        main       2 configs        Ready   ⋮ │
  │                                                                 │
  │    "Production"          ready · Jan 15 by Pablo    [View][Edit]│
  │      .env.local (3/3 keys) · .env (2/2 keys)                   │
  │                                                                 │
  │    "Staging"             ready · Feb 2 by Sarah     [View][Edit]│
  │      .env.local (1/3 keys) ⚠ missing secrets   [Manage Secrets]│
  │                                                                 │
  │    + New configuration                                          │
  └─────────────────────────────────────────────────────────────────┘
```

### Expanded repo row (no configurations yet)

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  ▾ org/repo-two ↗        develop    —                Pending  ⋮ │
  │                                                                 │
  │    No configurations yet                                        │
  │    [Configure →]                                                │
  └─────────────────────────────────────────────────────────────────┘
```

### Expanded row (config with no env file spec)

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  ▾ org/repo-three ↗      main       1 config         Ready   ⋮ │
  │                                                                 │
  │    "Default"             ready · Feb 10 by Pablo    [View][Edit]│
  │                                                                 │
  │    + New configuration                                          │
  └─────────────────────────────────────────────────────────────────┘
```

No env file line shown — clean, no noise for configs that don't declare env files.

### Empty state (no repos)

```
  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  │  No repositories yet                                             │
  │  Add a public repository or connect GitHub from Integrations     │
  │                                                                  │
  │  [+ Add Repository]     [Go to Integrations →]                   │
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

---

## 6. Component Breakdown

### `RepositoriesPage` (page component)

- Fetches `repos.list`.
- Manages expand state: `expandedRepoId: string | null` — only one repo expanded at a time.
- Manages search filter state: `filterQuery: string` — client-side filter against `githubRepoName`.
- Renders `PageShell` with search input and "+ Add Repository" button in actions slot.
- Renders table header row + `RepoRow` for each (filtered) repo.
- Renders empty state if no repos.
- Controls `AddRepoDialog` open/close state.

### `RepoRow`

Props: `repo: Repo`, `expanded: boolean`, `onToggle: () => void`

- Collapsed: repo name (with subtle external link icon to `githubUrl`), branch, config count, status badge, overflow menu.
- Expanded: renders `RepoConfigurations` below the row.
- Overflow menu items:
  - "Configure" → navigate to setup flow
  - "Open on GitHub" → external link to `repo.githubUrl`
  - Separator
  - "Delete" (destructive) → confirmation dialog

### `RepoConfigurations` (expanded content)

Props: `repoId: string`

- Fetches `repos.listSnapshots` on mount (only when expanded).
- Shows loading state while fetching.
- If configurations exist: renders a compact list of `ConfigurationRow` items.
- If no configurations: shows "No configurations yet" + "Configure" button.
- Always shows "+ New configuration" at the bottom when configurations exist.

### `ConfigurationRow`

Props: `config: RepoSnapshot`, `repoId: string`

- Name (from `getSnapshotDisplayName()`)
- Status + date + created by as a single metadata line (e.g., `ready · Jan 15 by Pablo`)
- "View" button (ghost) — opens historical session
- "Edit" button (ghost) — opens edit session (only shown if setup session exists)
- Below the main line: `EnvFileSummary` showing the env file spec status (if any)

### `EnvFileSummary`

Props: `prebuildId: string`, `repoId: string`

- Fetches the prebuild's env file spec (`prebuilds.getEnvFiles`) and checks which keys have secret values stored (`secrets.checkKeys`).
- If no env file spec exists: renders nothing (no noise).
- If spec exists: renders a compact line per file:
  - `.env.local (3/3 keys)` — all populated, muted text
  - `.env.local (1/3 keys)` — missing keys, warning indicator
- If any keys are missing: shows a "Manage Secrets" link that navigates to `/settings/secrets`.

### `AddRepoDialog` (modal)

- Search input with debounce (300ms, min 2 chars).
- Results list: repo full name, stars, language, branch.
- "Add" button per result.
- Repos already in the org are shown disabled with a "Connected" label.
- On add: calls `repos.create`, closes dialog on success.
- Shows loading state during search and during add.

---

## 7. Data Requirements

### API calls

| Call | When | Returns |
|------|------|---------|
| `repos.list` | Page load | All org repos with prebuild status |
| `repos.listSnapshots` | Repo row expanded | Prebuilds for a specific repo |
| `prebuilds.getEnvFiles` | Per-configuration, on expand | JSONB env file spec (file paths + required keys) |
| `secrets.checkKeys` | Per-configuration, on expand | Which keys have values stored |
| `repos.search` | Dialog search input | Public GitHub search results |
| `repos.create` | "Add" clicked in dialog | Creates repo, triggers snapshot build |
| `repos.delete` | "Delete" confirmed | Hard-deletes repo + cascades |

### Types consumed

```ts
// From repos.list
interface Repo {
  id: string;
  githubRepoName: string;     // "org/repo-name"
  githubUrl: string;           // "https://github.com/org/repo-name"
  defaultBranch: string | null;
  prebuildStatus: "ready" | "pending";
  prebuildId: string | null;
  isConfigured: boolean;
}

// From repos.listSnapshots
interface RepoSnapshot {
  id: string;
  snapshotId: string | null;
  status: string | null;        // "building" | "ready" | "failed"
  name: string | null;
  createdAt: string;
  createdBy: string | null;
  setupSessions?: Array<{
    id: string;
    sessionType: string | null;
  }>;
}

// From prebuilds.getEnvFiles (JSONB on prebuild)
interface EnvFileSpec {
  workspacePath: string;        // "." for single-repo
  path: string;                 // ".env.local", "apps/web/.env"
  format: "dotenv";
  mode: "secret";
  keys: Array<{
    key: string;                // "STRIPE_SECRET_KEY"
    required: boolean;
  }>;
}

// From repos.search
interface SearchResult {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
  stargazers_count?: number;
  language?: string;
  private: boolean;
}
```

### Backend changes required

1. **`prebuilds.getEnvFiles` endpoint (new).** Simple: read `prebuilds.env_files` JSONB for a given prebuild ID and return it. The DB function already exists (`getPrebuildEnvFiles` in `packages/services/src/prebuilds/db.ts`), just needs an oRPC route.
2. **`secrets.checkKeys` endpoint (new or extend existing).** Given `(orgId, repoId, keys[])`, return which keys have values stored. The `findExistingKeys` DB function in `packages/services/src/secrets/db.ts` already does this — just needs an oRPC route.
3. **No migrations, no schema changes.** Everything reads from existing tables and columns.

---

## 8. Interactions

### Expand/collapse

- Click anywhere on the repo row (except action buttons) to toggle expand.
- Only one repo expanded at a time (accordion behavior) — keeps the page clean.
- Chevron rotates on expand (`ChevronRight` → 90deg rotation).

### Client-side search

- Search input in the header filters repos by `githubRepoName` (case-insensitive substring match).
- Filtering is instant (client-side, no API call). Debounce not needed.
- Clearing the search shows all repos again.
- Expanding a repo row works while filtered.

### Configure (new snapshot)

1. User clicks "Configure" (from overflow menu, expanded area, or unconfigured repo prompt).
2. `useDashboardStore.setSelectedRepo(repoId)` is called.
3. Navigate to `/workspace/new?repoId={repoId}&type=setup`.
4. User configures the environment in the workspace. The agent discovers env file requirements and calls `save_env_files()` to persist them.
5. User finalizes → snapshot is captured.
6. On return to repos page, the repo shows the new configuration with its env file summary.

### View historical session

1. User clicks "View" on a configuration row.
2. Calls `openHistoricalSession(setupSessionId, snapshotName)`.
3. Opens the workspace in read-only mode.

### Edit configuration

1. User clicks "Edit" on a configuration row.
2. Calls `openEditSession({ sessionId, snapshotId, snapshotName, prebuildId })`.
3. Opens the workspace in edit mode for re-snapshotting.

### Manage secrets (from env file summary)

1. User sees a configuration with missing env file keys (e.g., `.env.local (1/3 keys)`).
2. Clicks "Manage Secrets" link.
3. Navigates to `/settings/secrets` — ideally with query params that highlight the missing keys (future enhancement; V1 can just link to the page).

### Add repository (dialog)

1. User clicks "+ Add Repository" in the page header.
2. Dialog opens with autofocused search input.
3. User types query → debounced search (300ms) → results appear.
4. Already-connected repos show as disabled with "Connected" label.
5. User clicks "Add" on a result → repo is created → dialog closes.
6. Table refreshes showing the new repo.

### Delete repository

1. User clicks "Delete" from overflow menu.
2. Confirmation dialog: "Delete repository? This will remove org/repo-name and all associated configurations and snapshots."
3. On confirm: `repos.delete` called, repo disappears. Cascade handles prebuild cleanup.

---

## 9. States

### Loading

- Full page loading: centered `LoadingDots` inside `PageShell`.
- Configuration loading on expand: `LoadingDots` in the expanded area.
- Env file summary loading: `LoadingDots` inline below configuration row (compact, doesn't shift layout).
- Search loading in dialog: `LoadingDots` below search input.

### Empty — no repos at all

```
No repositories yet
Add a public repository or connect GitHub from Integrations

[+ Add Repository]     [Go to Integrations →]
```

Dashed border container (`border-dashed`), centered text, two action buttons.

### Empty — repo has no configurations

Shown in expanded view:

```
No configurations yet
[Configure →]
```

### Empty — search filter has no matches

```
No repositories matching "query"
```

Single line, muted text, centered in the table area.

### Error — search/mutation fails

Mutation errors surface via TanStack Query's mutation state. The button shows loading state and on failure reverts to normal. Dialogs/modals stay open so the user can retry.

---

## 10. What's Removed from Current Page

| Current feature | Disposition |
|---|---|
| "From Connected Repos" accordion | **Removed.** Integrations page handles GitHub App scope. |
| "Public Repository" accordion | **Replaced** by "+ Add Repository" dialog. |
| Inline service commands editor (`ServiceCommandsSection`) | **Removed.** Managed in workspace settings panel. |
| Inline service commands read-only view | **Removed.** Not shown on list page. |
| Two-level expand (repo → configs + commands) | **Simplified** to single-level expand (repo → configurations with env file summary). |

### Components to remove

- `ServiceCommandsSection` — the inline CRUD editor for auto-start commands.
- Connected repos fetch logic (`useAvailableRepos`) — no longer needed on this page.
- The two collapsible "Add Repository" sections (connected + public search).

### Components to create

- `RepoConfigurations` — list of configurations for an expanded repo.
- `ConfigurationRow` — single configuration with name, status, actions, env file summary.
- `EnvFileSummary` — compact read-only display of env file spec + secret population status.
- `AddRepoDialog` — modal with public GitHub search.

### Components to simplify

- `RepoRow` — remove all expand logic for service commands, keep chevron + status badge.
- Delete `RepoDetails` entirely (replaced by `RepoConfigurations`).
- Delete `ServiceCommandsSection` entirely.

---

## 11. Design System Compliance Checklist

- [ ] Table uses `data table row` pattern: `flex items-center justify-between px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm`
- [ ] Header row uses `text-xs text-muted-foreground` (no background tint)
- [ ] Status badge uses `status badge` pattern: `inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground`
- [ ] Env file summary uses `text-xs text-muted-foreground` — compact, no visual weight
- [ ] Missing-keys warning uses subtle indicator (not a tinted callout box)
- [ ] Metadata collapsed into single lines (e.g., `ready · Jan 15 by Pablo`)
- [ ] No `font-mono` for metadata
- [ ] No tinted callout boxes
- [ ] No decorative icons repeated on every row
- [ ] External link icon is subtle (`text-muted-foreground`, small)
- [ ] Dialog/modal uses design system spec (`shadow-floating`, `rounded-xl`)
- [ ] All colors use semantic tokens (no raw Tailwind colors)
- [ ] Compact product density: `text-sm` body, `text-xs` metadata, `h-8`/`h-9` controls

---

## 12. `/settings/secrets` Impact

The repos page now surfaces env file requirements per-configuration as **read-only metadata**, with a "Manage Secrets" link to `/settings/secrets`. The secrets page remains the single place to add/edit/delete actual secret values.

Future enhancement: `/settings/secrets` could accept query params (e.g., `?repoId=X&keys=KEY1,KEY2`) to pre-filter or highlight the relevant keys when navigating from the repos page. V1: just link to the page without filtering.
