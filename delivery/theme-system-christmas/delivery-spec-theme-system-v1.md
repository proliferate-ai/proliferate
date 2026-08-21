# Delivery Specification: Theme Overlay System v1 + Christmas Theme

Status: frozen delivery specification. Governs one PR from `main` (8556a33204) on branch `theme-system-christmas`. This document is founder-approved intent, frozen per the delivery-specification rule in specs/README.md.

## Intent

Reintroduce user-selectable themes as a second styling axis, orthogonal to color mode, and ship the first theme: Christmas. The app currently pins `themePreset` to `"mono"` and force-migrates every other persisted value back to it. This PR turns that pin into a real preset system without weakening the single-authority token law.

## Rulings (settled, do not reopen)

1. This is a permanent product surface, not a seasonal hack. The overlay machinery ships fully gated.
2. A theme may never override code, diff, syntax, or terminal ANSI roles. Enforced by a generator denylist, not convention.
3. Scope is web and the desktop web view. The React Native bridge (`react-native.ts` / `mobileTheme`) and the AppKit window material sync are untouched; both keep base Mono values under any theme.
4. No new contrast exemptions. Every theme x mode plane must clear the existing floors in `check_theme_contrast.py` clean. If a Christmas value cannot clear a floor, change the value, never the floor.
5. Themes are opt-in only. No date-triggered activation of any kind.

## Architecture

A theme is an overlay: a TypeScript record in the design package mapping existing token names to `{dark, light}` override pairs. Base `themeTokens` remains the sole authority for the full vocabulary; an overlay may retint a role but can never invent one.

Runtime switch: `data-theme` attribute on `<html>`, alongside the existing `data-mode`. Absent attribute or `data-theme="mono"` means base (the generator emits no block for mono; mono IS the base).

Generated CSS gains, after the two existing roots and in stable alphabetical theme order:

```
:root[data-theme="christmas"] { ...dark overrides... }
:root[data-theme="christmas"][data-mode="light"] { ...light overrides... }
```

Because every Tailwind utility compiles to `var(--color-*)`, these blocks re-tint all call sites with zero component changes. `@theme` is untouched: no new `themeFallback` requirements, no new utilities, and shadow overrides (none in v1, but legal) must go through the existing `--elevation-*` twin emission used by the mode roots.

## Delta 1: design package authority

`apps/packages/design/src/tokens.ts` (or a sibling `themes.ts` re-exported through `dist/tokens.js`; implementer's call, but the generator and checker must both consume the compiled artifact):

- `export interface ThemeOverlayValue { readonly dark: string; readonly light: string; readonly provenance: string; }`
- `export const themeOverlays: Record<string, Record<string, ThemeOverlayValue>>` with one entry, `christmas`.
- Every overlay key must exist in `themeTokens`. Every overlay value carries a provenance tag `[THEME:christmas]`.

Denylist (generator + checker fail on any overlay key matching): `--color-diff-*`, `--color-terminal-*`, `--color-syntax-*`, `--color-code-block-background`, `--color-git-*`, plus every non-`--color-*` namespace (motion, text, z, icon, elevation/shadow excluded for v1 by simply rejecting non-color keys).

## Delta 2: generator and checker

`generate-theme.mjs`: after the light root, emit the two blocks per theme as above, reusing the existing `declarations`-style rendering. Overlay values are literals; `color-mix()` is legal here (these are runtime roots, not `@theme`).

`check-theme.mjs` re-projects and additionally asserts:

- byte equality still holds for the full file including overlay blocks;
- every overlay key exists in `themeTokens` and is not denylisted;
- both halves present on every overlay value;
- the full generated sheet still passes the Tailwind `compile()` pass;
- theme names are lowercase kebab and `mono` is not a key (mono is the absence of an overlay).

## Delta 3: contrast gate

`scripts/check_theme_contrast.py` currently reads exactly two blocks by literal selector. Extend it to enumerate every `:root[data-theme="X"]` pair, merge each overlay over its base mode block, and run the identical floor set on the merged result for each theme x mode. Existing ratchet entries apply to base only; a theme gets no ratchet entries and no exemptions (Ruling 4). Pre-existing base misses stay exactly as ratcheted.

## Delta 4: preference plumbing

- `model.ts`: `export const THEME_PRESETS = ["mono", "christmas"] as const; export type ThemePreset = (typeof THEME_PRESETS)[number];` Defaults stay `"mono"`.
- `migration.ts`: replace the hard `!== "mono"` pin with an allowlist check against `THEME_PRESETS`; unknown or legacy values (`ship`, `tbpn`, `original`) still normalize to `"mono"`. Update the comment to say why.
- `user-preferences-persistence.ts`: legacy parser accepts `christmas` as a passthrough alongside the values it already recognizes.
- `config/theme.ts`:
  - `applyMode` companion `applyTheme(preset)` writes `document.documentElement.dataset.theme = preset` (and deletes the attribute for `"mono"`, keeping the base DOM identical to today).
  - `AppearancePreference` gains `themePreset`; `applyAppearancePreference` applies it.
  - `initializeTheme` accepts and applies the preset.
  - Both MutationObservers (`subscribe` and `onThemeChange`) add `data-theme` to `attributeFilter`, so xterm and the highlighters re-read colors on theme switch exactly as they do on mode switch. `getTerminalTheme` needs no change; terminal roles are denylisted so it resolves base values by construction.
- Wherever `applyAppearancePreference` is invoked from the preferences store wiring, thread `themePreset` through (follow the existing `colorMode` path; do not invent a second subscription).

## Delta 5: settings UI

Appearance pane, Theme section: keep the existing mode preview cards untouched, and add a theme picker row beneath them. Reuse the existing settings control idiom (`SettingsRow` + `SettingsMenu`, same `CONTROL_WIDTH_CLASS` pattern) rather than building new preview artwork in v1; `ThemePreviewCards` remains mode-only. Label: "Theme", options "Mono" and "Christmas". Persist through `useUserPreferencesStore.set("themePreset", ...)`.

No colored left-border ownership patterns, existing atoms only, per UI rules.

## Delta 6: the Christmas overlay

Keep the mono neutral structure. Retint only, both halves independently authored to clear the floors:

| Role | Direction |
| --- | --- |
| `--color-primary`, `--color-primary-foreground` | deep evergreen fill, warm off-white foreground |
| `--color-ring`, `--color-sidebar-ring` | warm gold focus |
| `--color-special`, `--color-special-foreground` | gold selection frame family |
| `--color-selected`, `--color-highlight`, `--color-highlight-muted` | faint evergreen wash |
| `--color-link-foreground` | evergreen link |
| `--color-sidebar-status-unseen`, `--color-status-in-progress` | candy red attention dots |
| `--color-accent-foreground`, `--color-sidebar-primary`, `--color-sidebar-accent-foreground` | evergreen accents |

Destructive, warning, success, info, all surfaces, all text tiers, borders, scrollbars stay base. `--color-destructive` in particular must remain visually distinct from the candy red; if the chosen candy red is confusable with base destructive at a glance, darken the evergreen usage instead and drop the red dots from the overlay. Exact hex values are the implementer's craft subject to Delta 3 passing.

## Out of scope

Mobile, native window materials, theme preview artwork, seasonal auto-activation, per-workspace themes, user-authored themes, overlaying non-color namespaces.

## Acceptance

1. `pnpm --filter @proliferate/design build` green (tsc, generator, copy, check-theme).
2. `python3 scripts/check_theme_contrast.py` green with christmas x {dark, light} evaluated and zero new ratchet entries.
3. Existing suites for touched areas green, scoped from the diff: theme.test.ts, migration, persistence, user-preferences-store, AppearancePane tests. New tests: migration allowlist (christmas survives, tbpn normalizes), applyTheme attribute add/remove, observer fires on data-theme flip, generator emits overlay blocks and rejects a denylisted key (negative control: temporarily add `--color-terminal-red` to a fixture overlay and assert the checker fails).
4. Frontend appearance/design gates green (`check_appearance_scaling.py`, design CSS source checks).
5. Manual proof: screenshot dark+christmas and light+christmas of the workspace shell and settings pane; diffs and terminal visibly unchanged.
6. PR carries 1 `release:*` and all matching `area:*` labels at creation, no merge without Pablo.
