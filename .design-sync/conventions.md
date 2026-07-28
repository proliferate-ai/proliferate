## Building with this design system

Proliferate's UI is a **Tailwind-v4 preset** system: components carry their
own styling, and you compose layout with utility classes. Two rules matter
more than everything else below.

### 1. The stock Tailwind palette and type ramp DO NOT EXIST here

The token authority opens with `--color-*: initial; --text-*: initial`,
which **erases** Tailwind's built-in colours and text sizes. So
`text-sm`, `text-2xl`, `text-base`, `bg-slate-500`, `text-gray-400` and
every other stock colour/size class resolve to **nothing** — no error,
just unstyled output.

Use the semantic roles instead. Colours (the ones the system actually
leans on, most-used first):

| Role | Use for |
| --- | --- |
| `text-foreground` / `text-muted-foreground` / `text-faint` | primary / secondary / tertiary text |
| `text-destructive`, `text-success`, `text-warning` | status text |
| `bg-background` | the page surface |
| `bg-surface`, `bg-surface-elevated`, `bg-surface-elevated-secondary`, `bg-surface-control` | raised surfaces, in ascending elevation |
| `bg-card`, `bg-popover` | card and popover surfaces |
| `bg-hover`, `bg-active`, `bg-selected` | interaction states |
| `border-border`, `border-border-light`, `border-border-heavy`, `border-input` | dividers and control outlines |
| `bg-primary` / `text-primary-foreground` | the primary action pair |
| `text-sidebar-foreground`, `text-sidebar-muted-foreground`, `bg-sidebar-background` | sidebar-scoped roles |

Type — these **17 named scales are the entire ramp** (each carries its own
size, line-height and letter-spacing):

`text-hero`, `text-title`, `text-heading`, `text-body`,
`text-body-emphasis`, `text-ui`, `text-ui-sm`, `text-chat`,
`text-chat-meta`, `text-composer`, `text-message`, `text-readable-code`,
`text-markdown-inline-code`, `text-workspace-title`, `text-sidebar-brand`,
`text-sidebar-nav`, `text-sidebar-row`.

`text-ui-sm` and `text-ui` are the workhorses for interface text;
`text-body` for prose; `text-heading` / `text-title` for section and page
headings.

Everything non-colour, non-type is ordinary Tailwind and works normally:
`flex`, `grid`, `gap-4`, `p-6`, `w-full`, `rounded-lg`, `items-center`.
Icon sizing has named helpers: `icon-tight`, `icon-paired`, `icon-status`.

### 2. It is dark-first, and needs no provider

There is **no ThemeProvider and no ColorModeProvider** — tokens live on
`:root` in CSS, so components are correctly styled as soon as the
stylesheet is loaded. Just render them:

```jsx
<Button size="sm">Create workspace</Button>
```

Dark is the default. For light, set `data-mode="light"` on the root
element (`<html data-mode="light">`); every token flips.

Two components DO need a wrapper, and only these: `tooltip-primitive`'s
parts must sit inside `TooltipProvider`, and toasts require `Toaster`
mounted once near the app root. The styled `Tooltip` needs neither.

### 3. Where the truth lives

Read these before styling anything: `styles.css` and its `@import`
closure (the compiled tokens and utilities), and the per-component
`<Name>.prompt.md` + `<Name>.d.ts` for the real prop contract. The
`.d.ts` is authoritative for props — prefer it over guessing from a
component's name.

### 4. An idiomatic composition

Library components for the controls, DS utilities for your own glue:

```jsx
<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-elevated p-6">
  <div className="flex items-center justify-between">
    <h2 className="text-heading text-foreground">Cloud workspace</h2>
    <Badge tone="success">Ready</Badge>
  </div>
  <p className="text-ui-sm text-muted-foreground">
    Runs on a managed sandbox. Commits push to your branch.
  </p>
  <div className="flex items-center gap-2">
    <Button size="sm">Open</Button>
    <Button size="sm" variant="secondary">Settings</Button>
  </div>
</div>
```
