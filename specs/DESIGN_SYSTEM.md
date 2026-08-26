# Design System

The single design document for this codebase. It describes the value system —
type, color, elevation, spacing, radii, motion, icons, layering — the component
vocabulary built on top of it, and how to change either one.

**Two artifacts, one authority.** This document explains how the system works
and why it is shaped that way;
[tokens.ts](../apps/packages/design/src/tokens.ts) holds the values.
Where this document and `tokens.ts` disagree about a number, `tokens.ts` is
right and this document is stale. Every value was audited and consolidated in
July 2026; that pass is why each token carries a provenance tag (see
[Changing The Design](#changing-the-design)).

**Owns:** the value system and the design intent behind it (the closed type
ramp, the color role model, the elevation/spacing/radius/motion/icon/layering
scales), the component library's tier model, governance rule, and sanctioned
index, and the change-control model for moving a value or adding a component.

**Does not own:**

- Class-authoring rules and which CSS file owns which rules —
  [structures/frontend/guides/styling.md](frontend/styling.md).
- The appearance-scaling gate's own contract (what it bans, its baselines, the
  Appearance preference it protects) —
  [systems/product/settings/appearance-scaling.md](codebase/systems/product/settings/appearance-scaling.md).
  This document names the rules that shape the value system; that document is
  the gate's specification.
- Package dependency direction between `design` and ProductClient's nested
  domain, primitives, and connected tiers —
  [structures/frontend/packages/README.md](frontend/packages.md).
- Per-surface product behavior (what a screen does, its flows and copy) — the
  owning [systems/product/**](codebase/systems/README.md) document.

## Where The System Lives

```text
apps/packages/design/
├── src/tokens.ts               the value authority: every color/type/radius/size/layering token
├── src/motion.ts               duration, easing, activity-cadence and delay primitives tokens.ts composes
├── src/react-native.ts         the native bridge: RN-safe projections + hand-authored shadow objects
├── src/css/product.css         shared Desktop/Web entrypoint: Tailwind setup, @source list, font loading, base type, component-scoped rules
├── src/css/desktop.css         Tauri/native-only rules
├── scripts/generate-theme.mjs  projects dist/tokens.js → dist/theme.css (@theme + :root + light root + utilities)
├── scripts/copy-css.mjs        copies src/css/*.css into dist/css for package consumers
└── scripts/check-theme.mjs     re-projects independently; asserts byte equality, real Tailwind compile, ownership laws

apps/packages/product-client/src/primitives/           the component library
├── *.tsx                       root Radix/vendor wrappers + single-purpose visual atoms
├── patterns/                   opinionated compositions built from primitives + tokens
├── icons/                      concrete general, palette, brand, and provider glyph modules
├── utils/, overlays/           cn(), tw-merge, search/scroll, toast, and overlay infrastructure
└── __tests__/                  moved component-library tests

apps/packages/product-client/src/components/patterns/
                                domain-aware patterns: same composition rule as primitives/patterns,
                                but this tier may import #product/domain/<file> view models/vocabulary

scripts/check_appearance_scaling.py   class-level gate: banned class shapes at every call site
scripts/check_frontend_boundaries.py  Radix containment + primitives top-level closure/layer law
scripts/git-hooks/pre-commit          staged-file gate; encodes the load-bearing build order
Makefile                              git-hooks target wires core.hooksPath scripts/git-hooks
```

`apps/packages/product-client/src/primitives` contains root `.ts`/`.tsx` files
plus the five support directories above. That closure is enforced by
`PRODUCT_CLIENT_PRIMITIVES_ALLOWED_SUPPORT_DIRECTORIES` in
[check_frontend_boundaries.py](../scripts/check_frontend_boundaries.py).

## Type

### The closed ramp

Type is a closed set of semantic roles, not a size scale. Each role authors
size, line-height, and letter-spacing together, so a caller picks a *job*
(`text-ui-sm`, `text-chat`) and inherits the whole triple. There is no legal way
to ask for "13px" in the abstract.

| Role | Size | Line-height | Letter-spacing | What it is for |
| --- | --- | --- | --- | --- |
| `ui-sm` | 12px | 16px | `+0.01em` | Meta text, labels, badges, the smallest legible control text. |
| `ui` | 13px | 18px | `+0.005em` | Compact controls: buttons, menu rows, tabs, inputs. |
| `sidebar-nav` | 13px | 18px | `+0.005em` | Sidebar navigation rows. |
| `sidebar-row` | 13px | 18px | `+0.005em` | Sidebar content rows (workspaces, sessions). |
| `chat` | 14px | 22px | `0` | Transcript prose — the reading role. |
| `composer` | 14px | 20px | `0` | Composer input text. |
| `body` | 14px | 21px | `0` | General product prose outside the transcript. |
| `message` | = `chat` | = `chat` | = `chat` | Message body; a pure alias of the transcript reading role. |
| `chat-meta` | `calc(chat − 2px)` = 12px | inherited | inherited | Timestamps and per-turn meta, derived from `chat` rather than pinned. |
| `body-emphasis` | 15px | 22px | `−0.005em` | Emphasized prose, section leads. |
| `workspace-title` | 15px | 22px | `−0.005em` | Workspace/tab titles. |
| `heading` | 17px | 24px | `−0.01em` (`--tracking-heading`) | In-page headings. |
| `sidebar-brand` | 17px | 24px | `−0.01em` (`--tracking-heading`) | The sidebar brand lockup. |
| `title` | 19px | 24px | `−0.025em` (`--tracking-tight`) | Page titles. |
| `hero` | 26px | 34px | `−0.025em` (`--tracking-tight`) | Hero/empty-state display type. |
| `readable-code` | 14px | 1.625 (unitless) | `0` | Monospace prose: code blocks, readable code views. |

Two properties are visible in that table and are the ramp's actual design:

- **Tighter as larger.** Tracking runs positive at the small end (`+0.01em` at
  12px, `+0.005em` at 13px), lands at zero for the 14px reading roles, and goes
  negative as size grows (`−0.005em` at 15px, `−0.01em` at 17px, `−0.025em` at
  19px and 26px). Small text needs air between letters to stay legible; display
  text needs the letters pulled together to stop reading as loose.
- **Ratios shift with role.** Control roles sit near 1.4 (12/16, 13/18), while
  transcript prose gets 14/22 reading leading and the compact composer uses
  14/20. Display roles compress toward 1.26 (19/24) and 1.31
  (26/34). The tighter the leading, the more the type reads as an object rather
  than a paragraph.

`readable-code` is the one unitless line-height in the ramp: code font size is
independently adjustable through the Appearance preference, and a ratio keeps
the block proportional at any resolved size, where a pinned px leading would not.

**The ramp is the entire legal vocabulary.** The generated `@theme` block opens
with `--text-*: initial`, so Tailwind's stock text steps do not exist in the
compiled stylesheet; the consolidation removed the ten generic
`--text-xs`/`sm`/`base`/`lg`/`xl` size and line-height properties outright. The
appearance gate then bans reintroducing them by hand: `text-xs`…`text-9xl`,
`text-[…]`, `leading-[…]`, raw `font-size:` in CSS, and numeric `fontSize` props
all fail `FIXED_TEXT_PATTERNS` in
[check_appearance_scaling.py](../scripts/check_appearance_scaling.py).

> **The chat/composer pair is CI-locked.**
> [check-theme.mjs](../apps/packages/design/scripts/check-theme.mjs)
> asserts that both roles share one font-size rung while transcript leading is
> `font-size + 8px` and compact composer leading is `font-size + 6px`. Retuning
> either role onto a separate size ladder fails the design build.

Thirteen of these roles — `uiSm`, `ui`, `chat`, `composer`, `body`,
`bodyEmphasis`, `workspaceTitle`, `heading`, `title`, `hero`, `sidebarNav`,
`sidebarRow`, `sidebarBrand` — additionally form the frozen ramp that crosses to
React Native, and `check-theme.mjs` pins that key list and its order in
`typography.size`/`lineHeight`/`letterSpacing`. `message`, `chat-meta` and
`readable-code` are derived roles and exist only in CSS.

### Weight

`--font-weight-control: 450` is the single characteristic control weight, applied
through the `font-control` class on icon buttons, menus, pickers and sidebar
rows. It sits a half-step above regular: controls read denser than the prose
around them without stepping up to medium, which at 11–12px turns into a visible
bold and makes a toolbar shout.

Product prose is authored one notch below it — the `--font-weight-body: 445`
token, applied to `html, body` in
[product.css](../apps/packages/design/src/css/product.css) — so the
whole product renders on a variable-font axis between regular and medium, with
controls always the heavier of the two. Two weights, 5 units apart, carry the
entire hierarchy; size and color do the rest.

The token name is what makes `font-control` a real utility: `--font-weight-*` is
Tailwind's own font-weight namespace, so naming the token
`--font-weight-control` is what emits the class. The same trick is why the type
ramp works — `--text-*` is Tailwind's text namespace, so each role above emits
`text-<role>` with its line-height and tracking attached. Two consumers compose
the weight rather than restating it: `--workspace-shell-action-font-weight` is
`var(--font-weight-control)`, and the right-panel tab system reads the same
variable in `product.css`.

### Tracking primitives

Only two tracking values are named, and only because more than one role uses
each: `--tracking-heading: -0.01em` (heading, sidebar-brand) and
`--tracking-tight: -0.025em` (title, hero). Every other role authors its
letter-spacing inline, because it is used once.

### Markdown heading ramp and inline code

Transcript Markdown (`.chat-markdown` in `authenticated.css`) derives its
whole heading hierarchy and inline-code size from the semantic ramp above
plus a small set of unitless scale tokens, rather than pinning literal px
values inside the CSS file — the appearance gate's `fixed-font-size-css` rule
would otherwise flag a raw px `font-size` there.

| Token | Value | Role |
| --- | --- | --- |
| `--markdown-heading-h3-scale` | `1.1667` | h3 size = `--markdown-font-size` (the message's own reading size) × this scale. |
| `--markdown-heading-h4-scale` | `1.0833` | h4 size = `--markdown-font-size` × this scale. |
| `--text-markdown-inline-code` | `0.92em` | Inline `code` size, relative to the surrounding message text (fenced code blocks are unaffected). |

h1 stays anchored on the semantic `--text-title` role and h2 stays the
midpoint of `--text-title` and `--markdown-font-size` — both already
expressed through named roles, so neither needed a new token. h5 and h6 stay
at 1× (no additional scale-up), matching a compact, uppercase
micro-heading treatment rather than growing further.

### Font slots

| Token | Value | Note |
| --- | --- | --- |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, "Segoe UI", sans-serif` | The one UI type slot. Every text role inherits it; nothing else names a UI font. |
| `--font-mono` | `"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` | Code, diffs, terminal, `--diffs-font-family`. |

The sans slot currently ships a native system stack on trial. The previous Geist
value is preserved in git history, so switching back is a one-value revert — the
token's own provenance comment records that. Because the slot is single, no
component can pin a font family: `check-theme.mjs` asserts `product.css`'s
`:root` sets `font-family: var(--font-sans)` and contains no hand-authored
stack.

## Color

Color is expressed as roles, never as a palette. A component asks for
`bg-surface-elevated` or `text-foreground-secondary`; it never asks for a gray.
Every role has a dark and a light half in the same record, so a new role cannot
ship half-themed.

### The house form: one neutral ink per mode

Dark foreground and edge overlays derive from white; light neutrals derive from
one near-black ink, `#1a1c1f`. Light borders, state fills, secondary text,
control fills, scrollbars, and shadows use that ink with role-specific alpha
instead of an opaque gray ramp. The alpha form composes over both the white
content plane and the tinted rail without creating a separate gray for each
parent surface.

The percentages are independently authored per mode because equal numeric
alpha does not produce equal contrast over opposite backgrounds. In light mode,
secondary text uses 65% ink while the faint tier uses 62%; the latter is the
lowest clean two-decimal alpha that clears 4.5:1 on every measured plane,
including the translucent control fill. The contrast contract, not numeric
symmetry, chooses the rung.

Dark foreground-derived roles retain `color-mix(in oklab, …)` for perceptual
steps. Light neutral overlays use direct `rgba(26, 28, 31, alpha)` values so
their source ink and composition are explicit. The diff-view family uses
white-anchored `color-mix(in srgb, #ffffff …, #1a1c1f)` values because those are
surface-on-surface blends rather than translucent overlays.

> **`color-mix()` cannot live in Tailwind's `@theme`, so every default/dark mix
> projected there carries a resolved literal.** Each such mix declares a
> `themeFallback` — a flat
> `rgba()`/hex with no `var()` and no `color-mix()` — which the generator emits
> into the `@theme` half while `:root` keeps the live relative expression.
> `check-theme.mjs` requires the fallback on every projected default/dark mix
> and requires it to be fully resolved, so `@theme` can never silently drop a color.
> The same literals are what the React Native bridge consumes.

### Surfaces

A recessed-to-raised ladder in dark; light uses white content over one `#f6f6f6`
rail, with `#fafafa` reserved for editor/code chrome. Translucent neutral washes
separate controls from either opaque parent.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--color-surface-under` | `#141414` | `#f6f6f6` | Recessed backdrop behind the app frame. |
| `--color-surface` / `--color-background` | `#181818` | `#ffffff` | The root app surface — also the chat/content pane background. |
| `--color-sidebar` | `#222222` | `#f6f6f6` | Sidebar body; light shares the one rail plane. |
| `--color-sidebar-background` | `#181818` | `#f6f6f6` | Shell rail backdrop. |
| `--color-surface-elevated` / `--color-card` | `#212121` | `#ffffff` | Raised cards and panels. |
| `--color-surface-elevated-secondary` | 3% white | 4.9% light ink | A wash for surfaces that must sit on an unknown parent. |
| `--color-popover` | `#2d2d2d` | `#ffffff` | Popover/menu/toast body — the highest opaque step. |
| `--color-surface-editor` | `#282828` | `#fafafa` | Code/editor chrome. |
| `--color-diff-code-surface` | `#111111` | `var(--color-surface-editor)` | Diff code gutter/body, deliberately below root in dark. |
| `--color-surface-control` / `--color-muted` | 96% dark control / `#212121` | 4.9% light ink | Control chrome and low raised fills. |
| `--color-composer-background` | `#2d2d2d` | `#f6f6f6` | The fully opaque composer input surface; light reuses the `#f6f6f6` rail plane. |

The dark ladder steps `#141414 → #181818 → #212121/#222222 → #282828 → #2d2d2d`:
roughly four to five levels of lightness per step, small enough that no step
reads as a color change and large enough to separate two adjacent panels
without a border. The sidebar sits at the `#222222` rung in dark, one step
lighter than the root. Light deliberately has only the white content plane, the
`#f6f6f6` rail, and the `#fafafa` editor plane; reusable fills remain alpha ink
rather than adding opaque intermediate planes.

The composer is opaque in both modes and uses no backdrop filter. That keeps
transcript paint out of the input surface and avoids re-blurring the transcript
while typing. It takes the existing `#f6f6f6` rail plane rather than a fourth
opaque light plane, so the count above stays at three. Light combines a full
CSS-pixel `--color-border-heavy` perimeter with a controlled ink-tinted lift;
the edge keeps the full rounded silhouette unambiguous and the lift makes the
ordinary empty composer read as an available input against white. Dark keeps
its stronger fill step and no perimeter or shadow paint.

### Borders

| Token | Dark | Light | Where |
| --- | --- | --- | --- |
| `--color-border-light` | 5% white | 11.4% light ink | Hairlines inside a component: list separators, table rules. |
| `--color-border` | 8.4% white | 14% light ink | The default border for panels, inputs, cards. |
| `--color-border-heavy` | 12% white | 18% light ink | Active/selected borders and deliberate edges. |
| `--color-input` | 12% white | 20% light ink | Form-control outline. |

Light's values are stronger than the visual proposal's 4.9% / 7.8% / 11.7%
steps because those missed the repository's 1.25:1 edge floor. The chosen alpha
ramp keeps every weight composed from the one ink while clearing the enforced
floor on white, the rail, and the translucent control fill.

### Text

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--color-foreground` | `#ffffff` | `#1a1c1f` | Primary text. |
| `--color-foreground-secondary` | 70% white | 65% light ink | Secondary text, descriptions. |
| `--color-foreground-tertiary` | 50% white | 62% light ink | Tertiary text, placeholders, disabled labels. |
| `--color-muted-foreground` | 70% white | 65% light ink | The widely-used secondary role. |
| `--color-faint` | 50% white | 62% light ink | The widely-used tertiary role. |
| `--color-sidebar-foreground` | 85% | 85% | Sidebar body text: below primary, above secondary. |
| `--color-sidebar-muted-foreground` | 48.1% white | 62% light ink | Sidebar meta, including controls painted on the rail. |

The light faint tier is deliberately close to secondary: 55% light ink resolves
to about 3.74–3.84:1 across the actual planes, while 62% clears 4.5:1 everywhere.
The guard measures white, rail, editor, control, muted, card, popover, and raised
planes after alpha composition. `muted-foreground` and `faint` remain distinct
role names because hundreds of call sites use them.

### Interaction states

| Token | Dark | Light | State |
| --- | --- | --- | --- |
| `--color-hover` | 7.8% white | 5.3% light ink | Pointer hover. |
| `--color-selected` | 3.2% white | 6.5% light ink | Persistent selection. |
| `--color-active` | 5.2% white | 7.8% light ink | Press/open (`active:`, `data-[state=open]`). |

One vocabulary is reused everywhere. The light ladder is ordered so selected
carries more ink than hover and active carries more than selected; all adjacent
steps clear the state-distinction floor. Dark retains its historical ordering,
with the selected-direction miss recorded by the contrast ratchet rather than
hidden.

Consumers use these three roles directly — the shell, sidebar, lists and menus
all paint from the same three tokens, so they cannot drift apart. The gate
reinforces this from the class side: `bg-accent`/`bg-sidebar-accent` are
banned as retired state spellings (`OLD_ACCENT_RE`), and any
`bg-foreground/<alpha>` at or below 10% is banned outright
(`FOREGROUND_ALPHA_RE`) — that is precisely the shape of an ad-hoc overlay
invented where one of these three belongs.

### Semantic families

| Family | Token | Dark | Light |
| --- | --- | --- | --- |
| Destructive | `--color-destructive` | `#fa423e` | `#c02622` |
| | `--color-destructive-subtle` | `rgba(250,66,62,0.12)` | `#fbe9e8` |
| | `--color-destructive-foreground` | `#ffffff` | `#ffffff` |
| Success | `--color-success` | `#40c977` | `#0a7c3f` |
| | `--color-success-subtle` | `rgba(64,201,119,0.14)` | `#e6f4ec` |
| Warning | `--color-warning` | `rgba(255, 180, 50, 0.15)` | `#fdf3dc` |
| | `--color-warning-foreground` | `#ffb432` | `#8a5a00` |
| | `--color-warning-border` | `rgba(255, 180, 50, 0.25)` | `#e8d9ae` |
| | `--color-warning-subtle` | `rgba(242,201,76,0.14)` | same |
| Info | `--color-info` | `#339cff` | `#0b6bcb` |

Each family is independently authored per mode. These status values are outside
the neutral retune: changing the one-ink ladder must not move success,
destructive, warning, or review-state hues.

Git and review state carry a parallel set of roles rather than reusing these:
`--color-git-green`/`-red`/`-yellow`, `--color-diff-added`,
`--color-diff-deleted`, `--color-pr-merged` (`#ad7bf9`/`#8250df`),
`--color-status-in-progress`. Git green matches success in each mode, but the
roles stay separate so diff surface tints can move without changing every
success badge.

### Accents

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--color-primary` | `#ffffff` | `#1a1c1f` | Primary action fill. |
| `--color-primary-foreground` | `#0d0d0d` | `#ffffff` | Text on that fill. |
| `--color-link-foreground` | `#83c3ff` | `#0b6bcb` | Links. |
| `--color-special` | `#339cff` | `#0b6bcb` | Accent for highlighted/special affordances. |
| `--color-ring` | 28% white | `#0b6bcb` | Focus ring. |
| `--color-highlight` | `rgba(51, 156, 255, 0.12)` | `#e5f2ff` | Search/selection highlight fill. |

**Primary is the inverted foreground pair, not a brand hue.** The primary button
is white-on-near-black in dark and near-black-on-white in light. The product's
one chromatic accent is blue, so blue means link, focus, information, or a
called-out affordance and never the primary action. Light uses `#0b6bcb` for
link, focus, info, special, and sidebar-ring roles; dark uses a brighter link
step where prose contrast requires it. There are no per-surface link colors.

### Special-purpose palettes

These are closed sets whose members exist to be indexed, not composed. They are
listed by count because the individual values carry no design rule beyond
"distinguishable, and stable per identity".

| Family | Count | Purpose |
| --- | --- | --- |
| `--color-terminal-*` | 16 | The ANSI 8 + bright 8 set for the embedded terminal; also projected into `codeColors.terminal`. |
| `--color-delegated-agent-*` | 8 | Per-agent identity hues, authored in `hsl()`: the dark half is a light, desaturated tint of a hue and the light half is a darker, more saturated version of the same hue, so agent 3 is recognizably "the red one" in either mode. |
| `--color-diff-*` | 15 | Diff and review chrome: main/panel/header/code surfaces plus the chat-embedded file, turn and inline-tool headers. Light neutral surfaces mix white toward the one light ink. |
| `--diff-view-*` | 6 | The diff view's base, header, context, hover, separator, and context-number surfaces; light values are white-anchored mixes. |
| `--diffs-*` | 16 | The renderer override contract: independently authored addition/deletion/context/separator fills plus type and gutter geometry. |
| `--color-compute-target-*` | 9 | Compute-target identity colors — nine named hues, mode-independent. |
| `--color-file-icon-*` | 5 | File-tree glyph tones (folder, accent, neutral, muted, red). |
| `--scratch-*` | 6 | The scratch editor's type and marker geometry, derived from the message role and expressed in `em`. |
| `--color-window-control-*` | 2 | Native window-control dots (close, minimize). |

## Elevation

The system is near-flat by design. Three elevation roles are authored per mode:

| Token | Dark | Light | Where |
| --- | --- | --- | --- |
| `--shadow-subtle` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | `0 1px 2px rgba(26, 28, 31, 0.06)` | Elements that sit on the page. |
| `--shadow-popover` | `0 4px 12px rgb(0 0 0 / 0.12)` | 0.5px 5% ink edge + 12px 10% ink shadow | Popovers, menus, tooltips, toasts. |
| `--shadow-modal` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | `0 16px 40px rgba(26, 28, 31, 0.18)` | Dialogs, modal shells, command palette. |

Depth is carried by borders and surface steps first, shadow second. Light shadow
color derives from the same `#1a1c1f` ink as the neutral ladder, so elevation
does not reintroduce a blue slate cast.

Two component roles refine the shared scale. The light user-message bubble uses
a 5% ink 2px shadow. The light composer uses `--shadow-composer`: a full
border-heavy perimeter followed by 5px and 20px ink-tinted layers. Both roles
resolve to `none` in dark, where their opaque surface steps already provide
separation. The composer recipe does not change layout and remains controlled
enough to read as an in-page input rather than a popover.

From the class side, the appearance gate bans every other elevation spelling —
`shadow-sm/md/lg/xl/2xl/inner` (stock Tailwind emits a non-token shadow),
`shadow-floating`, `shadow-keystone`, and `shadow-[…]` — through
`OLD_SHADOW_RE`.

React Native ships hand-authored numeric approximations in
[react-native.ts](../apps/packages/design/src/react-native.ts)
(`mobileShadow.subtle`, `mobileShadow.floating`) because RN never parses CSS
shadow strings; each entry is comment-linked to the CSS role it approximates, and
`check-theme.mjs` pins the two-key shape.

## Spacing & Containers

### The spacing scale

The cross-platform spacing export is a sparse 4px scale:

| Key | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| px | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 |

It is sparse on purpose: 7, 9 and 11 are absent because nothing needs 28, 36 or
44px, and adding a key is how a one-off measurement becomes a system value. On
the web these keys coincide with Tailwind's own spacing scale, so `gap-2` and
`p-4` already mean 8px and 16px; the export exists so React Native resolves the
same numbers from the same authority.

### Transcript measure

Five tokens define how a transcript reads:

| Token | Value | Role |
| --- | --- | --- |
| `--container-transcript-readable` | `40rem` (640px) | A narrower measure available to prose-heavy surfaces outside the unified chat flow. |
| `--container-transcript-thread` | `48rem` (768px) | The shared new-chat, transcript, and composer column. `MarkdownBody.tsx` renders prose at `max-w-full` inside this column so the width does not change when a session starts. |
| `--container-transcript-wide` | `56rem` (896px) | The nominal spill measure for tables, images, and code; wide blocks remain bounded by the 48rem shared chat column until a breakout restructure lands (see `MarkdownBody.tsx`'s `table` override). |
| `--spacing-transcript-turn` | `1rem` (16px) | Vertical rhythm between top-level turns. |
| `--spacing-transcript-turn-tight` | `0.25rem` (4px) | Vertical rhythm within a turn, for closely related siblings (e.g. assistant prose and its action-row footer). |

The width tokens name three *available* measures even though conversation
prose currently uses one: the new-chat flow, live transcript, composer, and
wide blocks (tables, code) all fill the 48rem thread column, so the measure
does not change after launch. The 40rem readable tier remains available to
prose-heavy surfaces outside that flow, while the 56rem wide tier records the
space wide blocks may use once a deliberate breakout treatment lands. Two
spacing tiers make a real distinction vertically: turn-to-turn
rhythm and within-turn rhythm are two different rungs, not one shared gap.

These names read oddly because they are authored *into Tailwind's own
namespaces* — `--container-*` and `--spacing-*` — which makes
`max-w-transcript-readable`, `max-w-transcript-thread`, `max-w-transcript-wide`,
`gap-transcript-turn` and `gap-transcript-turn-tight` real generated utilities
rather than bracket values. For the turn gaps that is gate-forced: a raw
`gap-[16px]` fails `ARBITRARY_GAP_RE`. For the widths it is a consistency
choice — the gate has no `max-w` rule. Note that Tailwind v4 does not derive
`space-y-*` from the spacing namespace, so a turn stack is a flex column with
`gap-transcript-turn`, not a `space-y-` variant.

### The 28px compact-control system

The workspace shell is built on one control height:

| Token | Value | Role |
| --- | --- | --- |
| `--workspace-shell-action-size` | `1.75rem` (28px) | Square size of a shell action control. |
| `--workspace-shell-tab-height` | `1.75rem` (28px) | Tab strip height. |
| `--workspace-shell-tab-content-gap` | `0.5rem` (8px) | Gap between a tab's icon, label and close control. |
| `--workspace-shell-action-radius` | `0.5rem` (8px) | Shell action corner. |
| `--workspace-shell-tab-radius` | `0.375rem` (6px) | Tab corner. |

28px is small enough that a tab strip and a toolbar read as chrome rather than
content, and large enough to hold a 16px glyph with 6px of surround. Because
actions and tabs share the height, the shell has a single horizontal rhythm; the
remaining shell tokens are all state colors (transparent/hover/active/selected
background and border) that alias the interaction ladder, so a tab and a toolbar
button respond identically to the pointer.

## Radii

| Token | Value | Where it applies |
| --- | --- | --- |
| `--radius-sm` | `0.375rem` (6px) | Shell tabs — the densest, smallest elements. |
| `--radius-md` | `0.5rem` (8px) | The workhorse: icon buttons, inputs, shell actions, close controls. |
| `--radius-lg` | `0.625rem` (10px) | Sidebar rows, menu items, popover rows, empty-state frames. |
| `--radius-xl` | `0.75rem` (12px) | Dialogs, popover/menu frames, toasts. |
| `--radius-2xl` | `1rem` (16px) | Modal shells and the command palette — the largest panels. |
| `--radius-full` | `9999px` | Pills, avatars, status dots, the composer send button, level bars. |
| `--radius-composer` | `1.75rem` (28px) | The composer frame, as its own name — deliberately softer than the panel scale. |
| `--radius` | `0.5rem` (8px) | The unqualified base, equal to `md`. |

**Radius grows with the element.** The named steps run 6 → 8 → 10 → 12 → 16px
across elements that themselves grow from a 30px sidebar row to a 520px command
palette, so the ratio of corner to element stays in a narrow band and nothing
reads either boxy or over-rounded at its own scale. The sidebar row moved from
`--radius-sm` to `--radius-lg` (6px → 10px) in the sidebar retune — a softer
corner reads better against the sidebar's own recessed surface than it did
against the previous, slightly-raised one.

`--radius-composer` is a named 28px rather than a reference to any shared step
because the composer's corner is its own anatomy value — softer than the
dialogs' `xl`, and past the top of the named scale — tunable without moving every dialog
(`AgentHarnessConfigComposer` already overrides it locally).
`--radius` duplicates `md` as the unqualified base for consumers that ask for
"the" radius.

Arbitrary radius is banned at the class level: `rounded-[…]` in any directional
spelling fails `ARBITRARY_RADIUS_RE`.

## Motion

Motion has two scales that are deliberately *not* aliased to each other, plus a
set of choreography delays and a small feedback scale for confirmation
affordances. All four live in
[motion.ts](../apps/packages/design/src/motion.ts) and are projected
into CSS custom properties by the generator, so no component authors a
millisecond or a bezier.

### Interaction durations

| Token | Value | Role |
| --- | --- | --- |
| `--duration-hover` | 120ms | Pointer/focus feedback: color and opacity. |
| `--duration-enter` | 160ms | Entrance of content, modals, popovers, toasts. |
| `--duration-exit` | 120ms | Exit of those same surfaces. |
| `--duration-disclosure` | 200ms | Disclosure, chevrons, height transforms. |
| `--duration-panel` | 240ms | Panel and rail geometry. |
| `--duration-pop` | 280ms | A compact item joining an already-mounted group. |
| `--duration-emphasized` | 300ms | Emphasized, spring-led product moments. |

**Exits are deliberately faster than entrances** — 120ms out against 160ms in.
An entrance is information arriving and can afford to be seen; an exit is the
user having already moved on, and matching the entrance duration makes dismissal
feel sticky. The scale as a whole is ordered by how much geometry moves: color
(120) < content (160) < height (200) < panel (240) < a compact item joining a
group (280) < a moment you are meant to notice (300).

### Easing

| Token | Curve | Feel |
| --- | --- | --- |
| `--ease-out-quint` | `cubic-bezier(0.19, 1, 0.22, 1)` | The default entrance: fast start, long settle. |
| `--ease-pop` | `cubic-bezier(0.2, 0.9, 0.3, 1.3)` | Compact arrival with a small, deliberate overshoot. |
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | Spring-led emphasis, used with `--duration-emphasized`/`panel`. |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Symmetric transitions and exits. |
| `--ease-linear` | `linear` | Progress and streaming reveal, where constant rate is the point. |

The paired defaults are visible in the composed tokens: `--animate-popover-in`
is `popover-in var(--duration-enter) var(--ease-out-quint)`, and exits in
`product.css` consistently pair `--duration-exit` with `--ease-standard` —
entrances decelerate, exits do not need to.

### Activity cadences

| Value | ms | Role |
| --- | --- | --- |
| `activity.thinkingCycleMs` | 1800 | The thinking-text gleam cycle. |
| `activity.streamRevealFadeMs` | 320 | Per-word fade of streamed text (`--activity-stream-reveal-fade`). |
| `activity.streamRevealHandoffDelayMs` | 160 | Delay before the reveal hands off to static text. |

> **Activity cadence is a separate scale because reduced motion must not stop
> it.** The generated stylesheet zeroes every interaction duration under
> `prefers-reduced-motion: reduce`. Loops and streaming feedback keep their
> cadence, because they are the only signal that work is still happening — a
> zeroed thinking loop is not a calmer UI, it is a UI that looks frozen. The
> comment on `motion.activity` states this directly, and only interaction
> roles appear in the reduced-motion block.

### Choreography delays

`delay.autoHideScrollbarMs: 700`, `delay.hoverCardHideMs: 120`,
`delay.levelBarStaggerMs: 110`. These are waits, not animations: how long a
scrollbar lingers before hiding, how long a hover card tolerates the pointer
leaving, how far apart stepped level bars fire. They live with motion because
they are perceived as part of the same choreography, and JS consumers that must
stay in lockstep with CSS import them and format through `motion.cssMs()`.

The same delay scale also owns the todo progress pill's choreography
(`delay.todoPillStepLingerMs: 3400`, `delay.todoPillStepHideMs: 4000`,
`delay.todoPillHoverLingerMs: 1200`, `delay.todoPillHoverHideMs: 1800`: how
long the pill lingers after a step advance or after the pointer leaves before
its fade starts and finishes), a ghost tab row's collapse window
(`delay.ghostRowFinalizeMs: 280`: covers `duration.disclosureMs` plus
timer-scheduling slack so a deleted row's disclosure transition finishes
before it is torn down), and the bound on an optimistic archive/unarchive
POST's outcome (`delay.optimisticSettleTimeoutMs: 12_000`: past this the
outcome is treated as genuinely unknown rather than a false failure).

### Feedback affordances

`motion.feedback` is a third, smaller scale for a control flipping to a
confirmation label and then reverting — not an animation and not a
choreography wait. `feedback.copiedResetMs: 2_000` is how long a control reads
"Copied" before reverting to its resting label; every copy-to-clipboard
control shares this one token rather than each owning its own reset literal.

### Loading treatments

| Value | ms | Role |
| --- | --- | --- |
| `loading.showDelayMs` | 200 | No loading treatment mounts until a wait has lasted this long. |
| `loading.minDisplayMs` | 300 | A mounted treatment stays at least this long before it yields. |

> **Loading is its own scale, and a treatment is gated, not free.** These two
> waits are JS-scheduled and deliberately unaliased to the interaction or
> activity numbers: `showDelayMs` is the Class C default window from the UX
> Latency + Transitions ADR §4.2, and `minDisplayMs` is the anti-flicker floor.
> Any wait that resolves faster than 200ms never mounts a treatment at all, so
> fast paths stay treatment-free; once a treatment is up it holds for 300ms so a
> just-appeared spinner cannot flash back out.

The [`LoadingBoundary`](../apps/packages/product-client/src/primitives/LoadingBoundary.tsx)
primitive is the single owner of that state machine. Surfaces never hand-roll a
`content-fade-in` + `animation-delay` show-delay again; they pass a discriminated
`pending | empty | ready` state and a treatment slot. Doctrine, all load-bearing:

- The state is discriminated, never a boolean. `empty` is a resolved outcome and
  may only render after data lands; while `pending` the boundary shows the class
  treatment or nothing, never the empty slot.
- The treatment is a call-site slot: Class A is `ProliferateLivingMark`, Class B
  is `Spinner`. The boundary never renders two treatments inside one pending
  window, and the treatment identity is stable for the whole window.
- The one sanctioned reveal is `content-fade-in` at `--duration-enter`; reduced
  motion disables the fade so content appears instantly. No treatment carries a
  raw millisecond.
- The boundary emits `renderer.loading.*` marks (`treatment_shown`,
  `treatment_suppressed`, `settled`) through the same renderer diagnostics port
  as the Rung 1 `renderer.flow.*` family, so the show-delay suppression and the
  min-display hold are observable in telemetry.

> **Skeletons are a carve-out, not a default (ADR §4 Rung 4, FR-1).** A
> placeholder-shape skeleton (`SkeletonBlock`, `.skeleton-shimmer`) is sanctioned
> only for a small fixed-shape row list whose final geometry is genuinely known,
> and only at two named surfaces: the sidebar workspace list
> (`SidebarWorkspaceContent`) and the repo picker rows (`CloudRepoPicker`). Both
> route their skeleton through `LoadingBoundary` as the treatment slot so the
> Class C show-delay still governs it. Every other loading surface is Class C:
> the stable shell stays put and the body shows nothing until content resolves,
> with a Class B `Spinner` reserved for a single named slow region inside that
> shell. Settings pane bodies, the git review body, and any other big-surface
> placeholder are Class C and carry no skeleton. New skeleton sites are a review
> failure unless they are one of the two carve-out surfaces.

> **Raw time literals are illegal in the design CSS.** `check-theme.mjs`'s
> `checkRawMotionAuthority` walks `product.css` and the generated
> theme and fails any `animation`/`transition` declaration carrying a numeric
> `ms`/`s` value — with exactly one exemption: a rule that both declares an
> `infinite` animation and carries the literal `/* activity-motion */` marker.
> The spinner's `1.4s linear infinite` is the sanctioned case. The appearance
> gate enforces the same rule from the call-site side (`numeric-duration`,
> `inline-easing`, `inline-motion-literal`, `inline-js-motion-literal`), so a
> component cannot reintroduce a bezier or a duration constant in TS either.

## Icons & Controls

### Em-based glyph tiers

| Token | Value | At 12px `ui-sm` | At 13px compact UI | At 14px reading text | Role |
| --- | --- | --- | --- | --- | --- |
| `--icon-status` | `0.55em` | 6.6px | 7.2px | 7.7px | Status dots. |
| `--icon-tight` | `0.875em` | 10.5px | 11.4px | 12.3px | Trailing row controls that sit quieter than their text. |
| `--icon-compact` | `1em` | 12px | 13px | 14px | Inline glyphs that match their text exactly. |
| `--icon-indicator` | `1em` | 12px | 13px | 14px | Sidebar row navigation, repository, git, and activity glyphs inside larger alignment wells. |
| `--icon-paired` | `1.230769em` | 14.8px | 16px | 17.2px | The default glyph beside prose. |
| `--icon-control` | `1.333333em` | 16px | 17.3px | 18.7px | The glyph inside an icon-only control. |
| `--icon-large` | `1.666667em` | 20px | 21.7px | 23.3px | Emphasized inline glyphs. |
| `--icon-display` | `2em` | 24px | 26px | 28px | Empty-state and display glyphs. |

**Sizing glyphs in `em` is what makes the Appearance font preference work.** The
two odd-looking ratios are exact by construction: `1.230769em × 13px = 16px`, so
a paired glyph lands at 16px beside compact UI text; `1.333333em × 12px = 16px`,
so a control glyph lands at 16px when its owner uses the `ui-sm` role. At the
current Default rung, compact UI and sidebar text are 13px while reading text
is 14px, so the same proportional tiers resolve to the values shown above.
Because each multiplier is relative, it tracks the user's font preference
automatically where a fixed `size-4` would not.

The sidebar indicator and compact tiers intentionally share a current `1em`
value while retaining distinct semantic roles: sidebar glyphs can be retuned
without changing general inline glyphs. The tiers are projected as
`icon-status`/`icon-compact`/`icon-paired`/
`icon-control`/`icon-large`/`icon-display` utilities in
[product.css](../apps/packages/design/src/css/product.css). The appearance gate
holds the line at every glyph call site: fixed `size`/`width`/`height` attributes
and utilities on owned glyph tags, `[&_svg]:size-N` descendant sizing,
`iconClassName`/`glyphClassName` with fixed sizes, glyph-named class constants,
local glyph component defaults, and `--*icon*-size:` CSS variables all fail.

### Control hit targets

| Token | Value | Utility |
| --- | --- | --- |
| `--size-icon-button-sm` | `1.25rem` (20px) | `size-icon-button-sm` |
| `--size-icon-button-md` | `1.5rem` (24px) | `size-icon-button-md` |
| `--size-icon-button-lg` | `1.75rem` (28px) | `size-icon-button-lg` |

**Hit-target geometry belongs on the wrapper; glyph size belongs on the glyph.**
That split is the reason the container scale is its own set of tokens rather than
a padding convention: the glyph must scale with the user's font preference, and
the pointer target must not. The three steps are 4px apart and top out at the
shell's 28px control height, so an icon button can sit in a dense list (20px), a
pane toolbar (24px), or the shell (28px) without new geometry. The generator
emits each as a square `width`+`height` utility.

Because these utilities set both dimensions, they are registered in
tailwind-merge's stock `size` group in
[tw-merge.ts](../apps/packages/product-client/src/primitives/utils/tw-merge.ts). Unregistered,
a consumer overriding a component's own `h-7 w-7` with `size-icon-button-sm`
would keep both classes and lose on generated-CSS source order — the token
survives the merge but never wins the cascade. The registration is locked against
the generated theme's emitted utilities by a drift test, so adding a fourth tier
without registering it fails.

[RowActionIconButton.tsx](../apps/packages/product-client/src/primitives/RowActionIconButton.tsx)
is the sanctioned primitive for hover-revealed row actions: a 28px box with an
`icon-control` glyph, hover/active overlays, and a reveal contract expressed
entirely in opacity (`group-hover`, `group-focus-within`, `focus-visible`, and
`data-[state=open]`), so a colors-only transition cannot drop the fade. New
row-action affordances compose it rather than re-deriving the box/glyph pairing.

## Layering

| Token | Value | Role |
| --- | --- | --- |
| `--z-base` | 0 | In-flow content — the resting tab in a tab strip. |
| `--z-raised` | 10 | Raised in-flow elements: a hovered tab, a tab-strip active indicator. |
| `--z-sticky` | 20 | Sticky and dragged chrome: the active tab, a tab being dragged. |
| `--z-overlay` | 40 | Modal scrims and full-surface click-catchers. |
| `--z-popover` | 50 | Popovers, menus, dropdowns, inline search overlays. |
| `--z-toast` | 60 | Toasts. |
| `--z-tooltip` | 70 | Tooltips and hover cards — above toasts, because a tooltip can be triggered from a surface a toast overlaps. |
| `--z-top` | 80 | The last resort: native window-control safe areas, drag layers. |

Eight named roles, projected as `z-base` … `z-top` utilities. Steps of 10 leave
room to insert a role between two existing ones without renumbering, and 30 is
currently unused. The ordering is a stacking *contract*: a consumer picks the
role its element plays, and the numbers stay a private detail — which is exactly
what lets `HeaderChatTab` express "resting / hovered / active" as
`z-base` → `z-raised` → `z-sticky` instead of three magic numbers.

Arbitrary `z-[…]` fails `ARBITRARY_Z_RE`. Stock numeric `z-0/10/20/30/40/50` is
censused per file by `STANDARD_Z_RE` and may only shrink: those spellings collide
with the ladder while carrying no role, so no new site can be added, and the
remaining ones burn down as consumers migrate.

## Component Library

The value system above is consumed through a closed set of components. This
section owns the tier model, the governance rule that keeps feature code from
inventing new visual vocabulary, and the sanctioned index of what the library
actually ships.

One non-component module lives inside a tier directory:
[popover-surface.ts](../apps/packages/product-client/src/primitives/popover-surface.ts)
holds the shared popover frame/surface class constants composed by `Popover`,
`DropdownMenu`, and `PopoverButton`. Like the infrastructure directories, it is
not a component: no index row below, no export subpath.

### The five jobs of UI code

Every line of styling anywhere in the frontend does one of five jobs. Each job has one owner and one enforcement level; the whole governance model below is this table applied.

| Job | What it is | Owner | Feature code may | Enforcement |
| --- | --- | --- | --- | --- |
| **Paint** | Color, type scale, elevation, radii, motion — visual identity | `design` tokens + the library | never introduce it | Mechanical for values (the closed set above); token-composed identity at callsites is caught by review checks 1–2 below, not by a gate |
| **Anatomy** | The skeleton of a repeating shape: what makes a row a row, a card a card | patterns | fill slots with ReactNodes | UI-conformance review (below) |
| **State** | Interaction-state choreography: which hover/active/disabled/focus-visible/reveal states exist and how they paint | interactive primitives + patterns | compose a primitive's built-in states; never hand-assemble `hover:`/`active:`/`focus-visible:` stacks on raw elements | UI-conformance review (check 7 below) |
| **Layout** | Arrangement: flex, grid, gap, padding from the scale, width, ordering | feature code | free, always (inter-pattern rhythm belongs to the area scaffold — see below) | none |
| **Behavior** | Focus traps, dismissal, `role=` semantics, overlay positioning | primitives + patterns | compose, never rebuild | Mechanical (Radix/raw-DOM gates) + review |

The litmus test for any ambiguous line: **if a designer changed how the app looks, would this line need to change without a corresponding token or pattern edit?** Yes means the line is doing paint, anatomy, or state work; no means it is layout. The test classifies the job, never the file — placement is decided by the placement algorithm and the rule of two below, so a first-instance shape is paint-and-anatomy that legitimately lives in feature code until its second appearance, and `text-muted-foreground` at a callsite is fine because a redesign changes it through the token.

Slots are what keep the strictness livable. A pattern owns its skeleton and exposes `ReactNode` slots (`RosterRow`'s `leading`/`title`/`trailing`); feature code filling a slot with a `Badge`, a status glyph, or a shortcut hint is the mechanism working, not a violation. What is banned is redrawing the skeleton around the slot contents — and the same table applies *inside* the slot: a `ReactNode` passed into a slot may compose library components and layout, but may not itself constitute a new repeating skeleton. The conformance checks below apply to slot contents too.

Two corollaries. State stacks have exactly one owner: a hover/active/disabled/focus-visible treatment lives inside the interactive primitive or pattern (`Button`, `RosterRow`, `RowActionIconButton`), never hand-assembled per call site — a per-callsite stack is where a missing `active:` state hides until a user feels it. The rule-of-two carve-out applies here too: a first-instance interactive shape with no fitting primitive may carry its own state stack in place, built only from the shared state tokens (`hover:bg-hover`/`bg-selected`/`active:bg-active` and the focus ring), and the stack promotes with the shape on second appearance — what is banned is re-writing states an existing component already owns. The sanctioned hover-reveal idiom (`group` + `opacity-0 group-hover:opacity-100`, per [styling.md](frontend/styling.md)) is slot-content layout, not a state-stack violation. And rhythm is anatomy, not layout: containers own the space between their children, so an area scaffold owns its section gaps the way `SettingsGroup` owns its hairline dividers — two panes built from identical patterns must not drift apart at `space-y-6` versus `space-y-3`.

### The library model

Three tiers inside `product-client/src/primitives`, organized by **component
role, never by feature area** — a component's name describes what it does, not
where it is used:

- **Root files** — the base tier. Holds both the raw Radix (and other vendor)
  wrapper families — `Dialog`, `Popover`, `DropdownMenu`,
  `checkbox-primitive`, `tooltip-primitive`, `Command`, `Sonner` — and
  single-purpose visual atoms that don't compose another primitive: `Button`,
  `Input`, `Label`, `Badge`, `Switch`, `Select`, `Textarea`, `IconButton`,
  `Spinner`, `Skeleton`, and similar. Radix wrappers are vendored,
  shadcn-derived source that the repo owns outright, styled to `design` tokens;
  they are not a separate tier from the plain atoms because both are one-level
  building blocks with no other library component beneath them.
- **`patterns/`** — opinionated reusable compositions one level up from
  primitives: `ModalShell` (built on `Dialog`), `ConfirmationDialog` (built on
  `ModalShell` + `Button`), `CommandPalette` (built directly on `cmdk`, not on
  the `Command` primitive — see the `Command` row below), `EmptyState`,
  `SidebarNavRow`, composer controls, and similar. A pattern is named for the
  job it does (`RosterRow`, `PageHeader`), never for the feature that first needed
  it. The admission test is the props: a pattern's props are only `ReactNode`/`string`/`boolean`/callbacks — shapes, not nouns. A component whose props mention a domain type belongs in the domain-aware tier below.

  Inside this tier, an **area kit** is a family of patterns defining the canonical look of one system — the composer kit (`ComposerTextareaFrame`, `ComposerActionButton`, `ComposerControlButton`, `ComposerTextarea`), the toast system (`ToastBody`/`ToastExpansion`/`ToastHost`, patterned around the root `Sonner` positioner), the sidebar rows (`SidebarNavRow`, `SidebarRowSurface`, `SidebarActionButton`), the settings kit (`SettingsGroup`, `SettingsMenu`, `SettingsSection`, `SettingsRow`, `SettingsScopeTabs`, `SettingsSaveFooter`, `SettingsEmptyState`, `SettingsPageBody`), the tabs kit (`ChromeTab`, `TabGroupPill`), the panel kit (`PanelHeaderEntry`, `PaneOptionsMenuItem`). A kit member is sanctioned even with a single consuming surface: the test for a kit is not reuse but "does this define the canonical look of a system" — kits are the one structural exception to the rule of two below. Kit cohesion beats tier purity — a kit lives in one place, at the level its most domain-bound member requires; never split a kit across tiers to satisfy the props test file by file (two existing kits violate this today — see Current Gaps). A kit whose members sit in the pattern tier owns a directory there: they live under `primitives/patterns/<kit>/` (`composer/`, `toast/`, `sidebar/`, `settings/`, `tabs/`, `panel/` today), and a new member of such a kit lands inside that directory rather than flat beside the shared patterns. A kit member may be composed from any surface: matching another system's look by calling its kit is adoption, not duplication. The kit set is closed: kits exist only for the named app chrome (composer, toast, sidebar, tabs, panel, settings) or by explicit review sign-off recorded as a new named group in the sanctioned index — a feature area is not a system, and declaring one is not a rule-of-two bypass.
- **`icons/`** — concrete glyph modules split by general role, specific surface
  (command palette), or brand (Proliferate mark, auth/model provider glyphs).
  There is no aggregate icon barrel. Icon modules are glyph collections, not
  components in the atom/composition sense, so they get their own tier rather
  than living inside root primitives or `patterns/`.

A fourth tier lives in ProductClient because of an import-direction constraint,
not a different role:

- **`product-client/src/components/patterns/`** — domain-aware patterns. Same composition rule
  as `product-client/src/primitives/patterns/` (built from primitives/patterns + tokens), but this tier
  is allowed to import concrete `#product/domain/<file>` view models and vocabulary, which
  `product-client/src/primitives/patterns/` must not (per the package boundary in
  [packages/README.md](frontend/packages.md)). `BillingGateState`,
  `PrStatusBadge`, and the `secrets/` sub-tree live here for that reason, not
  because they belong to a feature folder.

  Admission to this tier is mechanical: the component's public props must reference a domain noun type — imported from `#product/domain/**` or `#product/lib/domain/**`, or a locally declared view type that the re-audit relocates there — AND the component must compose two or more library components (`SecretManagementPanel` passes, with consumers in the personal, organization, and repo secrets panes). Anything less is a presenter function feeding a pure pattern instead — the mapping still gets exactly one home, beside its types under `#product/lib/domain/**`, and the library stays smaller. The remaining rows that predate this test are grandfathered pending re-audit — see Current Gaps. This tier is a shelf, not a landfill; the settings kit's descent into `primitives/patterns/settings/` and the noun re-audit (which sent `ProductPageShell` down to `patterns/`, `ModelTable` out to its sole consumer, and `billingGateView` to `lib/domain/`) have both shrunk it.

There is no fourth content tier inside `product-client/src/primitives` (no
`surfaces/`, no feature-keyed folder): a component's tier is always a root
primitive, pattern, or icon module, decided by role.

### Governance rule

Feature code (pages, panes, and screens under `product-client` outside
`components/patterns/`, plus `apps/desktop` and `apps/web`) composes library
components and `design` tokens. It does not invent new visual vocabulary:

- **No raw Radix imports outside the library.** Every `@radix-ui/*` import must
  resolve to a root file directly under `product-client/src/primitives/` or any
  file under `product-client/src/primitives/patterns/**`. Radix stays illegal in
  `icons/**`, `utils/**`, `overlays/**`, `__tests__/**`, and higher layers.
  Enforced by `FE-UI-1` in
  [check_frontend_boundaries.py](../scripts/check_frontend_boundaries.py), scanned
  across every frontend package and app.
- **No hardcoded style values.** Colors, spacing, radii, shadows, and motion
  come from `design` tokens through library components, never as arbitrary
  Tailwind brackets or raw hex/duration values at a feature callsite. Enforced by
  the appearance-scaling gate
  ([check_appearance_scaling.py](../scripts/check_appearance_scaling.py),
  owned by
  [appearance-scaling.md](codebase/systems/product/settings/appearance-scaling.md)).
- **No re-implemented library behavior.** A feature component must not build its
  own popover positioning, its own dialog focus-trap, or any other behavior a
  library primitive/pattern already owns — compose the existing one instead of
  shadowing it.

Feature code may still define feature-specific components — a component that only composes library primitives/patterns and tokens does not need to live in the library. Graduation into the library follows the **rule of two**:

- **First instance is free.** The first time a feature needs a genuinely novel shape, it may build it in place — token paint only, composed from existing primitives where they apply. It does not enter the library and does not get an index row.
- **Second appearance promotes.** The PR that would introduce the second implementation of a shape anywhere in the tree must promote the shape into the tier matching its role (with an index row and a registry entry) instead of copying it. Duplicates are never merged as-is; the promotion absorbs both call sites.

Promotion is earned by duplication, never speculative — a component is not moved into the library because it "looks reusable." The inverse also holds: every library component must have at least one non-playground call site, or carry an explicit incubating note in its index row naming the in-flight PR that will consume it; an incubating note expires after one release, and review rejects new ones with no concrete consumer. Incubating rows arise from a kit member landing ahead of its consuming surface slice, or from a promotion whose duplicated call sites already exist in the tree and migrate in the named in-flight slice; a shape with no existing duplication cannot be born incubating, because its admission trigger (the second call site) is itself a consumer. A sanctioned component with zero consumers while feature code hand-rolls its shape is the failure mode this rule exists to catch. Both halves are mechanical: `dead-library-component` in [check_component_library.py](../scripts/check_component_library.py) fails on an index row with no non-playground importer, and `expired-incubating-note` fails on any incubating note still standing, since a note names an in-flight PR and cannot outlive the release that merged it.

Promotion is also bounded in both directions. A pattern that needs a third orthogonal variant axis is split or redesigned, decided in review, never extended — variant-prop monoliths that feature code fears touching are the failure this budget prevents. A variant with a single consumer for a full release returns to its call site, the fission mirror of the call-site rule above — this applies to shared patterns, never to kit members, whose single-surface variants are the kit sanction restated (a kit variant's fission target is another member of the same kit, not the surface). Shape identity is operational: same skeleton DOM and same slot contract is the same shape; differing only in token values is the same shape; differing in slot structure is a different shape.

### Placement algorithm

For any new UI, ask in order:

1. Is it a **value** (a color, size, duration)? → a `design` token.
2. Is it **one thing being rendered** (an atom, an icon)? → `product-client/src/primitives/` or `primitives/icons/`.
3. Is it a **skeleton or a system's look**? First check the sanctioned index — filling an existing pattern's slots is the most common correct answer. A *recurring* skeleton (second instance, or a member of a declared area kit) enters the library: props are shapes only → `primitives/patterns/` (as part of an area kit when it defines one system); props mention domain nouns → `components/patterns/`, under the strict admission test above. A first-instance novel shape stays in feature code per the rule of two.
4. Everything else is a **surface**: feature code that composes, fills slots, and lays out. Free, and it stays in its feature directory permanently.

Surfaces never relocate into the library wholesale. App-level coherence comes from surfaces calling the same patterns, not from merging surface files: two surfaces merge only after pattern adoption has hollowed them out and proven them structurally identical assemblies over different data.

### UI-conformance review

The judgment half of enforcement. Every PR touching frontend components gets reviewed against the current sanctioned index (never a memorized copy) for what the mechanical gates cannot decide:

1. **New shape vs. redraw** — did the PR build row/card/banner/dialog DOM from raw elements when a pattern already owns that skeleton?
2. **Second instance** — is this shape already implemented somewhere? Flag for promotion instead of merge (the rule of two). First instances have no index row, so check against the known-duplicates list in Current Gaps and search the tree for the shape's signature, not only the index.
3. **Hand-rolled overlay semantics** — any new `role="dialog|menu|listbox|tooltip"` outside the library instead of composing `ModalShell`/`PopoverButton`/`Tooltip` (or `DropdownMenu` for keyboard-navigable menus, per the parity rule below).
4. **Geometry escape hatches** — arbitrary values or inline styles without a legitimate cause (virtualization math and grid positioning are legitimate; decorative geometry is not). A legitimate cause is recorded in a comment at the site, so the judgment is visible in the diff.
5. **Icon source** — glyphs come from `primitives/icons/`, never directly from `lucide-react`. Feature code imports zero lucide identifiers and the product packages no longer declare the dependency; any reintroduction — import line or `package.json` entry — is a finding.
6. **New-pattern quality** — honest registry demo, correct tier (shapes vs nouns), named for the job not the feature.
7. **Hand-assembled state stacks** — new `hover:`/`active:`/`focus-visible:` choreography written on a raw element when an interactive primitive already owns those states. A first-instance interactive shape carrying shared state tokens is legal (the rule-of-two carve-out above); a re-implementation of `Button`'s or `RosterRow`'s states is not, and neither is a state stack built from non-state tokens. The `group`/`opacity-0` hover-reveal and muted-to-prominent color-promotion idioms taught in [styling.md](frontend/styling.md) are sanctioned.
8. **Rhythm** — where an area scaffold exists, inter-pattern spacing comes from it (containers own the space between their children). Where no scaffold exists yet, a pane picks one spacing value and review checks consistency across sibling panes, not the choice itself.

### The sanctioned index

Every component below has one canonical `#product/primitives/...` subpath and a
row here. A styled component with no row here is not library-sanctioned; the
index is the closed set, not a sample of it. Closure is mechanical in both directions: `registry-row-without-file` fails on a row whose file is gone, and `tier-file-without-registry-row` fails on a module that lives in a tier directory with no row — the support layers (`utils`, `overlays`, `icons`), the modules named in `NON_COMPONENT_TIER_FILES`, and a component's own private parts (imported only from inside its folder) are the whole of the exemption.

#### Primitives (`product-client/src/primitives/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `AnimatedCollapsibleContent` | [AnimatedCollapsibleContent.tsx](../apps/packages/product-client/src/primitives/AnimatedCollapsibleContent.tsx) | Height + opacity disclosure motion for expand/collapse content; collapsed subtree is inert. |
| `AnimatedSwapText` | [AnimatedSwapText.tsx](../apps/packages/product-client/src/primitives/AnimatedSwapText.tsx) | Crossfade transition when a keyed text value changes. |
| `AnchoredCommandPopover` | [AnchoredCommandPopover.tsx](../apps/packages/product-client/src/primitives/AnchoredCommandPopover.tsx) | Popover surface raised by a command rather than a control — a zero-size fixed anchor near the top of the viewport, so surfaces with no trigger element (command palette, deep link, empty state) get the portal/chrome/dismissal/focus-neutrality of a popover instead of a centered `Dialog`. |
| `Badge` | [Badge.tsx](../apps/packages/product-client/src/primitives/Badge.tsx) | Label/status chip on two axes: `tone` (the seven semantic tints) × `size` (`default` bordered pill / `micro` square count-chip for dense chrome — tighter radius and padding, border painted transparent). The axes are independent but for one cell: `neutral` at `micro` swaps to a flat `muted` fill, because an edgeless chip needs a fill that reads without the pill's chrome; every other tone keeps its tint and ink at either size. Micro was promoted from the git review selectors' local `GitReviewCountChip` plus `LoopsPanel`'s native/emulated chip. |
| `Button` | [Button.tsx](../apps/packages/product-client/src/primitives/Button.tsx) | The button primitive — variant/size/loading/destructive API every other button-shaped component composes. |
| `Checkbox` | [Checkbox.tsx](../apps/packages/product-client/src/primitives/Checkbox.tsx) | One-line re-export of `checkbox-primitive` — see Collision pairs below. |
| `checkbox-primitive` | [checkbox-primitive.tsx](../apps/packages/product-client/src/primitives/checkbox-primitive.tsx) | Raw `@radix-ui/react-checkbox` wrapper — see Collision pairs below. |
| `Command` | [Command.tsx](../apps/packages/product-client/src/primitives/Command.tsx) | Raw `cmdk` wrapper. `CommandPalette` (below) imports `cmdk` directly rather than this wrapper; today's only consumer is [WorkspacesCommandList.tsx](../apps/packages/product-client/src/components/workspace/repo-setup/WorkspacesCommandList.tsx) — two parallel `cmdk` consumers, a transitional gap, not a migration in progress. |
| `Dialog` | [Dialog.tsx](../apps/packages/product-client/src/primitives/Dialog.tsx) | Raw `@radix-ui/react-dialog` wrapper; `ModalShell` composes it. |
| `DotCellLoader` | [DotCellLoader.tsx](../apps/packages/product-client/src/primitives/DotCellLoader.tsx) | Nine-dot activity indicator with wave, orbit, scan, helix, and breathe motion variants. |
| `DropdownMenu` | [DropdownMenu.tsx](../apps/packages/product-client/src/primitives/DropdownMenu.tsx) | Raw `@radix-ui/react-dropdown-menu` wrapper — see DropdownMenu status below. |
| `FixedPositionLayer` | [FixedPositionLayer.tsx](../apps/packages/product-client/src/primitives/FixedPositionLayer.tsx) | Fixed-position wrapper for viewport-anchored overlay content. |
| `IconButton` | [IconButton.tsx](../apps/packages/product-client/src/primitives/IconButton.tsx) | Icon-only button, tone/size variants. |
| `IconTile` | [IconTile.tsx](../apps/packages/product-client/src/primitives/IconTile.tsx) | Glyph in a rounded tinted square, `tone` × `size`; non-interactive by construction, so it owns no state stack and never becomes a button. Promoted from 14 hand-rolled tiles across harness, repo-setup, billing and transcript surfaces. Eight files consume it now — four in the harness area, two in the transcript, plan handoff and the workflow definition list. Most of the unmigrated remainder is off-step or off-tone — `HarnessPane`'s 28px tile, the repo-setup and restart-dialog tiles at a radius the step does not carry, and `BillingOwnerCard`'s elevated-and-bordered pair, which no single `tone` recipe spells. `HarnessAuthSection`'s tile is not: it paints `size-8 rounded-md bg-surface-control text-muted-foreground`, which is exactly `tone="control" size="md"`, and is an unmigrated exact instance rather than a gap in the axes. |
| `Input` | [Input.tsx](../apps/packages/product-client/src/primitives/Input.tsx) | Text input field. |
| `Label` | [Label.tsx](../apps/packages/product-client/src/primitives/Label.tsx) | Form field label. |
| `LoadingBoundary` | [LoadingBoundary.tsx](../apps/packages/product-client/src/primitives/LoadingBoundary.tsx) | The shared loading primitive: takes `pending`/`empty`/`ready`, arms a treatment only after `loading.showDelayMs`, holds it at least `loading.minDisplayMs`, renders the empty slot only post-resolve, and exits through the one sanctioned content fade-in. |
| `PaneIconButton` | [PaneIconButton.tsx](../apps/packages/product-client/src/primitives/PaneIconButton.tsx) | Pane-scoped icon button (24px box), composes `Button`. |
| `Popover` | [Popover.tsx](../apps/packages/product-client/src/primitives/Popover.tsx) | Raw `@radix-ui/react-popover` wrapper; `PopoverButton` composes it. |
| `PopoverButton` | [PopoverButton.tsx](../apps/packages/product-client/src/primitives/PopoverButton.tsx) | Popover-backed trigger/content wrapper with `triggerMode` (`click`/`doubleClick`/`contextMenu`); the sanctioned trigger for click-only popovers and menus (keyboard-navigable menus stay on `DropdownMenu` until parity — see DropdownMenu status below). |
| `PopoverMenuItem` | [PopoverMenuItem.tsx](../apps/packages/product-client/src/primitives/PopoverMenuItem.tsx) | Plain-button popover menu row; the sanctioned menu-item companion to `PopoverButton`. |
| `PopoverSearchField` | [PopoverSearchField.tsx](../apps/packages/product-client/src/primitives/PopoverSearchField.tsx) | Search input for popover pickers; owns focus when mounted by default and supports in-place list-navigation keyboard handling. |
| `ProgressBar` | [ProgressBar.tsx](../apps/packages/product-client/src/primitives/ProgressBar.tsx) | Determinate progress bar. |
| `RadioCardGroup` | [RadioCardGroup.tsx](../apps/packages/product-client/src/primitives/RadioCardGroup.tsx) | Radio-selectable card group with label/description/icon per option. |
| `RowActionIconButton` | [RowActionIconButton.tsx](../apps/packages/product-client/src/primitives/RowActionIconButton.tsx) | Sanctioned hover-revealed row-action icon button (sidebar kebab, archive, tab close, file-row actions) — 28px hit target, 16px glyph. |
| `SegmentedControl` | [SegmentedControl.tsx](../apps/packages/product-client/src/primitives/SegmentedControl.tsx) | Segmented tab-like control. |
| `Select` | [Select.tsx](../apps/packages/product-client/src/primitives/Select.tsx) | Native select styled to tokens. |
| `ShortcutBadge` | [ShortcutBadge.tsx](../apps/packages/product-client/src/primitives/ShortcutBadge.tsx) | Keyboard-shortcut badge. |
| `Skeleton` | [Skeleton.tsx](../apps/packages/product-client/src/primitives/Skeleton.tsx) | Shimmer loading placeholder block. Carve-out only (ADR §4 Rung 4, FR-1): the sidebar workspace list and repo picker rows, both routed through `LoadingBoundary`. Every other surface is Class C (no skeleton). |
| `Sonner` | [Sonner.tsx](../apps/packages/product-client/src/primitives/Sonner.tsx) | Sole toast treatment, split in two: `Sonner` is the transparent positioner (stacking, swipe, 3-visible cap), and the toast body pattern ([ToastBody.tsx](../apps/packages/product-client/src/primitives/patterns/toast/ToastBody.tsx)) paints the whole card — popover frame, always-visible corner close, 28px action cluster with only the primary filled, and the in-place Details expansion (356→480px). |
| `Spinner` | [Spinner.tsx](../apps/packages/product-client/src/primitives/Spinner.tsx) | Inline loading spinner. |
| `StatusDot` | [StatusDot.tsx](../apps/packages/product-client/src/primitives/StatusDot.tsx) | Round semantic-status glyph sized by the `icon-status` tier, `tone` × `fill` (solid disc / hollow ring). The union of two hand-rolled dots (`PrStatusDot`, `RecentWorkStatusDot`) and a dozen inline `icon-status rounded-full bg-*` spans; every tone is an opaque ink, so `warning` maps to `warning-foreground`. `PrStatusDot` composes it, as do the workspace tab strip, the settings sidebar and the workflow run/detail lists. `RecentWorkStatusDot` and the inline spans have not migrated: the ones that remain each want a pulsing `live` state, a halo ring, or the `sidebar-status-unseen` tone, and each of those would be the third axis this row rules out. |
| `Switch` | [Switch.tsx](../apps/packages/product-client/src/primitives/Switch.tsx) | Toggle switch. |
| `Textarea` | [Textarea.tsx](../apps/packages/product-client/src/primitives/Textarea.tsx) | Multi-line text input (default/ghost/flush variants). Deliberately has no mono/code variant: prose inputs render in the sans stack (PRO-153); genuine code inputs style mono at the call site as the `font-mono text-readable-code` pair (see the secrets/API-key editors). |
| `Tooltip` | [Tooltip.tsx](../apps/packages/product-client/src/primitives/Tooltip.tsx) | Formatting wrapper over `tooltip-primitive` — see Collision pairs below. |
| `tooltip-primitive` | [tooltip-primitive.tsx](../apps/packages/product-client/src/primitives/tooltip-primitive.tsx) | Raw `@radix-ui/react-tooltip` wrapper — see Collision pairs below. |
| `TypewriterRevealText` | [TypewriterRevealText.tsx](../apps/packages/product-client/src/primitives/TypewriterRevealText.tsx) | Reveals a label one character at a time the first time it is assigned; a tab that mounts already named renders whole, and reduced motion skips the character clock. Consumed by `ChromeTab`. |
| `UserAvatar` | [UserAvatar.tsx](../apps/packages/product-client/src/primitives/UserAvatar.tsx) | Person avatar with initials fallback (`userInitials()` helper). |

**Collision pairs (transitional).** Two primitive families ship both a raw
wrapper and a same-tier overlay under names that would otherwise collide:
`checkbox-primitive.tsx` (the raw `@radix-ui/react-checkbox` wrapper) sits
alongside `Checkbox.tsx` (a one-line re-export of it), and
`tooltip-primitive.tsx` (the raw `@radix-ui/react-tooltip` wrapper) sits
alongside `Tooltip.tsx` (a formatting wrapper over it, adding `singleLine`
handling). Both pairs are two entry points onto one implementation, not duplicate
components — the lowercase `-primitive` module is the base layer, the PascalCase
module is the styled call-site entry point most consumers use.

**`DropdownMenu` status.** `DropdownMenu.tsx` is a legacy menu system living
alongside the sanctioned `PopoverButton`/`PopoverMenuItem` pair, not a second
tier. Four files import it directly:
[RightPanelNewTabMenu.tsx](../apps/packages/product-client/src/components/workspace/shell/right-panel/RightPanelNewTabMenu.tsx),
[WorkspaceActionsMenu.tsx](../apps/packages/product-client/src/components/workspace/shell/topbar/WorkspaceActionsMenu.tsx)
(both `product-client`), and
[ProposedPlanCard.tsx](../apps/packages/product-client/src/components/workspace/chat/transcript/ProposedPlanCard.tsx), and
[SelectedResponseActionMenu.tsx](../apps/packages/product-client/src/components/workspace/chat/transcript/SelectedResponseActionMenu.tsx)
(both `product-client`; the latter replaced chat's hand-rolled `role="menu"` machine). A fifth consumer,
`WorkspaceItemMenu.tsx`, was deleted when the archiving-workspaces train's R7 rung
folded the workspace sidebar's three-dot menu into the row's hover-action slot
plus its existing context menus. Migrating the remaining four onto `PopoverButton`/`PopoverMenuItem` waits
on parity: Radix's dropdown-menu primitive provides roving-tabindex arrow-key
navigation, typeahead, and managed focus-return-to-trigger that
`PopoverButton`/`PopoverMenuItem` do not implement today. Behavior parity is an
admission requirement for sanctioned replacements — a library component is not
declared the sanctioned replacement for a vendor-backed primitive until it
matches that primitive's keyboard and focus behavior. Until
`PopoverButton`/`PopoverMenuItem` reach parity, `DropdownMenu` remains the
sanctioned path for menus that need keyboard navigation (the five consumers
above are not migration debt); click-only popovers use
`PopoverButton`/`PopoverMenuItem`.

#### Patterns (`product-client/src/primitives/patterns/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `ActionRow` | [ActionRow.tsx](../apps/packages/product-client/src/primitives/patterns/ActionRow.tsx) | The row you answer rather than select: primary/secondary lines plus an always-visible trailing control cluster, never pressable itself, carrying the hover wash that says which row those controls belong to. One `secondaryTone` axis (`muted` / `destructive`, for a second line that *is* the error); alignment derives from whether there is a secondary line, as on `RosterRow`. Promoted from `PromptRecoveryPanel`'s unsent-message row and the workflows resume popover's interrupted-run row, which had both recorded the same two-part refusal of `RosterRow` (hover tied to `onSelect`, secondary line fixed at `text-muted-foreground`) — this pattern is those two gaps, and `RosterRow` stays the row you select. |
| `AutoHideScrollArea` | [AutoHideScrollArea.tsx](../apps/packages/product-client/src/primitives/patterns/AutoHideScrollArea.tsx) | Scroll area whose scrollbar affordance auto-hides. Chains the vertical wheel to the nearest scrollable ancestor at its scroll edges by default (`chainVerticalWheel={false}` opts out); a raw scroller that cannot adopt the pattern wires the same behavior via `useChainedVerticalWheel` from `primitives/utils`. |
| `Card` | [Card.tsx](../apps/packages/product-client/src/primitives/patterns/Card.tsx) | The card surface — fill, radius, clipping and header layering, and nothing else (padding and width stay at the call site). `surface` (`tint` wash / `opaque` bordered panel) × `plane` (which ground a sticky header paints on); `stickyHeader` is a header-slot property, not a third axis. Promoted from 16 hand-rolled shells in the workflows area and 21 in chat; the settings area adopted it too (`AppearancePane`, `OrganizationBudgetsPane`, `HarnessAuthApiKeyDetails`), which was not part of the promotion evidence. Of the chat 21, 2 have migrated onto `Card`, 3 went to `NoticeBanner` (they are notices, not cards) and 3 folded onto the shared tool-call detail panel; the remaining 13 carry a recorded exclusion at the site — most need a fill the two-value `surface` axis does not carry (alpha-modified cards, `bg-muted`/`bg-background` washes, `--color-diff-panel-surface`), some need to overflow their frame, one needs no fill at all, and one needs interaction states `Card` does not own. |
| `ChromeTab` | [tabs/ChromeTab.tsx](../apps/packages/product-client/src/primitives/patterns/tabs/ChromeTab.tsx) | Tabs kit — the workspace-shell chrome tab: fixed-width truncating label, optional badge and shortcut reveal, hover-revealed close. Composes `Button`/`ShortcutBadge`/`TypewriterRevealText`. |
| `CommandPalette` | [CommandPalette.tsx](../apps/packages/product-client/src/primitives/patterns/CommandPalette.tsx) | Command-palette shell/context, built directly on `cmdk` (not on the `Command` primitive — see `Command` row above). |
| `ComposerActionButton` | [ComposerActionButton.tsx](../apps/packages/product-client/src/primitives/patterns/composer/ComposerActionButton.tsx) | Composer primary-action button, composes `Button`. |
| `ComposerControlButton` | [ComposerControlButton.tsx](../apps/packages/product-client/src/primitives/patterns/composer/ComposerControlButton.tsx) | Composer control pill (icon/label/detail/trailing/active), composes `Button`. Three axes: `iconOnly` (icon vs. labeled) × `emphasizeLabel` (two-tone value hierarchy) × `size` (`default` 28px pill / `compact` 24px chip). The third axis was decided in review for the composer handoff (PR #1851) under the rule above that a third orthogonal axis is ruled in review rather than extended into the props — the composer row needed a denser chip than every other surface draws, and splitting the kit member in two would have duplicated its whole state stack. |
| `ComposerTextarea` | [ComposerTextarea.tsx](../apps/packages/product-client/src/primitives/patterns/composer/ComposerTextarea.tsx) | Composer-sized text input, composes `Textarea`. |
| `ComposerTextareaFrame` | [ComposerTextareaFrame.tsx](../apps/packages/product-client/src/primitives/patterns/composer/ComposerTextareaFrame.tsx) | Composer textarea's outer frame/top-inset shell. |
| `ConfirmationDialog` | [ConfirmationDialog.tsx](../apps/packages/product-client/src/primitives/patterns/ConfirmationDialog.tsx) | Confirm/cancel dialog, built on `ModalShell` + `Button`. |
| `Disclosure` | [Disclosure.tsx](../apps/packages/product-client/src/primitives/patterns/Disclosure.tsx) | The chevron expand/collapse shape: a real `<button>` header row (`aria-expanded`/`aria-controls`, native Enter/Space) over an `AnimatedCollapsibleContent` region that is `inert` when closed. Owns the row's whole state stack; `chevronSide` is its one axis, and the `trailing` slot sits outside the toggle so it can hold its own controls. Promoted from 13 hand-rolled disclosures, of which two consume it (`SettingsContentBoundary`, `WorkflowRunDetail`). Four limitations block the rest, recorded in full on the component: the header row's paint is closed to the call site (the chat transcript's 15 quiet rows would get the pressed rectangle PRO-120 removed, and the git review pane's sticky `color-mix` header cannot be painted at all), the title type is fixed at 17px, every child sits inside the collapsible region so there is no always-visible summary slot, and collapsed children stay mounted rather than unmounting. A quiet spelling has to answer all four. |
| `EmptyState` | [EmptyState.tsx](../apps/packages/product-client/src/primitives/patterns/EmptyState.tsx) | Title/description/action empty-state block. |
| `EnvironmentSearchSelect` | [EnvironmentSearchSelect.tsx](../apps/packages/product-client/src/primitives/patterns/EnvironmentSearchSelect.tsx) | Searchable environment picker, composes `PopoverButton`/`PopoverMenuItem`/`PickerPopoverContent`. |
| `ModalShell` | [ModalShell.tsx](../apps/packages/product-client/src/primitives/patterns/ModalShell.tsx) | Modal composition built on `Dialog`. |
| `NoticeBanner` | [NoticeBanner.tsx](../apps/packages/product-client/src/primitives/patterns/NoticeBanner.tsx) | The inline-notice frame: tinted bordered block with a leading glyph, a title/body rhythm, and a trailing action slot. One `tone` axis (`neutral`/`info`/`warning`/`destructive`) that also picks the live-region role; it paints no interaction states, because the action slot takes a primitive that already owns them. Promoted from 16 hand-rolled notices across workflows, chat/activity and settings/billing. |
| `PageContentFrame` | [PageContentFrame.tsx](../apps/packages/product-client/src/primitives/patterns/PageContentFrame.tsx) | Page content frame with header slot and sticky action/title. |
| `PageHeader` | [PageHeader.tsx](../apps/packages/product-client/src/primitives/patterns/PageHeader.tsx) | Page-level header (title/description/actions); `variant="flat"` is the unframed settings look, replacing the retired `SettingsPageHeader`. |
| `PanelHeaderEntry` | [panel/PanelHeaderEntry.tsx](../apps/packages/product-client/src/primitives/patterns/panel/PanelHeaderEntry.tsx) | Panel kit — the canonical entry of a right-panel header strip: leading glyph, truncating label, optional trailing slot, dirty dot, hover-revealed close. Owns `role="tab"`/`aria-selected`/roving `tabIndex` (floored to the first entry when none is active, so the strip stays keyboard-reachable) and its own state stack instead of the `.right-panel-tab-system` descendant CSS. Promoted from four hand-rolled header buttons, now consumed by the right-panel header strip. |
| `PaneOptionsMenuItem` | [panel/PaneOptionsMenuItem.tsx](../apps/packages/product-client/src/primitives/patterns/panel/PaneOptionsMenuItem.tsx) | Panel kit — pane options-menu row, composes `Button`. |
| `PickerPopoverContent` | [PickerPopoverContent.tsx](../apps/packages/product-client/src/primitives/patterns/PickerPopoverContent.tsx) | Popover content shell for pickers: search field + list + empty row. |
| `ProductPageShell` | [ProductPageShell.tsx](../apps/packages/product-client/src/primitives/patterns/ProductPageShell.tsx) | General product page shell, composes `PageContentFrame` + `PageHeader`. Domain-free, so it sits in the generic pattern tier. |
| `RosterPanel` | [RosterPanel.tsx](../apps/packages/product-client/src/primitives/patterns/RosterPanel.tsx) | The roster panel wrapper that pairs with `RosterRow`: static section label, optional header action, the row `<ul>`, an empty line when there are no rows, and an optional footer. Non-interactive — `RosterRow` stays the sole owner of the row state stack. The header is deliberately a static label rather than a `PanelHeaderEntry`, which is a tablist tab entry with no static variant. The label renders as a `span` by default or a semantic heading via `titleAs` when the panel is a labeled document section. Promoted from the activity chips' hand-rolled subagents/terminals/loops panels. |
| `RosterRow` | [RosterRow.tsx](../apps/packages/product-client/src/primitives/patterns/RosterRow.tsx) | The list-panel roster row: leading glyph, primary/secondary lines, always-visible trailing meta, hover-revealed actions. One `density` axis; interactivity is derived from `onSelect`, and hover is suppressed on a selected row. Not the sidebar nav row — that stays on `SidebarNavRow`/`SidebarRowSurface`. Promoted from the near-verbatim `SubagentRosterRow`/`TerminalRosterRow` pair plus the workflow run/definition lists. |
| `SettingsEmptyState` | [SettingsEmptyState.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsEmptyState.tsx) | Settings-scoped empty state (compact/full sizes). |
| `SettingsGroup` | [SettingsGroup.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsGroup.tsx) | Settings/list wash surface: borderless tinted card owning inset hairline dividers between children, optional label and empty slot. |
| `SettingsMenu` | [SettingsMenu.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsMenu.tsx) | Labeled select-style menu, composes `PopoverButton`/`PopoverMenuItem`. |
| `SettingsPageBody` | [SettingsPageBody.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsPageBody.tsx) | Settings kit — the body scaffold of one settings pane, owning the page-width contract (`max-w-[50rem]`) and the section rhythm (`space-y-6`, the root rhythm of 22 of 26 surveyed panes). Deliberately closed: no `className`, because a pane that can override the rhythm is a pane that can drift. Now consumed by the settings pane roots. |
| `SettingsRow` | [SettingsRow.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsRow.tsx) | In-card settings row (label/description/control), divider-agnostic (the owning `SettingsGroup` draws hairlines between rows), fixed 240px control-width companion for menus. |
| `SettingsSaveFooter` | [SettingsSaveFooter.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsSaveFooter.tsx) | Settings save/revert footer with a status badge, composes `Badge` + `Button`. |
| `SettingsScopeTabs` | [SettingsScopeTabs.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsScopeTabs.tsx) | User/org/repo/agents underline scope-switcher tabs, composes `Button`. |
| `SettingsSection` | [SettingsSection.tsx](../apps/packages/product-client/src/primitives/patterns/settings/SettingsSection.tsx) | Sentence-case muted label (or `titleWeight="emphasized"` mini-heading) over a `SettingsGroup` wash card; `surface="plain"` opts out of the card for content that can't sit in one. |
| `SidebarActionButton` | [SidebarActionButton.tsx](../apps/packages/product-client/src/primitives/patterns/sidebar/SidebarActionButton.tsx) | Sidebar action button, composes `RowActionIconButton`. |
| `SidebarNavRow` | [SidebarNavRow.tsx](../apps/packages/product-client/src/primitives/patterns/sidebar/SidebarNavRow.tsx) | Sidebar navigation row (icon/label/status/shortcut), composes the `ShortcutBadge` primitive + `SidebarRowSurface`; modifier-held shortcuts overlay an existing rightmost status instead of widening its trailing region. |
| `SidebarRowSurface` | [SidebarRowSurface.tsx](../apps/packages/product-client/src/primitives/patterns/sidebar/SidebarRowSurface.tsx) | Shared sidebar row interaction surface (active/disabled/press state) other sidebar rows build on. |
| `TabGroupPill` | [tabs/TabGroupPill.tsx](../apps/packages/product-client/src/primitives/patterns/tabs/TabGroupPill.tsx) | Tabs kit — the collapse/expand pill heading a run of grouped tabs; `tone="filled"` paints in the caller's colour, `tone="outline"` is the bordered neutral pill. |
| `ThinkingText` | [ThinkingText.tsx](../apps/packages/product-client/src/primitives/patterns/ThinkingText.tsx) | Animated "thinking" gleam text. |
| `ToastBody` | [ToastBody.tsx](../apps/packages/product-client/src/primitives/patterns/toast/ToastBody.tsx) | Paints the whole toast card (popover frame, corner close, 28px action cluster) rendered inside the `Sonner` positioner; registry-exempt kit internal. |
| `ToastExpansion` | [ToastExpansion.tsx](../apps/packages/product-client/src/primitives/patterns/toast/ToastExpansion.tsx) | The toast's in-place Details expansion (356→480px unfold) and mono excerpt; registry-exempt kit internal. |
| `ToastHost` | [ToastHost.tsx](../apps/packages/product-client/src/primitives/patterns/toast/ToastHost.tsx) | The single toast mount — renders the kit `Toaster` and nothing else. |

#### Icons (`product-client/src/primitives/icons/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `app-shell` | [app-shell.tsx](../apps/packages/product-client/src/primitives/icons/app-shell.tsx) | App-shell tab, terminal, review, and split-panel glyphs. |
| `core` | [core.tsx](../apps/packages/product-client/src/primitives/icons/core.tsx) | General navigation, action, history, and utility glyphs. |
| `platform` | [platform.tsx](../apps/packages/product-client/src/primitives/icons/platform.tsx) | Platform, deployment, account, and device glyphs. |
| `product` | [product.tsx](../apps/packages/product-client/src/primitives/icons/product.tsx) | Product workflow, agent, plan, and state glyphs. |
| `status` | [status.tsx](../apps/packages/product-client/src/primitives/icons/status.tsx) | Semantic status glyphs; `Spinner` remains a root primitive. |
| `workspace` | [workspace.tsx](../apps/packages/product-client/src/primitives/icons/workspace.tsx) | Workspace, file, folder, terminal, and notebook glyphs. |
| `workspace-git` | [workspace-git.tsx](../apps/packages/product-client/src/primitives/icons/workspace-git.tsx) | Git branch, commit, pull-request, and tree glyphs. |
| `command-palette-icons` | [command-palette-icons.tsx](../apps/packages/product-client/src/primitives/icons/command-palette-icons.tsx) | Icon set scoped to the command palette. |
| `proliferate-icons` | [proliferate-icons.tsx](../apps/packages/product-client/src/primitives/icons/proliferate-icons.tsx) | The Proliferate brand-mark glyph. |
| `provider-icons` | [provider-icons.tsx](../apps/packages/product-client/src/primitives/icons/provider-icons.tsx) | Auth/model-provider brand glyphs, composes `proliferate-icons` for the Proliferate entry. |

#### Patterns — domain-aware (`product-client/src/components/patterns/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `AgentIdentityChip` | [AgentIdentityChip.tsx](../apps/packages/product-client/src/components/patterns/AgentIdentityChip.tsx) | Durable agent-identity chip (glyph + title in a pill), composes `AgentIdentityGlyph` + `Button` + `Tooltip`. |
| `AgentIdentityGlyph` | [AgentIdentityGlyph.tsx](../apps/packages/product-client/src/components/patterns/AgentIdentityGlyph.tsx) | Solid Seal renderer for every durable agent-identity surface; geometry and color come from the session-derived identity. |
| `BillingGateState` | [BillingGateState.tsx](../apps/packages/product-client/src/components/patterns/BillingGateState.tsx) | Billing gate panel plus `BillingBalanceNotice` inline banner. The mapping from typed start-block reasons to a view is `billingGateView` in [billing-gate-presentation.ts](../apps/packages/product-client/src/lib/domain/billing/billing-gate-presentation.ts) — presentation logic, not a component. |
| `PrStatusBadge` | [PrStatusBadge.tsx](../apps/packages/product-client/src/components/patterns/PrStatusBadge.tsx) | PR status dot (`PrStatusDot`) and tooltip-text helper (`prStatusTooltip`). The dot composes the `StatusDot` primitive; the domain mapping from a PR status to a tone is `prStatusTone` in [pr-status-presentation.ts](../apps/packages/product-client/src/lib/domain/workspaces/git-status/pr-status-presentation.ts). |
| `secrets/SecretManagementPanel` | `secrets/SecretManagementPanel.tsx` | Presentational secrets-management pattern (list, editor/delete dialogs, scope notice are private internals of this one export). |

### How to add a component

1. **Design against tokens.** Use the type ramp, spacing, radii, motion and icon
   tiers above — never an arbitrary value at the component or the callsite.
2. **Place it in the right tier**, by role, not by the feature that needed it: a
   raw Radix/vendor wrapper or single-purpose atom goes in `product-client/src/primitives/`;
   a generic composition of those goes in `product-client/src/primitives/patterns/`; a domain-aware
   pattern that needs a `#product/domain/<file>` rule goes in
   `product-client/src/components/patterns/`; an icon set goes in
   `product-client/src/primitives/icons/`.
3. **Give it one real ProductClient-internal subpath.** Root components use
   `#product/primitives/<Component>`, generic patterns add `/patterns/`, and
   icon modules add `/icons/`. Do not add a barrel, alias, or public host
   export.
4. **Add a row to the sanctioned index above** — component name, real path,
   one-line purpose, in the matching tier's table.
5. **Add a registry entry with a self-contained demo.** Every library component has a `LibraryEntry` in [components/playground/library/](../apps/packages/product-client/src/components/playground/library/) whose `render()` uses only fixture props and local state — no providers, no stores. This is not optional documentation: [library-registry.test.ts](../apps/packages/product-client/src/components/playground/library/library-registry.test.ts) fails CI on any library file without an entry (and vice versa; the two toast kit internals `ToastBody`/`ToastExpansion` are the only files the test's glob exempts), so the demo card is part of shipping the component. The registry is also the manifest the Claude Design sync builds from ([scripts/design-sync/](../scripts/design-sync/) builds the payload; the upload to claude.ai runs from a local main-thread session), so the same entry is the component's design-project card.
6. **Consume it** via the exact internal subpath
   (`#product/primitives/Button`,
   `#product/primitives/patterns/settings/SettingsRow`) — never a relative import across
   a package boundary, never a barrel.

## Changing The Design

### Moving a value

1. Edit the token in
   [tokens.ts](../apps/packages/design/src/tokens.ts) (or
   [motion.ts](../apps/packages/design/src/motion.ts) for a duration,
   ease, cadence or delay).
2. Run the canonical build: `pnpm --filter @proliferate/design build`, which is
   `tsc -p tsconfig.json && node scripts/generate-theme.mjs && node
   scripts/copy-css.mjs && node scripts/check-theme.mjs`.
3. Commit both the source edit and any consumer changes together.

> **The `tsc` step is load-bearing, not an optimization.**
> [generate-theme.mjs](../apps/packages/design/scripts/generate-theme.mjs)
> imports the compiled `../dist/tokens.js`, not the TypeScript source. Skip the
> compile and the generator re-projects whatever was compiled last time,
> producing a byte-identical theme — so the equality check passes while the tree
> has drifted. That is the exact failure the check exists to catch, which is why
> both the package `build` script and
> [pre-commit](../scripts/git-hooks/pre-commit) hard-code the order.

Everything downstream is a projection of the same authority: `dist/theme.css`
(the `@theme` block, the dark `:root`, the single flattened
`:root[data-mode="light"]`, and the generated z/duration/ease/icon-button
utilities), the React Native bridge, and the Shiki/Monaco/terminal palettes.
`product.css` holds rules only — never token values.

### What check-theme proves

[check-theme.mjs](../apps/packages/design/scripts/check-theme.mjs)
never trusts the generator. It re-projects the compiled authority through its own
independent code path and then asserts, in order:

- **Byte equality** between its projection and the committed generator output.
- **A real Tailwind compile.** The generated CSS is run through Tailwind's
  `compile()`, so a malformed `@theme`/`@utility` block fails the design build
  instead of 500-ing a consumer app's JIT stylesheet at runtime.
- **Provenance and fallback discipline:** every token has a provenance tag, and
  every default/dark `color-mix()` projected into `@theme` has a resolved
  fallback (Tailwind's `@theme` block cannot hold `color-mix()`).
- **The light palette contract:** retired opaque slate literals stay absent,
  the white/rail/editor planes and single accent stay pinned, and every neutral
  alpha role remains on its adopted `#1a1c1f` rung.
- **Motion authority:** each duration/ease/cadence/delay number and each
  `--duration-*`/`--ease-*`/`--activity-*` token matches `motion.ts` in both
  halves.
- **The native bridge:** every shared native color equals the literal of its web
  token, the public key lists of `colors`/`radius`/`timing`/`mobileShadow`/
  `mobileTheme` are pinned, and no native value contains `var()` or
  `color-mix()`.
- **The closed ramp:** the 13-role key order of
  `typography.size`/`lineHeight`/`letterSpacing`, and the chat/composer
  line-height invariant.
- **Ownership:** `product.css` never declares a global token value in a
  `:root`/`@theme` block; it imports Tailwind, then the generated theme, then
  its `@source` list, in that order; named motion declarations are still
  present verbatim; and no raw time literal appears in any design CSS outside
  a marked infinite-loop rule.
- **One entry per name** in the `themeTokens` manifest (no duplicate keys
  silently shadowing each other).

### Provenance tags

Every token carries a tag recording its disposition in the July 2026
consolidation:

| Tag | Meaning |
| --- | --- |
| `[SHIPPED]` | The value that was already rendering, carried forward exactly. |
| `[SHIPPED:raw-hex-move]` | A shipped literal that was living in a component and was relocated into the authority unchanged. |
| `[SHIPPED:motion/authority]` | A shipped cadence whose value now lives in `motion.ts`. |
| `[RETUNE:<area/change>]` | A deliberate change, named by what it changed — e.g. `[RETUNE:radii/soft-scale]`, `[RETUNE:type/closed-ramp]`, `[RETUNE:state/overlay]`, `[RETUNE:layering/scale]`. |

Tags are historical, not permissions. `[SHIPPED]` does not mean a value is
protected and `[RETUNE:…]` does not mean it is still in flight — the tag records
where the value came from. `tokens.ts` remains the authority; an intentional
light-palette change also updates the exact invariant map in `check-theme.mjs`
before rebuilding, so the architectural lock cannot drift silently with the
value it guards.

### Gates

| Gate | Purpose |
| --- | --- |
| [check-theme.mjs](../apps/packages/design/scripts/check-theme.mjs) | Everything in the section above: the generated CSS is a faithful, compilable projection of the authority, and hand-authored CSS owns no values. |
| [check_theme_contrast.py](../scripts/check_theme_contrast.py) | Text contrast on every content, rail, editor, and control plane; border contrast on white, rail, recessed, and control surfaces; and ordered, distinguishable interaction-state fills. Pre-existing misses are exact ratchets rather than silent exemptions. |
| [check_appearance_scaling.py](../scripts/check_appearance_scaling.py) | Banned class shapes at every call site (arbitrary radius/z/gap/size, the `w-[…]`/`h-[…]`/`p-[…]`/`m-[…]`/`inset-[…]` geometry families, non-token shadows, low-alpha foreground overlays, retired state classes, fixed text/glyph sizes, numeric durations and inline beziers, unowned `backdrop-filter`, raw hex, unsanctioned long lists), plus the sealed directories a migration slice finished. Its contract is owned by [appearance-scaling.md](codebase/systems/product/settings/appearance-scaling.md). |
| [check_frontend_boundaries.py](../scripts/check_frontend_boundaries.py) | Radix containment inside ProductClient's library tiers, the closed `primitives/**` root/support-directory set, the nested primitives purity/layer law, the lucide icon-source ban (`LUCIDE_ICON_SOURCE` on any import line, `LUCIDE_PACKAGE_DEPENDENCY` on any product manifest entry), and the broader frontend import boundaries. |
| [check_component_library.py](../scripts/check_component_library.py) | The decidable half of the UI-conformance review: hand-rolled `role="dialog\|menu\|listbox\|tooltip\|button"` outside the shape's owner (check 3), dead index rows with no non-playground call site and incubating notes that outlived their release, index rows that link a missing file, sanctioned components with no JSDoc, tier modules that carry no index row at all, and kit placement (a kit directory imports no feature code and does not exist without index rows). Its allowlist ([component_library_allowlist.json](../scripts/component_library_allowlist.json)) is shrink-only and every entry carries a written justification. |
| [report_frontend_structure.py](../scripts/report_frontend_structure.py) (`--strict` in CI) | Raw DOM control usage (`RAW_DOM_CONTROL`) outside the primitives layer — the mechanical half of the behavior job's "compose, never rebuild". |
| [check_docs.py](../scripts/check_docs.py) | Documentation links and anchors — a renamed source file breaks CI instead of silently orphaning a reference in this document. |

Local enforcement runs through
[pre-commit](../scripts/git-hooks/pre-commit), which checks only the
staged frontend files (so it stays fast) and additionally recompiles and
re-projects the theme whenever anything under `apps/packages/design/` is staged.
It is wired by the `git-hooks` target in [Makefile](../Makefile), which
sets `core.hooksPath scripts/git-hooks`. It is bypassable — `--no-verify` or
`PROLIFERATE_SKIP_HOOKS=1` — because CI runs the same scripts over the whole
repository, so a bypass defers the failure rather than hiding it.

**The appearance gate's census is a ratchet, not an allowlist.** Rule families
whose consumers pre-date the token authority are censused per file in
`scripts/appearance_scaling_baseline.json`: the gate fails on any hit *beyond*
the frozen count, so no new violation can be introduced anywhere while the
migration burns the existing ones down. Three properties keep that honest, and
each is enforced, not merely intended:

- A census entry that allocates more than its file now uses fails
  `stale-census-allowance` — a slack entry is a live allowance waiting to swallow
  the next new violation in that file, because absorption matches on
  `(file, rule)` and never on the site that earned the slot.
- `--write-baseline` refuses to grow any entry not covered by
  `censusGrowthSanctions`, which names the rule family *and* the exact files and
  counts it covers. The written trail cannot be broader than the enforced one.
- A rule whose census reaches zero entries becomes an absolute ban from that
  moment, with no bookkeeping left to remove.

Growth is legitimate in one situation only: a regex widens and newly *sees*
pre-existing sites. A dead class left behind by a removed token never qualifies —
that gets deleted at the call site.

**A finished directory is sealed, not censused.** `sealedDirectories` in the same
baseline file pins a directory a migration slice completed at zero: any staged-rule
hit under a sealed prefix fails as `sealed-directory-regression`, and
`--write-baseline` refuses to record a census entry there at all. That is the one
move the census alone cannot prevent — a cleaned surface quietly re-entering the
staged set as if its violations were pre-existing. Each seal names the slice that
cleaned it, so the pin records work done rather than an opinion about a directory.

## Failure Modes

| Condition | What a consumer observes | Recovery |
| --- | --- | --- |
| `tokens.ts` edited without rebuilding | `check-theme.mjs` fails byte-equality — or, worse, passes on a stale `dist/theme.css` if `tsc` was skipped | Run `pnpm --filter @proliferate/design build`; never run the generator alone. |
| A token value is syntactically invalid CSS | The Tailwind `compile()` pass in `check-theme.mjs` fails; unguarded, the JIT stylesheet 500s at runtime and the app renders unstyled | Fix the value in `tokens.ts`; the compile pass keeps this pre-merge. |
| A `color-mix()` token ships without a resolved `themeFallback` | `check-theme.mjs` fails; unguarded, the `@theme` half of that color is missing and Tailwind utilities built on it silently do nothing | Add the resolved literal alongside the mix expression. |
| A banned class lands (arbitrary radius/z/gap/size, non-token shadow, `bg-foreground/<alpha>` ≤ 10%, `text-[…]`/`leading-[…]`, numeric duration, fixed glyph size) | `check_appearance_scaling.py` fails in pre-commit and CI, naming file and match | Replace with the semantic token utility, or obtain a written sanction — baseline growth is not a fix. |
| A hard-coded value lands in `product.css` instead of `tokens.ts` | The token-declaration case is gated: `check_design_css_source` emits `authored-root-token` for any `--x:` in a global `:root` block and `authored-theme-block` for any `@theme`. Only a non-token literal inside a component rule (e.g. `background: #212121` in `.foo`) escapes, since `RAW_HEX_RE` is not run over design CSS — that one silently becomes a second source of truth and diverges mode-to-mode | Move the value into `tokens.ts` and regenerate. |
| A raw `ms`/`s` literal or inline bezier lands in design CSS | `checkRawMotionAuthority` in `check-theme.mjs` fails, naming the owning rule and declaration | Use a `--duration-*`/`--ease-*`/`--activity-*` variable, or add the `/* activity-motion */` marker if it is genuinely an infinite loop. |
| A `@radix-ui/*` import lands outside a root primitive file or `product-client/src/primitives/patterns/**` | `FE-UI-1` fails in `check_frontend_boundaries.py`, naming file and line | Move the wrapper into the legal tier, or compose the existing library primitive. |
| A non-source file or unsupported directory is added at the primitives root | `FE-PC-7` fails, naming the offending entry | Move it to a root primitive file or the `patterns`, `icons`, `utils`, `overlays`, or `__tests__` owner. |
| A styled component ships outside the library with no library equivalent and gets reused across surfaces | No mechanical check catches this — review only | Promote it into the matching tier per "How to add a component". |
| A `lucide-react` import or dependency entry reappears | `LUCIDE_ICON_SOURCE` / `LUCIDE_PACKAGE_DEPENDENCY` fail in `check_frontend_boundaries.py`, naming file and line | Add the glyph to `primitives/icons/**` and import it from there. |
| A new `role="dialog\|menu\|listbox\|tooltip\|button"` lands on a raw element | `hand-rolled-overlay-role` fails in `check_component_library.py` | Compose `ModalShell`/`PopoverButton`/`DropdownMenu`/`Tooltip`/`Button`, or record the site in the allowlist with the reason no sanctioned path fits. |
| A library component loses its last call site, or an index row links a deleted file | `dead-library-component` / `registry-row-without-file` fail in `check_component_library.py` | Retire the component and its row, or add the consumer the promotion was earned by. |
| A component lands inside a library tier with no index row | `tier-file-without-registry-row` fails in `check_component_library.py`, naming the file | Add the index row (and the JSDoc it implies), move the module into a support directory (`utils`, `overlays`, `icons`), or name it in `NON_COMPONENT_TIER_FILES` with the reason it is not a component. A module imported only from inside its own component folder is already exempt as a private part. |
| A cleaned directory picks up a banned class again | `sealed-directory-regression` fails in `check_appearance_scaling.py`, and `--write-baseline` refuses to census it | Fix the site; a sealed directory does not re-enter the staged census. |
| Hook not installed (fresh clone, `core.hooksPath` unset) | Local commits skip both gates; failure surfaces only in CI | Run the `git-hooks` Makefile target. |

## Current Gaps

Everything above describes current behavior. These are the places where a rule
this document states is not mechanically enforced.

- Icon-button container sizes are the stated legal scale but are not enforced: no
  gate rule restricts freehand `size-N` on an icon *button* (`ARBITRARY_SIZE_RE`
  catches only `size-[…]` brackets, and the glyph rules apply to glyph tags, not
  their wrappers). Raw boxes remain legal and live in
  [IconButton.tsx](../apps/packages/product-client/src/primitives/IconButton.tsx)
  (`size-5`/`size-6`/`size-7`),
  [PaneIconButton.tsx](../apps/packages/product-client/src/primitives/PaneIconButton.tsx)
  (`size-6`),
  [SidebarActionButton.tsx](../apps/packages/product-client/src/primitives/patterns/sidebar/SidebarActionButton.tsx)
  (`size-6`) and
  [Button.tsx](../apps/packages/product-client/src/primitives/Button.tsx)
  (`icon-sm` = `h-7 w-7`). Closing it means either a gate rule or dropping the
  claim.
- `apps/packages/design/dist/theme.css` is generated, not checked in, so a fresh
  checkout has no emitted file to read; every statement here about the generated
  stylesheet is verified against `src/tokens.ts` plus the generator and checker
  scripts.
- Rendered visual coverage is narrow: the Tier-2 composer perimeter spec serves
  the real Desktop renderer and preserves the production dock/surface depth
  path, but other design surfaces still rely on human inspection with no fixed
  appearance baseline.
- `DropdownMenu` usage has no mechanical routing: it is the sanctioned path for
  keyboard-navigable menus (so new keyboard-menu consumers are legitimate), but
  nothing fails CI when a *click-only* menu imports it instead of
  `PopoverButton`/`PopoverMenuItem` — that misrouting is review-caught only.
- The rule of two is still review-enforced: no script detects a second implementation of a shape. The at-least-one-call-site rule and review check 3 are now mechanical — [check_component_library.py](../scripts/check_component_library.py) fails on a dead index row and on a hand-rolled overlay role — but each ratchets from a written allowlist rather than from zero, so the entries below are recorded there with their reasons rather than fixed. Known remaining violations, re-censused against the tree after the wave-2 vocabulary and migration slices landed. **Two hand-rolled overlay shells** are left of the original seven: `ComposerInlineMenu` (`role="listbox"`) and `DelegatedAgentHoverCard` (`role="tooltip"`, blocked because `Tooltip`'s content prop takes a string). `FileTreeOverlay`'s `role="dialog"` shell is deleted with slice 02A: the docked file tree it was replaced by is non-modal (no `role="dialog"`, scrim, click-catcher, or focus trap) and so is outside this census entirely. `PaneSideOverlay` was deleted, `SelectedResponseActionMenu` moved to `DropdownMenu`, `PublishDialog`'s invalid listbox became `aria-current`, and `OpenTargetMenu`'s click-only `role="menu"` was simply removed. **Of the duplicated shapes, roster rows, card shells and inline notices are retired** — `RosterRow`, `Card` and `NoticeBanner` each carry a dozen or more call sites, and the paint-fingerprint census that found 31 cross-file clusters now finds 19, with the nine-file `bg-card border border-border rounded-lg` cluster gone. **Status dots and disclosure state machines are not**: `StatusDot` has consumers but `RecentWorkStatusDot` and thirteen inline `icon-status rounded-full bg-*` spans remain, each wanting a pulse, a halo or an unread tone that would be a third axis; `Disclosure` has two consumers and four recorded limitations blocking the rest (see its index row). The two exact instances of a shape the library already owns — `SecretEditorDialog`'s inline error, whose byte-identical twin in `ApiKeyCreatorModal` had moved to `NoticeBanner`, and `HarnessAuthSection`'s icon tile, which painted `IconTile`'s exact `control`/`md` recipe — have both been migrated, closing the half-migrated pairs the wave itself created; `HarnessPane`'s 28px runtime tile and `GitReviewTargetSelector`'s hand-wired picker skeleton went with them. **Dead library vocabulary is retired**: `AuthProviderButton`, `ListRow`, `RangeSlider` and `ProductNotice` all had no non-playground call sites, and all four are now gone, deleted outright rather than respecified. `ListRow` had carried two recorded refusals rather than adoptions (`PlanHandoffDialog` and `PromptRecoveryPanel` both explained in comments why it did not fit — its fixed `text-heading` title at one, its single-`<button>` shape against a row hosting its own controls at the other), which was retire-or-respecify evidence rather than a pending migration, and the founder ruling came down on retirement. Both comments recorded the same refusals against `RosterRow`, the surviving slotted row, on its own terms: it paints no resting surface and titles off a density axis, and it ties its hover wash to `onSelect` with a secondary line fixed at `text-muted-foreground`. The second of those two refusals is now closed by promotion rather than by a `RosterRow` ruling: `ActionRow` is the non-selectable washed row with a toned secondary line, and it absorbed `PromptRecoveryPanel`'s row together with the workflows resume popover's interrupted-run row, the second instance that earned it. `PlanHandoffDialog`'s refusal stands unchanged — its row is a pressable `Button` with a resting surface, a different shape from either. `NoticeBanner` owns the shape `ProductNotice` used to and carries its call sites.
- Arbitrary width/height/padding/margin/inset brackets (`w-[…]`, `p-[…]`, and siblings) are censused, not banned: the appearance gate counts them per file so no new one can land, and 101 pre-existing sites burn down as their surfaces migrate. The prefixed spellings (`min-w-[…]`, `max-h-[…]`) and the axis paddings (`px-[…]`, `mt-[…]`) are still outside the rule.
- Every named kit now owns a subdirectory under `primitives/patterns/` — composer, toast, sidebar, settings, tabs, panel — but one kit remains split across tiers against the kit-cohesion rule: the toast kit's positioner (`Sonner`) is a root primitive outside `patterns/toast/`. The panel kit has a second, narrower split: `PaneIconButton` is the pane-scoped icon button the kit's members are built around, but it is a root primitive with consumers outside the right panel, so moving it is a tier change rather than a file move and is deferred. What *is* mechanical is the boundary and the sanction: `kit-imports-feature-code` fails when a kit member reaches into `components/**`, and `kit-directory-without-registry-rows` fails when a subdirectory of `primitives/patterns/` has no index row placing members in it. Which kit a given component *belongs* to is still a review judgment.
- The state job is review-enforced only: no gate detects a hand-assembled `hover:`/`active:`/`focus-visible:` stack on a raw element in feature code, and hundreds of such stacks predate the rule.
- One domain-tier row is still grandfathered against the mechanical admission test (domain type in the public props plus composing two or more library components): `BillingGateState`, which now composes only `Button` and so fails the two-component clause — its re-audit outcome (dissolve into the pattern tier, or stay by review exception) is open. `PrStatusBadge` composes exactly one component (`StatusDot`) for the same reason and raises the same question.

Test coverage for the mechanical library rules:
[test_check_frontend_boundaries.py](../scripts/test_check_frontend_boundaries.py)
(Radix containment, the primitives root set, the lucide icon-source ban) and
[test_check_component_library.py](../scripts/test_check_component_library.py)
(index parsing, overlay roles, dead vocabulary, JSDoc, kit placement, and the
allowlist's refusal of an unjustified entry).
