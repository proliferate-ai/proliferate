# UI foundation token retune draft

This is the token-only Phase 1 input for .foundation-scout/retune-spec.md. It resolves the current global cascade and ruled token retunes; callsite maps and appearance pins belong to the other Phase 1 drafts.

## Resolution law and inventory

- Inventory: **285 concrete global custom properties**, excluding Tailwind's namespace reset and component-scoped properties.
- The printed full table in cascade-winners.md contains 276 unique names although its heading says 285. The omitted source globals are the eight live delegated-agent colors and live --color-warning-subtle; all nine are included.
- [SHIPPED] preserves the exact rendered winner. Dark uses final :root color-mix declarations; light uses block B, then block A, then dark fallback.
- [RETUNE:ruling] is intentional. [REMOVED] covers the 59 confirmed-dead tokens, ten generic text properties, and non-floating keystone shadow.
- Values are exact declaration expressions; var(...) dependencies intentionally remain referential.

Coverage: **176 shipped + 39 retuned/mapped + 70 removed = 285**.

## Existing global-token disposition

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
| `--color-accent` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
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
| `--color-composer-border` | `--color-border` | `var(--color-border)` | `var(--color-border)` | [RETUNE:state/border] |
| `--color-composer-control-active-foreground` | `--color-composer-control-active-foreground` | `var(--color-foreground)` | `var(--color-foreground)` | [SHIPPED] |
| `--color-composer-control-foreground` | `--color-composer-control-foreground` | `var(--color-muted-foreground)` | `color-mix(in oklab, var(--color-foreground) 55%, transparent)` | [SHIPPED] |
| `--color-composer-control-hover` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
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
| `--color-list-hover` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
| `--color-muted` | `--color-muted` | `#212121` | `var(--color-surface-elevated-secondary)` | [SHIPPED] |
| `--color-muted-foreground` | `--color-muted-foreground` | `color-mix(in oklab, #ffffff 70%, transparent)` | `var(--color-foreground-secondary)` | [SHIPPED] |
| `--color-overlay` | `--color-overlay` | `#000000` | `#000000` | [SHIPPED] |
| `--color-overlay-strong` | — | — | — | [REMOVED] |
| `--color-popover` | `--color-popover` | `#2d2d2d` | `#ffffff` | [SHIPPED] |
| `--color-popover-accent` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
| `--color-popover-foreground` | `--color-popover-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-popover-ring` | `--color-border` | `var(--color-border)` | `var(--color-border)` | [RETUNE:state/border] |
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
| `--color-sidebar-accent` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
| `--color-sidebar-accent-foreground` | `--color-sidebar-accent-foreground` | `#ffffff` | `var(--color-foreground)` | [SHIPPED] |
| `--color-sidebar-background` | `--color-sidebar-background` | `#181818` | `var(--color-background)` | [SHIPPED] |
| `--color-sidebar-blue` | — | — | — | [REMOVED] |
| `--color-sidebar-border` | `--color-border` | `var(--color-border)` | `var(--color-border)` | [RETUNE:state/border] |
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
| `--shadow-composer` | `--shadow-subtle` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | [RETUNE:elevation/near-flat] |
| `--shadow-floating` | `--shadow-modal` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | [RETUNE:elevation/near-flat] |
| `--shadow-floating-dark` | `--shadow-modal` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | [RETUNE:elevation/near-flat] |
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
| `--workspace-shell-action-hover-background` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
| `--workspace-shell-action-hover-foreground` | `--workspace-shell-action-hover-foreground` | `var(--color-foreground)` | `var(--color-foreground)` | [SHIPPED] |
| `--workspace-shell-action-line-height` | `--workspace-shell-action-line-height` | `var(--text-ui-sm--line-height)` | `var(--text-ui-sm--line-height)` | [SHIPPED] |
| `--workspace-shell-action-radius` | `--workspace-shell-action-radius` | `0.5rem` | `0.5rem` | [SHIPPED] |
| `--workspace-shell-action-size` | `--workspace-shell-action-size` | `1.75rem` | `1.75rem` | [SHIPPED] |
| `--workspace-shell-header-height` | — | — | — | [REMOVED] |
| `--workspace-shell-tab-active-background` | `--color-active` | `color-mix(in oklab, #ffffff 5.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 5.2%, transparent)` | [RETUNE:state/overlay] |
| `--workspace-shell-tab-active-border` | `--workspace-shell-tab-active-border` | `var(--color-border-heavy)` | `var(--color-border-heavy)` | [SHIPPED] |
| `--workspace-shell-tab-border` | — | — | — | [REMOVED] |
| `--workspace-shell-tab-content-gap` | `--workspace-shell-tab-content-gap` | `0.5rem` | `0.5rem` | [SHIPPED] |
| `--workspace-shell-tab-height` | `--workspace-shell-tab-height` | `1.75rem` | `1.75rem` | [SHIPPED] |
| `--workspace-shell-tab-hover-background` | `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
| `--workspace-shell-tab-hover-border` | `--workspace-shell-tab-hover-border` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-tab-inactive-background` | `--workspace-shell-tab-inactive-background` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-tab-inactive-border` | `--workspace-shell-tab-inactive-border` | `transparent` | `transparent` | [SHIPPED] |
| `--workspace-shell-tab-radius` | `--workspace-shell-tab-radius` | `0.375rem` | `0.375rem` | [RETUNE:radii/Codex-soft] |
| `--workspace-shell-tab-selected-background` | `--color-selected` | `color-mix(in oklab, #ffffff 3.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 3.2%, transparent)` | [RETUNE:state/overlay] |
| `--workspace-shell-tab-selected-border` | `--workspace-shell-tab-selected-border` | `var(--color-border-heavy)` | `var(--color-border-heavy)` | [SHIPPED] |

## New canonical tokens required by the rulings

| New final token | Dark | Light | Provenance |
|---|---|---|---|
| `--color-hover` | `color-mix(in oklab, #ffffff 7.8%, transparent)` | `color-mix(in oklab, var(--color-foreground) 7.8%, transparent)` | [RETUNE:state/overlay] |
| `--color-active` | `color-mix(in oklab, #ffffff 5.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 5.2%, transparent)` | [RETUNE:state/overlay] |
| `--color-selected` | `color-mix(in oklab, #ffffff 3.2%, transparent)` | `color-mix(in oklab, var(--color-foreground) 3.2%, transparent)` | [RETUNE:state/overlay] |
| `--font-weight-control` | `450` | `450` | [RETUNE:type/control-weight] |
| `--radius-2xl` | `1rem` | `1rem` | [RETUNE:radii/Codex-soft] |
| `--shadow-modal` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | [RETUNE:elevation/near-flat] |
| `--duration-hover` | `120ms` | `120ms` | [RETUNE:motion/roles] |
| `--duration-enter` | `160ms` | `160ms` | [RETUNE:motion/roles] |
| `--duration-exit` | `120ms` | `120ms` | [RETUNE:motion/roles] |
| `--duration-disclosure` | `200ms` | `200ms` | [RETUNE:motion/roles] |
| `--duration-panel` | `240ms` | `240ms` | [RETUNE:motion/roles] |
| `--duration-emphasized` | `300ms` | `300ms` | [RETUNE:motion/roles] |
| `--ease-out-quint` | `cubic-bezier(0.19, 1, 0.22, 1)` | `cubic-bezier(0.19, 1, 0.22, 1)` | [RETUNE:motion/roles] |
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | `cubic-bezier(0.16, 1, 0.3, 1)` | [RETUNE:motion/roles] |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | `cubic-bezier(0.4, 0, 0.2, 1)` | [RETUNE:motion/roles] |
| `--ease-linear` | `linear` | `linear` | [RETUNE:motion/roles] |
| `--z-base` | `0` | `0` | [RETUNE:layering/scale] |
| `--z-raised` | `10` | `10` | [RETUNE:layering/scale] |
| `--z-sticky` | `20` | `20` | [RETUNE:layering/scale] |
| `--z-overlay` | `40` | `40` | [RETUNE:layering/scale] |
| `--z-popover` | `50` | `50` | [RETUNE:layering/scale] |
| `--z-toast` | `60` | `60` | [RETUNE:layering/scale] |
| `--z-tooltip` | `70` | `70` | [RETUNE:layering/scale] |
| `--z-top` | `80` | `80` | [RETUNE:layering/scale] |
| `--size-icon-button-sm` | `1.25rem` | `1.25rem` | [RETUNE:icons/control-boxes] |
| `--size-icon-button-md` | `1.5rem` | `1.5rem` | [RETUNE:icons/control-boxes] |
| `--size-icon-button-lg` | `1.75rem` | `1.75rem` | [RETUNE:icons/control-boxes] |
| `--text-ui-sm--letter-spacing` | `0.01em` | `0.01em` | [RETUNE:type/closed-ramp] |
| `--text-ui--letter-spacing` | `0.005em` | `0.005em` | [RETUNE:type/closed-ramp] |
| `--text-chat--letter-spacing` | `0` | `0` | [RETUNE:type/closed-ramp] |
| `--text-composer--letter-spacing` | `0` | `0` | [RETUNE:type/closed-ramp] |
| `--text-workspace-title--letter-spacing` | `-0.005em` | `-0.005em` | [RETUNE:type/closed-ramp] |

Light state overlays use the light foreground rather than literal white; literal white would disappear on the white light surface.

## Enumerated token retune changelog

1. RT-TOK-001 — Geist UI stack: system sans stack -> Geist-leading stack. Visible on every non-monospace Desktop/Web surface.
2. RT-TOK-002 — Hover overlay: 5% accent/list/popover, 7.4% sidebar, and 9% dark/6% light composer -> one 7.8% foreground overlay. Visible on hovered rows, menus, composer controls, workspace tabs, and header actions.
3. RT-TOK-003 — Active overlay: workspace-tab 8% -> 5.2%. Visible on the active workspace tab.
4. RT-TOK-004 — Selected overlay: workspace-tab 10% -> 3.2%. Visible on multi-selected workspace tabs.
5. RT-TOK-005 — Border alpha: base 8% -> 8.4%; light composer 10%, dark sidebar 7.9%, and popover ring 8% collapse onto it. Visible on general, composer, sidebar, and popover borders.
6. RT-TOK-006 — Paired icon: 1.15em -> 1.230769em, exactly 16px beside 13px text. Visible on paired label icons.
7. RT-TOK-007 — Radius scale: 4/6/12/12px -> 6/8/10/12px, plus 16px modal. Visible after radius migrations on rows, controls, cards/popovers, composers, and modals.
8. RT-TOK-008 — Composer radius: 16px -> 12px. Visible on home and chat composers.
9. RT-TOK-009 — Workspace-tab radius: 10px -> 6px. Visible on workspace tabs.
10. RT-TOK-010 — Chat step: 11px/19px -> 13px/20px. Visible in transcript/chat chrome.
11. RT-TOK-011 — Composer/message leading: 13px/21px -> 13px/20px. Visible in composer input and message prose.
12. RT-TOK-012 — Workspace-title leading: 14px/22px -> 14px/21px. Visible in workspace titles.
13. RT-TOK-013 — Title leading: 19px/23px -> 19px/24px. Visible in page/settings titles.
14. RT-TOK-014 — Hero: 26.5px/34.5px -> 26px/34px. Visible on the home hero.
15. RT-TOK-015 — Sidebar roles: 13px/18px -> 12px/17px. Visible in sidebar nav, repo groups, workspace rows, and headers.
16. RT-TOK-016 — Tracking: absent -> +0.01em at 11px, +0.005em at 12px, 0 at 13px, -0.005em at 14px. Visible across semantic body roles.
17. RT-TOK-017 — Generic type tokens: text-xs/sm/base/lg/xl pairs -> removed. Visibility is governed by the semantic class migration.
18. RT-TOK-018 — Control weight: 500/freehand -> 450. Visible on migrated controls.
19. RT-TOK-019 — Popover entrance: 150ms out-quint -> 160ms out-quint. Visible when popovers, menus, and tooltips enter.
20. RT-TOK-020 — Composer shadow: two-layer 3px/20px -> subtle 0 1px 2px. Visible on composers.
21. RT-TOK-021 — Popover shadow: ring plus 0 8px 16px -4px -> 0 4px 12px. Visible on popovers, menus, and tooltips.
22. RT-TOK-022 — Modal shadow: light floating stack -> 0 25px 50px -12px; floating-dark already matches. Visible on floating dialogs/overlays.
23. RT-TOK-023 — Keystone shadow: button double-shadow -> removed. Visible on primary buttons, which become border/surface-led.
24. RT-TOK-024 — Motion roles: scattered literals -> 120/160/120/200/240/300ms and the ruled easings. Visible at migrated transitions.
25. RT-TOK-025 — Layer scale: arbitrary z values -> 0/10/20/40/50/60/70/80. Usually pixel-neutral; changes only corrected stacking.
26. RT-TOK-026 — Icon-button targets: freehand boxes -> 20/24/28px. Visible on migrated icon controls and the 28px row action.

## Non-visual authority resolutions

- All tokens.ts/product.css drift takes the product.css rendered winner unless explicitly retuned above.
- All @theme/:root mismatches take :root; base border is the one ruled exception, moving 8% -> 8.4%.
- The flattened light palette takes block-B winners. Six surface tokens unique to block A keep block-A values.
- --color-composer-background is exactly #212121 dark and block-B rgba(255, 255, 255, 0.864) light.
- The 59 dead removals have no visibility and therefore are absent from the visual changelog.

