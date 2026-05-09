export const CLAUDE_PLAN_SHORT = `# Tighten onboarding copy

## Context
The current onboarding reads as "install five CLIs to get started." New users bounce because each step looks like a potential failure point.

## Changes
1. Collapse the three CLI steps into a single "Install proliferate" step with a platform picker.
2. Replace the three-paragraph explainer on the welcome page with a one-liner plus a "Learn more" link.
3. Remove the warning banner about cloud billing — it's misleading for free users.

## Verification
- Run the onboarding walkthrough on a fresh profile and confirm it completes in under 90 seconds.
- Check that the warning banner no longer appears for accounts with no billing history.
`;

export const CLAUDE_PLAN_LONG = `# Desktop Shortcut Unification Rollout

## Summary
Implement a full shortcut-system rollout for the desktop app in one functional change set, not a staged coexistence migration. The new system will cover every current app-level and workspace-level shortcut plus a new \`CmdOrCtrl+,\` Settings shortcut, while keeping truly local keyboard behavior local.

This plan is based on the current code, not the prior writeup. Pre-change baseline checks are green: \`cd desktop && pnpm exec tsc --noEmit\` and \`cargo check --manifest-path src-tauri/Cargo.toml\`.

## Implementation Changes

### 1. Replace ad hoc shortcut registration
**Files:** \`desktop/src/hooks/shortcuts/use-global-shortcuts.ts\`, \`desktop/src/config/shortcuts.ts\`

Consolidate the three existing shortcut registration points into a single descriptor list in \`config/shortcuts.ts\`. Each descriptor carries:
- \`id\`: stable string key
- \`label\`: user-facing accelerator text (e.g. "⌘K", "Esc")
- \`description\`: tooltip copy
- \`scope\`: "global" | "workspace" | "composer"
- \`handler\`: dispatched through a central keyboard router

### 2. Route keyboard events through a single dispatcher
**File:** new \`desktop/src/lib/keyboard/dispatcher.ts\`

The dispatcher matches against the descriptor list, takes the \`scope\` of the currently-focused element into account, and fires the handler. This replaces the \`useKeyboardShortcut\` hook and the inline \`onKeyDown\` listeners scattered across the codebase.

### 3. Add the missing Settings shortcut
Wire \`CmdOrCtrl+,\` to navigate to \`/settings\`. The accelerator surface should show in the macOS menu as well — update \`desktop/src-tauri/src/menu.rs\` to register a Settings menu item with the same accelerator.

### 4. Remove the \`useState\` noise in \`components/header.tsx\`
With the single-list migration, the header no longer needs its own \`Sheet\`/\`SheetContent\`/\`SheetTrigger\` machinery. Replace with plain inline links.

## Verification
- \`pnpm tsc --noEmit\` passes
- \`cargo check --manifest-path src-tauri/Cargo.toml\` passes
- Manual: every existing shortcut still fires, the new Settings shortcut opens settings, and the menu shows the accelerator
- Manual: \`Esc\` in the composer still clears focus without triggering workspace-level shortcuts
`;
