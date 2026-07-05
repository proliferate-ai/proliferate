# Files Experience: Codex Visual Spec

Reference source: `/Users/pablohansen/proliferate/reference/codex/` (10 HTML captures + styles.css, captured 2026-07-01/03)

This document extracts the concrete, implementable visual values from Codex's files experience—file tree sidebar, code/file viewer, diff rendering, toolbar/tabs. Values are verbatim where found; derived calculations are noted.

---

## 1. Color System

### 1.1 Base Palette

Defined in `:root` at styles.css line 182+:

```css
/* Grayscale */
--gray-0: #fff;
--gray-50: #f9f9f9;
--gray-100: #ededed;
--gray-300: #afafaf;
--gray-500: #5d5d5d;
--gray-550: #4f4f4f;
--gray-600: #414141;
--gray-700: #303030;
--gray-750: #282828;
--gray-800: #212121;
--gray-900: #181818;
--gray-1000: #0d0d0d;

/* Git decoration colors */
--green-50: #d9f4e4;
--green-300: #40c977;
--green-400: #04b84c;
--green-500: #00a240;
--green-700: #00692a;
--green-800: #004f1f;

--red-50: #ffd9d9;
--red-300: #ff6764;
--red-400: #fa423e;
--red-500: #e02e2a;
--red-600: #ba2623;
--red-900: #4d100e;

--orange-50: #ffe7d9;
--orange-300: #ff8549;
--orange-400: #fb6a22;
--orange-500: #e25507;
--orange-700: #923b0f;
--orange-900: #4a2206;

/* Additional */
--yellow-300: #ffd240;
--yellow-400: #ffc300;
--purple-300: #ad7bf9;
--purple-400: #924ff7;
--blue-50: #e5f3ff;
--blue-100: #99ceff;
--blue-300: #339cff;
--blue-400: #0285ff;
--blue-900: #00284d;
--pink-400: #ff66ad;
```

### 1.2 Git Status Colors

Mapped to base palette, theme-dependent (lines 11800+ for light, 12136+ for dark):

**Light theme:**
```css
--color-decoration-added: var(--green-300);      /* #40c977 */
--color-decoration-modified: var(--orange-300);  /* #ff8549 */
--color-decoration-deleted: var(--red-400);      /* #fa423e */
--color-decoration-unchanged: var(--gray-600);   /* #414141 */
```

**Dark theme:**
```css
--color-decoration-added: var(--green-500);      /* #00a240 */
--color-decoration-modified: var(--orange-700);  /* #923b0f */
--color-decoration-deleted: var(--red-600);      /* #ba2623 */
--color-decoration-unchanged: var(--gray-300);   /* #afafaf */
```

Then bridged to VSCode tokens:
```css
--vscode-gitDecoration-addedResourceForeground: var(--color-decoration-added);
--vscode-gitDecoration-modifiedResourceForeground: var(--color-decoration-modified);
--vscode-gitDecoration-deletedResourceForeground: var(--color-decoration-deleted);
--vscode-gitDecoration-untrackedResourceForeground: var(--color-decoration-added);
/* (other variants map to modified/unchanged as needed) */
```

Finally to diff overrides (line 22442):
```css
--diffs-deletion-color-override: var(--color-token-git-decoration-deleted-resource-foreground);
--diffs-addition-color-override: var(--color-token-git-decoration-added-resource-foreground);
```

### 1.3 Color-Mix Formulas

Codex uses `color-mix()` to derive hover/selected/border states instead of hardcoded hex values. Examples from styles.css:

**Borders** (lines 268+):
```css
/* Default fallback */
--color-token-border: var(--color-border, var(--vscode-foreground))

/* Progressive enhancement with color-mix */
@supports (color: color-mix(in lab, red, red)) {
  --color-token-border: var(--color-border, color-mix(in oklab, var(--vscode-foreground) 8%, transparent))
}

--color-token-border-heavy: var(--color-border-heavy, color-mix(in oklab, var(--vscode-foreground) 12%, transparent))
--color-token-border-light: var(--color-border-light, color-mix(in oklab, var(--vscode-foreground) 5%, transparent))
```

**Diff surface** (line 469+):
```css
--color-token-diff-surface: var(--color-token-main-surface-primary)

@supports (color: color-mix(in lab, red, red)) {
  --color-token-diff-surface: color-mix(in srgb, var(--color-token-main-surface-primary) 94%, var(--color-token-foreground))
}
```

**Diff surface override** (inline styles in changes.html, Tailwind classes in styles.css line 18558+):
```css
/* Standard window */
--codex-diffs-surface-override: color-mix(in oklab, var(--color-token-dropdown-background) 50%, transparent)

/* Extension window */
--codex-diffs-surface-override: color-mix(in oklab, var(--color-token-input-background) 50%, transparent)

/* Applied as: */
--codex-diffs-surface: var(--codex-diffs-surface-override, var(--color-token-main-surface-primary));
background-color: var(--codex-diffs-surface);
```

**Diff header backgrounds** (inline in changes.html):
```css
background-color: color-mix(in srgb, var(--codex-diffs-surface) 88%, transparent);
```

**Text colors** (lines 337+):
```css
--color-token-conversation-header: var(--color-token-foreground)
@supports (color: color-mix(in lab, red, red)) {
  --color-token-conversation-header: color-mix(in oklab, var(--color-token-foreground) 30%, transparent)
}

--color-token-conversation-body: color-mix(in oklab, var(--color-token-foreground) 60%, transparent)
--color-token-text-secondary: color-mix(in srgb, var(--color-token-foreground) 65%, transparent)
```

**Backgrounds** (lines 483+):
```css
--color-token-bg-secondary: color-mix(in srgb, var(--color-token-bg-primary) 92%, transparent)
--color-token-bg-tertiary: color-mix(in srgb, var(--color-token-bg-primary) 85%, transparent)
--color-token-bg-fog: color-mix(in oklab, var(--color-token-foreground) 2.5%, transparent)
```

---

## 2. Code Viewer Metrics

### 2.1 Typography

From `:root` (lines 22439+):

```css
--diffs-font-family: var(--font-mono);
--diffs-font-size: var(--vscode-editor-font-size, 12px);
--diffs-line-height: calc(var(--diffs-font-size, 12px) * 1.8);
```

**In extension window** (line 22451):
```css
--diffs-font-size: calc(var(--codex-chat-code-font-size) - 1px);
```

**Font stacks** (lines 223+):
```css
--font-mono-default: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

**Derived values:**
- Default font size: **12px**
- Line height: **12px × 1.8 = 21.6px** (effectively ~22px)
- Font family: monospace stack (SF Mono on macOS)

### 2.2 Gutter & Grid Layout

From inline styles in changes.html:

```css
--diffs-min-number-column-width: 4ch;
--diffs-min-number-column-width-default: 3ch;
```

**Grid template** (observed in changes.html inline styles):
```css
grid-template-columns: var(--diffs-column-number-width) auto;
```

**Example concrete values** (from changes.html):
```css
--diffs-column-width: 162px;
--diffs-column-number-width: 57px;
--diffs-column-content-width: 105px;
```

**Gap block** (line 22444):
```css
--diffs-gap-block: 0;
```

### 2.3 Padding

From Tailwind utility classes in changes.html (also lines 22443+ for header overrides):

```css
--codex-diffs-header-padding-x: 1rem;
--codex-diffs-header-padding-y: 0.25rem;
```

These are overridden in thread contexts via:
```css
--codex-diffs-header-padding-x: var(--thread-resource-card-row-padding-x);
--codex-diffs-header-padding-y: var(--turn-diff-row-padding-y);
```

---

## 3. Tree Metrics

From files.html inline `<style data-file-tree-unsafe-css="">` block:

### 3.1 Row & Font Sizing

```css
:host {
  --trees-font-size-override: 13px;
}
```

**Row height** (from treeitem inline style in files.html):
```css
style="min-height: 28px;"
```

So:
- Font size: **13px**
- Row height: **28px** (= `h-7` = `calc(var(--spacing) * 7)` where `--spacing: 0.25rem`)

### 3.2 Padding & Indentation

From unsafe-css block:

```css
--trees-item-padding-x-override: 6px;
--trees-item-margin-x-override: 0px;
--trees-level-gap-override: 0px;
--trees-padding-inline-override: 0px;
--trees-item-row-gap-override: 10px;
```

So:
- Horizontal padding per item: **6px**
- Level indent gap: **0px** (indentation is handled by the tree library itself, not via this gap)
- Row gap (vertical spacing between items): **10px**

### 3.3 Color Tokens

From unsafe-css block:

```css
--trees-bg-override: var(--color-token-main-surface-primary);
--trees-bg-muted-override: var(--color-token-list-hover-background);
--trees-border-color-override: var(--color-token-border);
--trees-fg-override: var(--color-token-foreground);
--trees-focus-ring-color-override: var(--color-token-list-focus-outline);
--trees-selected-bg-override: var(--color-token-list-active-selection-background);
--trees-selected-fg-override: var(--color-token-list-active-selection-foreground);
```

These reference VSCode tokens defined in styles.css:
```css
--color-token-list-hover-background: var(--vscode-list-hoverBackground);
--color-token-list-focus-outline: var(--vscode-list-focusOutline);
--color-token-list-active-selection-background: var(--vscode-list-activeSelectionBackground);
--color-token-list-active-selection-foreground: var(--vscode-list-activeSelectionForeground);
```

### 3.4 Git Status Pills

Not explicit in the tree styles, but from changes.html we see git status indicators use:

```css
rounded-full  /* = border-radius: 9999px */
```

And colors from the git decoration tokens above (green-300/500 for added, orange-300/700 for modified, red-400/600 for deleted, depending on theme).

### 3.5 Icon Sizing

From styles.css:

```css
.icon-xs {
  width: 16px;
  height: 16px;
}

.icon-sm {
  width: 18px;
  height: 18px;
}
```

File tree uses **16px × 16px** icons (icon-xs).

---

## 4. Chrome: Sidebar, Filter Input, Tabs

### 4.1 Sidebar Width

**Not explicitly found** in the captures as a hardcoded value. However, from the token definition (line 253):

```css
--spacing-token-sidebar: clamp(240px, 300px, min(520px, calc(100vw - 320px)));
```

This suggests:
- Minimum: **240px**
- Preferred: **300px**
- Maximum: **520px** (or viewport-dependent)

**Default inference:** likely **250px** or **280px** based on typical usage, but not confirmed in these captures.

### 4.2 Resize Handle

From files.html:

```html
<div class="group absolute flex touch-none select-none z-40 top-0 bottom-0 left-0 w-4 -translate-x-2 cursor-col-resize active:cursor-col-resize">
  <div class="sidebar-resize-handle-line pointer-events-none m-auto opacity-0 h-full w-px bg-gradient-to-b from-transparent via-token-foreground/25 to-transparent group-hover:opacity-100 group-active:opacity-100">
  </div>
</div>
```

**Key values:**
- Hit area width: **16px** (`w-4` = `calc(var(--spacing) * 4)` = 1rem)
- Visual line width: **1px** (`w-px`)
- Gradient: `from-transparent via-token-foreground/25 to-transparent` (vertical gradient, 25% opacity at center)
- Visibility: `opacity-0` default, `opacity-100` on hover/active

### 4.3 Filter Files Input

From files.html:

```html
<div class="relative flex h-token-button-composer w-full items-center gap-1.5 rounded-lg border border-token-border bg-token-bg-fog text-base leading-[18px]">
  <label class="sr-only">Filter files</label>
  <svg class="icon-xs ms-2 shrink-0 text-token-input-placeholder-foreground">...</svg>
  <input 
    class="w-full appearance-none border-none bg-transparent py-0 ps-0 pe-1.5 text-token-foreground ring-0 outline-none placeholder:text-token-input-placeholder-foreground"
    placeholder="Filter files…"
  />
</div>
```

**Key values:**
- Height: `h-token-button-composer` = `var(--spacing-token-button-composer)` = `calc(var(--spacing) * 7)` = **28px** (1.75rem)
- Border radius: `rounded-lg` = `var(--radius-lg-base)` = **0.625rem** (10px)
- Border: `border-token-border` (see color-mix formulas above)
- Background: `bg-token-bg-fog` = `color-mix(in oklab, var(--color-token-foreground) 2.5%, transparent)`
- Icon: **16px** (icon-xs), left margin **8px** (`ms-2`)
- Gap between icon and input: **6px** (`gap-1.5` = `calc(var(--spacing) * 1.5)`)
- Text: `text-base` (inherited from default), `leading-[18px]`
- Placeholder color: `text-token-input-placeholder-foreground` = `var(--vscode-input-placeholderForeground)`

### 4.4 Tab Strip

From files.html (tab element):

```html
<div class="group/tab relative flex min-w-0 shrink-0 select-none items-center bg-[var(--app-shell-tab-background)] outline-hidden transition">
  <button type="button" class="flex h-8.5 cursor-interaction items-center gap-1 px-3 py-0.5 text-sm font-medium outline-hidden ring-inset transition-[background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-token-focus-border group-hover/tab:bg-token-toolbar-hover-background data-[state=active]:bg-token-list-active-selection-background data-[state=active]:text-token-list-active-selection-foreground">
    <svg class="icon-xs">...</svg>
    <span class="block w-full min-w-0 whitespace-nowrap">page.html</span>
  </button>
  <button type="button" class="invisible absolute inset-y-0 end-1 z-30 flex items-center pe-1 group-hover/tab:visible">
    <svg class="icon-xs">...</svg>
  </button>
</div>
<div class="h-3 w-px shrink-0 bg-token-border transition-opacity duration-200 opacity-0"></div>
```

**Key values:**
- Tab height: `h-8.5` = `calc(var(--spacing) * 8.5)` = **34px** (2.125rem)
- Padding: `px-3` = **12px**, `py-0.5` = **2px**
- Font: `text-sm font-medium` (14px)
- Icon: **16px** (icon-xs)
- Gap: `gap-1` = **4px**
- Separator: **1px** width (`w-px`), height **12px** (`h-3`), `opacity-0` (shown conditionally)
- Close button: `end-1` = right offset **4px**, `invisible` → `visible` on hover
- Active state: `bg-token-list-active-selection-background`, `text-token-list-active-selection-foreground`
- Hover state: `bg-token-toolbar-hover-background`
- Focus ring: `focus-visible:ring-2 focus-visible:ring-token-focus-border` (2px ring, inset)

### 4.5 Breadcrumb

**Not explicitly found** in files.html. The tab label ("page.html") appears to serve as the primary file identifier, not a separate breadcrumb component.

---

## 5. Additional Visually Load-Bearing Tokens

### 5.1 Transitions

From styles.css (lines 178+, 262+):

```css
--default-transition-duration: .15s;
--default-transition-timing-function: cubic-bezier(.4, 0, .2, 1);
--transition-duration-basic: .15s;
--transition-duration-relaxed: .3s;
--transition-ease-basic: ease;
--cubic-enter: cubic-bezier(.19, 1, .22, 1);
--cubic-exit-snappy: cubic-bezier(.65, 0, .4, 1);
```

Applied as:
```css
transition-property: color, background-color, border-color, opacity, box-shadow, transform, ...;
transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
transition-duration: var(--tw-duration, var(--default-transition-duration));
```

Default: **150ms** with ease-out curve.

### 5.2 Focus Rings

From tab element above:
```css
focus-visible:ring-2 focus-visible:ring-token-focus-border
ring-inset
```

Color:
```css
--color-token-focus-border: var(--vscode-focusBorder);
```

Width: **2px**, inset.

### 5.3 Scrollbar Styling

From styles.css (lines 22493+):

```css
.overflow-auto,
.overflow-scroll,
.overflow-x-auto,
.overflow-y-auto {
  scrollbar-color: var(--color-token-scrollbar-slider-background) transparent;
}

:is(...):hover {
  scrollbar-color: var(--color-token-scrollbar-slider-hover-background) transparent;
}

:is(...):active {
  scrollbar-color: var(--color-token-scrollbar-slider-active-background) transparent;
}
```

Tokens (lines 426+):
```css
--color-token-scrollbar-slider-background: var(--vscode-scrollbarSlider-background);
--color-token-scrollbar-slider-hover-background: var(--vscode-scrollbarSlider-hoverBackground);
--color-token-scrollbar-slider-active-background: var(--vscode-scrollbarSlider-activeBackground);
```

Tree scrollbar gutter (from files.html unsafe-css):
```css
--trees-scrollbar-gutter-measured: 6px;
scrollbar-gutter: auto;
```

### 5.4 Elevation / Shadows

From styles.css (line 241):
```css
--shadow-hairline: 0px 0px 0px .5px #0000001a;
```

For main surface (line 22464):
```css
box-shadow: var(--elevation-prominent);
```

(Exact value of `--elevation-prominent` not found in the subset grep'd, but referenced.)

### 5.5 Corner Radius

From lines 229+:

```css
--corner-radius-scale: 1;
--radius-2xs-base: .125rem;
--radius-xs-base: .25rem;
--radius-sm-base: .375rem;
--radius-md-base: .5rem;
--radius-lg-base: .625rem;
--radius-xl-base: .75rem;
--radius-2xl-base: 1rem;
--radius-3xl-base: 1.25rem;
--radius-4xl-base: 1.5rem;
--radius-2xs: calc(var(--radius-2xs-base) * var(--corner-radius-scale));
--radius-full: 9999px;
```

Common usage:
- Filter input: `rounded-lg` = **0.625rem** (10px)
- Pills (git status): `rounded-full` = **9999px**
- Tabs: no explicit border-radius found (likely small or 0)

---

## 6. What Could Not Be Found

- **Exact sidebar default width**: Token exists but exact pixel value not hardcoded in captures.
- **Breadcrumb styling**: No breadcrumb component observed in files.html; tabs serve this role.
- **Elevation token values**: `--elevation-prominent` referenced but not defined in the lines grep'd.
- **Tree-level indentation step size**: The `--trees-level-gap-override: 0px` suggests indentation is handled by the tree library (likely via padding-left multiplied by level), not via a Codex CSS variable.
- **Diff line number width computation details**: Only the min width (`4ch`, `3ch`) and example concrete values (`57px`) are found; the dynamic calculation logic is not in the CSS.

---

## 7. Inferred vs. Verbatim

**Verbatim values** (copied from captures):
- All color hex codes
- All custom property definitions (`--diffs-*`, `--trees-*`, `--color-token-*`)
- All `color-mix()` formulas
- Font size, line height, padding, border-radius values
- Transition durations and timing functions

**Inferred or calculated**:
- `h-7 = 28px` (calculated from `var(--spacing) * 7` where `--spacing: 0.25rem`)
- `h-token-button-composer = 28px` (calculated from `var(--spacing) * 7`)
- Line height `21.6px` (calculated from `12px * 1.8`)
- Sidebar width "likely 250px or 280px" (not confirmed; token is a `clamp()` expression)

---

## 8. Summary

This spec captures:
1. **Color system**: base palette (gray, green, red, orange scales), git status mapping (light/dark variants), and color-mix formulas for borders, backgrounds, diff surfaces.
2. **Code viewer**: 12px monospace, 1.8 line-height ratio, grid-based gutter (4ch min), header padding (1rem × 0.25rem).
3. **Tree**: 13px font, 28px row height, 6px padding-x, 10px row-gap, VSCode token-based colors for hover/selected/focus.
4. **Chrome**: filter input (28px height, rounded-lg, bg-fog), tab strip (34px height, 12px padding-x, 2px focus ring), resize handle (16px hit area, 1px gradient line).
5. **Transitions**: 150ms default, cubic-bezier easing, 2px focus rings.
6. **Scrollbar**: `scrollbar-color` with hover/active states, 6px gutter.

All values are ready for implementation or cross-reference against our own design system.
