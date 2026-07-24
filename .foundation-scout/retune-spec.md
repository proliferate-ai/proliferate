# UI foundation retune specification

Status: frozen Phase-1 implementation map for the foundation pass.

This is the single canonical pre-implementation authority for token
disposition, generation, migrations, tests, gates, and deliberate visual
retunes. `ui-foundation-target.md` supplies the ruled destination;
`foundation-handoff.md` supplies delivery law. The three scout drafts are
merge inputs only after this file exists.

## 1. Resolution law and architecture

- Inventory scope is 285 current concrete global custom properties. The
  `--color-*: initial` Tailwind reset and component-scoped custom properties
  are excluded.
- `[SHIPPED]` means the current rendered winner survives exactly.
  `[RETUNE:<ruling>]` means an enumerated deliberate change. `[REMOVED]`
  means a proven-dead or explicitly retired property.
- With no explicit retune, `product.css`'s rendered winner beats
  `tokens.ts`; final `:root` color-mix declarations beat `@theme`; light
  block B beats light block A, while block-A-only values survive.
- The cascade census heading/source contradiction is resolved, not blocking:
  its printed table had 276 rows although current source has 285 globals.
  The missing current-source rows are `--color-delegated-agent-1` through
  `--color-delegated-agent-8` and `--color-warning-subtle`. All nine appear
  in the 285-row disposition below.
- Remove exactly the 59 census-dead globals, the ten generic text
  size/line-height properties, and `--shadow-keystone`: 70 removals total.
- `apps/packages/design` TS modules become the only literal authority,
  organized by colors, type, icons/control boxes, radii, shadows, motion,
  and layering. The generator emits the complete CSS `@theme`, dark root,
  one flattened light root, keyframes/utilities, React Native bridge inputs,
  and code-palette inputs.
- `product.css` and `dom.css` retain rules, font faces, utilities, and
  component selectors only. They contain no hand-authored global token
  values. The generated `@theme` half and runtime `:root` color-mix half
  come from the same TS entries.
- `design build` remains `tsc` first, then generation/copy, so
  `generate-theme.mjs` can import compiled design values. Generated `dist/`
  remains untracked and consumers keep their current hand-chained design
  build.
- DOM delivery remains `product-client/index.css` → design `product.css` →
  `dom.css` → generated `theme.css`; Desktop and Web receive it transitively.
  Mobile consumes the unchanged `mobileTheme` shape through
  `design/react-native`.
- Shiki retains the exact exports `PROLIFERATE_DARK_THEME`,
  `PROLIFERATE_LIGHT_THEME`, and `toShikiTheme`, including the `.palette`
  shape read by `highlighting.ts`. Monaco retains
  `proliferateDarkTheme`, `proliferateLightTheme`, `THEME_NAME_DARK`, and
  `THEME_NAME_LIGHT`. Both derive palette values from design; Monaco remains
  otherwise vestigial.
- Geist sans is owned by design, is a direct design dependency, and is
  selected only through `--font-sans`. `dom.css :root` uses
  `font-family: var(--font-sans)`.
- A currently live historical custom-property name is not deleted merely
  because a canonical replacement exists. Unless its consumers are
  exhaustively migrated by the census, it survives as a `var(...)`
  compatibility alias with the exact grep-able comment
  `/* legacy-alias */`. It contains no duplicate literal.

### 1.1 Approved canonical state and tracking names

Claude approved the pending defaults:

- canonical state names are `--color-hover`, `--color-active`,
  `--color-selected`, and the existing `--color-border`;
- 16px heading tracking is `--tracking-heading: -0.01em`;
- 19px title and 26px hero share `--tracking-tight: -0.025em`.

There is no `--color-state-*` family and no three-step title tracking.

## 2. Exhaustive disposition of all 285 current globals

Coverage remains 176 shipped + 39 retuned/mapped + 70 removed = 285.
Compatibility aliases count under their current historical row.

| Current global token | Final name | Final dark | Final light | Provenance |
|---|---|---|---|---|
| `--animate-blink-cursor` | — | — | — | [REMOVED] |
| `--animate-popover-in` | `--animate-popover-in` | `popover-in var(--duration-enter) var(--ease-out-quint)` | `popover-in var(--duration-enter) var(--ease-out-quint)` | [RETUNE:motion/roles] |
| `--codex-diffs-addition-number` | — | — | — | [REMOVED] |
| `--codex-diffs-context-number` | `--codex-diffs-context-number` | `color-mix(in lab, var(--codex-diffs-surface) 98.5%, var(--diffs-mixer))` | `color-mix(in lab, var(--codex-diffs-surface) 98.5%, var(--diffs-mixer))` | [SHIPPED] |
| `--codex-diffs-context-surface` | `--codex-diffs-context-surface` | `color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--color-diff-main-surface))` | `color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--color-diff-main-surface))` | [SHIPPED] |
| `--codex-diffs-deletion-number` | — | — | — | [REMOVED] |
| `--codex-diffs-header-surface` | `--codex-diffs-header-surface` | `var(--color-diff-header-surface)` | `var(--color-diff-header-surface)` | [SHIPPED] |
| `--codex-diffs-hover-surface` | `--codex-diffs-hover-surface` | `color-mix(in srgb, var(--codex-diffs-surface) 92%, var(--color-diff-main-surface))` | `color-mix(in srgb, var(--codex-diffs-surface) 92%, var(--color-diff-main-surface))` | [SHIPPED] |
| `--codex-diffs-separator-surface` | `--codex-diffs-separator-surface` | `color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--color-foreground))` | `color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--color-foreground))` | [SHIPPED] |
| `--codex-diffs-surface` | `--codex-diffs-surface` | `var(--color-diff-surface)` | `var(--color-diff-surface)` | [SHIPPED] |
| `--color-accent` | `--color-accent` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--color-accent-foreground` | `--color-accent-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-app-switcher-bg` | — | — | — | [REMOVED] |
| `--color-background` | `--color-background` | `#181818` | `#ffffff` | [SHIPPED] |
| `--color-border` | `--color-border` | `color-mix(in oklab, #ffffff 8.4%, transparent)` | `color-mix(in oklab, var(--color-foreground) 8.4%, transparent)` | [RETUNE:state/border] |
| `--color-border-heavy` | `--color-border-heavy` | `color-mix(in oklab, #ffffff 12%, transparent)` | `color-mix(in oklab, var(--color-foreground) 12%, transparent)` | [SHIPPED] |
| `--color-border-highlight` | — | — | — | [REMOVED] |
| `--color-border-light` | `--color-border-light` | `color-mix(in oklab, #ffffff 5%, transparent)` | `color-mix(in oklab, var(--color-foreground) 5%, transparent)` | [SHIPPED] |
| `--color-brand-logo-tile` | `--color-brand-logo-tile` | `hsl(0 0% 100%)` | `hsl(0 0% 100%)` | [SHIPPED] |
| `--color-card` | `--color-card` | `#212121` | `var(--color-surface-elevated)` | [SHIPPED] |
| `--color-card-foreground` | `--color-card-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-code-block-background` | `--color-code-block-background` | `var(--color-diff-surface)` | `var(--color-diff-surface)` | [SHIPPED] |
| `--color-composer-backdrop-filter` | `--color-composer-backdrop-filter` | `none` | `blur(16px)` | [SHIPPED] |
| `--color-composer-background` | `--color-composer-background` | `#212121` | `rgba(255, 255, 255, 0.864)` | [SHIPPED] |
| `--color-composer-border` | `--color-composer-border` | `var(--color-border) /* legacy-alias */` | `var(--color-border) /* legacy-alias */` | [RETUNE:state/border] |
| `--color-composer-control-active-foreground` | `--color-composer-control-active-foreground` | `var(--color-foreground)` | `var(--color-foreground)` | [SHIPPED] |
| `--color-composer-control-foreground` | `--color-composer-control-foreground` | `var(--color-muted-foreground)` | `color-mix(in oklab, var(--color-foreground) 55%, transparent)` | [SHIPPED] |
| `--color-composer-control-hover` | `--color-composer-control-hover` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--color-composer-control-muted-foreground` | `--color-composer-control-muted-foreground` | `var(--color-faint)` | `color-mix(in oklab, var(--color-foreground) 50%, transparent)` | [SHIPPED] |
| `--color-composer-send-background` | `--color-composer-send-background` | `var(--color-foreground)` | `var(--color-primary)` | [SHIPPED] |
| `--color-composer-send-foreground` | `--color-composer-send-foreground` | `var(--color-background)` | `var(--color-primary-foreground)` | [SHIPPED] |
| `--color-composer-shadow` | `--color-composer-shadow` | `var(--shadow-subtle)` | `var(--shadow-subtle)` | [RETUNE:elevation/near-flat] |
| `--color-delegated-agent-1` | `--color-delegated-agent-1` | `hsl(213 94% 68%)` | `hsl(221 83% 53%)` | [SHIPPED] |
| `--color-delegated-agent-2` | `--color-delegated-agent-2` | `hsl(292 100% 78%)` | `hsl(292 100% 46%)` | [SHIPPED] |
| `--color-delegated-agent-3` | `--color-delegated-agent-3` | `hsl(0 91% 71%)` | `hsl(0 72% 51%)` | [SHIPPED] |
| `--color-delegated-agent-4` | `--color-delegated-agent-4` | `hsl(50 100% 75%)` | `hsl(36 95% 42%)` | [SHIPPED] |
| `--color-delegated-agent-5` | `--color-delegated-agent-5` | `hsl(265 88% 78%)` | `hsl(265 80% 55%)` | [SHIPPED] |
| `--color-delegated-agent-6` | `--color-delegated-agent-6` | `hsl(188 85% 59%)` | `hsl(192 90% 36%)` | [SHIPPED] |
| `--color-delegated-agent-7` | `--color-delegated-agent-7` | `hsl(24 95% 72%)` | `hsl(25 95% 46%)` | [SHIPPED] |
| `--color-delegated-agent-8` | `--color-delegated-agent-8` | `hsl(199 89% 68%)` | `hsl(199 89% 42%)` | [SHIPPED] |
| `--color-destructive` | `--color-destructive` | `#fa423e` | `#e02e2a` | [SHIPPED] |
| `--color-destructive-foreground` | `--color-destructive-foreground` | `#ffffff` | `#ffffff` | [SHIPPED] |
| `--color-destructive-subtle` | `--color-destructive-subtle` | `rgba(250,66,62,0.12)` | `rgba(250,66,62,0.12)` | [SHIPPED] |
| `--color-diff-added` | `--color-diff-added` | `#00a240` | `#00a240` | [SHIPPED] |
| `--color-diff-added-bg` | — | — | — | [REMOVED] |
| `--color-diff-chat-file-header-hover-surface` | `--color-diff-chat-file-header-hover-surface` | `color-mix(in srgb, var(--color-diff-chat-file-header-surface) 97%, var(--color-foreground))` | `color-mix(in srgb, var(--color-diff-chat-file-header-surface) 97%, var(--color-foreground))` | [SHIPPED] |
| `--color-diff-chat-file-header-surface` | `--color-diff-chat-file-header-surface` | `var(--color-diff-surface)` | `var(--color-diff-surface)` | [SHIPPED] |
| `--color-diff-chat-inline-tool-header-hover-surface` | `--color-diff-chat-inline-tool-header-hover-surface` | `color-mix(in srgb, var(--color-diff-chat-inline-tool-header-surface) 97%, var(--color-foreground))` | `color-mix(in srgb, var(--color-diff-chat-inline-tool-header-surface) 97%, var(--color-foreground))` | [SHIPPED] |
| `--color-diff-chat-inline-tool-header-surface` | `--color-diff-chat-inline-tool-header-surface` | `color-mix(in srgb, var(--color-diff-surface) 86%, var(--color-overlay))` | `var(--color-diff-surface)` | [SHIPPED] |
| `--color-diff-chat-turn-header-hover-surface` | — | — | — | [REMOVED] |
| `--color-diff-chat-turn-header-surface` | `--color-diff-chat-turn-header-surface` | `color-mix(in srgb, var(--color-diff-surface) 86%, var(--color-overlay))` | `var(--color-diff-surface)` | [SHIPPED] |
| `--color-diff-chat-turn-icon-surface` | `--color-diff-chat-turn-icon-surface` | `color-mix(in srgb, var(--color-background) 88%, var(--color-overlay))` | `color-mix(in srgb, var(--color-diff-main-surface) 94%, var(--color-foreground))` | [SHIPPED] |
| `--color-diff-code-surface` | `--color-diff-code-surface` | `#111111` | `var(--color-surface-editor)` | [SHIPPED] |
| `--color-diff-deleted` | `--color-diff-deleted` | `#e02e2a` | `#ba2623` | [SHIPPED] |
| `--color-diff-deleted-bg` | — | — | — | [REMOVED] |
| `--color-diff-header-surface` | `--color-diff-header-surface` | `var(--color-diff-surface)` | `var(--color-diff-surface)` | [SHIPPED] |
| `--color-diff-main-surface` | `--color-diff-main-surface` | `#181818` | `var(--color-surface)` | [SHIPPED] |
| `--color-diff-panel-surface` | `--color-diff-panel-surface` | `color-mix(in oklab, #ffffff 3%, transparent)` | `var(--color-surface-elevated-secondary)` | [SHIPPED] |
| `--color-diff-sidebar-file-header-hover-surface` | `--color-diff-sidebar-file-header-hover-surface` | `color-mix(in srgb, var(--color-diff-sidebar-file-header-surface) 97%, var(--color-foreground))` | `color-mix(in srgb, var(--color-diff-sidebar-file-header-surface) 97%, var(--color-foreground))` | [SHIPPED] |
| `--color-diff-sidebar-file-header-surface` | `--color-diff-sidebar-file-header-surface` | `var(--color-diff-chat-inline-tool-header-surface)` | `var(--color-diff-chat-inline-tool-header-surface)` | [SHIPPED] |
| `--color-diff-surface` | `--color-diff-surface` | `color-mix(in srgb, #181818 94%, #ffffff)` | `color-mix(in srgb, var(--color-surface) 94%, var(--color-foreground))` | [SHIPPED] |
| `--color-faint` | `--color-faint` | `color-mix(in oklab, #ffffff 50%, transparent)` | `var(--color-foreground-tertiary)` | [SHIPPED] |
| `--color-file-icon-accent` | `--color-file-icon-accent` | `hsl(0 0% 89%)` | `hsl(0 0% 17%)` | [SHIPPED] |
| `--color-file-icon-folder` | `--color-file-icon-folder` | `hsl(0 0% 89%)` | `hsl(0 0% 17%)` | [SHIPPED] |
| `--color-file-icon-muted` | `--color-file-icon-muted` | `hsl(0 0% 64%)` | `hsl(0 0% 43%)` | [SHIPPED] |
| `--color-file-icon-neutral` | `--color-file-icon-neutral` | `hsl(0 0% 89%)` | `hsl(0 0% 17%)` | [SHIPPED] |
| `--color-file-icon-red` | `--color-file-icon-red` | `hsl(0 0% 89%)` | `hsl(0 0% 17%)` | [SHIPPED] |
| `--color-foreground` | `--color-foreground` | `#ffffff` | `#1a1c1f` | [SHIPPED] |
| `--color-foreground-secondary` | `--color-foreground-secondary` | `color-mix(in oklab, #ffffff 70%, transparent)` | `color-mix(in oklab, var(--color-foreground) 70%, transparent)` | [SHIPPED] |
| `--color-foreground-tertiary` | `--color-foreground-tertiary` | `color-mix(in oklab, #ffffff 50%, transparent)` | `color-mix(in oklab, var(--color-foreground) 50%, transparent)` | [SHIPPED] |
| `--color-git-gray` | — | — | — | [REMOVED] |
| `--color-git-green` | `--color-git-green` | `#40c977` | `#00a240` | [SHIPPED] |
| `--color-git-new-line` | — | — | — | [REMOVED] |
| `--color-git-red` | `--color-git-red` | `#fa423e` | `#ba2623` | [SHIPPED] |
| `--color-git-removed-line` | — | — | — | [REMOVED] |
| `--color-git-yellow` | `--color-git-yellow` | `#ffd240` | `#ffc300` | [SHIPPED] |
| `--color-helper` | — | — | — | [REMOVED] |
| `--color-highlight` | `--color-highlight` | `rgba(51, 156, 255, 0.12)` | `#e5f3ff` | [SHIPPED] |
| `--color-highlight-foreground` | — | — | — | [REMOVED] |
| `--color-highlight-muted` | `--color-highlight-muted` | `rgba(51, 156, 255, 0.5)` | `#339cff` | [SHIPPED] |
| `--color-info` | `--color-info` | `#339cff` | `#0285ff` | [SHIPPED] |
| `--color-info-foreground` | — | — | — | [REMOVED] |
| `--color-info-subtle` | — | — | — | [REMOVED] |
| `--color-input` | `--color-input` | `color-mix(in oklab, #ffffff 12%, transparent)` | `var(--color-surface-control)` | [SHIPPED] |
| `--color-input-border` | — | — | — | [REMOVED] |
| `--color-link` | — | — | — | [REMOVED] |
| `--color-link-elevated` | — | — | — | [REMOVED] |
| `--color-link-foreground` | `--color-link-foreground` | `#339cff` | `#339cff` | [SHIPPED] |
| `--color-list-hover` | `--color-list-hover` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--color-muted` | `--color-muted` | `#212121` | `var(--color-surface-elevated-secondary)` | [SHIPPED] |
| `--color-muted-foreground` | `--color-muted-foreground` | `color-mix(in oklab, #ffffff 70%, transparent)` | `var(--color-foreground-secondary)` | [SHIPPED] |
| `--color-overlay` | `--color-overlay` | `#000000` | `#000000` | [SHIPPED] |
| `--color-overlay-strong` | — | — | — | [REMOVED] |
| `--color-popover` | `--color-popover` | `#2d2d2d` | `#ffffff` | [SHIPPED] |
| `--color-popover-accent` | `--color-popover-accent` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--color-popover-foreground` | `--color-popover-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-popover-ring` | `--color-popover-ring` | `var(--color-border) /* legacy-alias */` | `var(--color-border) /* legacy-alias */` | [RETUNE:state/border] |
| `--color-positive` | — | — | — | [REMOVED] |
| `--color-positive-foreground` | — | — | — | [REMOVED] |
| `--color-positive-muted` | — | — | — | [REMOVED] |
| `--color-pr-merged` | `--color-pr-merged` | `#ad7bf9` | `#8250df` | [SHIPPED] |
| `--color-primary` | `--color-primary` | `#ffffff` | `#1a1c1f` | [SHIPPED] |
| `--color-primary-foreground` | `--color-primary-foreground` | `#0d0d0d` | `#ffffff` | [SHIPPED] |
| `--color-prose-border` | `--color-prose-border` | `color-mix(in oklab, #ffffff 8%, transparent)` | `var(--color-border-heavy)` | [SHIPPED] |
| `--color-ring` | `--color-ring` | `color-mix(in oklab, #ffffff 28%, transparent)` | `color-mix(in oklab, var(--color-foreground) 30%, transparent)` | [SHIPPED] |
| `--color-scrollbar-thumb` | `--color-scrollbar-thumb` | `rgba(255, 255, 255, 0.08)` | `rgba(13, 13, 13, 0.08)` | [SHIPPED] |
| `--color-scrollbar-thumb-active` | `--color-scrollbar-thumb-active` | `rgba(255, 255, 255, 0.16)` | `rgba(13, 13, 13, 0.16)` | [SHIPPED] |
| `--color-secondary` | — | — | — | [REMOVED] |
| `--color-secondary-foreground` | `--color-secondary-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-separator` | — | — | — | [REMOVED] |
| `--color-sidebar` | `--color-sidebar` | `#1d1d1d` | `var(--color-surface-under)` | [SHIPPED] |
| `--color-sidebar-accent` | `--color-sidebar-accent` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--color-sidebar-accent-foreground` | `--color-sidebar-accent-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-sidebar-background` | `--color-sidebar-background` | `#181818` | `var(--color-background)` | [SHIPPED] |
| `--color-sidebar-blue` | — | — | — | [REMOVED] |
| `--color-sidebar-border` | `--color-sidebar-border` | `var(--color-border) /* legacy-alias */` | `var(--color-border) /* legacy-alias */` | [RETUNE:state/border] |
| `--color-sidebar-foreground` | `--color-sidebar-foreground` | `color-mix(in oklab, #ffffff 85%, transparent)` | `color-mix(in oklab, var(--color-foreground) 85%, transparent)` | [SHIPPED] |
| `--color-sidebar-muted-foreground` | `--color-sidebar-muted-foreground` | `rgba(255, 255, 255, 0.481)` | `var(--color-foreground-tertiary)` | [SHIPPED] |
| `--color-sidebar-primary` | `--color-sidebar-primary` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-sidebar-primary-foreground` | — | — | — | [REMOVED] |
| `--color-sidebar-ring` | `--color-sidebar-ring` | `rgba(127, 193, 255, 0.747)` | `var(--color-ring)` | [SHIPPED] |
| `--color-special` | `--color-special` | `#339cff` | `#339cff` | [SHIPPED] |
| `--color-status-backlog` | — | — | — | [REMOVED] |
| `--color-status-backlog-hover` | — | — | — | [REMOVED] |
| `--color-status-canceled` | — | — | — | [REMOVED] |
| `--color-status-canceled-hover` | — | — | — | [REMOVED] |
| `--color-status-done` | — | — | — | [REMOVED] |
| `--color-status-done-hover` | — | — | — | [REMOVED] |
| `--color-status-in-progress` | `--color-status-in-progress` | `#ffcc33` | `#bd5800` | [SHIPPED] |
| `--color-status-in-progress-hover` | — | — | — | [REMOVED] |
| `--color-status-in-review` | — | — | — | [REMOVED] |
| `--color-status-in-review-hover` | — | — | — | [REMOVED] |
| `--color-success` | `--color-success` | `#40c977` | `#00a240` | [SHIPPED] |
| `--color-success-foreground` | — | — | — | [REMOVED] |
| `--color-success-subtle` | `--color-success-subtle` | `rgba(64,201,119,0.14)` | `rgba(64,201,119,0.14)` | [SHIPPED] |
| `--color-surface` | `--color-surface` | `#181818` | `#ffffff` | [SHIPPED] |
| `--color-surface-control` | `--color-surface-control` | `color-mix(in oklab, #2b2b2b 96%, transparent)` | `rgba(237, 237, 237, 0.4)` | [SHIPPED] |
| `--color-surface-control-opaque` | — | — | — | [REMOVED] |
| `--color-surface-editor` | `--color-surface-editor` | `#282828` | `#f7f7f7` | [SHIPPED] |
| `--color-surface-elevated` | `--color-surface-elevated` | `#212121` | `#ffffff` | [SHIPPED] |
| `--color-surface-elevated-secondary` | `--color-surface-elevated-secondary` | `color-mix(in oklab, #ffffff 3%, transparent)` | `color-mix(in oklab, var(--color-foreground) 2%, transparent)` | [SHIPPED] |
| `--color-surface-under` | `--color-surface-under` | `#141414` | `#f9f9f9` | [SHIPPED] |
| `--color-switch-background` | — | — | — | [REMOVED] |
| `--color-switch-foreground` | — | — | — | [REMOVED] |
| `--color-terminal-black` | `--color-terminal-black` | `rgba(255, 255, 255, 0.5)` | `rgba(13, 13, 13, 0.5)` | [SHIPPED] |
| `--color-terminal-blue` | `--color-terminal-blue` | `#339cff` | `#001bcb` | [SHIPPED] |
| `--color-terminal-bright-black` | `--color-terminal-bright-black` | `rgba(255, 255, 255, 0.71)` | `#000000` | [SHIPPED] |
| `--color-terminal-bright-blue` | `--color-terminal-bright-blue` | `#339cff` | `#006aff` | [SHIPPED] |
| `--color-terminal-bright-cyan` | `--color-terminal-bright-cyan` | `#339cff` | `#20b8ff` | [SHIPPED] |
| `--color-terminal-bright-green` | `--color-terminal-bright-green` | `#40c977` | `#59d24e` | [SHIPPED] |
| `--color-terminal-bright-magenta` | `--color-terminal-bright-magenta` | `#ad7bf9` | `#9840ff` | [SHIPPED] |
| `--color-terminal-bright-red` | `--color-terminal-bright-red` | `#ff6764` | `#f44a4c` | [SHIPPED] |
| `--color-terminal-bright-white` | `--color-terminal-bright-white` | `#ffffff` | `#828282` | [SHIPPED] |
| `--color-terminal-bright-yellow` | `--color-terminal-bright-yellow` | `#ffd240` | `#f87915` | [SHIPPED] |
| `--color-terminal-cyan` | `--color-terminal-cyan` | `#339cff` | `#0071ea` | [SHIPPED] |
| `--color-terminal-green` | `--color-terminal-green` | `#40c977` | `#008809` | [SHIPPED] |
| `--color-terminal-magenta` | `--color-terminal-magenta` | `#ad7bf9` | `#751ed9` | [SHIPPED] |
| `--color-terminal-red` | `--color-terminal-red` | `#ff6764` | `#d53538` | [SHIPPED] |
| `--color-terminal-white` | `--color-terminal-white` | `#ffffff` | `#666666` | [SHIPPED] |
| `--color-terminal-yellow` | `--color-terminal-yellow` | `#ffd240` | `#bd5800` | [SHIPPED] |
| `--color-text-caret` | `--color-text-caret` | `var(--color-foreground)` | `var(--color-foreground)` | [SHIPPED] |
| `--color-text-selection` | `--color-text-selection` | `var(--color-highlight, var(--color-input))` | `var(--color-highlight, var(--color-input))` | [SHIPPED] |
| `--color-tip` | — | — | — | [REMOVED] |
| `--color-tip-border` | — | — | — | [REMOVED] |
| `--color-tip-foreground` | — | — | — | [REMOVED] |
| `--color-tip-muted` | — | — | — | [REMOVED] |
| `--color-tip-secondary` | — | — | — | [REMOVED] |
| `--color-tip-secondary-border` | — | — | — | [REMOVED] |
| `--color-todo-completed` | — | — | — | [REMOVED] |
| `--color-todo-in-progress` | — | — | — | [REMOVED] |
| `--color-todo-pending` | — | — | — | [REMOVED] |
| `--color-unread` | — | — | — | [REMOVED] |
| `--color-warning` | `--color-warning` | `rgba(255, 180, 50, 0.15)` | `#fff8e6` | [SHIPPED] |
| `--color-warning-border` | `--color-warning-border` | `rgba(255, 180, 50, 0.25)` | `var(--color-border)` | [SHIPPED] |
| `--color-warning-foreground` | `--color-warning-foreground` | `#ffb432` | `var(--color-foreground)` | [SHIPPED] |
| `--color-warning-foreground-secondary` | — | — | — | [REMOVED] |
| `--color-warning-subtle` | `--color-warning-subtle` | `rgba(242,201,76,0.14)` | `rgba(242,201,76,0.14)` | [SHIPPED] |
| `--diffs-addition-color-override` | `--diffs-addition-color-override` | `var(--color-diff-added)` | `var(--color-diff-added)` | [SHIPPED] |
| `--diffs-bg-addition-hover-override` | `--diffs-bg-addition-hover-override` | `color-mix(in srgb, var(--color-diff-main-surface) 82%, #00a240)` | `color-mix(in srgb, var(--codex-diffs-surface) 78%, var(--diffs-addition-color-override))` | [SHIPPED] |
| `--diffs-bg-addition-number-override` | `--diffs-bg-addition-number-override` | `color-mix(in srgb, var(--color-diff-main-surface) 91%, #00a240)` | `color-mix(in srgb, var(--color-diff-main-surface) 91%, #00a240)` | [SHIPPED] |
| `--diffs-bg-addition-override` | `--diffs-bg-addition-override` | `color-mix(in srgb, var(--color-diff-main-surface) 88%, #00a240)` | `color-mix(in srgb, var(--codex-diffs-surface) 84%, var(--diffs-addition-color-override))` | [SHIPPED] |
| `--diffs-bg-context-override` | `--diffs-bg-context-override` | `var(--codex-diffs-context-surface)` | `var(--codex-diffs-context-surface)` | [SHIPPED] |
| `--diffs-bg-deletion-hover-override` | `--diffs-bg-deletion-hover-override` | `color-mix(in srgb, var(--color-diff-main-surface) 82%, #e02e2a)` | `color-mix(in srgb, var(--codex-diffs-surface) 78%, var(--diffs-deletion-color-override))` | [SHIPPED] |
| `--diffs-bg-deletion-number-override` | `--diffs-bg-deletion-number-override` | `color-mix(in srgb, var(--color-diff-main-surface) 91%, #e02e2a)` | `color-mix(in srgb, var(--color-diff-main-surface) 91%, #e02e2a)` | [SHIPPED] |
| `--diffs-bg-deletion-override` | `--diffs-bg-deletion-override` | `color-mix(in srgb, var(--color-diff-main-surface) 88%, #e02e2a)` | `color-mix(in srgb, var(--codex-diffs-surface) 84%, var(--diffs-deletion-color-override))` | [SHIPPED] |
| `--diffs-bg-hover-override` | — | — | — | [REMOVED] |
| `--diffs-bg-separator-override` | `--diffs-bg-separator-override` | `var(--codex-diffs-separator-surface)` | `var(--codex-diffs-separator-surface)` | [SHIPPED] |
| `--diffs-deletion-color-override` | `--diffs-deletion-color-override` | `var(--color-diff-deleted)` | `var(--color-diff-deleted)` | [SHIPPED] |
| `--diffs-fg` | `--diffs-fg` | `#fcfcfc` | `var(--color-foreground)` | [SHIPPED] |
| `--diffs-font-family` | `--diffs-font-family` | `var(--font-mono)` | `var(--font-mono)` | [SHIPPED] |
| `--diffs-font-size` | `--diffs-font-size` | `13px` | `13px` | [SHIPPED] |
| `--diffs-line-height` | `--diffs-line-height` | `calc(var(--diffs-font-size, 13px) * 1.8)` | `calc(var(--diffs-font-size, 13px) * 1.8)` | [SHIPPED] |
| `--diffs-min-number-column-width` | `--diffs-min-number-column-width` | `4ch` | `4ch` | [SHIPPED] |
| `--diffs-mixer` | `--diffs-mixer` | `#fcfcfc` | `var(--color-foreground)` | [SHIPPED] |
| `--font-mono` | `--font-mono` | `"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` | `"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` | [SHIPPED] |
| `--font-sans` | `--font-sans` | `"Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | `"Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | [RETUNE:type/Geist] |
| `--git-new-line-bg` | — | — | — | [REMOVED] |
| `--git-new-line-border` | — | — | — | [REMOVED] |
| `--git-new-line-highlight` | — | — | — | [REMOVED] |
| `--git-removed-line-bg` | — | — | — | [REMOVED] |
| `--git-removed-line-border` | — | — | — | [REMOVED] |
| `--git-removed-line-highlight` | — | — | — | [REMOVED] |
| `--icon-compact` | `--icon-compact` | `1em` | `1em` | [SHIPPED] |
| `--icon-control` | `--icon-control` | `1.333333em` | `1.333333em` | [SHIPPED] |
| `--icon-display` | `--icon-display` | `2em` | `2em` | [SHIPPED] |
| `--icon-large` | `--icon-large` | `1.666667em` | `1.666667em` | [SHIPPED] |
| `--icon-paired` | `--icon-paired` | `1.230769em` | `1.230769em` | [RETUNE:icons/16px-paired] |
| `--icon-status` | `--icon-status` | `0.55em` | `0.55em` | [SHIPPED] |
| `--radius` | `--radius` | `0.5rem` | `0.5rem` | [SHIPPED] |
| `--radius-composer` | `--radius-composer` | `0.75rem` | `0.75rem` | [RETUNE:radii/Codex-soft] |
| `--radius-full` | `--radius-full` | `9999px` | `9999px` | [SHIPPED] |
| `--radius-lg` | `--radius-lg` | `0.625rem` | `0.625rem` | [RETUNE:radii/Codex-soft] |
| `--radius-md` | `--radius-md` | `0.5rem` | `0.5rem` | [RETUNE:radii/Codex-soft] |
| `--radius-sm` | `--radius-sm` | `0.375rem` | `0.375rem` | [RETUNE:radii/Codex-soft] |
| `--radius-xl` | `--radius-xl` | `0.75rem` | `0.75rem` | [SHIPPED] |
| `--readable-code-font-size` | `--readable-code-font-size` | `13px` | `13px` | [SHIPPED] |
| `--readable-code-line-height` | `--readable-code-line-height` | `1.625` | `1.625` | [SHIPPED] |
| `--scratch-code-font-family` | `--scratch-code-font-family` | `var(--font-mono)` | `var(--font-mono)` | [SHIPPED] |
| `--scratch-font-family` | `--scratch-font-family` | `var(--font-sans)` | `var(--font-sans)` | [SHIPPED] |
| `--scratch-font-size` | `--scratch-font-size` | `var(--text-message, var(--text-composer, 13px))` | `var(--text-message, var(--text-composer, 13px))` | [SHIPPED] |
| `--scratch-line-height` | `--scratch-line-height` | `var(--text-message--line-height, var(--text-composer--line-height, 21px))` | `var(--text-message--line-height, var(--text-composer--line-height, 21px))` | [SHIPPED] |
| `--scratch-list-marker-leading-space` | `--scratch-list-marker-leading-space` | `0.48em` | `0.48em` | [SHIPPED] |
| `--scratch-task-box-size` | `--scratch-task-box-size` | `0.82em` | `0.82em` | [SHIPPED] |
| `--shadow-composer` | `--shadow-composer` | `var(--shadow-subtle) /* legacy-alias */` | `var(--shadow-subtle) /* legacy-alias */` | [RETUNE:elevation/near-flat] |
| `--shadow-floating` | `--shadow-floating` | `var(--shadow-modal) /* legacy-alias */` | `var(--shadow-modal) /* legacy-alias */` | [RETUNE:elevation/near-flat] |
| `--shadow-floating-dark` | `--shadow-floating-dark` | `var(--shadow-modal) /* legacy-alias */` | `var(--shadow-modal) /* legacy-alias */` | [RETUNE:elevation/near-flat] |
| `--shadow-keystone` | — | — | — | [REMOVED] |
| `--shadow-popover` | `--shadow-popover` | `0 4px 12px rgb(0 0 0 / 0.12)` | `0 4px 12px rgb(0 0 0 / 0.12)` | [RETUNE:elevation/near-flat] |
| `--shadow-subtle` | `--shadow-subtle` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | [SHIPPED] |
| `--text-base` | — | — | — | [REMOVED] |
| `--text-base--line-height` | — | — | — | [REMOVED] |
| `--text-chat` | `--text-chat` | `13px` | `13px` | [RETUNE:type/closed-ramp] |
| `--text-chat--line-height` | `--text-chat--line-height` | `20px` | `20px` | [RETUNE:type/closed-ramp] |
| `--text-chat-meta` | `--text-chat-meta` | `calc(var(--text-chat, 13px) - 2px)` | `calc(var(--text-chat, 13px) - 2px)` | [RETUNE:type/closed-ramp] |
| `--text-composer` | `--text-composer` | `13px` | `13px` | [SHIPPED] |
| `--text-composer--line-height` | `--text-composer--line-height` | `20px` | `20px` | [RETUNE:type/closed-ramp] |
| `--text-hero` | `--text-hero` | `26px` | `26px` | [RETUNE:type/closed-ramp] |
| `--text-hero--line-height` | `--text-hero--line-height` | `34px` | `34px` | [RETUNE:type/closed-ramp] |
| `--text-lg` | — | — | — | [REMOVED] |
| `--text-lg--line-height` | — | — | — | [REMOVED] |
| `--text-message` | `--text-message` | `var(--text-composer)` | `var(--text-composer)` | [SHIPPED] |
| `--text-message--line-height` | `--text-message--line-height` | `var(--text-composer--line-height)` | `var(--text-composer--line-height)` | [SHIPPED] |
| `--text-sidebar-brand` | `--text-sidebar-brand` | `16px` | `16px` | [SHIPPED] |
| `--text-sidebar-brand--line-height` | `--text-sidebar-brand--line-height` | `23px` | `23px` | [SHIPPED] |
| `--text-sidebar-nav` | `--text-sidebar-nav` | `12px` | `12px` | [RETUNE:type/closed-ramp] |
| `--text-sidebar-nav--line-height` | `--text-sidebar-nav--line-height` | `17px` | `17px` | [RETUNE:type/closed-ramp] |
| `--text-sidebar-row` | `--text-sidebar-row` | `12px` | `12px` | [RETUNE:type/closed-ramp] |
| `--text-sidebar-row--line-height` | `--text-sidebar-row--line-height` | `17px` | `17px` | [RETUNE:type/closed-ramp] |
| `--text-sm` | — | — | — | [REMOVED] |
| `--text-sm--line-height` | — | — | — | [REMOVED] |
| `--text-title` | `--text-title` | `19px` | `19px` | [SHIPPED] |
| `--text-title--line-height` | `--text-title--line-height` | `24px` | `24px` | [RETUNE:type/closed-ramp] |
| `--text-ui` | `--text-ui` | `12px` | `12px` | [SHIPPED] |
| `--text-ui--line-height` | `--text-ui--line-height` | `17px` | `17px` | [SHIPPED] |
| `--text-ui-sm` | `--text-ui-sm` | `11px` | `11px` | [SHIPPED] |
| `--text-ui-sm--line-height` | `--text-ui-sm--line-height` | `15px` | `15px` | [SHIPPED] |
| `--text-workspace-title` | `--text-workspace-title` | `14px` | `14px` | [SHIPPED] |
| `--text-workspace-title--line-height` | `--text-workspace-title--line-height` | `21px` | `21px` | [RETUNE:type/closed-ramp] |
| `--text-xl` | — | — | — | [REMOVED] |
| `--text-xl--line-height` | — | — | — | [REMOVED] |
| `--text-xs` | — | — | — | [REMOVED] |
| `--text-xs--line-height` | — | — | — | [REMOVED] |
| `--workspace-shell-action-background` | `--workspace-shell-action-background` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-action-border` | `--workspace-shell-action-border` | `var(--color-border)` | `var(--color-border)` | [SHIPPED] |
| `--workspace-shell-action-font-size` | `--workspace-shell-action-font-size` | `var(--text-ui-sm)` | `var(--text-ui-sm)` | [SHIPPED] |
| `--workspace-shell-action-font-weight` | `--workspace-shell-action-font-weight` | `var(--font-weight-control)` | `var(--font-weight-control)` | [RETUNE:type/control-weight] |
| `--workspace-shell-action-foreground` | `--workspace-shell-action-foreground` | `var(--color-muted-foreground)` | `var(--color-muted-foreground)` | [SHIPPED] |
| `--workspace-shell-action-hover-background` | `--workspace-shell-action-hover-background` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--workspace-shell-action-hover-foreground` | `--workspace-shell-action-hover-foreground` | `var(--color-foreground)` | `var(--color-foreground)` | [SHIPPED] |
| `--workspace-shell-action-line-height` | `--workspace-shell-action-line-height` | `var(--text-ui-sm--line-height)` | `var(--text-ui-sm--line-height)` | [SHIPPED] |
| `--workspace-shell-action-radius` | `--workspace-shell-action-radius` | `0.5rem` | `0.5rem` | [SHIPPED] |
| `--workspace-shell-action-size` | `--workspace-shell-action-size` | `1.75rem` | `1.75rem` | [SHIPPED] |
| `--workspace-shell-header-height` | — | — | — | [REMOVED] |
| `--workspace-shell-tab-active-background` | `--workspace-shell-tab-active-background` | `var(--color-active) /* legacy-alias */` | `var(--color-active) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--workspace-shell-tab-active-border` | `--workspace-shell-tab-active-border` | `var(--color-border-heavy)` | `var(--color-border-heavy)` | [SHIPPED] |
| `--workspace-shell-tab-border` | — | — | — | [REMOVED] |
| `--workspace-shell-tab-content-gap` | `--workspace-shell-tab-content-gap` | `0.5rem` | `0.5rem` | [SHIPPED] |
| `--workspace-shell-tab-height` | `--workspace-shell-tab-height` | `1.75rem` | `1.75rem` | [SHIPPED] |
| `--workspace-shell-tab-hover-background` | `--workspace-shell-tab-hover-background` | `var(--color-hover) /* legacy-alias */` | `var(--color-hover) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--workspace-shell-tab-hover-border` | `--workspace-shell-tab-hover-border` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-tab-inactive-background` | `--workspace-shell-tab-inactive-background` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-tab-inactive-border` | `--workspace-shell-tab-inactive-border` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-tab-radius` | `--workspace-shell-tab-radius` | `0.375rem` | `0.375rem` | [RETUNE:radii/Codex-soft] |
| `--workspace-shell-tab-selected-background` | `--workspace-shell-tab-selected-background` | `var(--color-selected) /* legacy-alias */` | `var(--color-selected) /* legacy-alias */` | [RETUNE:state/overlay] |
| `--workspace-shell-tab-selected-border` | `--workspace-shell-tab-selected-border` | `var(--color-border-heavy)` | `var(--color-border-heavy)` | [SHIPPED] |



## 3. Final token schema and values added by the ruling

The 285-row table is exhaustive for current names. The following table adds
new canonical entries; compatibility aliases are listed separately. Semantic
text-role values at the default preset are defined in section 4.

| New canonical token | Dark | Light | Provenance |
| --- | --- | --- | --- |
| `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | `[RETUNE:state/overlay]` |
| `--color-active` | `color-mix(in oklab, #ffffff 5.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 5.2%, transparent)` | `[RETUNE:state/overlay]` |
| `--color-selected` | `color-mix(in oklab, #ffffff 3.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 3.2%, transparent)` | `[RETUNE:state/overlay]` |
| `--font-weight-control` | `450` | `450` | `[RETUNE:type/control-weight]` |
| `--tracking-heading` | `-0.01em` | `-0.01em` | `[RETUNE:type/closed-ramp]` |
| `--tracking-tight` | `-0.025em` | `-0.025em` | `[RETUNE:type/closed-ramp]` |
| `--radius-2xl` | `1rem` | `1rem` | `[RETUNE:radii/Codex-soft]` |
| `--shadow-modal` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | same | `[RETUNE:elevation/near-flat]` |
| `--duration-hover` | `120ms` | same | `[RETUNE:motion/roles]` |
| `--duration-enter` | `160ms` | same | `[RETUNE:motion/roles]` |
| `--duration-exit` | `120ms` | same | `[RETUNE:motion/roles]` |
| `--duration-disclosure` | `200ms` | same | `[RETUNE:motion/roles]` |
| `--duration-panel` | `240ms` | same | `[RETUNE:motion/roles]` |
| `--duration-emphasized` | `300ms` | same | `[RETUNE:motion/roles]` |
| `--ease-out-quint` | `cubic-bezier(0.19, 1, 0.22, 1)` | same | `[RETUNE:motion/roles]` |
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | same | `[RETUNE:motion/roles]` |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | same | `[RETUNE:motion/roles]` |
| `--ease-linear` | `linear` | same | `[RETUNE:motion/roles]` |
| `--activity-stream-reveal-fade` | `320ms` | same | `[SHIPPED:motion/authority]` |
| `--activity-update-ready-sweep` | `700ms` | same | `[SHIPPED:motion/authority]` |
| `--z-base` / `--z-raised` / `--z-sticky` | `0` / `10` / `20` | same | `[RETUNE:layering/scale]` |
| `--z-overlay` / `--z-popover` | `40` / `50` | same | `[RETUNE:layering/scale]` |
| `--z-toast` / `--z-tooltip` / `--z-top` | `60` / `70` / `80` | same | `[RETUNE:layering/scale]` |
| `--size-icon-button-sm` | `1.25rem` | same | `[RETUNE:icons/control-boxes]` |
| `--size-icon-button-md` | `1.5rem` | same | `[RETUNE:icons/control-boxes]` |
| `--size-icon-button-lg` | `1.75rem` | same | `[RETUNE:icons/control-boxes]` |
| `--color-compute-target-slate` | `#6b7280` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-red` | `#b04444` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-orange` | `#b56b3a` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-amber` | `#b59a3a` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-green` | `#4a8d5a` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-teal` | `#3c8a86` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-blue` | `#4a72b5` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-purple` | `#7a5ab0` | same | `[SHIPPED:raw-hex-move]` |
| `--color-compute-target-pink` | `#b0567c` | same | `[SHIPPED:raw-hex-move]` |
| `--color-window-control-close` | `#ff5f57` | same | `[SHIPPED:raw-hex-move]` |
| `--color-window-control-minimize` | `#febc2e` | same | `[SHIPPED:raw-hex-move]` |

### 3.1 Explicit live compatibility alias set

Every value below is emitted with the shown tag in generated CSS:

| Historical live name | Exact generated value |
| --- | --- |
| `--color-accent` | `var(--color-hover) /* legacy-alias */` |
| `--color-composer-border` | `var(--color-border) /* legacy-alias */` |
| `--color-composer-control-hover` | `var(--color-hover) /* legacy-alias */` |
| `--color-list-hover` | `var(--color-hover) /* legacy-alias */` |
| `--color-popover-accent` | `var(--color-hover) /* legacy-alias */` |
| `--color-popover-ring` | `var(--color-border) /* legacy-alias */` |
| `--color-sidebar-accent` | `var(--color-hover) /* legacy-alias */` |
| `--color-sidebar-border` | `var(--color-border) /* legacy-alias */` |
| `--shadow-composer` | `var(--shadow-subtle) /* legacy-alias */` |
| `--shadow-floating` | `var(--shadow-modal) /* legacy-alias */` |
| `--shadow-floating-dark` | `var(--shadow-modal) /* legacy-alias */` |
| `--workspace-shell-action-hover-background` | `var(--color-hover) /* legacy-alias */` |
| `--workspace-shell-tab-active-background` | `var(--color-active) /* legacy-alias */` |
| `--workspace-shell-tab-hover-background` | `var(--color-hover) /* legacy-alias */` |
| `--workspace-shell-tab-selected-background` | `var(--color-selected) /* legacy-alias */` |

`--color-border` is canonical, not an alias.

## 4. Closed type ramp, appearance ladder, and migration law

### 4.1 Closed semantic type ramp

#### 4.1.1 Default-preset metrics

Every type token owns all three metrics. Tailwind's generated `text-*`
utility must therefore set `font-size`, `line-height`, and `letter-spacing`
from the same token family (`--text-X`, `--text-X--line-height`,
`--text-X--letter-spacing`).

| Ramp step | Default metrics | Semantic roles / legal classes |
| --- | --- | --- |
| meta | `11px / 15px / 0.01em` | `text-ui-sm` |
| compact | `12px / 17px / 0.005em` | `text-ui`, `text-sidebar-nav`, `text-sidebar-row` |
| reading/body | `13px / 20px / 0` | `text-body`, `text-chat`, `text-message`, `text-composer` |
| body emphasis | `14px / 21px / -0.005em` | `text-body-emphasis`, `text-workspace-title` |
| heading | `16px / 23px / -0.01em` | `text-heading`, `text-sidebar-brand` |
| title | `19px / 24px / -0.025em` | `text-title` |
| hero | `26px / 34px / -0.025em` | `text-hero` |

The body-step tracking values through 14px are ruled verbatim. Claude approved
`--tracking-heading: -0.01em` for 16px and the shared
`--tracking-tight: -0.025em` for both 19px title and 26px hero. Generated
role letter-spacing properties resolve through those named tracking tokens;
there is no independent third title-tracking value. The appearance table
stores the resolved string (`-0.01em` or `-0.025em`) because it writes runtime
root overrides. CSS drift tests normalize a generated
`var(--tracking-heading)` / `var(--tracking-tight)` reference through the
same generated block before comparing it with that resolved appearance value.

`text-message` is a generated CSS alias of the shared reading metrics
(currently emitted through `text-composer`), not an independent appearance
slot. `text-sidebar-nav` and `text-sidebar-row` are
semantic aliases of compact. `text-workspace-title` is an alias of emphasis,
and `text-sidebar-brand` is an alias of compact title. Aliases still receive
their own CSS variables because current components and the runtime preference
writer address them by role; their values must be generated from the same
ramp entry rather than copied literals.

Delete the generic slots and their variables completely:

```text
xs, sm, base, lg, xl
--text-xs, --text-sm, --text-base, --text-lg, --text-xl
and every corresponding --line-height / --letter-spacing property
```

Add `body`, `bodyEmphasis`, and `heading` as real `UiFontScale` slots. Retain
the existing semantic slots `uiSm`, `ui`, `chat`, `composer`,
`workspaceTitle`, `title`, `hero`, `sidebarNav`, `sidebarRow`, and
`sidebarBrand`.

#### 4.1.2 Font and weight

- `typography.fontSans` and generated `--font-sans` become:
  `"Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif`.
- `dom.css :root` becomes `font-family: var(--font-sans)`. It must not contain
  a second Inter-leading stack.
- The existing Geist variable-sans `@font-face` remains the load owner.
  `Geist Mono` and `--font-mono` remain unchanged.
- The characteristic interactive-control weight is `450`. Controls/rows
  currently authored at `430` or `500` migrate to the generated
  `--font-weight-control: 450`; content emphasis and authored headings do not
  get flattened to control weight. The exact `430` callsites in this retune
  are `CloudChatModelConfigControl`, `SidebarRowSurface`, `SettingsMenu`, and
  `EnvironmentSearchSelect`; the exact `500` owners are the generated
  workspace-shell action weight and `.right-panel-tab-system`. The shipped
  `html, body { font-weight: 430; }` is base prose rendering, not an
  interactive-control weight, and remains unchanged.
- The explicit `font-medium`, `font-semibold`, uppercase tracking, and
  `tracking-*` classes remain author overrides where they communicate
  hierarchy. In their absence, the semantic text utility supplies the ramp's
  letter-spacing.

### 4.2 Appearance re-anchor: exact arrays and formulas

Keep the existing eight ids, `scaleRecord`, root rewrite, dataset attributes,
preference persistence, independent readable-code selection, and
`WINDOW_ZOOM_SCALES` exactly as they are. The source remains an authored
anchor array plus deterministic role formulas; do not replace it with a
multiplier model.

#### 4.2.1 Anchors

```ts
const READING_FONT_SIZES =
  [11, 11.5, 12, 13, 14, 15, 16, 17] as const;

const HERO_FONT_SIZES =
  [23, 24, 25, 26, 28, 29.5, 31, 32.5] as const;
```

`READING_FONT_SIZES` is the current `COMPOSER_FONT_SIZES` array, renamed for
ownership clarity; no numeric rung changes. `HERO_FONT_SIZES.default` is the
only hero anchor change (`26.5 -> 26`); the other seven current hero anchors
survive.

Remove `XS_REM_SCALES`, `SM_REM_SCALES`, `BASE_REM_SCALES`,
`LG_LINE_HEIGHTS`, `XL_LINE_HEIGHTS`, `rem`, `remScale`, and
`remTokenScale`. The closed UI ramp is authored in px. Readable code remains
its separate current CSS/number bridge.

#### 4.2.2 Formula

`TextTokenScale` gains `letterSpacing: string`. `pixelScale` accepts all
three metrics. With `reading = READING_FONT_SIZES[index]`:

```ts
return {
  uiSm:          pixelScale(reading - 2, reading + 2,  "0.01em"),
  ui:            pixelScale(reading - 1, reading + 4,  "0.005em"),
  chat:          pixelScale(reading,     reading + 7,  "0"),
  composer:      pixelScale(reading,     reading + 7,  "0"),
  body:          pixelScale(reading,     reading + 7,  "0"),
  bodyEmphasis:  pixelScale(reading + 1, reading + 8,  "-0.005em"),
  workspaceTitle:pixelScale(reading + 1, reading + 8,  "-0.005em"),
  heading:       pixelScale(reading + 3, reading + 10, "-0.01em"),
  title:         pixelScale(16 + index,  21 + index,   "-0.025em"),
  hero:          pixelScale(hero,        hero + 8,     "-0.025em"),
  sidebarNav:    pixelScale(reading - 1, reading + 4,  "0.005em"),
  sidebarRow:    pixelScale(reading - 1, reading + 4,  "0.005em"),
  sidebarBrand:  pixelScale(reading + 3, reading + 10, "-0.01em"),
};
```

This deliberately changes two current derivations so the ruled target is
actually reachable:

1. `chat.fontSize` changes from `composerAnchor - 2` to `reading`. Leaving
   the old offset would produce 11px at default and contradict the ruled
   13px chat step.
2. `chat.lineHeight` and `composer.lineHeight` change to `reading + 7`.
   The current test invariant `chat.lineHeight === composer.fontSize + 6`
   yields 19px at default and contradicts the ruled 13/20 step. Replace it
   with the equally strong invariant
   `chat.lineHeight === composer.fontSize + 7`; do not delete or loosen the
   relational test.

#### 4.2.3 Expanded UI table

Order is `xxsmall, xsmall, small, default, large, xlarge, xxlarge,
xxxlarge`. Tracking is role-stable in `em` at every preset.

| Role | font sizes (px) | line heights (px) | tracking |
| --- | --- | --- | --- |
| `uiSm` | `9, 9.5, 10, 11, 12, 13, 14, 15` | `13, 13.5, 14, 15, 16, 17, 18, 19` | `0.01em` |
| `ui` | `10, 10.5, 11, 12, 13, 14, 15, 16` | `15, 15.5, 16, 17, 18, 19, 20, 21` | `0.005em` |
| `chat` | `11, 11.5, 12, 13, 14, 15, 16, 17` | `18, 18.5, 19, 20, 21, 22, 23, 24` | `0` |
| `composer` | `11, 11.5, 12, 13, 14, 15, 16, 17` | `18, 18.5, 19, 20, 21, 22, 23, 24` | `0` |
| `body` | `11, 11.5, 12, 13, 14, 15, 16, 17` | `18, 18.5, 19, 20, 21, 22, 23, 24` | `0` |
| `bodyEmphasis` | `12, 12.5, 13, 14, 15, 16, 17, 18` | `19, 19.5, 20, 21, 22, 23, 24, 25` | `-0.005em` |
| `workspaceTitle` | `12, 12.5, 13, 14, 15, 16, 17, 18` | `19, 19.5, 20, 21, 22, 23, 24, 25` | `-0.005em` |
| `heading` | `14, 14.5, 15, 16, 17, 18, 19, 20` | `21, 21.5, 22, 23, 24, 25, 26, 27` | `-0.01em` |
| `title` | `16, 17, 18, 19, 20, 21, 22, 23` | `21, 22, 23, 24, 25, 26, 27, 28` | `-0.025em` |
| `hero` | `23, 24, 25, 26, 28, 29.5, 31, 32.5` | `31, 32, 33, 34, 36, 37.5, 39, 40.5` | `-0.025em` |
| `sidebarNav` | `10, 10.5, 11, 12, 13, 14, 15, 16` | `15, 15.5, 16, 17, 18, 19, 20, 21` | `0.005em` |
| `sidebarRow` | `10, 10.5, 11, 12, 13, 14, 15, 16` | `15, 15.5, 16, 17, 18, 19, 20, 21` | `0.005em` |
| `sidebarBrand` | `14, 14.5, 15, 16, 17, 18, 19, 20` | `21, 21.5, 22, 23, 24, 25, 26, 27` | `-0.01em` |

#### 4.2.4 Readable code and invariants

`READABLE_CODE_FONT_SCALES` continues to use `READING_FONT_SIZES`:

```ts
monacoFontSize = reading
monacoLineHeight = reading + 8
diffsFontSize = `${reading}px`
diffsLineHeight = "calc(var(--diffs-font-size) * 1.8)"
codeFontSize = `${reading}px`
codeLineHeight = "1.625"
```

Required invariants:

- every font-size and line-height ladder remains monotonic;
- `chat` and `composer` are identical at every preset;
- `body`, `chat`, and `composer` are identical at every preset;
- `chat.lineHeight === composer.fontSize + 7` at every preset;
- `bodyEmphasis` and `workspaceTitle` are identical at every preset;
- `workspaceTitle.fontSize === composer.fontSize + 1`;
- `workspaceTitle.lineHeight === composer.lineHeight + 1`;
- readable-code font size equals `composer.fontSize` for the same id;
- all semantic aliases have exact metric equality with their owning ramp
  step;
- `WINDOW_ZOOM_SCALES` is untouched.

### 4.3 Exhaustive generic-class migration law

#### 4.3.1 Precedence

For every production, test, fixture, and playground occurrence of
`text-xs`, `text-sm`, `text-base`, `text-lg`, or `text-xl`, apply the first
matching rule:

1. If the class sizes an owned SVG/glyph, use the icon law in 4.3.3.
2. If the node is actual editor/diff/code content whose size follows the
   readable-code preference, use `text-readable-code` (a sanctioned utility
   backed by `--readable-code-font-size` and
   `--readable-code-line-height`). Monospace metadata remains a UI role.
3. Use the semantic context matrix in 4.3.2. The original generic class never
   decides semantics.
4. If context remains genuinely ambiguous, apply the DEFAULT mapping in
   4.3.4. Add the stable escalation tag in 4.3.5 only when that deterministic
   fallback looks visually or contextually wrong.

The frozen source baseline across the four migration roots
(`ui`, `product-ui`, `product-client`, and Desktop TS/TSX) is **756 literal
occurrences**: `text-xs=330`, `text-sm=341`, `text-base=67`, `text-lg=12`,
and `text-xl=6`. This reconciles the older target/scout prose counts to the
actual commit. Phase 5 reports the final zero count, except for the gate's own
explicit negative fixtures.

Keep responsive/selector prefixes on the replacement:
`sm:text-sm -> sm:text-ui`, `[&_*]:text-base -> [&_*]:text-chat`, etc.
Remove an adjacent `leading-*` only when it was compensating for the deleted
generic token; an intentionally tighter single-line control (`leading-none`)
or authored prose override remains. Preserve authored weight and tracking
overrides unless the component is one of the control-weight retunes.

#### 4.3.2 Context matrix

Every cell is an exact replacement. The repeated columns are intentional:
semantic context, not the old accidental pixel value, is law.

| Usage context | `text-xs` | `text-sm` | `text-base` | `text-lg` | `text-xl` |
| --- | --- | --- | --- | --- | --- |
| metadata, caption, helper, secondary label, timestamp, count, eyebrow, validation hint, muted empty/loading detail | `text-ui-sm` | `text-ui-sm` | `text-ui-sm` | `text-ui-sm` | `text-ui-sm` |
| primary compact UI: button/trigger/tab/menu/popover item/input/field label/list row/card label/status or alert body | `text-ui` | `text-ui` | `text-ui` | `text-ui` | `text-ui` |
| sidebar primary nav or repository-group label | `text-sidebar-nav` | `text-sidebar-nav` | `text-sidebar-nav` | `text-sidebar-nav` | `text-sidebar-nav` |
| sidebar workspace/thread/tree row or sidebar section header | `text-sidebar-row` | `text-sidebar-row` | `text-sidebar-row` | `text-sidebar-row` | `text-sidebar-row` |
| transcript chrome, tool/action row, plan/work-history row, chat notice, chat status | `text-chat` | `text-chat` | `text-chat` | `text-chat` | `text-chat` |
| assistant/user message prose or sent-message body | `text-message` | `text-message` | `text-message` | `text-message` | `text-message` |
| composer textarea/input or typed prompt body | `text-composer` | `text-composer` | `text-composer` | `text-composer` | `text-composer` |
| ordinary body/prose outside transcript/composer surfaces | `text-body` | `text-body` | `text-body` | `text-body` | `text-body` |
| body emphasis, prominent value, account/workspace name outside a title surface | `text-body-emphasis` | `text-body-emphasis` | `text-body-emphasis` | `text-body-emphasis` | `text-body-emphasis` |
| workspace name in global chrome/header | `text-workspace-title` | `text-workspace-title` | `text-workspace-title` | `text-workspace-title` | `text-workspace-title` |
| compact card/dialog title or level-three heading | `text-heading` | `text-heading` | `text-heading` | `text-heading` | `text-heading` |
| page/settings/modal primary title | `text-title` | `text-title` | `text-title` | `text-title` | `text-title` |
| home/marketing hero only | `text-hero` | `text-hero` | `text-hero` | `text-hero` | `text-hero` |
| sidebar brand wordmark only | `text-sidebar-brand` | `text-sidebar-brand` | `text-sidebar-brand` | `text-sidebar-brand` | `text-sidebar-brand` |
| actual editor/diff/code content following the code-size preference | `text-readable-code` | `text-readable-code` | `text-readable-code` | `text-readable-code` | `text-readable-code` |

Clarifications that make the matrix deterministic:

- Color does not determine role. A destructive alert body is still
  `text-ui`; its helper is `text-ui-sm`.
- `font-mono` does not determine role. A repository path caption is
  `font-mono text-ui-sm`; only editable/rendered code uses
  `text-readable-code`.
- Heading tags do not determine role. A compact row `<h2>` is
  `text-heading`; the page heading is `text-title`.
- A generic class inherited from a container is classified by the container's
  content role, then replaced once on that container.
- In chat paths, meta labels/timestamps remain `text-ui-sm`; message prose,
  transcript chrome, and composer text use their explicit rows above.
- For conditional compact/regular branches, use
  `compact ? "text-ui-sm" : "text-ui"` unless the component belongs to a more
  specific chat/sidebar/title role.

#### 4.3.3 Icon/glyph law

Generic `text-*` utilities on an owned glyph are never migrated to another
text role blindly. Use one of these exact pairings so the `em` tier has an
explicit semantic base:

| Glyph context | Exact classes at the sizing owner | Default visible box |
| --- | --- | --- |
| status dot | `icon-status` plus the owning role (`text-ui`, `text-chat`, or `text-sidebar-row`) | existing optical dot ratio |
| compact/meta-row glyph | `text-ui icon-compact` | `12px` |
| default glyph paired with reading text | `text-chat icon-paired` | `16px` |
| icon-only control glyph | `text-ui icon-control` | `16px` |
| sanctioned row action | primitive owns `text-ui icon-control`; caller supplies neither text nor size class | `16px` glyph in `28px` box |

For example, current `icon-paired text-sm` sites in automation/workspace
inventory glyphs become `text-chat icon-paired`; current
`icon-status text-sm` loses the generic class and receives the row's semantic
base. A component may put the text-role class on a wrapper or directly on the
glyph, but it must not rely on `body` inheritance when exact glyph geometry is
part of the contract.

Icon tier values:

```text
--icon-status:  0.55em       (unchanged)
--icon-compact: 1em          (unchanged)
--icon-paired:  1.230769em   (was 1.15em; 16 / 13)
--icon-control: 1.333333em   (unchanged; 16 / 12)
--icon-large:   1.666667em   (unchanged)
--icon-display: 2em          (unchanged)
```

#### 4.3.4 DEFAULT mapping for unclassifiable sites

If inspection cannot establish a context, apply this reviewer-approved
deterministic table at the `default` appearance preset:

| Removed class | DEFAULT replacement | Default result | Current result before retune |
| --- | --- | --- | --- |
| `text-xs` | `text-ui-sm` | `11/15` | `7.5/12` |
| `text-sm` | `text-ui` | `12/17` | `9/15` |
| `text-base` | `text-body` | `13/20` | `10/15` |
| `text-lg` | `text-body` | `13/20` | `13/19` |
| `text-xl` | `text-heading` | `16/23` | `17/26` |

This is the only coherent meaning of "same-rendered-size fallback" under the
ruled closed ramp: the replacement renders the corresponding new ramp rung
at `default`. Literal pre-change pixel preservation is impossible for four
of five generic steps because `7.5`, `9`, `10`, and `17px` are illegal in
the new ramp; retaining them would violate the closed-ramp ruling.

#### 4.3.5 Stable escalation tag

Use this exact grep-stable substring only when the deterministic fallback
looks visually or contextually wrong to the migrating agent:

```text
ui-foundation-escalation: <why the deterministic fallback looks wrong>
```

In JSX use `{/* ui-foundation-escalation: ... */}`. In a TS class constant
use `// ui-foundation-escalation: ...`. The generic class is still removed
and the DEFAULT replacement is still applied. Correct-looking fallback sites
receive no comment. Phase-5 reports must list every remaining tag under its
class-level changelog id; migration agents never invent an eighth ramp value.

Tests/comments that merely mention an old class are updated to the semantic
name they assert. Negative gate fixtures may keep the forbidden string only
inside the gate's own explicit rejection fixture.

### 4.4 Exact test-pin updates

#### 4.4.1 `appearance.test.ts`

Keep every current test category. Update exact pins as follows.

1. `TextTokenScale` now includes `letterSpacing`; monotonic checks still run
   only over `fontSize` and `lineHeight`.
2. Replace the `small` exact subset with:

```ts
expect(UI_FONT_SCALES.small).toMatchObject({
  ui: { fontSize: "11px", lineHeight: "16px", letterSpacing: "0.005em" },
  chat: { fontSize: "12px", lineHeight: "19px", letterSpacing: "0" },
  composer: { fontSize: "12px", lineHeight: "19px", letterSpacing: "0" },
  title: { fontSize: "18px", lineHeight: "23px", letterSpacing: "-0.025em" },
});
```

3. Replace the full `default` equality pin with:

```ts
expect(UI_FONT_SCALES.default).toEqual({
  uiSm: { fontSize: "11px", lineHeight: "15px", letterSpacing: "0.01em" },
  ui: { fontSize: "12px", lineHeight: "17px", letterSpacing: "0.005em" },
  chat: { fontSize: "13px", lineHeight: "20px", letterSpacing: "0" },
  composer: { fontSize: "13px", lineHeight: "20px", letterSpacing: "0" },
  body: { fontSize: "13px", lineHeight: "20px", letterSpacing: "0" },
  bodyEmphasis: { fontSize: "14px", lineHeight: "21px", letterSpacing: "-0.005em" },
  workspaceTitle: { fontSize: "14px", lineHeight: "21px", letterSpacing: "-0.005em" },
  heading: { fontSize: "16px", lineHeight: "23px", letterSpacing: "-0.01em" },
  title: { fontSize: "19px", lineHeight: "24px", letterSpacing: "-0.025em" },
  hero: { fontSize: "26px", lineHeight: "34px", letterSpacing: "-0.025em" },
  sidebarNav: { fontSize: "12px", lineHeight: "17px", letterSpacing: "0.005em" },
  sidebarRow: { fontSize: "12px", lineHeight: "17px", letterSpacing: "0.005em" },
  sidebarBrand: { fontSize: "16px", lineHeight: "23px", letterSpacing: "-0.01em" },
});
```

4. In "extends the upper rung", replace the removed `base` comparisons with
   `ui`; retain `xxxlarge.composer.fontSize === "17px"` and readable-code
   `=== 17`.
5. Strengthen the workspace-title test to exact `+1` font and line metrics,
   not only `>`.
6. Replace the glyph equality pin's paired value:
   `"--icon-paired": "1.230769em"`. All other tier values stay verbatim.
7. Retain readable-code/composer equality and all monotonic checks.
8. Replace small/default/large distinctness checks on removed `base` with
   `ui`.
9. Rename the chat-line test and replace `+ 6` with `+ 7`. Add exact lower
   pins:
   `xxsmall.uiSm.fontSize === "9px"`,
   `xxsmall.chat.fontSize === "11px"`,
   `xxsmall.chat.lineHeight === "18px"`, and readable Monaco `=== 11`.
10. Add exact equality loops for `body === chat === composer`,
    `bodyEmphasis === workspaceTitle`,
    `ui === sidebarNav === sidebarRow`, and
    `heading === sidebarBrand`, including tracking.

#### 4.4.2 `appearance-css-drift.test.ts`

1. After the design prebuild, parse the generated
   `apps/packages/design/dist/theme.css`, not the now-token-free
   `dom.css`/`product.css`, for the canonical `@theme` text/icon/default-code
   values. Structural equality includes every `--letter-spacing` key emitted
   by `DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES`; normalize named tracking
   `var(...)` references through the same generated block before comparison.
2. Update the workspace ordering assertion to exact default metrics:
   workspace `14/21` and composer `13/20`.
3. Replace the old `typography.size`/`typography.lineHeight` loop with a loop
   over the semantic generated table and compare all three values. No
   `stockSizes` exemption remains because the five stock ids are gone.
4. `TEXT_SIZE_TOKEN_IDS` exact set becomes:

```ts
[
  "ui-sm", "ui", "chat", "composer", "body", "workspace-title",
  "body-emphasis", "heading", "title", "hero", "sidebar-nav", "sidebar-row",
  "sidebar-brand", "message", "readable-code",
]
```

`message` and `readable-code` may be sanctioned utility aliases rather than
appearance slots, but `twMerge` must preserve them against a text-color
class. Compare `TEXT_SIZE_TOKEN_IDS` directly with this exact array; do not
derive it from every `--text-*` key. If a generated-token discovery helper is
also retained, it selects only base `--text-<role>` declarations and
explicitly rejects the `--line-height` / `--letter-spacing` suffixes.
5. Replace the old two-authored-CSS conflict check with an assertion that
   `dom.css` and `product.css` declare no global theme tokens, and keep exact
   generated-theme-to-appearance table equality. Do not weaken either
   boundary.
6. Right-panel pins remain on `--text-ui-sm` and `--icon-control`; update the
   control weight expectation from literal `500` to
   `var(--font-weight-control)`.
7. Glyph-default equality updates only `--icon-paired` to `1.230769em`.
8. Code CSS pins remain unchanged (`13px` default code size).
9. Add an assertion that `dom.css :root` uses
   `font-family: var(--font-sans)` and the generated theme's `--font-sans`
   begins with `"Geist"`.

#### 4.4.3 Other exact gates/pins

- `AuthGate.test.tsx` continues to enumerate every generated
  `DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES` key; it therefore automatically
  verifies root application of letter-spacing. Keep the exact before/after
  loops.
- Add a CI-enforced `check_appearance_scaling.py` rule rejecting production
  `text-xs|text-sm|text-base|text-lg|text-xl`; its only allowlist is the
  guard's own rejection fixture. Add one accepting fixture for every legal
  class in `TEXT_SIZE_TOKEN_IDS`.
- Add an exact source-shape test that neither generated theme output nor
  `UiFontScale` declares the five removed generic ids.
- Update negative transcript assertions/comments that say "not text-xs" to
  assert the intended positive semantic class, while retaining the negative
  generic-class assertion where it protects a regression.



## 5. State, radii, shadows, motion, layering, raw hex, row actions, and spacing

### 5.1 State

Use foreground-relative mixes so the ruled translucent-white dark-mode model
also remains visible in light mode:

| Token | Dark rendered value | Light rendered value | Generated class |
| --- | --- | --- | --- |
| `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | `bg-hover` |
| `--color-active` | `color-mix(in oklab, #ffffff 5.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 5.2%, transparent)` | `bg-active` |
| `--color-selected` | `color-mix(in oklab, #ffffff 3.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 3.2%, transparent)` | `bg-selected` |
| `--color-border` | `color-mix(in oklab, #ffffff 8.4%, transparent)` | `color-mix(in oklab, var(--color-foreground) 8.4%, transparent)` | `border-border` |

Interaction meaning is closed: `hover` is pointer/focus hover, `active` is
pressed or an open transient control, and `selected` is committed selection.
Static tinted panels are not states; use the owning surface token.

Every distinct state-like census literal maps as follows:

| Census literal/value | Exact replacement | Interpretation / exception |
| --- | --- | --- |
| `hover:bg-foreground/[0.02]` | `hover:bg-hover active:bg-active` | Harness auth option. |
| `hover:bg-foreground/[0.03]` | `hover:bg-hover active:bg-active` | Collapsible and selection rows. |
| `hover:bg-foreground/[0.04]` | `hover:bg-hover active:bg-active` | Automation/workspace rows and filters. |
| `hover:bg-foreground/[0.045]` | `hover:bg-hover active:bg-active` | Prompt attachment and inventory-group hover. |
| `hover:bg-foreground/[0.06]` (button found at the row-action owner in `AutomationInventoryList`) | `hover:bg-hover active:bg-active` | Row-action button. |
| `hover:bg-foreground/[0.07]` | `hover:bg-hover active:bg-active` | Cloud chat header control; its resting `.045` fill becomes `bg-surface-control`. |
| `hover:bg-foreground/[0.075] focus:bg-foreground/[0.075]` | `hover:bg-hover focus:bg-active` | Plan-handoff editor: hover is hover, focused editing is active. |
| overlay `hover:bg-foreground/5`, `hover:bg-foreground/8`, `hover:bg-foreground/10`, or `hover:!bg-foreground/10` | same-prefix `hover:bg-hover` | Remaining 5–10% neutral overlay interactions. Solid-button ink modulation at `hover:bg-foreground/80` or `/90` is not an overlay and remains unchanged. |
| `hover:bg-accent`, `hover:bg-accent/40`, `hover:bg-accent/50`, `hover:bg-accent/60`, `hover:bg-accent/70`, `hover:bg-accent/80`, and sidebar equivalents | `hover:bg-hover active:bg-active` with the same selector prefix | Interaction states do not retain opacity variants of the historical alias. |
| `focus:bg-accent`, `focus-visible:bg-accent`, and sidebar equivalents | `focus:bg-hover` / `focus-visible:bg-hover` | Roving focus mirrors hover unless the control is open. |
| selected `bg-foreground/[0.075]` / `bg-foreground/[0.05]` / `bg-foreground/[0.035]` / `bg-foreground/5` / active `bg-sidebar-accent` | `bg-selected` | Committed tab/row/section/toggle selection. |
| open-state `bg-accent` / `data-[state=open]:bg-accent` / `data-[state=open]:bg-sidebar-accent` | `data-[state=open]:bg-active` | Transient open control, not selection. |
| `hover:bg-foreground/5 data-[state=open]:bg-foreground/5` | `hover:bg-hover data-[state=open]:bg-active` | `SettingsMenu` neutral trigger. |
| static `bg-foreground/[0.018]` or `bg-foreground/[0.025]` | `bg-surface-elevated-secondary` | Markdown stripe and plan-handoff modal footer. |
| static `bg-foreground/[0.02]`, `bg-foreground/[0.03]`, or `bg-foreground/[0.04]` panel | `bg-surface-elevated-secondary` | Static settings, billing, transcript-tool, and notice surfaces are not interaction states. |
| static `bg-foreground/[0.028]` control | `bg-surface-control` | Resting `WorkspacesSurface` icon-control fill. |
| static `bg-foreground/[0.045]` control/chip | `bg-surface-control` | Cloud-chat header control and status chip. |
| static diff-panel `bg-foreground/[0.0475]` | `bg-diff-panel-surface` | `TurnDiffPanel` and `TranscriptPatchTurnDiffPanel` use the existing diff surface role. |
| static `bg-foreground/[0.035]` | `bg-surface-elevated-secondary` | Static automation panels, segmented-control trough, and Markdown table header; the active calendar section is the selected exception above. |
| `bg-foreground/[0.042]` | `bg-surface-elevated-secondary` | Static automation/workspace group header; not a state. |
| indicator `bg-foreground/[0.18]` / `bg-foreground/[0.6]` | unchanged | `AutomationSurface` binary indicator strength is glyph/status feedback, not a surface overlay. |
| static `bg-accent`, `bg-accent/50`, `bg-sidebar-accent`, and opacity variants | owning `bg-surface-control` or `bg-surface-elevated-secondary` role from the exhaustive table | Historical state aliases are not static-surface tokens. |
| `bg-card/95`, `bg-popover`, `bg-sidebar-background`, `bg-surface-control`, `bg-transparent` | unchanged semantic surface class | Not state literals. |
| `bg-warning/5`, `bg-destructive/5`, `bg-primary/5`, `bg-foreground/5` | retain only where the alpha is a semantic tone/surface tint and no interaction/selection exception above applies | Do not rewrite these to interaction state tokens merely because the numeric alpha is similar. |
| `opacity-0` → `opacity-100` reveal pairs | primitive-owned reveal classes (section 5.6) | Visibility state, not a color state. |
| `opacity-50`, `opacity-80` | retain only for disabled/drag feedback; remove from row-action resting style | The new row action uses semantic ink rather than a permanently half-opacity glyph. |

#### 5.1.1 Exact live historical-accent consumer disposition

This census is required before the aliases in section 3.1 are emitted.
Migrate every production class below; no `bg-accent`,
`bg-sidebar-accent`, hover/focus/open variant of either name, or opacity
variant of either name remains in production source. Tests assert the
canonical replacement. Playground specimens follow the same row as the
primitive or product surface they demonstrate.

| Final role | Exact current consumers |
| --- | --- |
| foreground-alpha interactions → `hover:bg-hover active:bg-active` (or the exact focus/open rule in the literal table) | `.02`: `HarnessAuthSection:351`; `.03`: `CollapsibleSummaryRow:21`, `SelectionRow:37`; `.04`: `workspace-chrome.ts:134`, `AutomationCalendarView:60,168`, `AutomationInventoryList:93`, `AutomationRunsList:71`, `AutomationSurface:171,198`, `WorkspaceInventoryRow:34`; `.045`: `PromptAttachmentCard:65`, `WorkspaceInventoryGroup:73`; `.05`: `AgentsPlaygroundPage:66`, `SettingsMenu:47`, `CloudEnvironmentList:88`, `NewChatSurface:204`, and `RepoActionsPane:279`; `.06`: `AutomationInventoryList:288`, `WorkspacesSurface:275`; `.07`: `CloudChatHeader:141` (resting `.045` becomes `bg-surface-control`); `.075`: `PlanHandoffDialog:115` (`focus:bg-active`); `.08`: `TabGroupPill:30`; `.10`: `NewChatSurface:333`, `UpdateToastPresenter:234`, `WorktreeStorageSection:151,171`, `PlanHandoffDialog:96`, `AppearancePane:100,114`, and `SidebarUpdatePill:125,126`. Solid `hover:bg-foreground/80` and `hover:bg-foreground/90` button treatments remain. |
| `hover:bg-hover active:bg-active` (preserve `enabled:`, `group-*`, and other selector prefixes) | `SidebarAccountFooter:107`; `SidebarConsumptionCard:240`; `SidebarHelpFooter:47`; `FileDiffCard:67`; `HomeOnboardingCards:50`; `HomeTargetPickerParts:121`; `OrganizationBudgetsPane:320`; `HarnessAllModelsSection:298`; `SettingsScreen:146`; `PlanReferenceAttachmentCard:34,36,37,71`; `ComposerOptionRow:55`; `ComposerSlashCommandSearch:125`; `PromptRecoveryPanel:39`; `UserInputCard:337`; `TurnMetadata:69`; `FileTreeRow:48`; `GitPanelReviewChrome:40`; `GitReviewEmptyState:73`; `GitReviewFileSectionShell:9`; `GitReviewTargetSelector:106`; `PaneFileTree:136`; `KeyboardShortcutsDialog:24`; both `ChromeWorkspaceTab` close controls at `103,167`; `ClosedChatTabsMenu:27`; `TerminalCommandFloatingAction:36`; `TerminalTopBar:74,98`; `AddRepoFlow:173`; `CloudRepoPicker:251`; `SecretEditorDialog:58`; `ModelTable:161`; `RepoPicker:44`; `WorkspacesCommandList:133`; `AlertDialog:144`; `ListRow:26`; all hover variants in `PaneIconButton:6`, `SidebarNavItem:27`, `SidebarRowSurface:30`, `AuthProviderButton:31`, `Button:27,29,31,37`, `GridTile:17`, `IconButton:22,24`, `PillControlButton:46,47`, `PopoverMenuItem:37`, `RadioCardGroup:48`, `SegmentedControl:46`, `Toggle:20`; the non-selected branch of `EnvironmentSearchSelect:60`; and the explicit foreground-alpha hover sites listed in the table above. |
| `focus:bg-hover` / `focus-visible:bg-hover` | `ComposerSlashCommandSearch:125`, `AddRepoFlow:173`, `HomeNextScreen:163`, and the focus branch of `PopoverMenuItem:37`. Open-state selectors at those owners instead use `bg-active`. |
| `bg-active` / `data-[state=open]:bg-active` | open branches in `SidebarAccountFooter:107`, `SidebarConsumptionCard:240`, `SidebarHelpFooter:47`, `HomeNextScreen:163`, `HomeTargetPickerParts:121`, `RepoPicker:44`, `PaneIconButton:6`, `PillControlButton:46,47`, `EnvironmentSearchSelect:60`, and `SettingsMenu:47`; `rightPanelOpen` in `CoworkWorkspaceHeader:50`; `active` in `PaneIconButton:30` and `SidebarActionButton:39`; focused editing at `PlanHandoffDialog:115`; and resize feedback in `FileTreeOverlay:96`. |
| direct historical state-variable consumers | `ComposerControlButton:39` becomes `hover:bg-hover data-[state=open]:bg-active`; enabled `ComposerFastModeToggle:34` becomes `bg-selected` and its exact test pin is updated; `authenticated.css:208-214` replaces both the 30%-of-list-hover mix and raw 3.5% hover mix with `background: var(--color-hover)`. |
| `bg-selected` | `ComposerOptionRow:56`, `ComposerSlashCommandSearch:126`, `ComposerFastModeToggle:34`, `UserInputCard:338`, `FileTreeRow:49`, `AttachedPaneShell:155`, `PaneFileTree:138`, `ChatTabsMenu:151,211`, `ClosedChatTabsMenu:27`, `ModelTable:66`, `WorkspacesSurface:350`, `Table:46`, `SidebarNavItem:26`, `SidebarRowSurface:27`, `Tabs:61`, and `Toggle:19`; plus foreground-alpha selections at `AutomationCalendarView:61,115`, `AutomationSurface:170`, `WorkspacesSurface:277`, `WorkspaceInventoryRow:36`, `HarnessAuthSection:350`, and `SelectionRow:36`. The current `/70` selected modifiers are deleted, not transferred. |
| `bg-surface-control` | the account/avatar/icon tiles at `SidebarAccountFooter:110`, `AccountIdentityCard:21`, `ProductSidebarAccountFooter:14`, `CloudWorkspaceList:68`, and `Avatar:43`; update-progress tracks at `HarnessUpdateToastPresenter:72` and `UpdateToastPresenter:62`; the API-key chip at `HarnessAuthApiKeyRow:95`; file-search controls at `FileTreeOverlay:146` and `PaneFileTree:59`; the badge in `PaneFileTree:187`; both static Cloud-chat header fills at `CloudChatHeader:141,194`; the resting icon-control fill at `WorkspacesSurface:278`; `CloudSidebarStatusDefinition.ready` in `cloud-sidebar.ts:36`; all skeleton overrides at `CoworkManagedWorkspaceList:58`, `CoworkThreadsSection:153,154`, `GitPanel:63,67,73,77`, `GitPanelReviewBody:85,86,87`, and `SidebarWorkspaceContent:78,79,80`; every neutral/accent/sidebar background in `Badge:18,19,24`; and the resting control surface in `EnvironmentSearchSelect:60`. Preserve an existing `/70` or `/80` modifier only on skeleton opacity variants. |
| `bg-surface-elevated-secondary` | static `.018` stripe at `MarkdownBody:172`; static `.025` footer at `PlanHandoffDialog:61`; static `.02` panels at `BillingPlanManagementDialog:99`, `PlaygroundToolTranscript:139,146`, `HarnessSettingsSection:70`, `HarnessPane:205,247`, `ApiKeysPane:230`, and `OrganizationBudgetsPane:180,189,220,234,246`; static `.03` panels at `BillingPlanComparison:176,206` and `UpdateRestartDialog:82`; static `.035` panels at `AutomationDetailSurface:139`, `AutomationSurface:155`, and `MarkdownBody:178`; static `.04` panels at `BillingPlanComparison:93`, `CloudTranscriptActionRow:183`, `CollapsedCommandActionRow:29`, `CollapsedEditActionRows:155`, `CollapsedGenericActionRow:41`, and `ToolActionDetailsPanel:15`; static `.042` group headers at `AutomationDetailSurface:103`, `AutomationInventoryList:38`, and `WorkspaceInventoryGroup:59`; static Git review notices at `GitPanelReviewChrome:26,55`; and the model-table header at `ModelTable:43`. |
| `bg-diff-panel-surface` | `TranscriptPatchTurnDiffPanel:92` and `TurnDiffPanel:106` replace their static `.0475` foreground tint with the existing diff-panel role. |

The playground state specimens are not grandfathered. `FullFlowTabs:31-44`
and `NavigationCloseTabs:64-76` use `bg-selected` and `hover:bg-hover`;
`NavigationClosePaneRow:22,56` and `SubagentsPanePrototype:145,179` use
`bg-selected` for focused/selected branches and `hover:bg-hover` for hover;
`GlobalAgentsPanePrototype:68,116,161` and
`SubagentCreationReceipt:55` use `hover:bg-hover`.
`GitReviewV2Playground:223,396,410` uses `hover:bg-hover`, while its static
badge at `373` uses `bg-surface-control`; `PlaygroundLoadingStates:127-129`
uses `bg-surface-control` with the existing skeleton opacity modifiers.
The static `AgentsPlaygroundPage:53` header uses
`bg-surface-elevated-secondary`. These exact mappings cover all three
`subagents-ux` specimen families captured by the migration census.

Exact class pins change with their owners:
`workspace-chrome.test.ts:83,88` expects `hover:bg-hover`;
`FileDiffCard.test.tsx:57` expects `hover:bg-hover`; and
`ReleaseNoticeCard.test.tsx:24` expects `bg-surface-control`.
`TurnDiffPanel.test.tsx:124,128` expects `bg-diff-panel-surface`.
The existing negative old-class assertions in `GitPanel.test.tsx:255-256`
remain valid and become redundant defense behind the source gate.

The exact still-live compatibility aliases are frozen in section 3.1 and must
carry `/* legacy-alias */`. Migrated interaction sites use canonical
`hover`, `active`, and `selected` utilities. The historical accent utility
names are forbidden after this exhaustive class migration. Custom-property
aliases remain only where listed in section 3.1, including existing
component-CSS/runtime API compatibility; they do not license
repository-authored accent utility classes.

### 5.2 Radii

| Token | Value | Generated class | Role |
| --- | ---: | --- | --- |
| `--radius-sm` | `0.375rem` (`6px`) | `rounded-sm` | rows and compact shapes |
| `--radius-md` | `0.5rem` (`8px`) | `rounded-md` | buttons and controls |
| `--radius-lg` | `0.625rem` (`10px`) | `rounded-lg` | cards and popovers |
| `--radius-xl` | `0.75rem` (`12px`) | `rounded-xl` | composer |
| `--radius-2xl` | `1rem` (`16px`) | `rounded-2xl` | modals |
| `--radius-full` | `9999px` | `rounded-full` | pills/circles |

The generator must also emit the non-value utility
`rounded-inherit { border-radius: inherit; }`. It is a sanctioned structural
exception, not another radius.

Every distinct `rounded-[…]` value in the census:

| Old literal | Exact replacement by context | Visible sites |
| --- | --- | --- |
| `rounded-[0.25em]` | `rounded-sm` | inherited compute-target swatch |
| `rounded-[1.25rem]` | `rounded-2xl` for `RuntimePressureDetailsDialog`; `rounded-lg` for both composer popovers | runtime-pressure modal; integrations/workspace-status popovers |
| `rounded-[10px]` | `rounded-sm` for `SidebarRowSurface` and 36px group-header rows; `rounded-lg` for detail card and automation menu | sidebar, automations, workspace inventory |
| `rounded-[12px]` | `rounded-2xl` | update-dialog playground modal specimen |
| `rounded-[20px]` | `rounded-lg` | session-content search popover |
| `rounded-[22%]` | `rounded-xl` | update dialog artwork tile |
| `rounded-[26px]` | `rounded-lg` | empty chat surface card |
| `rounded-[2px]` | `rounded-sm` | provider-link icon |
| `rounded-[3px]` | `rounded-sm` | add-repository key tile |
| `rounded-[4px]` | `rounded-md` for `Checkbox`; `rounded-sm` for compute swatch and composer-option glyph tile | checkbox, compute, composer options |
| `rounded-[5px]` | `rounded-sm` for all rows/chips/icon tiles | automation rows/calendar, workspace inventory, model chips, repo icon |
| `rounded-[6px]` | `rounded-md` | automation segmented buttons/filter control |
| `rounded-[8px]` | `rounded-lg` for warning/error/calendar cards; `rounded-md` for segmented-control trough | workspaces and automations |
| `rounded-[inherit]` | `rounded-inherit` | both prompt-attachment descendants |
| `rounded-[var(--radius)]` | `rounded-lg` | model table frame |
| `rounded-[var(--radius-composer)]` | `rounded-xl` | chat drop target |
| `rounded-[var(--radius-composer,1rem)]` | `rounded-xl` | chat composer and cloud composer footer |
| `rounded-[var(--workspace-shell-tab-radius,0.625rem)]` | `rounded-md` | both Chrome workspace-tab layers |
| `rounded-t-[13px]` | `rounded-t-xl` | `ComposerAttachedPanel`, `PendingPromptList`, `PromptRecoveryPanel`, and `GoalBar`; attached composer panels use the 12px composer radius. |
| `rounded-t-[var(--radius-composer,1rem)]` | `rounded-t-xl` | `WorkspaceActivityComposerCard` and playground `ActivityAggregatePopover`. |
| `rounded-tl-[22px]` | `rounded-tl-2xl` | both opaque workspace content-shell branches in `workspace-chrome.ts:90,108`; update `workspace-chrome.test.ts:33,63`. |

The current generated `rounded-lg` utility resolves from
`--radius-lg: 0.75rem` (12px). Changing that global token to
`0.625rem` (10px) retunes every existing `rounded-lg` consumer, not only the
arbitrary-literal sites above; `[RAD-03]` owns that exhaustive 12px → 10px
class-level change. No radius literal or directional radius literal is
allowlisted. `rounded-full` remains legal.

### 5.3 Layering

Emit explicit utilities (`z-base`, `z-raised`, and so on) for the arbitrary-z
migration census. Existing standard Tailwind numeric utilities
`z-0|10|20|30|40|50` are outside this pass and keep their current local
stacking behavior; this pass neither expands nor newly adopts that vocabulary.

| Token/class | Value |
| --- | ---: |
| `--z-base` / `z-base` | `0` |
| `--z-raised` / `z-raised` | `10` |
| `--z-sticky` / `z-sticky` | `20` |
| `--z-overlay` / `z-overlay` | `40` |
| `--z-popover` / `z-popover` | `50` |
| `--z-toast` / `z-toast` | `60` |
| `--z-tooltip` / `z-tooltip` | `70` |
| `--z-top` / `z-top` | `80` |

Every distinct arbitrary z value in the census:

| Old literal | Exact replacement | Visible site / reason |
| --- | --- | --- |
| `z-[1]` | `z-base` | inactive header chat tab |
| `z-[2]` | `hover:z-raised` | hovered header chat tab |
| `z-[3]` | `z-raised` | header group pill |
| `z-[4]` | `hover:z-sticky` | hovered header group pill |
| `z-[5]` | `z-sticky` | active header chat tab |
| `z-[6]` | `z-raised` | group underline inside isolated tab strip |
| `z-[20]` | `z-sticky` | dragged header tab/group |
| `z-[55]` | `z-popover` | session-content search |
| `z-[60]` | `z-overlay` | manual group editor scrim |
| `z-[61]` | `z-popover` | manual group editor panel |
| `z-[70]` | `z-tooltip` for `Tooltip` and delegated hover cards; `z-popover` for `ChatTabsMenu` | semantic split of one numeric value |
| `z-[80]` | `z-popover` | outer composer model/config menu |
| `z-[81]` | `z-raised` inside an `isolate z-popover` outer wrapper | nested composer submenu is locally raised above its sibling; it is not mislabeled as a tooltip. |
| `z-[100]` | `z-toast` | auth-onboarding playground notice |
| `z-[999]` | `z-overlay` | command-palette scrim |
| `z-[2147483647]` | `z-top` | macOS window-controls safe area |

The header tab strip must remain an isolated stacking context; otherwise
mapping its internal 1–6 ordering into the global scale can escape the strip.
The outer composer model/config wrapper likewise becomes
`isolate z-popover`; its submenu uses local `z-raised`. There is no
arbitrary-z allowlist. The gate freezes the current standard numeric-z
baseline and rejects additions rather than pretending those 95 existing
local-order uses were part of this census.

### 5.4 Motion mapping

#### 5.4.1 Canonical interaction scale

`apps/packages/design/src/motion.ts` is the shared JS authority and is exported
as `@proliferate/design/motion`. The CSS generator consumes the same values.
It also exports `motion.cssMs(value)` so a consumer never hand-appends an
`ms` literal to a shared numeric timing.

| JS key | CSS token / exact class | Value |
| --- | --- | ---: |
| `motion.duration.hoverMs` | `--duration-hover` / `duration-hover` | `120ms` |
| `motion.duration.enterMs` | `--duration-enter` / `duration-enter` | `160ms` |
| `motion.duration.exitMs` | `--duration-exit` / `duration-exit` | `120ms` |
| `motion.duration.disclosureMs` | `--duration-disclosure` / `duration-disclosure` | `200ms` |
| `motion.duration.panelMs` | `--duration-panel` / `duration-panel` | `240ms` |
| `motion.duration.emphasizedMs` | `--duration-emphasized` / `duration-emphasized` | `300ms` |
| `motion.ease.outQuint` | `--ease-out-quint` / `ease-out-quint` | `cubic-bezier(0.19, 1, 0.22, 1)` |
| `motion.ease.spring` | `--ease-spring` / `ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `motion.ease.standard` | `--ease-standard` / `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `motion.ease.linear` | `--ease-linear` / `ease-linear` | `linear` |
| `motion.activity.streamRevealFadeMs` | `--activity-stream-reveal-fade` | `320ms` |
| `motion.activity.updateReadySweepMs` | `--activity-update-ready-sweep` | `700ms` |

#### 5.4.2 Every distinct census duration/easing literal

| Old literal/value | Exact replacement |
| --- | --- |
| `duration-150` on color/opacity hover/reveal | `duration-hover` (`120ms`) |
| `duration-150` on content/modal/popover entrance | `duration-enter` (`160ms`) |
| `duration-150` on chevron/disclosure transforms | `duration-disclosure` (`200ms`) |
| `duration-150` on sidebar/right-rail width | `duration-panel` (`240ms`) |
| `duration-150` on header-tab drag transform | `duration-enter` (`160ms`) |
| `duration-200` on grid/height/disclosure transforms | `duration-disclosure` (`200ms`) |
| `duration-200` on hover-only opacity reveal | `duration-hover` (`120ms`) |
| `duration-200` on AuthGate entrance | `duration-enter` (`160ms`) |
| `duration-300` on progress/update emphasis | `duration-emphasized` (`300ms`) |
| `duration-300` on tool disclosure chevrons | `duration-disclosure` (`200ms`) |
| `duration-500` on todo progress transform | `duration-emphasized` (`300ms`) |
| `300ms cubic-bezier(0.16, 1, 0.3, 1)` in `authenticated.css` | `var(--duration-emphasized) var(--ease-spring)`; rendered value stays `300ms` and the curve is named |
| `` `${i * 110}ms` `` in `LevelBarsButton` | `motion.cssMs(i * motion.delay.levelBarStaggerMs)` with `levelBarStaggerMs = 110`; the shared formatter owns the `ms` suffix and this remains an activity-family exception. |
| `150ms cubic-bezier(0.19, 1, 0.22, 1)` test assertion | `var(--duration-enter) var(--ease-out-quint)` (or assert the generated resolved values); entrance becomes `160ms` |
| documented/implemented `280ms cubic-bezier(0.23,1,0.32,1)` | `var(--duration-emphasized) var(--ease-spring)` (`300ms cubic-bezier(0.16,1,0.3,1)`) |

#### 5.4.3 Exhaustive finite-motion disposition in design CSS

The migration census intentionally excluded the design package, but its
component CSS is not exempt from the new motion authority. Every finite
interaction declaration below is rewritten to generated variables; no
numeric duration or authored easing remains on these selectors.

| Current design CSS site/value | Exact final declaration |
| --- | --- |
| `dom.css:320` content fade, `150ms ease-out` | `animation: content-fade-in var(--duration-enter) var(--ease-out-quint)` |
| `dom.css:470` brand settle, `300ms ease-out` | `animation: brand-mark-settle var(--duration-emphasized) var(--ease-standard)` |
| `dom.css:493` web sidebar slide, `220ms` spring | `animation: web-sidebar-panel-slide-in var(--duration-panel) var(--ease-spring)` |
| generated `--animate-popover-in`, current `150ms` out-quint | `popover-in var(--duration-enter) var(--ease-out-quint)` |
| `product.css:1119` `panel-in 150ms ease-out` | `panel-in var(--duration-panel) var(--ease-out-quint)` |
| `product.css:1162,1168` modal overlay/panel enter, `150ms` out-quint | `var(--duration-enter) var(--ease-out-quint)` |
| `product.css:1165,1171` modal overlay/panel exit, `120ms ease-in` | `var(--duration-exit) var(--ease-standard)` |
| `product.css:1217` composer-dock enter, `280ms` legacy spring | `var(--duration-emphasized) var(--ease-spring)` |
| `product.css:1221` composer-dock exit, `150ms ease-out` | `var(--duration-exit) var(--ease-out-quint)`; the JS unmount timer changes in lockstep. |
| `product.css:1288,1296` composer value enter/exit, `240ms` legacy spring | `var(--duration-panel) var(--ease-spring)`; `SWAP_DURATION_MS` uses the same shared `240`. |
| `product.css:1364` chip enter, `280ms` legacy spring | `var(--duration-emphasized) var(--ease-spring)` |
| `product.css:1427` status crossfade, `150ms ease-out` | `var(--duration-enter) var(--ease-out-quint)` |
| `product.css:1446` transcript-activity enter, `150ms` out-quint | `var(--duration-enter) var(--ease-out-quint)` |
| `product.css:1511` update-pill enter, `280ms` legacy spring | `var(--duration-emphasized) var(--ease-spring)` |
| `product.css:1673` toast enter, `200ms ease-out` | `var(--duration-enter) var(--ease-out-quint)` |
| `product.css:1691` dialog pop-in, `160ms ease-out` | `var(--duration-enter) var(--ease-out-quint)` |
| `product.css:1789` workspace-shell background/color/border transitions, `150ms` | each duration becomes `var(--duration-hover)` and timing becomes `var(--ease-standard)`. |
| `product.css:2010,2101-2102,2113,2289` right-panel tab edge/color/fill/close transitions, `100ms ease` | `var(--duration-hover) var(--ease-standard)` in the existing longhand or shorthand form. |

Finite activity feedback is named, not confused with interaction motion:
`dom.css:339` stream reveal uses generated
`--activity-stream-reveal-fade: 320ms`; the paired JS handoff remains
`motion.activity.streamRevealHandoffDelayMs = 160`.
`product.css:1483,1495` update-ready sweep keeps 700ms through generated
`--activity-update-ready-sweep`. Both selectors carry the exact
`/* activity-motion */` marker.

Infinite activity recipes (caret, skeleton, thinking, brand breathe,
level-bar wave, ripple, loading, snake, braille, spinners, and celebration
loops) retain their current cadence and carry `/* activity-motion */`
immediately before the owning rule. The design-CSS gate scopes that marker to
one rule and permits raw numeric time only in that rule's `animation` and
`animation-delay` declarations when its animation is `infinite`; this covers
existing duration/delay fallbacks without exempting neighboring selectors.
Finite activity timing must instead flow through a generated `--activity-*`
variable. The gate strips ordinary comments before scanning, so prose such as
the snake recipe's `0.08s` explanation is not source authority. It does not
exempt a whole file or permit finite interaction literals merely because they
live under `apps/packages/design`.

#### 5.4.4 Named JS constant triage

| Census constant | Current | Final authority | Decision |
| --- | ---: | --- | --- |
| `THINKING_TEXT_DURATION_MS` | `1800` | `motion.activity.thinkingCycleMs = 1800` | Migrate; activity loop, no visual retune. |
| `SWAP_DURATION_MS` | `240` | `motion.duration.panelMs = 240` | Migrate; finite interaction motion. |
| `STREAM_REVEAL_FADE_MS` | `320` | `motion.activity.streamRevealFadeMs = 320` | Migrate; streaming recipe is explicitly deferred from scale retuning, so preserve. |
| `STREAM_REVEAL_HANDOFF_DELAY_MS` | `160` | `motion.activity.streamRevealHandoffDelayMs = 160` | Migrate; streaming choreography delay, preserve. |
| `CARD_EXIT_DURATION_MS` | `150` | `motion.duration.exitMs = 120` | Migrate and retune CSS plus unmount timer together. |
| `HIDE_DELAY_MS` | `700` | `motion.delay.autoHideScrollbarMs = 700` | Migrate; UI choreography delay, not an animation duration. |
| `CLICKABLE_CARD_HIDE_DELAY_MS` | `120` | `motion.delay.hoverCardHideMs = 120` | Migrate; UI choreography delay, preserve. |

All other `_MS`/`DURATION` hits in the migration census are non-motion clocks (network
timeouts, polling/heartbeat intervals, cache staleness, debounce/batching,
measurement thresholds, retry backoff, fixture timestamps, and business
windows). They stay with their current owners and are explicitly excluded from
the motion-token lint. The extra streaming cadence constants adjacent to the
two named stream constants (`16`, `32`, `240`, and the derived settle value)
may live beside the streaming algorithm; they are not CSS animation mirrors.

#### 5.4.5 Reduced motion

At the generated token layer:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-hover: 0ms;
    --duration-enter: 0ms;
    --duration-exit: 0ms;
    --duration-disclosure: 0ms;
    --duration-panel: 0ms;
    --duration-emphasized: 0ms;
  }
}
```

Finite interaction transitions therefore complete immediately without each
component adding `motion-reduce:*`. Activity-family timings (thinking,
streaming, spinner/skeleton/snake recipes, and level-bar staggering) are not
aliased to interaction tokens and remain unchanged, per the ruled “loops keep,
transitions drop to 0” contract. Existing component-specific reduced-motion
rules may still replace motion with a static representation where that is part
of the component's accessibility contract.

### 5.5 Raw-hex disposition

| Distinct census value(s) | Exact replacement / allowlist |
| --- | --- |
| `#f4f4f5`, `#d4d4d8`, `#a1a1aa` | Exact-file allowlist for `boot-stall-diagnostics-overlay.ts`; dev-only injected emergency overlay intentionally cannot depend on app CSS variables. |
| `#000` in `ChromeWorkspaceTab` title mask | Exact-line/pattern allowlist; mask alpha geometry, not a rendered palette color. |
| `#6b7280` | Design token `--color-compute-target-slate`; option value becomes `var(--color-compute-target-slate)`. |
| `#b04444` | `--color-compute-target-red`; option value becomes `var(--color-compute-target-red)`. |
| `#b56b3a` | `--color-compute-target-orange`; option value becomes `var(--color-compute-target-orange)`. |
| `#b59a3a` | `--color-compute-target-amber`; option value becomes `var(--color-compute-target-amber)`. |
| `#4a8d5a` | `--color-compute-target-green`; option value becomes `var(--color-compute-target-green)`. |
| `#3c8a86` | `--color-compute-target-teal`; option value becomes `var(--color-compute-target-teal)`. |
| `#4a72b5` | `--color-compute-target-blue`; option value becomes `var(--color-compute-target-blue)`. |
| `#7a5ab0` | `--color-compute-target-purple`; option value becomes `var(--color-compute-target-purple)`. |
| `#b0567c` | `--color-compute-target-pink`; option value becomes `var(--color-compute-target-pink)`. |
| `#F22C3D`, `#FFFFFF80`, `#FFFFFF`, `#00A67D` in `highlighting.test.ts` | Replace expected literals with imported generated code-palette constants. No test-file allowlist. |
| `#1c1c1c`, `#232323`, `#2b2b2b` in negative diff assertions | Exact matcher exception for `.not.toContain(<hex>)`; these prove forbidden colors are absent and do not style output. |
| `#ff5f57`, `#febc2e` | Design tokens `--color-window-control-close` and `--color-window-control-minimize`; playground uses `bg-window-control-close` / `bg-window-control-minimize`. |
| `#823`, `#737`, `#381`, `#1333`, `#1042`, `#123`, `#124`, `#125`, and URL fragment `#caf…` | Not colors. The gate must parse color-bearing syntax or explicitly reject issue/PR/URL-fragment contexts rather than allowlisting their files. |

The four census-excluded source groups retain their stated policy:
brand/provider SVG paths are exact-file allowlisted; Shiki and Monaco palette
outputs are generated from design and their generated output files are
allowlisted. Hand-authored raw hex is not allowed in those generated palette
consumers.

Playground and test-fixture paths are outside the raw-hex lint scope as
categories, not through per-file exceptions. The categorical matcher is a
normalized path segment named `playground` or `fixtures`, or a source basename
ending in `Fixture`/`Fixtures`; it does not exclude all `.test.*` files.
Consequently the embedded SVG data in
`PlaygroundAttachmentFixtures.tsx` remains byte-for-byte unchanged and does
not create `fixtureColors` or production design tokens. This scope rule also
prevents PR/issue fixture strings from being mistaken for colors. Production
code, including non-fixture tests of generated palette behavior, still
follows the dispositions above. No additional production raw-hex allowlist is
implied.

### 5.6 Row-action icon-button contract and census adoption

The sanctioned primitive is
`@proliferate/ui/layout/RowActionIconButton`:

- `forwardRef<HTMLButtonElement, RowActionIconButtonProps>` over the native
  `<button>` from `IconButton`; `type="button"`. Forwarding is mandatory
  because `WorkspaceItemMenu` measures the trigger ref for its native-menu
  fallback;
- fixed `size-7` (28px) hit target, `rounded-md` (8px);
- 16px glyph via `text-ui [&_svg]:icon-control`;
- resting semantic muted ink, `hover:bg-hover`,
  `active:bg-active`, hover/focus ink promotion;
- default reveal contract:
  `pointer-events-none opacity-0
  group-hover:pointer-events-auto group-hover:opacity-100
  group-focus-within:pointer-events-auto
  group-focus-within:opacity-100 focus-visible:pointer-events-auto
  focus-visible:opacity-100 data-[state=open]:pointer-events-auto
  data-[state=open]:opacity-100 disabled:!pointer-events-none`;
- `visibility="always"` removes the hidden opacity and pointer-event classes,
  leaving the button pointer-active;
- open/active state uses `bg-active`;
- requires `label` and supplies both `aria-label` and `title`;
- stops click propagation before invoking its callback, because its owning row
  remains independently clickable;
- disabled remains focus/semantics correct and does not become pointer-active.

`SidebarActionButton` becomes a thin tone/variant adapter over this primitive;
the product-local `SidebarActionIconButton` remains a product action adapter,
not a second visual primitive. Local `RowIconButton` in
`AutomationInventoryList` is deleted.

The census counts reveal companions as well as actual buttons. “Adopt all 20”
means every actual control uses the primitive and every companion reveal is
driven by the primitive-owning row state; it does not turn status text or a
whole-row navigation affordance into a second nested button.

| Census site | Adoption interpretation |
| --- | --- |
| `AutomationRunsList:97` | Companion trailing label hides when the row's presentational action indicator reveals. |
| `AutomationRunsList:105` | Whole row already performs the open action; keep a non-interactive 28px/16px `RowActionIndicator`, sharing state/reveal classes, not a nested button. |
| `SidebarActionButton:41` | Implement reveal through `RowActionIconButton`. |
| `SidebarNavRow:57` | Shortcut badge is a reveal companion, not an icon button; use `duration-hover`. |
| `AutomationInventoryList:120` | Companion status label hides while actions reveal. |
| `AutomationInventoryList:128` | Reveal container remains; every child action adopts `RowActionIconButton`; delete local visual button. |
| `ProductSidebarRepositories:147` | Existing action children adopt the sidebar adapter; wrapper no longer owns a competing 150ms visual recipe. |
| `ProductSidebarRepositories:196` | Shortcut/status companion only; retain inverse visibility linked to row action reveal. |
| `ProductSidebarRepositories:206` | Shortcut/status companion only; same. |
| `ProductSidebarRepositories:218` | Shortcut/status companion only; same. |
| `ProductSidebarThreads:53` | Existing action child adopts sidebar adapter. |
| `ProductSidebarThreads:82` | Shortcut companion only; inverse visibility. |
| `ProductSidebarThreads:86` | Timestamp companion only; inverse visibility. |
| `ProductSidebarActionButton:28` | Product adapter delegates visibility and appearance to shared primitive. |
| `WorkspacesCommandList:137` | Keyboard/selection hint only, not a button; keep as reveal companion with `duration-hover`. |
| `WorkspaceInventoryRow:83` | Companion timestamp hides for the whole-row open indicator. |
| `WorkspaceInventoryRow:90` | Whole row already opens; use non-interactive `RowActionIndicator`, not nested button. |
| `HomeOnboardingCards:84` | Dismiss button adopts primitive; hit target retunes 16px → 28px and glyph → 16px. |
| `WorkspaceItemMenu:111` | Kebab trigger adopts primitive; half-opacity bare glyph becomes 28px hover-filled control. |
| `PlanReferenceAttachmentCard:71` | Keep the full-height reveal veil as layout wrapper; put a 28px `RowActionIconButton` at its trailing edge for remove. |



### 5.7 Shadow migration

| Current value/name | Final token/value | Exact consumers |
| --- | --- | --- |
| `--shadow-subtle: 0 1px 2px 0 rgb(0 0 0 / 0.05)` | unchanged `--shadow-subtle` | generated composer/card elevation only |
| composer two-layer `0 3px 7.5px …, 0 0 20px …` / `--shadow-composer` | `--shadow-subtle` | generated composer surface |
| current `--shadow-popover` ring + `0 8px 16px -4px` | `--shadow-popover: 0 4px 12px rgb(0 0 0 / 0.12)` | all existing `shadow-popover` menus/popovers/tooltips |
| `shadow-floating` on popover/floating controls | `shadow-popover` | `AutomationAgentRunConfigPicker:25`, `WorkspaceArrivalAttachedPanel:80,190`, `TerminalCommandFloatingAction:36`, `TerminalTopBar:81` |
| `shadow-floating` on dialogs | `shadow-modal` | `UpgradeGateDialog:37`, `ConfirmationDialog:50` |
| `shadow-floating-dark` on large overlays/dialogs | `shadow-modal` | `UpdateRestartDialog:41`, `CommandPalette:143`, and playground `UpdateUiPlayground:39` |
| `shadow-floating-dark` on floating side panels | `shadow-popover` | `FileTreeOverlay:85`, `PaneSideOverlay:64` |
| `shadow-lg` on dialogs | `shadow-modal` | `AutomationEditorDialog:125`, `AlertDialog:59`, `Dialog:62`, and `ModalShell:50` |
| `shadow-lg` on floating playground notices | `shadow-popover` | `AuthOnboardingPlayground:93,114,134` |
| `shadow-lg` on non-floating content/control | remove the class (`shadow-none` only if merge precedence requires it) | `ChatSurfaceCard:29` and `Switch:40` |
| three-layer arbitrary popover shadow | `shadow-popover` | `ComposerIntegrationsControl:74`, `WorkspaceStatusComposerControl:178` |
| three-layer arbitrary modal shadow | `shadow-modal` | `RuntimePressureDetailsDialog:53` |
| `0 8px 16px -4px` arbitrary search shadow | `shadow-popover` | `SessionContentSearchOverlay:118` |
| composer-card ring encoded as `shadow-[0_0_0_0.5px_…]` | remove arbitrary shadow; use `ring-1 ring-border` | `WorkspaceActivityComposerCard:97` |
| lateral `-8px 0 16px -8px` dock shadow | remove; retain border-led separation | `RightPanelFrame:99` |
| `shadow-subtle` on non-floating support cards | remove | `SupportSurface:62,153` |
| `shadow-subtle` on active workspace-chrome tabs | remove from both branches and their exact test pins | `workspace-chrome.ts:121,122` |
| `--shadow-keystone` double shadow | removed | primary buttons become border/surface-led |

Only floating layers and the generated composer surface keep shadows.
Non-floating cards and controls use borders and surface roles. All repository
class consumers of `shadow-floating` and `shadow-floating-dark` are migrated
before the compatibility aliases are emitted; a source gate asserts zero
remaining class consumers. The aliases may therefore point to
`--shadow-modal` for external/runtime compatibility without accidentally
giving a live popover the modal stack.

### 5.8 Spacing and arbitrary-size closure

The only arbitrary gap value is closed by Claude's ruling:

| Current sites | Exact replacement |
| --- | --- |
| `AgentHarnessConfigComposer:68,69`; `CloudChatComposerControls:71,75,87`, all `gap-[5px]` | `gap-1.5` (6px) |

All current `size-[…]` sites migrate through the ruled icon/container laws:

| Current site/value | Exact replacement |
| --- | --- |
| `ComputeTargetSwatch:59`, inner `size-[62.5%]` | replace the percentage contract with per-variant semantic geometry: `inherit`/`xs`/`sm` own a `text-ui [&_svg]:icon-compact` 12px glyph; `md` owns `text-ui [&_svg]:icon-control` 16px. The swatch boxes become `size-full`, `size-4`, `size-5`, and `size-7` respectively. |
| `IntegrationIcon:172`, inner `size-[62%]` in a 32px tile | container owns `text-ui [&_svg]:icon-large`, exactly 20px; glyph carries no size class. |
| `PlanHandoffDialog:100`, `size-[26px]` icon tile | `size-7` (28px) with its paired 16px glyph. |
| `CollapsedActions:118`, `size-[1em]` icon-only disclosure button | `size-5` (20px) control box; child remains `text-ui icon-compact` (12px). |
| `TranscriptToolKindIcon:14`, `size-[1.143em]` | `icon-paired` (16px at the 13px chat base). |
| `RepoPicker:92`, `size-[15px]` chip icon tile | `size-5` (20px) with `text-ui icon-compact`. |
| `WorkspaceInventoryGlyphs:63`, `size-[18px]` | `size-5` (20px) wrapper; child uses the owning compact/paired icon tier. |
| `RadioCardGroup:74`, `size-[18px]` selection indicator | `size-5` (20px), `text-ui icon-compact`. |
| playground `FullFlowTabs:95`, `size-[16px]` agent bubble | `size-5` (20px). |
| playground `AgentGlyph:35`, `size-[18px]` agent bubble | `size-5` (20px). |

No arbitrary `gap-[…]` or `size-[…]` remains. Standard spacing utilities and
the legal icon-control boxes `size-5|6|7` remain available; this rule does not
ban layout width/height geometry, which is outside this pass.

## 6. Code palettes and React Native bridge

- Design owns semantic code roles for foreground, background, muted,
  string/success, heading/destructive, emphasis, selection, diff, git, and
  terminal colors. Shiki and Monaco scope/rule shapes remain unchanged; only
  their literal source becomes these design entries.
- Generated Shiki/Monaco outputs may contain resolved hex, but hand-authored
  palette source outside design may not. `highlighting.test.ts` imports
  generated palette constants for expected colors.
- Monaco's warm `#1A1715/#D4A574` world is retired. Its editor background,
  foreground, selection, line highlight, and syntax roles resolve from the
  cool-neutral app/code roles.
- `react-native.ts` keeps `mobileTheme = { colors, spacing, radius,
  typography: { size, lineHeight }, timing, shadow }`. RN shadow-prop objects
  remain hand-authored numeric objects, comment-linked to CSS shadow roles;
  CSS shadow strings are not parsed into RN objects.
- Mobile does not receive DOM CSS. New DOM-only state/layer utilities do not
  alter the public mobile bridge unless their primitive values belong in the
  existing bridge shape.

## 7. Test, drift, gate, and verification plan

### 7.1 Exact drift and unit tests

- Design generator test: compiled output must byte-match freshly generated
  `theme.css`; CSS colors, radii, shadows, type metrics/tracking, motion,
  easing, z values, aliases, and generated utilities must equal TS authority.
- Assert all 285 current names have exactly the disposition in section 2,
  all 70 removals are absent, and every live alias has exactly one
  `/* legacy-alias */` tag and a `var(...)` value.
- Assert `product.css`/`dom.css` contain no global token literals, duplicate
  light block, duplicate composer token block, or second font stack.
- Keep and update all appearance tests specified in section 4, including
  exact preset pins, monotonic ladders, alias equality, letter spacing, and
  the all-preset `chat.lineHeight === composer.fontSize + 7` invariant.
- Keep `WINDOW_ZOOM_SCALES` byte-for-byte and readable-code ladder pins.
- Add exact Shiki/Monaco export-shape tests and prove both palettes derive
  from design. Preserve `highlighting.ts` direct `.palette` reads.
- Add row-action behavior/markup tests: 28px box class, 16px glyph tier,
  hover/active state classes, hidden pointer-event suppression,
  group-hover/group-focus/open/focus-visible pointer restoration,
  disabled pointer suppression after restoration, `visibility="always"`,
  forwarded-ref identity and measurement,
  reveal/focus/open visibility, label/title, disabled semantics, and stopped
  row propagation.
- Add exact source-census tests proving production contains no historical
  accent state classes, no foreground-alpha interaction-overlay classes at
  10% or lower, and no
  `shadow-floating`, `shadow-floating-dark`, `shadow-lg`, or arbitrary-shadow
  consumers. Assert each static owner from sections 5.1.1 and 5.7 uses its
  exact ruled surface/shadow disposition.
- Assert all direct and directional arbitrary radius forms are absent,
  including the ten previously uncaptured `rounded-t-*`/`rounded-tl-*`
  sites; pin global `rounded-lg` to 10px and update its 12px → 10px visual
  contract.
- Add a design-CSS finite-motion source test: every selector in section
  5.4.3 uses the exact duration/easing variables, every raw-literal infinite
  activity rule has `/* activity-motion */`, finite activity timing uses only
  generated `--activity-*` variables, and no unmarked numeric finite
  animation/transition value remains.
- Assert the arbitrary-z census is empty, the composer outer wrapper is
  `isolate z-popover`, its submenu is local `z-raised`, and the pre-existing
  standard numeric-z baseline has no additions.
- Assert all five `gap-[5px]` sites became `gap-1.5`, all ten arbitrary-size
  sites match section 5.8, and neither arbitrary pattern remains.
- Update tests that assert numeric `duration-*`, arbitrary radius/z, generic
  type, old state classes, or old palette hex to assert the semantic
  replacement.

### 7.2 CI-enforced source gates

Extend the pure-Python `check_appearance_scaling.py` path used by the
`repo-shape` CI job, with unit fixtures for every accept/reject rule. Do not
rely only on `check-design-system.sh`, which is a local/pretest gate.

Reject in production roots:

- `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, arbitrary
  `text-[…]`, fixed glyph-size classes, and unowned `leading-[…]`;
- `rounded-\[[^]]+\]` and
  `rounded-(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee)-\[[^]]+\]`; arbitrary
  `z-[…]`; and any
  addition to the checked-in manifest of existing standard
  `z-0|10|20|30|40|50` sites;
- repository-authored `bg-accent`, `bg-sidebar-accent`, their selector or
  opacity variants, and foreground-alpha interaction-overlay fills at 10% or
  lower; only generated compatibility alias declarations may contain the
  historical token names, while solid primary-button
  `hover:bg-foreground/80|90` modulation remains legal;
- raw hex outside design token/palette authority, with the production
  exceptions in section 5.5; the exact segment/basename categories for
  playground and test-fixture paths are excluded from the raw-hex lint scope
  rather than file-allowlisted;
- inline `cubic-bezier` and interaction `ms`/`s` literals outside design;
- inside design CSS, every numeric finite animation/transition duration or
  literal easing. Only animation/animation-delay declarations in the exact
  one-rule scope of an `/* activity-motion */`-marked infinite activity, plus
  generated `--activity-*` variables, are motion exceptions;
- every `gap-\[[^]]+\]` and `size-\[[^]]+\]`. The five gap sites must be
  `gap-1.5`; icon/control geometry must use the exact section-5.8 standard
  box and semantic icon classes;
- `shadow-floating`, `shadow-floating-dark`, `shadow-lg`, and
  `shadow-[…]` in component classes after the section-5.7 migration;
- token declarations in `product.css`/`dom.css`, untagged legacy aliases,
  and duplicate literal values for aliases;
- authored `backdrop-filter:` declarations outside the generated
  light-composer declaration and the existing composer surface rule; Tailwind
  `backdrop-blur*` utility usage is not matched by this CSS-property gate;
- newly introduced unvirtualized long-list surfaces.

Allow only:

- exact brand/provider SVG files and generated Shiki/Monaco outputs;
- the dev boot-stall emergency overlay;
- the Chrome tab alpha mask;
- playground/test-fixture paths, excluded categorically from raw-hex lint
  only (all other foundation gates still scan them);
- non-color PR/issue/URL fragments parsed as such;
- non-motion clocks such as network timeouts, polling, cache windows,
  batching, and measurement thresholds;
- marked infinite activity motion and generated `--activity-*` variables.

### 7.3 Required proofs

Run the narrowest proofs after implementation: design build/generator drift,
gate unit tests plus gate, appearance tests, touched package typechecks, and
touched package tests. Do not build Rust. Completion reporting lists every
remaining `ui-foundation-escalation` tag under its class-level changelog id.

## 8. Canonical enumerated visual-retunes changelog

Each deliberate visual change must trace to exactly one id below. Authority
collapse, literal moves, compatibility aliases, dead-token removal, generated
code reshaping, and exact-value raw-hex moves are non-visual and have no id.

1. `[TYPE-01] UI sans` — system/Inter-leading UI stack → Geist variable sans
   through `--font-sans`; every non-monospace DOM text surface.
2. `[TYPE-02] Meta metrics` — semantic meta → `11/15 +0.01em`; labels,
   captions, helpers, timestamps, counts, and secondary metadata.
3. `[TYPE-03] Compact metrics` — semantic compact → `12/17 +0.005em`; rows,
   controls, menus, popovers, inputs, tabs, and compact sidebar roles.
4. `[TYPE-04] Chat chrome` — `11/19` → `13/20`; transcript tool/action rows,
   plans, notices, and work-history chrome.
5. `[TYPE-05] Message/composer leading` — `13/21` → `13/20`; composer input
   and assistant/user message prose.
6. `[TYPE-06] Body roles` — body → `13/20 0`; body emphasis →
   `14/21 -0.005em`; ordinary prose, prominent values, and names.
7. `[TYPE-07] Workspace title` — `14/22` → `14/21 -0.005em`; global chrome.
8. `[TYPE-08] Sidebar density` — `13/18` → `12/17 +0.005em`; nav, groups,
   workspace/thread/tree rows, and section headers.
9. `[TYPE-09] Heading` — generic heading/most `17/26` → `16/23 -0.01em`;
   compact card/dialog titles and sidebar brand tracking.
10. `[TYPE-10] Title` — `19/23` → `19/24 -0.025em`; page/settings/modal
    primary titles.
11. `[TYPE-11] Hero` — `26.5/34.5` → `26/34 -0.025em`; home hero.
12. `[TY-XS] Removed text-xs` — every former `text-xs` site uses semantic
    context; deterministic fallback `7.5/12` → `text-ui-sm 11/15`.
13. `[TY-SM] Removed text-sm` — every former `text-sm` site uses semantic
    context; deterministic fallback `9/15` → `text-ui 12/17`.
14. `[TY-BASE] Removed text-base` — every former `text-base` site uses
    semantic context; deterministic fallback `10/15` → `text-body 13/20`.
15. `[TY-LG] Removed text-lg` — every former `text-lg` site uses semantic
    context; deterministic fallback `13/19` → `text-body 13/20`.
16. `[TY-XL] Removed text-xl` — every former `text-xl` site uses semantic
    context; deterministic fallback `17/26` → `text-heading 16/23`.
17. `[TYPE-12] Control weight` — affected interactive controls/rows at
    `430` or `500` → `450`.
18. `[ICON-01] Paired glyph` — `1.15em` → `1.230769em`, exactly 16px beside
    13px text.
19. `[ICON-02] Compact glyph base` — accidental 7.5/9/10px generic bases →
    `text-ui icon-compact`, exactly 12px.
20. `[ICON-03] Icon-button boxes` — freehand icon-only targets → legal
    20/24/28px boxes; arbitrary 15/16/18/26px tiles, indicators, and
    controls adopt the exact section-5.8 box/tier pairing.
21. `[STATE-01] Hover overlay / static-tint split` — mixed 1.5%, 2%, 3%,
    3.5%, 4%, 4.5%, 5%, 6%, 7%, 7.4%, 7.5%, 8%, 9%, and 10% overlays →
    7.8%; rows, menus, composer, sidebar, tabs, and row actions. Static
    arbitrary 1.8–4.75% foreground panels and historical static accent fills
    move to their ruled `surface-control`, `surface-elevated-secondary`, or
    diff-surface role rather than inheriting hover.
22. `[STATE-02] Active overlay` — reused hover/accent and workspace-tab 8%
    → 5.2%; pressed/open/focused-editing controls, resize feedback, and
    active workspace tab.
23. `[STATE-03] Selected overlay` — roughly 3.5–10% selected fills → 3.2%;
    workspace, automation, sidebar, file-tree, menu, and multi-selected tabs.
24. `[STATE-04] Border alpha` — base 8% → 8.4%, collapsing composer 10%,
    sidebar 7.9%, and popover ring 8%; general and floating borders.
25. `[RAD-01] Rows` — 5px/10px → 6px; automation/workspace/sidebar rows.
26. `[RAD-02] Controls` — freehand 4–6px → 8px; checkboxes, segmented
    controls, tab controls, and row actions.
27. `[RAD-03] Cards/popovers` — the globally generated `rounded-lg`
    12px → 10px, plus arbitrary 8px/20px/26px → 10px; every existing
    `rounded-lg` consumer, warnings, search, menus/detail cards, and empty
    chat.
28. `[RAD-04] Composer` — 16px/13px → 12px; home/chat composer, attached
    panel top corners, footer, and drag target.
29. `[RAD-05] Modals/large shell` — 12px/20px/22px → 16px; runtime
    pressure, update dialog, and opaque workspace content-shell top-left
    corner.
30. `[RAD-06] Micro shapes` — 0.25em/2/3/4/5px → ruled 6px/8px role;
    provider/compute/repository tiles, chips, and composer options.
31. `[RAD-07] Workspace tabs` — 10px → 6px.
32. `[SPACE-01] Five-pixel control gaps` — five `gap-[5px]` composer/config
    control sites → `gap-1.5` (6px).
33. `[SHADOW-01] Composer elevation` — two-layer 3px/20px and composer-card
    ring shadow → subtle 1px/2px or border-led ring.
34. `[SHADOW-02] Popover elevation` — ring/legacy floating stacks and
    `0 8px 16px -4px` → `0 4px 12px`; popovers, menus, tooltips, floating
    side panels, and playground floating notices.
35. `[SHADOW-03] Modal elevation` — light floating/`shadow-lg` dialog stacks
    → `0 25px 50px -12px`; dialogs/overlays, while matching dark modal values
    stay unchanged. Non-floating card/control/dock shadows are removed.
36. `[SHADOW-04] Keystone removal` — button double-shadow → border/surface
    treatment.
37. `[MOTION-01] Hover/reveal` — 100/150/200ms → 120ms; sidebar,
    transcript/file actions, rows, controls, workspace chrome, and right-panel
    tabs.
38. `[MOTION-02] Entrances` — 150/200ms and keyword `ease-out` → 160ms
    out-quint; modal, popover, toast, status, transcript, content, and auth
    entrances; modal exits use the 120ms exit role.
39. `[MOTION-03] Disclosure` — 150/300ms → 200ms; collapsibles, diff/file
    chevrons, tool actions.
40. `[MOTION-04] Panels` — 150/220ms → 240ms; sidebars, right rail, terminal
    panel, and panel-in recipe.
41. `[MOTION-05] Emphasized/spring` — 500ms or 280ms → 300ms; duplicate
    `(0.23,1,0.32,1)` → spring `(0.16,1,0.3,1)` on todo progress,
    composer dock cards, value swaps, chips, and update entrances. Value
    swaps retain their 240ms panel duration.
42. `[MOTION-06] Composer dock exit` — 150ms → 120ms with CSS and JS timer
    together.
43. `[LAYER-01] Semantic stack` — arbitrary 1–2147483647 → 0–80 semantic
    roles; isolated local order preserved, including local raised composer
    submenu order, and cross-surface overlap corrected. Existing standard
    numeric-z sites remain outside this change.
44. `[ROW-ACTION-01] Row actions` — bare/undersized 13–16px glyphs and
    16/20/24px or full-height targets → 16px glyph, 28px target, 8px radius,
    7.8% hover fill, shared reveal/focus/open/pointer behavior at all 20
    census sites.

Every visually suspect deterministic fallback retains its replacement and
gets `ui-foundation-escalation: <reason>`; those sites are reported beneath
the applicable `TY-*` id for Claude's visual review. Everything not covered
by this changelog must render pixel-identically.
