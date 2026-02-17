# Proliferate UI — Current State & Design Brief

**Date:** February 2026
**Author:** Pablo (product) + AI implementation
**Audience:** Principal engineer with no codebase access
**Purpose:** Provide full context on the current UI so you can guide us on fixing it

---

## TL;DR

We have a working product UI across 5 surfaces (auth, onboarding, dashboard, settings, workspace). It was built incrementally by AI coding agents with course corrections from me. The result is **functional but visually inconsistent** — it's a patchwork of different styling approaches, spacing systems, and component patterns. We need a senior design pass to unify it.

The codebase is Next.js + React + Tailwind + shadcn/ui. We have a written design system (`docs/design-system.md`) that's decent but not consistently enforced. Dark mode is the default for the workspace; the dashboard supports both but defaults to light via system preference.

---

## 1. Architecture Overview

### Route Groups

```
/sign-in, /sign-up              → Auth (standalone, always dark)
/onboarding                     → Onboarding wizard (standalone, respects system theme)
/(command-center)/dashboard/*   → Dashboard + all management pages (sidebar layout)
/(command-center)/settings/*    → Settings pages (same sidebar layout)
/(workspace)/workspace/[id]     → Coding session / IDE view (full-bleed, always dark)
```

### Layout Hierarchy

```
Root layout (app/layout.tsx)
├── AuthLayout          → Centered card on dark bg, no chrome
├── OnboardingLayout    → Full-page centered steps, dot progress indicator
├── CommandCenterLayout → Sidebar + top bar + content area
│   ├── Dashboard pages (home, sessions, runs, automations, repos, integrations, actions)
│   └── Settings pages (profile, general, members, secrets, billing)
└── WorkspaceLayout     → Full-bleed h-dvh, no sidebar
    └── CodingSession   → Two-pane: chat (35%) + engine room (65%)
```

### Key Technologies
- **UI framework:** shadcn/ui components in `apps/web/src/components/ui/`
- **Styling:** Tailwind CSS with CSS custom properties for theming
- **State:** Zustand for client state, TanStack Query for server state
- **Icons:** Lucide React + custom brand icons in `components/ui/icons.tsx`
- **Font:** Inter (loaded via `next/font`)
- **Dark mode:** Tailwind `class` strategy. Auth pages force dark via inline CSS vars. Dashboard follows system.

---

## 2. Design System (What We Have on Paper)

We have `docs/design-system.md` which defines:

**Tokens (CSS custom properties):**
- Fully monochrome palette — zero color outside of `destructive` (red)
- Light and dark mode variants defined in `globals.css` under `:root` and `.dark`
- Key tokens: `background`, `foreground`, `card`, `muted`, `border`, `primary`, `secondary`, `accent`, `sidebar`
- All wired through Tailwind config: `bg-background`, `text-foreground`, `border-border`, etc.

**Typography scale (compact):**
- `xs: 12px`, `sm: 13px`, `base: 14px`, `lg: 16px`, `xl: 18px`
- Product UI maxes at `text-xl` for headings, `text-sm`/`text-xs` for most content

**Anti-patterns (written rules, not always followed):**
1. No tinted callout boxes (success/warning/info)
2. No card-in-card nesting
3. No pill-style step indicators → use muted text "Step 1 of 3"
4. No filler stat cards or decorative widgets
5. No monospace for metadata
6. Collapse metadata into single compact lines

**Shadows:** `subtle`, `keystone`, `floating`, `floating-dark`
**Radius:** `sm/md/lg/xl` derived from `--radius: 0.5rem`

---

## 3. Surface-by-Surface Breakdown

### 3.1 Auth Pages (`/sign-in`, `/sign-up`)

**Files:**
- `apps/web/src/components/auth/auth-layout.tsx` — shared wrapper
- `apps/web/src/app/sign-in/page.tsx`
- `apps/web/src/app/sign-up/page.tsx`

**What it does:**
Full-page dark background (`bg-neutral-950`) with a centered form card. Logo at top, form in middle, "Works with" integration badges below, footer links at bottom. Social OAuth buttons (Google/GitHub) side by side, "or" divider, then email/password form.

**How it's styled:**
This is the most recently redesigned surface. Uses **hardcoded neutral-\* classes** (`bg-neutral-950`, `text-neutral-500`, `border-neutral-800`) instead of design tokens. This was intentional — the auth page forces dark mode regardless of system theme by injecting `darkModeVars` as inline CSS custom properties. But the component's own elements use `neutral-*` instead of `bg-background`/`text-foreground`/`border-border`.

**Problems:**
- **Token bypass:** Uses `neutral-*` Tailwind utilities everywhere instead of the semantic tokens. This means if we change the dark theme, auth pages won't pick it up.
- **Inconsistent approach:** `darkModeVars` overrides the CSS custom properties for child shadcn components (so `<Button>`, `<Input>` etc. render correctly in dark mode), but the layout itself uses raw Tailwind colors. Pick one approach.
- The `<img>` tag for the logo loads from a CDN (`d1uh4o7rpdqkkl.cloudfront.net`) — works but the URL is hardcoded.
- Overall the design is clean and minimal. This surface is in decent shape visually.

---

### 3.2 Onboarding (`/onboarding`)

**Files:**
- `apps/web/src/app/onboarding/layout.tsx` — layout with dot progress indicator
- `apps/web/src/app/onboarding/page.tsx` — step orchestrator
- `apps/web/src/components/onboarding/step-path-choice.tsx` — Developer vs Company cards
- `apps/web/src/components/onboarding/step-create-org.tsx`
- `apps/web/src/components/onboarding/step-questionnaire.tsx`
- `apps/web/src/components/onboarding/step-tool-selection.tsx`
- `apps/web/src/components/onboarding/step-invite-members.tsx`
- `apps/web/src/components/onboarding/step-billing.tsx`
- `apps/web/src/components/onboarding/step-complete.tsx`
- `apps/web/src/stores/onboarding.ts` — Zustand store (persisted to localStorage)

**What it does:**
Multi-step wizard with branching paths:
- **Developer flow:** Path Choice → Tools → (Billing) → Complete
- **Organization flow:** Path Choice → Create Org → Questionnaire → Tools → Invite → (Billing) → Complete

The path choice step shows two large cards with images (Developer / Company). The step indicator is a row of dots/bars at the top.

**How it's styled:**
- The layout uses `bg-background dark:bg-neutral-950` — so it's light in light mode, dark in dark mode. This is the **only flow that isn't force-dark** among the pre-dashboard pages. If the user's system is in light mode, the onboarding renders light, but they just came from a forced-dark auth page. Jarring transition.
- The step indicator uses `<Button variant="ghost">` components styled as tiny dots/bars (`h-1.5`, `w-1.5` to `w-6`). This violates the design system's "no pill-style step indicators" rule.
- Step-path-choice uses `text-2xl sm:text-3xl font-bold` heading — way larger than the dashboard's `text-lg` heading convention. Appropriate for an onboarding hero, but feels disconnected from the rest of the product.
- Cards use `<CardButton>` (custom component), `rounded-2xl`, `border-border`. Images reference `/single.png` and `/jam.png` from the public folder.
- Individual steps (create-org, questionnaire, etc.) are simple centered forms. They use the design tokens correctly (`text-foreground`, `bg-card`, `border-border`).

**Problems:**
- **Theme whiplash:** User goes dark auth → light onboarding → dark/light dashboard. The onboarding layout doesn't force dark mode like auth does.
- **Step indicator violates own design rules.** The dot/bar progress indicator is exactly the "pill-style step indicator" the design system says to avoid. Should use muted text like "Step 2 of 5".
- **Path choice is the most "designed" part** and looks decent, but the subsequent form steps are very plain — just centered forms with no visual identity. There's no persistent branding or visual thread through the wizard.
- **No back button** on most steps (you can click completed dots to go back, but it's not obvious).
- **Layout width inconsistency:** Path choice uses `max-w-[720px]`, other steps use varying widths or just center naturally. No consistent `max-w-*` across steps.

---

### 3.3 Dashboard Home (`/dashboard`)

**Files:**
- `apps/web/src/app/(command-center)/dashboard/page.tsx` — renders `<EmptyDashboard />`
- `apps/web/src/components/dashboard/empty-state.tsx` — the actual dashboard home
- `apps/web/src/components/dashboard/prompt-input.tsx` — chat-style prompt input
- `apps/web/src/components/dashboard/onboarding-cards.tsx` — horizontal card scroller

**What it does:**
- Personalized greeting ("Good morning, Pablo") at top
- Large prompt input for creating sessions (model selector, repo picker, file attach)
- Below: "Needs Attention" (agent runs needing human input), "Active Sessions", "Recent Sessions"
- The onboarding section (get-started cards) is currently commented out: `{/* <OnboardingSection /> */}`

**How it's styled:**
- Greeting is `text-3xl font-semibold` — feels marketing-scale, not product-scale
- Content below prompt is in a bordered column (`border-l border-r border-border/50 mx-auto max-w-3xl`) — a "feed" style layout
- Session rows use `rounded-xl border border-border` containers with `px-4 py-3` row padding
- SectionHeader component: `text-base font-semibold` title + `text-sm text-muted-foreground` subtitle
- Uses `StatusDot` component which **uses colored dots** (`bg-green-500`, `bg-yellow-500`) — this may violate the "no arbitrary colored dots" anti-pattern, though status dots for sessions arguably have functional meaning

**Problems:**
- **Greeting scale is too large** for a product page. `text-3xl` is marketing territory according to the design system rules.
- **Bordered column pattern** (the `border-l border-r` feed) doesn't appear anywhere else in the product. It's an orphaned layout pattern.
- **The `StatusDot` uses raw Tailwind colors** (`bg-green-500`, `bg-yellow-500`) instead of semantic tokens. If we want colored status, we should define them as CSS variables.
- **"Needs Attention" section uses `AlertCircle` in `text-destructive`** and pills with `border-amber-500/30 text-amber-600` — this is one of the few places where non-monochrome color leaks in. The amber tint may violate the design system's monochrome philosophy.
- **No consistent page container.** This page builds its own layout from scratch instead of using `PageShell`. The other dashboard pages (sessions, repos, etc.) all use `PageShell`.

---

### 3.4 Dashboard Sub-Pages (Sessions, Automations, Repos, Runs, Integrations, Actions)

**Files:**
- `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/automations/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/repos/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/runs/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/actions/page.tsx`
- `apps/web/src/components/dashboard/page-shell.tsx` — shared wrapper

**What they do:**
Standard list pages. Filter tabs at top, search input, table/list of items. Each uses the `PageShell` component for consistent padding.

**How they're styled:**
`PageShell` provides: `overflow-y-auto` → `mx-auto px-6 py-6 max-w-4xl` container. Simple and clean.

List pages generally follow this pattern:
- Filter tabs: plain `<button>` elements with `rounded-md`, active state `bg-muted text-foreground`
- Search: shadcn `<Input>` with search icon overlay
- List container: `rounded-lg border border-border bg-card overflow-hidden`
- List rows: `flex items-center px-4 py-2.5 border-b border-border/50`
- Empty states: centered text with action button

**Problems:**
- **Filter tabs use raw `<button>` elements** instead of shadcn Button or a tab component. They work fine but are inconsistent with the design system's "use existing primitives" rule.
- **Row heights vary:** Sessions rows are `py-2.5`, the empty-state dashboard rows are `py-3`. Automations rows are full custom `<Link>` components. No shared row component.
- **Some pages have the title in the header bar** (set by `CommandCenterLayout` via `PAGE_TITLES` map) AND a title in the page itself. Others only have the header bar title. Inconsistent.
- **PageShell title prop is accepted but not rendered** — the component takes a `title` prop but doesn't use it in the JSX. The title comes from the layout's header bar instead. This is confusing.
- **Integrations page** is the most complex sub-page with two dialogs (picker + detail), its own catalog system, OAuth connection management, and MCP preset forms. The picker dialog is `max-w-[1100px]` with a sidebar — feels like a different app compared to the minimal list pages.

---

### 3.5 Sidebar

**File:** `apps/web/src/components/dashboard/sidebar.tsx`

**What it does:**
Left sidebar with: Logo + org name, nav items (Home, Runs, Sessions, Automations, Repos, Integrations), recent sessions list, settings link, user menu at bottom. Also a mobile drawer variant.

**How it's styled:**
- Width: `w-56` (224px) on desktop
- Background: `bg-sidebar` token
- Nav items: `h-8 rounded-xl` with `h-5 w-5` icons
- Recent sessions: same `h-8 rounded-xl` sizing (recently unified to match nav items)
- Org selector: dropdown popover with org list
- Mobile: sheet/drawer triggered by hamburger button in mobile header

**Problems:**
- **The sidebar is probably the most polished component** — it follows the design system well.
- **Session items in sidebar** show `ChatBubbleIcon` (custom) while nav items use Lucide icons. The visual weight is consistent but the icon style is slightly different (custom SVG vs Lucide).
- **"View all" link** styling was recently adjusted but still uses a smaller text size than nav items.

---

### 3.6 Settings Pages

**Files:**
- `apps/web/src/app/(command-center)/settings/layout.tsx` — settings sub-nav
- `apps/web/src/app/(command-center)/settings/profile/page.tsx`
- `apps/web/src/app/(command-center)/settings/general/page.tsx`
- `apps/web/src/app/(command-center)/settings/members/page.tsx`
- `apps/web/src/app/(command-center)/settings/secrets/page.tsx`
- `apps/web/src/app/(command-center)/settings/billing/page.tsx`

**What they do:**
Standard settings forms — profile editing, org management, member invitations, secret/env management, billing. The settings layout adds a secondary horizontal nav bar (Profile, General, Members, Secrets, Billing).

**How they're styled:**
- Settings layout adds a horizontal tab bar below the main header: `flex items-center gap-6 h-10 px-6 border-b border-border/50`
- Individual settings pages use `PageShell` with various form layouts
- Forms use shadcn Input, Label, Button, etc.
- Cards for sections: `rounded-lg border border-border bg-card p-5` pattern

**Problems:**
- **The secondary nav bar** is another ad-hoc implementation — `<Link>` tags with active state checking via pathname. Not using shadcn Tabs or any shared component.
- **Billing page** likely has the most complex layout with Stripe integration — haven't audited it fully but it's behind a feature flag.
- **Members page** has invite functionality and a member list, using standard patterns.
- These pages are functional but unremarkable. They could benefit from the same design pass as everything else.

---

### 3.7 Workspace / Coding Session (`/workspace/[id]`)

**Files:**
- `apps/web/src/app/(workspace)/layout.tsx` — minimal shell
- `apps/web/src/app/(workspace)/workspace/[id]/page.tsx` — session detail page
- `apps/web/src/components/coding-session/coding-session.tsx` — main two-pane layout
- `apps/web/src/components/coding-session/thread.tsx` — chat thread
- `apps/web/src/components/coding-session/right-panel.tsx` — engine room panel router
- `apps/web/src/components/coding-session/session-header.tsx` — connection status, indicators
- `apps/web/src/components/coding-session/terminal-panel.tsx` — terminal via xterm.js
- `apps/web/src/components/coding-session/vscode-panel.tsx` — iframe to OpenVSCode Server

**What it does:**
Full-bleed two-pane IDE layout. Left pane (35%) is the chat thread. Right pane (65%) is the "engine room" — a tabbed container switching between: Preview (iframe), Code (VSCode iframe), Terminal (xterm.js), Git, Services, Artifacts, Settings.

The header bar has: back arrow, separator, logo, session title, status indicators on the left. Panel tab picker on the right (aligned with the right pane). Panel tabs can be pinned/unpinned.

**How it's styled:**
- Layout: `h-dvh flex flex-col` → header (h-12) + main content (flex-1)
- Split: flexbox with `md:flex-[35]` and `md:flex-[65]`
- Right panel: wrapped in `rounded-xl border border-border bg-background`
- Panel tabs: small buttons (`h-7 gap-1.5 text-xs font-medium`) with icon + label
- Chat area: uses `@assistant-ui/react` runtime for the thread UI
- The right panel renders different sub-components based on `mode.type` from the preview panel Zustand store

**Problems:**
- **The VSCode panel is an iframe** to OpenVSCode Server running in the sandbox. It works but: startup takes time, requires polling until ready, and the visual style doesn't match our design system at all. This is documented in `todos/custom-code-editor.md` as a future project to replace with Monaco.
- **The header is dense but functional.** The 35/65 split alignment between header and content works well.
- **Mobile UX is an afterthought.** On mobile, you toggle between chat and preview full-screen. It works but there's no thought-through mobile design.
- **The "Resumed from Automation" banner** uses a raw `<button>` for the dismiss X instead of shadcn Button.
- **This surface is actually the most visually cohesive** because it has the clearest design reference (Lovable-style IDE) and was built as a single unit.

---

## 4. Cross-Cutting Issues

### 4.1 Color System Leaks
The design system mandates monochrome tokens. Actual usage:
- `StatusDot`: `bg-green-500`, `bg-yellow-500` (raw Tailwind)
- Needs Attention pills: `border-amber-500/30`, `text-amber-600` (raw Tailwind)
- Auth layout: `bg-neutral-950`, `text-neutral-500`, etc. everywhere (raw Tailwind)
- Some places use `text-destructive` correctly for errors, but raw red colors elsewhere

### 4.2 Two Theme Strategies
1. **CSS custom property override** (`darkModeVars` in auth-layout.tsx) — manually sets `--background`, `--foreground`, etc. as inline styles to force dark mode
2. **Tailwind `.dark` class** — the standard approach via `darkMode: ["class"]` in tailwind config

These coexist but aren't coordinated. The onboarding flow doesn't do either, so it follows system theme, creating a jarring light-to-dark-to-light transition.

### 4.3 No Shared Page Layout Pattern
- Dashboard home: builds its own layout from scratch (bordered feed column)
- Dashboard sub-pages: use `PageShell` (max-w-4xl, px-6 py-6)
- Settings: use `PageShell` with a secondary nav bar added by the settings layout
- Workspace: full-bleed custom layout
- The design system doc specifies a "Page container" class string, but `PageShell` doesn't use it

### 4.4 Component Consistency
- Filter tabs are raw `<button>` on some pages, shadcn `<Button>` on others
- Some list containers are `rounded-lg`, others `rounded-xl`
- Row padding varies: `py-2.5`, `py-3`, `py-4` across different lists
- Some empty states are centered text + button, others are more elaborate

### 4.5 Font & Typography
- Tailwind config uses `var(--font-inter)` but the root layout loads Inter via `next/font/google` and applies it as `inter.variable` and `inter.className`
- The design system doc says `var(--font-geist-sans)` — this is **wrong/outdated**. The actual font is Inter.
- Marketing-scale type (`text-3xl`) leaks into the dashboard greeting

---

## 5. What Works

- **The workspace/IDE view** is the strongest surface. The two-pane split, header design, and panel system all work well together. The Lovable reference was the right call.
- **The sidebar** is clean and functional. Nav items, session list, org selector are all in good shape.
- **The auth pages** look polished (after the recent redesign). The centered dark layout with subtle gradient is on-brand.
- **The overall architecture** (route groups, layout hierarchy, state management) is sound. This isn't a rebuild — it's a polish/consistency pass.
- **PageShell** as a concept is right, just under-utilized and slightly misconfigured.

---

## 6. What Needs Fixing (Prioritized)

### P0 — Embarrassing / Broken Feel
1. **Theme whiplash through auth → onboarding → dashboard.** Onboarding should force dark like auth does, OR the whole app should be dark-only for v1.
2. **Dashboard home is the weakest page.** The greeting + bordered feed column feels placeholder-y. It's the first thing users see after onboarding.
3. **Onboarding step indicator** should be muted text ("Step 2 of 5"), not pill dots. We wrote this rule and immediately broke it.

### P1 — Visual Inconsistency
4. **Unify container patterns.** Every list page should use the same container radius, row height, row padding. Pick one.
5. **Fix color leaks.** Either define status colors as CSS custom properties (so they participate in theming) or explicitly allow them in the design system.
6. **Fix auth layout token bypass.** Choose between `darkModeVars` + semantic tokens OR hardcoded `neutral-*`. Not both.
7. **PageShell should match the design system's page container spec.** Currently it defines its own padding/width.

### P2 — Polish
8. **Mobile isn't designed.** The workspace mobile toggle works but needs proper UX thought.
9. **Empty states vary in quality.** Some are just centered text, others are more thoughtful. Unify.
10. **Onboarding steps after path-choice need visual identity.** They're plain forms with no branding continuity.
11. **Filter tabs should use a shared component** instead of raw buttons.

---

## 7. Key Files Reference

| File | What it is |
|------|-----------|
| `docs/design-system.md` | Design tokens, anti-patterns, component specs |
| `docs/updated-flows.md` | Product layout design doc (information architecture) |
| `apps/web/src/app/globals.css` | CSS custom properties (light/dark tokens) |
| `apps/web/tailwind.config.cjs` | Tailwind theme config |
| `apps/web/src/components/auth/auth-layout.tsx` | Auth page wrapper |
| `apps/web/src/app/onboarding/layout.tsx` | Onboarding wizard layout |
| `apps/web/src/app/(command-center)/layout.tsx` | Dashboard/settings shell |
| `apps/web/src/components/dashboard/sidebar.tsx` | Sidebar component |
| `apps/web/src/components/dashboard/empty-state.tsx` | Dashboard home |
| `apps/web/src/components/dashboard/page-shell.tsx` | Shared page wrapper |
| `apps/web/src/components/coding-session/coding-session.tsx` | Workspace two-pane layout |
| `apps/web/src/components/ui/status-dot.tsx` | Status dot (color leak example) |
| `apps/web/src/stores/preview-panel.ts` | Right panel state management |
| `apps/web/src/stores/onboarding.ts` | Onboarding wizard state |

---

## 8. Design References

Products we're inspired by (in order of relevance):
1. **Lovable** — workspace/IDE view reference (two-pane, files pop open as agent works)
2. **Linear** — dashboard density, triage view, monochrome palette
3. **Vercel** — settings pages, clean forms, minimal UI
4. **Raycast** — sidebar density, keyboard-first
5. **Perplexity** — chat UI, clean thread design

---

## 9. Branding & Build Issues

1. **Root layout metadata still says "Keystone"** (`apps/web/src/app/layout.tsx`): The page title, meta author, meta creator, meta publisher, OG tags, and Twitter cards all reference "Keystone" and `withkeystone.com`. The product is called Proliferate. This is visible to users in browser tabs and when sharing links.

2. **Onboarding questionnaire uses `/asdf.png`** (`components/onboarding/step-questionnaire.tsx`): The image source for the questionnaire step card is literally `/asdf.png`. Obviously a placeholder/debug name that was never swapped.

3. **GitHub/Slack connect steps exist but aren't wired into the flow** (`onboarding/page.tsx`): `StepGithubConnect` and `StepSlackConnect` are imported but never rendered in the step switch. The onboarding flow skips directly from tools to invite/billing. These components exist fully built but are dead code.

4. **`export const dynamic = "force-dynamic"` on client components**: Used in sign-in, sign-up, onboarding page, and workspace page. This is a Next.js route segment config that only works in server components. On `"use client"` components, it's silently ignored and does nothing.

5. **Design system doc references wrong font** (`docs/design-system.md`): Says `var(--font-geist-sans)` but the actual font is Inter, loaded as `var(--font-inter)` in the root layout and tailwind config.

---

## 10. Code-Level Bugs Found During Audit

These aren't design issues — they're actual bugs discovered while reading the code:

1. **Terminal selection color is broken** (`coding-session/terminal-panel.tsx`): The code does `${fg}33` to append hex alpha to the foreground color, but `getCssColor()` returns an `hsl(...)` string, producing invalid CSS like `hsl(0 0% 98%)33`. The selection highlight in the terminal is invisible or broken.

2. **Thread composer `hasContent` check is stale** (`coding-session/thread.tsx`): `composerRuntime.getState().text.trim()` is called outside React's reactive scope. It doesn't trigger re-renders when text changes, so the send button may stay disabled/enabled incorrectly.

3. **Duplicate attach buttons** (`coding-session/thread.tsx`): Both the `Plus` button (left toolbar) and `Paperclip` button (right toolbar) trigger the same `handleAttachClick`. One is redundant.

4. **Dead `onClose` props** (`terminal-panel.tsx`, `vscode-panel.tsx`): Both accept an `onClose` prop that is never used in the component body.

5. **Duplicate `relativeTime` utility** (`actions/action-invocation-card.tsx`): Has its own `relativeTime()` function that duplicates `formatRelativeTime` from `@/lib/utils`.

6. **Raw `<button>` in feature code** (`coding-session/thread.tsx`): The `ToolFallback` component uses a raw `<button>` element instead of the shadcn `Button` component, violating the design system's "no raw HTML form elements" rule.

---

## 11. Additional Code Issues

7. **`PageShell` accepts `title`/`subtitle` props but never renders them** (`components/dashboard/page-shell.tsx`): Every page passes `title="Sessions"` etc. to PageShell, but the component destructures these away and only uses `actions`, `maxWidth`, and `children`. The title comes from the layout's header bar instead. Misleading API.

8. **Three different tab styling patterns across dashboard pages:**
   - Sessions: `bg-muted text-foreground rounded-md`
   - Automations: `bg-card shadow-subtle border border-border/50`
   - Runs: `bg-secondary text-foreground rounded-lg`
   No shared tab component. Each page implements its own filter tabs differently.

9. **Runs page uses a raw `<input>` instead of shadcn `Input`** (`dashboard/runs/page.tsx`): Has hand-rolled focus styles that duplicate what shadcn provides.

10. **`text-[10px]` in repos page** (`dashboard/repos/page.tsx`): Below the design system minimum of `xs` (12px). Used for configuration badges.

11. **`Button variant="dark"` used in onboarding** — this is a custom variant not in standard shadcn. Works but undocumented.

---

## 12. Design System Violations by File (Severity)

| File | Violation | Severity |
|------|-----------|----------|
| `actions/action-invocation-card.tsx` | Hardcoded `text-green-600`, `text-yellow-600`, `text-blue-600` across light/dark | High |
| `inbox/inbox-item.tsx` | Hardcoded `text-red-500`, `text-amber-500`, `text-orange-500` for status | High |
| `auth/auth-layout.tsx` | Uses `neutral-*` utilities instead of semantic tokens | Medium |
| `dashboard/empty-state.tsx` | `border-amber-500/30 text-amber-600` on status pills | Medium |
| `coding-session/thread.tsx` | `text-red-500` on mic recording button | Low |
| `ui/status-dot.tsx` | `bg-green-500`, `bg-yellow-500` for status dots | Low (intentional) |

---

## 13. Questions for You

1. **Dark-only or light+dark?** Should we just go dark-only for v1 and eliminate the theme switching complexity? The workspace is already always dark. Auth is always dark. Only the dashboard/settings/onboarding currently support light mode.

2. **Dashboard home layout:** The current "greeting + prompt + feed" pattern feels like it's trying too hard to be a chat app homepage. Should we lean into a more traditional dashboard (sidebar + content area is the dashboard) or keep the centered feed?

3. **Should we extract a shared list/table component?** We have ~6 pages that are all "filter tabs + search + bordered list of rows". A shared `DataList` or similar could enforce consistency.

4. **Onboarding visual treatment:** The path-choice step with the two image cards is the nicest part. Should the rest of the onboarding steps match that visual weight, or is it fine for them to be plain forms since users only see them once?

5. **Color in a monochrome system:** We currently use green/yellow/amber for status indicators and red for errors. The design system says monochrome-only. What's the right answer — semantic status colors as CSS variables, or truly monochrome status (dot opacity/fill instead of color)?
