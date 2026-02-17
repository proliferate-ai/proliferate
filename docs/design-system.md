# Proliferate Design System

Design direction: minimalist, clean, professional (in the spirit of Linear, Raycast, and Perplexity). The product UI is a canvas of whites, grays, and near-blacks. Color is reserved for actionable elements and meaningful status signals.

## 1) Strict Anti-Patterns

These constraints are mandatory for product UI work.

1. **No generic component-library tropes**
	- No tinted success/warning/info callout boxes.
	- No card-within-a-card nesting with repeated borders.
	- No pill-style step indicators; use muted text such as `Step 1 of 3`.
2. **No filler UI**
	- Do not add placeholder stat cards, fake metrics, or decorative dashboard widgets.
	- If a block has no clear functional purpose, remove it.
3. **No repetitive decorative icons**
	- Do not place the same meaningless icon on every row.
	- Do not use arbitrary red/yellow/green dots for color.
4. **No monospace for metadata**
	- Do not use `font-mono` for paths, timestamps, counts, or labels.
	- Metadata should use standard sans text (`text-xs text-muted-foreground`).
5. **Collapse metadata**
	- Merge secondary info into one compact line (for example, `api/auth/callback.ts • 2m ago`).
	- Do not spread metadata across multiple columns.
6. **Use existing UI primitives**
	- Build with existing components in `apps/web/src/components/ui/` instead of raw form elements in feature/page code.

## 2) Design Tokens

The system uses neutral, high-contrast monochrome tokens in HSL channel format (without `hsl()` wrapper) for Tailwind opacity compatibility.

### CSS custom properties (`apps/web/src/app/globals.css`)

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 10%;

    --card: 0 0% 100%;
    --card-foreground: 0 0% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 10%;

    --sidebar: 0 0% 98%;
    --sidebar-foreground: 0 0% 10%;
    --sidebar-border: 0 0% 90%;

    --primary: 0 0% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96%;
    --secondary-foreground: 0 0% 10%;
    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 45%;
    --accent: 0 0% 94%;
    --accent-foreground: 0 0% 10%;

    --border: 0 0% 90%;
    --input: 0 0% 90%;
    --ring: 0 0% 10%;

    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 98%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 0 0% 0%;
    --foreground: 0 0% 98%;

    --card: 0 0% 6%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 6%;
    --popover-foreground: 0 0% 98%;

    --sidebar: 0 0% 4%;
    --sidebar-foreground: 0 0% 98%;
    --sidebar-border: 0 0% 12%;

    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 0%;
    --secondary: 0 0% 12%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 12%;
    --muted-foreground: 0 0% 65%;
    --accent: 0 0% 15%;
    --accent-foreground: 0 0% 98%;

    --border: 0 0% 15%;
    --input: 0 0% 15%;
    --ring: 0 0% 100%;

    --destructive: 0 63% 31%;
    --destructive-foreground: 0 0% 98%;
  }
}
```

### Tailwind extension (`apps/web/tailwind.config.cjs`)

```js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"]
      },
      fontSize: {
        xs: ["12px", "16px"],
        sm: ["13px", "20px"],
        base: ["14px", "24px"],
        lg: ["16px", "24px"],
        xl: ["18px", "28px"]
      },
      boxShadow: {
        subtle: "rgba(0, 0, 0, 0.04) 0px 1px 2px",
        keystone: "rgba(0, 0, 0, 0.04) 0px 3px 3px, rgba(0, 0, 0, 0.05) 0px 1px 2px",
        floating: "0 0 0 1px rgba(0,0,0,0.05), 0 8px 24px -4px rgba(0,0,0,0.1)",
        "floating-dark": "0 0 0 1px rgba(255,255,255,0.1), 0 8px 24px -4px rgba(0,0,0,0.5)"
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      }
    }
  }
};
```

## 3) Shared Component Specs and Common Classes

Use these class strings to keep product UI visually consistent.

| Element context | Tailwind classes |
| --- | --- |
| Page container | `flex-1 h-full w-full max-w-6xl mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-6` |
| Section header | `flex items-center justify-between pb-4 mb-4 border-b border-border/50` |
| Page title | `text-lg font-semibold tracking-tight text-foreground` |
| Standard card | `rounded-lg border border-border bg-card text-card-foreground shadow-keystone overflow-hidden` |
| Danger section | `rounded-lg border border-destructive/20 bg-destructive/5 p-5` |
| Danger button | `inline-flex items-center justify-center h-9 px-4 rounded-md border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors` |
| Primary button | `inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium shadow-keystone hover:bg-primary/90 transition-colors disabled:opacity-50` |
| Data table row | `flex items-center justify-between px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm cursor-pointer last:border-0` |
| Metadata line | `text-xs text-muted-foreground truncate mt-0.5` |
| Status badge | `inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground` |

### Modals and dialogs

- Backdrop: `fixed inset-0 z-50 bg-black/80 backdrop-blur-sm`
- Content box: `fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-6 rounded-xl border border-border bg-background p-6 shadow-floating dark:shadow-floating-dark`
- Header: `flex items-center justify-between pb-2 border-b border-border/50`
- Step indicator: `text-sm text-muted-foreground font-medium`
- Summary sections: use plain text or simple borders, not tinted success/warning callouts

## 4) Marketing vs Product Density

Apply different density rules based on context.

| Attribute | Marketing (`/marketing`) | Product (`/dashboard`) |
| --- | --- | --- |
| Typography scale | Expressive, up to `text-6xl`; body often `text-base`/`text-lg` | Dense; max heading `text-xl`; most UI uses `text-sm` and `text-xs` |
| Spacing | Generous (`gap-8` to `gap-16`) | Compact (`p-4` to `p-6`, `gap-2` to `gap-4`) |
| Hit targets | Larger controls (`h-11`/`h-12`) | Compact controls (`h-8`/`h-9`) |
| Background treatment | Decorative layers/gradients allowed | Flat functional surfaces only (`bg-background`, `bg-card`) |

For dashboard widgets, settings forms, and data tables: keep typography compact, avoid meaningless stat blocks, avoid decorative repetition, and prioritize information density with clarity.
