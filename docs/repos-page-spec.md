# Repositories Page — Design Spec

**Status:** Draft
**Page:** `/dashboard/repos`
**Current file:** `apps/web/src/app/(command-center)/dashboard/repos/page.tsx`

---

## 1. Purpose

The repositories page is the single surface for managing codebases connected to the org. It answers three questions:

1. **What repos are connected?** — See all GitHub repos in the org at a glance.
2. **Are they configured?** — Each repo can have one or more snapshot configurations (prebuilds). A configured repo has a captured working environment that sessions can boot from instantly.
3. **How do I add a repo that isn't here?** — Public GitHub search for repos outside the org's GitHub App installation.

### What this page is NOT

- **Not the place to manage GitHub connectivity.** Reconnecting, reinstalling, or expanding the GitHub App permissions belongs on `/dashboard/integrations`. Connected repos flow in automatically from the integration.
- **Not the place to manage secrets.** Repo-level and org-level secrets live on `/settings/secrets`.
- **Not the place to edit service commands inline.** Auto-start commands are configured during the setup flow (in the workspace) and can be tweaked per-session via the workspace settings panel. The repos page may show a read-only summary but does not host an editor.

---

## 2. Problems with the Current Page

1. **Accordion overload.** Three levels of expand/collapse: repo rows expand to show snapshots, "Add Repository" expands to show connected repos, and a second accordion expands for public search. The page feels like a developer settings panel, not a product surface.
2. **Core value is hidden.** Snapshot configurations — the main thing users manage here — are buried inside an expand. You can't see them without clicking each repo.
3. **"Add Repository" is half the page.** Two collapsible sections for connected repos and public search dominate the layout. Connected repos shouldn't be here at all (that's an integrations concern).
4. **Inline service commands editor.** A full CRUD editor for auto-start commands lives inside the expanded repo row. This is too much detail for a list view and duplicates what the workspace settings panel already provides.
5. **No table structure.** Repo rows lack column headers, making it unclear what each piece of data represents.
6. **No external links.** Users can't jump to the repo on GitHub from the list.

---

## 3. Design Direction

**Primary inspiration:** Tembo's GitHub page (`inspiration/tembo/github_page.html`).

Tembo uses a clean data table with column headers, inline metadata (branch, last activity), external links to GitHub, and a simple "Add another repository" button at the bottom. Their repos page is scannable — you see everything important without expanding anything.

We adapt this for our domain: the key difference is that our repos have **snapshot configurations** (prebuilds), which Tembo doesn't have. Each repo can have 0–N configurations, and managing those is the core job of this page.

**Design system compliance:** Follow `docs/design-system.md` strictly. Use semantic tokens only (`bg-background`, `text-foreground`, `border-border`, etc.). Use the data table row pattern. No tinted callouts, no decorative icons, no `font-mono` for metadata.

---

## 4. Functional Requirements

### Job 1: View repos and their configuration status

**What the user sees:**
- A table of all repos in the org.
- Each row shows: repo name (clickable to GitHub), default branch, number of snapshot configs, configuration status badge, and an overflow menu.
- Status badge: "Configured" (has at least one ready snapshot) or "Not configured" (no snapshots).

**Data source:**
- `repos.list` → returns `Repo[]` with `prebuildStatus`, `prebuildId`, `githubRepoName`, `defaultBranch`, `githubUrl`.

### Job 2: View and manage snapshot configurations per repo

**What the user sees:**
- Expanding a repo row reveals its snapshot configurations (prebuilds).
- Each snapshot row shows: name (or "Untitled"), status (`ready`/`building`/`failed`), creation date, created by.
- Actions per snapshot:
  - **View** — opens the historical setup session (read-only playback).
  - **Edit** — re-opens the setup session as an editable session to recapture the snapshot.
- A "+ New configuration" button at the bottom of the snapshot list launches the setup flow.
- For unconfigured repos with zero snapshots, a single "Configure" button replaces the snapshot list.

**Data source:**
- `repos.listSnapshots` → returns `RepoSnapshot[]` with `id`, `snapshotId`, `status`, `name`, `notes`, `createdAt`, `createdBy`, `setupSessions[]`.
- Loaded on expand (not eagerly for every repo).

**Navigation:**
- "Configure" / "+ New configuration" → `/workspace/new?repoId={id}&type=setup`
- "View" snapshot → `openHistoricalSession(setupSessionId, snapshotName)`
- "Edit" snapshot → `openEditSession({ sessionId, snapshotId, snapshotName, prebuildId })`

### Job 3: Add a public GitHub repo

**What the user sees:**
- A "+ Add Repository" button in the page header (PageShell actions slot).
- Clicking it opens a dialog with a search input.
- User types a query (min 2 chars) or an exact `owner/repo` path.
- Results show: repo name, stars, language, default branch.
- Repos already in the org are filtered out.
- Click "Add" → repo is created in the org, dialog closes, table refreshes.

**Data source:**
- `repos.search` → unauthenticated GitHub API, 60 req/hr rate limit.
- `repos.create` → adds repo, auto-triggers Layer 2 snapshot build (Modal only).

**What's removed:**
- The "From Connected Repos" accordion. Connected repos are an integrations concern. If the user needs repos from their GitHub org, they go to `/dashboard/integrations` to manage their GitHub App installation scope.

---

## 5. Page Layout

```
PageShell
  title: "Repositories"
  actions: <Button variant="outline" size="sm">+ Add Repository</Button>

  ┌─ Table ─────────────────────────────────────────────────────────┐
  │  Header row (muted):                                            │
  │  Name                    Branch     Configurations    Status    │
  ├─────────────────────────────────────────────────────────────────┤
  │  ▸ org/repo-one ↗        main       2 configs        Ready   ⋮ │
  ├─────────────────────────────────────────────────────────────────┤
  │  ▸ org/repo-two ↗        develop    —                Pending  ⋮ │
  ├─────────────────────────────────────────────────────────────────┤
  │  ▸ org/repo-three ↗      main       1 config         Ready   ⋮ │
  └─────────────────────────────────────────────────────────────────┘

  Empty state (no repos):
  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  │  No repositories yet                                             │
  │  Add a public repository or connect GitHub from Integrations     │
  │                                                                  │
  │  [+ Add Repository]     [Go to Integrations →]                   │
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

### Expanded repo row (snapshots visible)

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  ▾ org/repo-one ↗        main       2 configs        Ready   ⋮ │
  │                                                                 │
  │    "Production"          ready · Jan 15 by Pablo    [View][Edit]│
  │    "Staging"             ready · Feb 2 by Sarah     [View][Edit]│
  │    + New configuration                                          │
  └─────────────────────────────────────────────────────────────────┘
```

### Expanded repo row (no snapshots yet)

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  ▾ org/repo-two ↗        develop    —                Pending  ⋮ │
  │                                                                 │
  │    No configurations yet                                        │
  │    [Configure →]                                                │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 6. Component Breakdown

### `RepositoriesPage` (page component)

- Fetches `repos.list`.
- Manages expand state (which repo ID is expanded, or null).
- Renders `PageShell` with "Add Repository" action button.
- Renders the table header + `RepoRow` for each repo.
- Renders empty state if no repos.
- Controls `AddRepoDialog` open/close state.

### `RepoRow` (per-repo table row)

Props: `repo: Repo`, `expanded: boolean`, `onToggle: () => void`

- Collapsed: shows repo name (with external link icon to `githubUrl`), branch, config count, status badge, overflow menu.
- Expanded: renders `RepoSnapshots` below the row.
- Overflow menu items:
  - "Configure" → navigate to setup flow
  - "Open on GitHub" → external link to `repo.githubUrl`
  - Separator
  - "Delete" (destructive) → confirmation dialog

### `RepoSnapshots` (expanded content)

Props: `repoId: string`

- Fetches `repos.listSnapshots` on mount (only when expanded).
- Shows loading state while fetching.
- If snapshots exist: renders a compact list of snapshot rows.
- If no snapshots: shows "No configurations yet" + "Configure" button.
- Always shows "+ New configuration" button at the bottom when snapshots exist.

Each snapshot row shows:
- Name (from `getSnapshotDisplayName()`)
- Status + date + created by (collapsed into one metadata line, e.g., `ready · Jan 15 by Pablo`)
- "View" button (ghost, opens historical session)
- "Edit" button (ghost, opens edit session) — only shown if a setup session exists

### `AddRepoDialog` (modal)

- Search input with debounce (300ms, min 2 chars).
- Results list: repo full name, stars, language, branch.
- "Add" button per result.
- Filters out repos already in the org.
- On add: calls `repos.create`, closes dialog on success.
- Shows loading state during search and during add.

---

## 7. Data Requirements

### API calls used

| Call | When | Returns |
|------|------|---------|
| `repos.list` | Page load | All org repos with prebuild status |
| `repos.listSnapshots` | Repo row expanded | Prebuilds for a specific repo |
| `repos.search` | Dialog search input changes | Public GitHub search results |
| `repos.create` | "Add" clicked in dialog | Creates repo, triggers snapshot build |
| `repos.delete` | "Delete" confirmed | Hard-deletes repo + cascades |

### Types consumed

```ts
// From repos.list
interface Repo {
  id: string;
  githubRepoName: string;    // "org/repo-name"
  githubUrl: string;          // "https://github.com/org/repo-name"
  defaultBranch: string | null;
  prebuildStatus: "ready" | "pending";
  prebuildId: string | null;
  isConfigured: boolean;
}

// From repos.listSnapshots
interface RepoSnapshot {
  id: string;
  snapshotId: string | null;
  status: string | null;       // "building" | "ready" | "failed"
  name: string | null;
  createdAt: string;
  createdBy: string | null;
  setupSessions?: Array<{
    id: string;
    sessionType: string | null;
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

---

## 8. Interactions

### Expand/collapse

- Click anywhere on the repo row (except action buttons) to toggle expand.
- Only one repo expanded at a time (accordion behavior) — keeps the page clean.
- Chevron rotates on expand (`ChevronRight` → 90deg rotation).

### Configure (new snapshot)

1. User clicks "Configure" (from row overflow menu, expanded area, or unconfigured repo prompt).
2. `useDashboardStore.setSelectedRepo(repoId)` is called.
3. Navigate to `/workspace/new?repoId={repoId}&type=setup`.
4. User configures the environment in the workspace, finalizes → snapshot is captured.
5. On return to repos page, the repo now shows the new snapshot in its expanded view.

### View historical session

1. User clicks "View" on a snapshot row.
2. Calls `openHistoricalSession(setupSessionId, snapshotName)`.
3. Opens the workspace in read-only mode showing the setup session.

### Edit configuration

1. User clicks "Edit" on a snapshot row.
2. Calls `openEditSession({ sessionId, snapshotId, snapshotName, prebuildId })`.
3. Opens the workspace with the setup session in edit mode for re-snapshotting.

### Add repository (dialog)

1. User clicks "+ Add Repository" in the page header.
2. Dialog opens with autofocused search input.
3. User types query → debounced search (300ms) → results appear.
4. User clicks "Add" on a result → repo is created → dialog closes.
5. Table refreshes showing the new repo (with "Not configured" status).

### Delete repository

1. User clicks "Delete" from the overflow menu.
2. Confirmation dialog: "Delete repository? This will remove org/repo-name and all associated configurations and snapshots."
3. On confirm: `repos.delete` is called, repo disappears from table.

---

## 9. States

### Loading

- Full page loading: centered `LoadingDots` inside `PageShell` (same as current).
- Snapshot loading on expand: `LoadingDots` in the expanded area.
- Search loading in dialog: `LoadingDots` below search input.

### Empty — no repos at all

```
No repositories yet
Add a public repository or connect GitHub from Integrations

[+ Add Repository]     [Go to Integrations →]
```

Dashed border container (`border-dashed`), centered text, two action buttons.

### Empty — repo has no snapshots

Shown in expanded view:

```
No configurations yet
[Configure →]
```

Single line of muted text + primary-style button to launch setup.

### Error — search fails or add fails

Mutation errors surface via TanStack Query's mutation state. No custom error UI needed — the "Add" button shows loading state, and on failure reverts to normal. The dialog stays open so the user can retry.

---

## 10. What's Removed from Current Page

| Current feature | Disposition |
|---|---|
| "From Connected Repos" accordion | **Removed.** Integrations page handles GitHub App scope. |
| "Public Repository" accordion | **Replaced** by "+ Add Repository" dialog. |
| Inline service commands editor (`ServiceCommandsSection`) | **Removed.** Managed in workspace settings panel. |
| Inline service commands read-only view | **Removed.** Not shown on list page. |
| Two-level expand (repo → configs + commands) | **Simplified** to single-level expand (repo → snapshots only). |

### Components to remove

- `ServiceCommandsSection` — the full inline CRUD editor for auto-start commands.
- Connected repos fetch logic (`useAvailableRepos`) — no longer needed on this page.
- The two collapsible "Add Repository" sections (connected + public search).

### Components to create

- `AddRepoDialog` — modal with search for public repos.
- Optionally extract `RepoSnapshots` as its own component (currently inline in `RepoDetails`).

### Components to simplify

- `RepoRow` — remove expand logic for service commands, keep only snapshot expand.
- `RepoDetails` → becomes `RepoSnapshots` — remove service commands section entirely.

---

## 11. Design System Compliance Checklist

- [ ] Table uses `data table row` pattern from design system: `flex items-center justify-between px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm`
- [ ] Header row uses `text-xs text-muted-foreground` (no background tint)
- [ ] Status badge uses `status badge` pattern: `inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground`
- [ ] Metadata collapsed into single lines (e.g., `ready · Jan 15 by Pablo`)
- [ ] No `font-mono` for metadata
- [ ] No tinted callout boxes
- [ ] No decorative icons repeated on every row
- [ ] External link icon is subtle (muted-foreground, small)
- [ ] Dialog uses design system modal spec (`shadow-floating`, `rounded-xl`, etc.)
- [ ] All colors use semantic tokens (no raw Tailwind colors)
- [ ] Compact product density: `text-sm` body, `text-xs` metadata, `h-8`/`h-9` controls
