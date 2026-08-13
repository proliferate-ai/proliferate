# Frontend Styling

Scope:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/mobile/src/**`
- shared styling under `apps/packages/design/**` and
  `apps/packages/product-client/**`

This file covers styling-only rules. Read
[README.md](../README.md) for structure, ownership, and data-flow guidance.
ProductClient's `src/domain/**` subtree is included in the package path above
but is headless: it imports no CSS, Tailwind vocabulary, Design package, DOM
primitive, or visual component.

For which layer may style what — the five jobs of UI code (paint/anatomy/state/layout/behavior) and the component placement algorithm — see [DESIGN_SYSTEM.md § Component Library](../DESIGN_SYSTEM.md#component-library).

## Semantic Tokens

Always use semantic theme tokens such as:

- `bg-background`
- `bg-card`
- `text-foreground`
- `text-muted-foreground`
- `border-border`
- `bg-success`
- `bg-destructive`

If a new color meaning is truly needed, add a semantic token and update all
supported themes instead of dropping palette classes into a component.

Shared token ownership:

- `apps/packages/design/src/tokens.ts` owns serializable cross-client token
  values.
- `apps/packages/design/dist/theme.css` is generated from those tokens and exposes
  shared CSS theme variables plus shared non-product animation utilities for
  Desktop/Web. Do not hand-edit generated theme output.
- `apps/packages/design/src/css/product.css` owns the shared Desktop/Web
  product entrypoint: Tailwind setup, shared package `@source` entries, shared
  reset/root/body defaults, fonts, shared scrollbar utilities, and global
  runtime selectors. The ProductClient package entry imports it as
  `@proliferate/design/product.css`, and `apps/web/src/index.css` imports the
  same stylesheet.
- `apps/packages/design/src/css/desktop.css` owns genuine Desktop/native-only
  CSS (drag regions and other Tauri-specific overrides). Desktop imports this
  as `@proliferate/design/desktop.css`.
- Client-specific global selectors are allowed only when explicitly scoped
  under `[data-proliferate-client="desktop"]` or
  `[data-proliferate-client="web"]`.
- Desktop keeps Desktop-only global CSS, third-party overrides, and theme
  runtime behavior in `apps/desktop/src/**`.
- Third-party dependency CSS, such as `@xterm/xterm/css/xterm.css`, is imported
  by the owning app directly. Do not put third-party dependency CSS in
  `apps/packages/design`.
- Mobile consumes React Native-safe values from
  `@proliferate/design/react-native`, not DOM CSS.

## No Raw Tailwind Palette Classes

Do not use raw palette classes such as:

- `bg-red-500`
- `text-zinc-300`
- `border-blue-600`
- `from-slate-900`

Theme decisions belong in tokens, not ad hoc callsite classes.

## Sidebar Tokens

Components rendered inside the right panel or sidebar background
(`bg-sidebar-background`) use the shared state tokens for interaction paint and
sidebar-specific tokens for text:

- `bg-hover` / `hover:bg-hover` for hover and active states, `bg-selected` for
  persistent selection — the same three state roles as everywhere else
- `text-sidebar-foreground` / `text-sidebar-muted-foreground` for text
- `border-border` for borders

Do not use `hover:bg-muted` or ad-hoc overlays inside sidebar surfaces — the
shared state tokens are what keep the shell, sidebar, lists and menus from
drifting apart.

## No Partial-Opacity Hover Transitions on Glyphs

Never animate `opacity` between two visible values (e.g. `opacity-75` →
`hover:opacity-100`) on always-visible text or icons. The opacity animation
creates a compositing layer that collapses at 1.0, re-rasterizing the glyph's
anti-aliasing on every hover — which reads as shimmer/jitter even though
nothing moves. Express the same muted→prominent promotion as a **color**
change instead:

```tsx
{/* BAD: shimmer on every hover */}
<span className="opacity-75 transition-opacity group-hover:opacity-100" />

{/* GOOD: same visual weight, no re-rasterization */}
<span className="text-current/75 transition-colors group-hover:text-current" />
{/* or with explicit tokens: */}
<span className="text-muted-foreground/75 transition-colors group-hover:text-muted-foreground" />
```

`text-current/75` (a color-mix on currentColor) preserves inheritance so
tinted rows (`text-destructive`) still color their glyphs. This rule is only
about *transitions between two visible states* — the 0→100 hover-reveal
pattern below is fine because the element starts invisible.

## Hover Reveal Pattern

Use `group` + `opacity-0 group-hover:opacity-100` for actions that should
appear on hover. Name the group when nesting is possible:

```tsx
<div className="group/file-diff ...">
  {/* Always visible content */}
  <div className="opacity-0 transition-opacity group-hover/file-diff:opacity-100">
    {/* Hover-revealed actions */}
  </div>
</div>
```

Use `transition-opacity duration-200` for smooth reveal. Keep the always-
visible element (like a chevron or status indicator) outside the hidden
container.

## Card Surfaces

Reach for the `Card` pattern
(`#product/primitives/patterns/Card`) before hand-rolling a card-like
container (diff cards, file entries). It owns the whole recipe below.
The recipe is documented here because it is what `Card` paints, not as a
licence to re-assemble it.

- Background: `bg-surface-elevated-secondary` for a subtle tint against
  any surface. This is the token form of the theme-stable card tint —
  3% white in dark, 4.9% light ink in light. Do not write
  `bg-foreground/5`: the appearance gate's `FOREGROUND_ALPHA_RE` rejects
  raw `foreground/<alpha>` fills, and the token is the sanctioned way to
  name the same wash.
- Header: double-layer pattern for opaque sticky headers. A sticky
  header over a tinted card cannot just repeat the tint, or the body
  shows through it — so the outer layer paints the opaque plane behind
  the card and the inner layer repaints the tint on top, resolving to
  exactly the body's colour. The ground is whatever the card's own
  parent paints, and `Card`'s `plane` axis names the two grounds it
  supports: `content` is `bg-background`, `rail` is `bg-sidebar` — the
  ground the git/review rail that hosts these cards paints
  (`GitPanel.tsx`). `bg-sidebar-background` is a *third*, darker plane
  (`#181818` against `bg-sidebar`'s `#222222`) painted by the right-panel
  frame, the attached pane shell and the file-tree pane; a card whose
  parent is one of those cannot ground on `plane="rail"` without seaming,
  and needs a review decision rather than a guessed token.
- Border radius: `rounded-lg` with `overflow-clip`. Never
  `overflow-hidden`, which establishes a scroll container and freezes a
  sticky header inside a box that never scrolls.
- Spacing between cards: `gap-2`, owned by the container.

Do not use `bg-hover/30` or similar opacity-based backgrounds that
shift meaning across themes.

## RTL Truncation for File Paths

Long file paths should truncate from the left (showing the filename end).
Use the RTL direction trick:

```tsx
<span className="min-w-0 truncate text-start [direction:rtl]" title={fullPath}>
  <span className="[direction:ltr] [unicode-bidi:plaintext]">
    {fullPath}
  </span>
</span>
```

The outer span truncates from the left via `[direction:rtl]`. The inner span
restores left-to-right rendering for the actual text.

## Syntax Highlighting

Use Shiki for syntax-highlighted code outside of the Monaco editor:

- `lib/infra/highlighting.ts` owns the Shiki highlighter singleton
- Always pass a `theme` parameter (`"dark"` or `"light"`) — never hardcode a
  single theme
- Use `highlightLines()` for per-line token arrays (diffs, inline code)
- Use `highlightCode()` for full HTML blocks (code panels, previews)
- Hooks own the async Shiki call; components render the result

The `proliferate-dark` and `proliferate-light` Shiki themes live in
`highlighting.ts`. When adding new token scopes, update both themes.

## Monaco Editor

Use the custom `proliferate-dark` / `proliferate-light` Monaco themes defined
in `lib/infra/monaco-theme.ts`. Register both in `beforeMount` and select
based on `useResolvedMode()`.

Key options to preserve:
- `useShadows: false` on scrollbar (no scroll shadow)
- `glyphMargin: false`, `lineNumbersMinChars: 3`
- Font: `'Geist Mono', monospace`

## Git Diff Colors

All themes define git-specific tokens:

- `text-git-green` / `text-git-red` for inline stats
- `text-git-new-line` / `text-git-removed-line` for diff line text
- `bg-[var(--git-new-line-bg)]` / `bg-[var(--git-removed-line-bg)]` for line
  backgrounds
- Border and highlight variants at different opacity levels

These are defined per-theme in `index.css`. Do not hardcode green/red — use
the tokens.

## UI Primitives First

In DOM package code,
`apps/packages/product-client/src/primitives/**` owns the primitive visual
contract. Do not define primitive components outside that subtree.
The sibling `product-client/src/domain/**` subtree is not a styling or primitive
owner and cannot depend on this DOM layer.

Forbidden outside `apps/packages/product-client/src/primitives/**`:

- defining a local `Button`, `IconButton`, `Input`, `Dialog`, `Menu`, `Select`,
  `Tabs`, `Tooltip`, `Badge`, layout shell, or equivalent lookalike
- wrapping raw DOM controls in a reusable locally styled primitive
- restyling raw controls at callsites to mimic a primitive
- rendering raw controls directly:

- `<button>`
- `<input>`
- `<label>`
- `<select>`
- `<textarea>`

If a visual treatment is missing, extend the primitive API or add a dedicated
primitive in `apps/packages/product-client/src/primitives/**`. Callsite classes
may handle layout, spacing, and sizing; primitives own color, border, radius,
typography, focus, hover, disabled, and loading states.

When using ProductClient primitives or shared ProductClient components,
import `@proliferate/design/product.css`;
that shared entrypoint owns the Tailwind package source scanning.

Reusable icons belong in app/package primitive icon modules, not inline inside
feature components.

## Callsite Styling

Allowed at callsites:

- spacing
- layout
- sizing
- composition

Callsite styling means `className` at the callsite. Prefer utility classes for
static layout, spacing, sizing, and composition.

Use inline `style={...}` only when the value is truly dynamic and cannot be
expressed cleanly with existing utilities or CSS variables. Typical examples
are runtime-calculated widths, heights, positions, or custom properties passed
to a class-driven layout.

Do not rebuild the product visual language at the callsite with ad hoc
border/color/typography stacks that should come from the primitive contract.

## Global CSS

Global CSS is for:

- theme tokens
- theme definitions
- resets
- third-party overrides

Component-specific styling belongs with the component or primitive, not in
`index.css`.

Shared element resets in `product.css` (e.g. the `a` color/underline reset) must
live in `@layer base`, never unlayered. Tailwind v4 puts utilities in
`@layer utilities`, and unlayered CSS beats every layer regardless of
specificity — an unlayered reset silently strips intentional utility classes
(link color, underline, the file/provider mention styles) off the matching
element, which then renders as plain inherited text. A `<button>`-based mention
escapes an `a` reset and looks fine while the equivalent `<a>` does not, which is
exactly how this hides.

App stylesheets should be import-only where possible. `apps/web/src/index.css`
imports only `@proliferate/design/product.css`. Desktop imports
`@proliferate/design/desktop.css` in `apps/desktop/src/main.tsx`; the shared
product theme rides with the compiled ProductClient package entry, whose
`index.css` imports `@proliferate/design/product.css`. Mobile uses
`apps/mobile/src/styles/**` and `@proliferate/design/react-native`, not DOM
CSS.
