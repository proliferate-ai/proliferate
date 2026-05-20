# Frontend Styling

Scope:

- `desktop/src/**`
- `web/src/**`
- shared DOM styling under `packages/design/**`, `packages/ui/**`, and
  `packages/product-ui/**`

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

- `packages/design/src/tokens.ts` owns serializable cross-client token values.
- `packages/design/dist/theme.css` is generated from those tokens and exposes
  shared CSS theme variables plus shared non-product animation utilities for
  Desktop/Web. Do not hand-edit generated theme output. Desktop currently
  imports this generated CSS while still owning its full product theme presets
  in `desktop/src/index.css`; moving those presets into generated shared tokens
  is a later migration, not part of the foundation package.
- `packages/design/src/dom.css` owns the shared Desktop/Web DOM entrypoint:
  Tailwind setup, shared package `@source` entries, shared reset/root/body
  defaults, shared scrollbar utilities, and shared Proliferate global classes.
  Apps import this as `@proliferate/design/dom.css`.
- Client-specific global selectors are allowed only when explicitly scoped
  under `[data-proliferate-client="desktop"]` or
  `[data-proliferate-client="web"]`.
- Desktop keeps Desktop-only global CSS, third-party overrides, and theme
  runtime behavior in `desktop/src/**`.
- Third-party dependency CSS, such as `@xterm/xterm/css/xterm.css`, is imported
  by the owning app directly. Do not put third-party dependency CSS in
  `packages/design`.
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

Outside `components/ui/**`, do not render raw:

- `<button>`
- `<input>`
- `<label>`
- `<select>`
- `<textarea>`

Use an existing primitive when possible. If the visual treatment is genuinely
new, extend the primitive cleanly or add a new dedicated primitive in
`components/ui/**`.

When using primitives from `packages/ui/**` or shared product components from
`packages/product-ui/**`, import `@proliferate/design/dom.css`; that shared
entrypoint owns the Tailwind package source scanning.

Reusable icons belong in `components/ui/icons.tsx`, not inline inside feature
components.

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

App stylesheets should be import-only where possible. `web/src/index.css`
imports only `@proliferate/design/dom.css`. `desktop/src/index.css` imports
the shared DOM entrypoint plus Desktop-owned third-party CSS and remaining
legacy Desktop-specific theme/runtime CSS.
