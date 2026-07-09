# Frontend Styling

Scope:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/mobile/src/**`
- shared styling under `apps/packages/design/**`, `apps/packages/ui/**`,
  `apps/packages/product-ui/**`, and `apps/packages/product-surfaces/**`

This file covers styling-only rules. Read
[README.md](../README.md) for structure, ownership, and data-flow guidance.

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
- `apps/packages/design/src/css/dom.css` owns the shared Desktop/Web DOM entrypoint:
  Tailwind setup, shared package `@source` entries, shared reset/root/body
  defaults, shared scrollbar utilities, and shared Proliferate global classes.
  Apps import this as `@proliferate/design/dom.css`.
- `apps/packages/design/src/css/desktop.css` owns package-managed Desktop DOM
  CSS: fonts, desktop theme presets, and global runtime selectors. Desktop
  imports this as `@proliferate/design/desktop.css`.
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
(`bg-sidebar-background`) must use sidebar-specific tokens:

- `bg-sidebar-accent` / `hover:bg-sidebar-accent` for hover and active states
- `text-sidebar-foreground` / `text-sidebar-muted-foreground` for text
- `border-sidebar-border` for borders

Do not use generic `bg-accent` or `hover:bg-muted` inside sidebar surfaces —
those resolve to different colors and look wrong against the sidebar
background.

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

For card-like containers (diff cards, file entries, settings items):

- Background: `bg-foreground/5` for subtle tint against any surface
- Header: double-layer pattern for opaque sticky headers:
  outer `bg-sidebar-background`, inner `bg-foreground/5`
- Border radius: `rounded-lg` with `overflow-clip`
- Spacing between cards: `gap-2`

Do not use `bg-sidebar-accent/30` or similar opacity-based backgrounds that
shift meaning across themes. `bg-foreground/5` is theme-stable.

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

In DOM apps/packages, `apps/packages/ui/**` owns the primitive visual contract.
Do not define primitive components outside that folder.

Forbidden outside `apps/packages/ui/**`:

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
primitive in `apps/packages/ui/**`. Callsite classes may handle layout,
spacing, and sizing; primitives own color, border, radius, typography, focus,
hover, disabled, and loading states.

When using primitives from `apps/packages/ui/**`, shared product components
from `apps/packages/product-ui/**`, or connected surfaces from
`apps/packages/product-surfaces/**`, import `@proliferate/design/dom.css`;
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

Shared element resets in `dom.css` (e.g. the `a` color/underline reset) must
live in `@layer base`, never unlayered. Tailwind v4 puts utilities in
`@layer utilities`, and unlayered CSS beats every layer regardless of
specificity — an unlayered reset silently strips intentional utility classes
(link color, underline, the file/provider mention styles) off the matching
element, which then renders as plain inherited text. A `<button>`-based mention
escapes an `a` reset and looks fine while the equivalent `<a>` does not, which is
exactly how this hides.

App stylesheets should be import-only where possible. `apps/web/src/index.css`
imports only `@proliferate/design/dom.css`. `apps/desktop/src/index.css`
imports app-owned third-party CSS plus `@proliferate/design/desktop.css`, which
itself imports the shared DOM entrypoint. Mobile uses
`apps/mobile/src/styles/**` and `@proliferate/design/react-native`, not DOM CSS.
