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
| `--color-composer-background` | `#2d2d2d` | `#ffffff` | The fully opaque composer input surface. |

The dark ladder steps `#141414 → #181818 → #212121/#222222 → #282828 → #2d2d2d`:
roughly four to five levels of lightness per step, small enough that no step
reads as a color change and large enough to separate two adjacent panels
without a border. The sidebar sits at the `#222222` rung in dark, one step
lighter than the root. Light deliberately has only the white content plane, the
`#f6f6f6` rail, and the `#fafafa` editor plane; reusable fills remain alpha ink
rather than adding opaque intermediate planes.

The composer is opaque in both modes and uses no backdrop filter. That keeps
transcript paint out of the input surface and avoids re-blurring the transcript
while typing.

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

Two component roles refine the shared scale: the light user-message bubble uses
a 5% ink 2px shadow, and the light composer combines a 0.5px ink edge with 3px
and 12px shadow layers. Dark keeps the user-message shadow absent and aliases
the composer to `--shadow-subtle`.

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
| `--radius-composer` | `1.25rem` (20px) | The composer frame, as its own name — deliberately softer than the panel scale. |
| `--radius` | `0.5rem` (8px) | The unqualified base, equal to `md`. |

**Radius grows with the element.** The named steps run 6 → 8 → 10 → 12 → 16px
across elements that themselves grow from a 30px sidebar row to a 520px command
palette, so the ratio of corner to element stays in a narrow band and nothing
reads either boxy or over-rounded at its own scale. The sidebar row moved from
`--radius-sm` to `--radius-lg` (6px → 10px) in the sidebar retune — a softer
corner reads better against the sidebar's own recessed surface than it did
against the previous, slightly-raised one.

`--radius-composer` is a named 20px rather than a reference to any shared step
because the composer's corner is its own anatomy value — softer than the
dialogs' `xl` — tunable without moving every dialog
(`AgentHarnessConfigComposer` already overrides it locally).
`--radius` duplicates `md` as the unqualified base for consumers that ask for
"the" radius.

Arbitrary radius is banned at the class level: `rounded-[…]` in any directional
spelling fails `ARBITRARY_RADIUS_RE`.

## Motion

Motion has two scales that are deliberately *not* aliased to each other, plus a
set of choreography delays. All three live in
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
| `--duration-emphasized` | 300ms | Emphasized, spring-led product moments. |

**Exits are deliberately faster than entrances** — 120ms out against 160ms in.
An entrance is information arriving and can afford to be seen; an exit is the
user having already moved on, and matching the entrance duration makes dismissal
feel sticky. The scale as a whole is ordered by how much geometry moves: color
(120) < content (160) < height (200) < panel (240) < a moment you are meant to
notice (300).

### Easing

| Token | Curve | Feel |
| --- | --- | --- |
| `--ease-out-quint` | `cubic-bezier(0.19, 1, 0.22, 1)` | The default entrance: fast start, long settle. |
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
> it.** The generated stylesheet zeroes all six interaction durations under
> `prefers-reduced-motion: reduce`. Loops and streaming feedback keep their
> cadence, because they are the only signal that work is still happening — a
> zeroed thinking loop is not a calmer UI, it is a UI that looks frozen. The
> comment on `motion.activity` states this directly, and only the six
> interaction roles appear in the reduced-motion block.

### Choreography delays

`delay.autoHideScrollbarMs: 700`, `delay.hoverCardHideMs: 120`,
`delay.levelBarStaggerMs: 110`. These are waits, not animations: how long a
scrollbar lingers before hiding, how long a hover card tolerates the pointer
leaving, how far apart stepped level bars fire. They live with motion because
they are perceived as part of the same choreography, and JS consumers that must
stay in lockstep with CSS import them and format through `motion.cssMs()`.

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

### The library model

Three tiers inside `product-client/src/primitives`, organized by **component
role, never by feature area** — a component's name describes what it does, not
where it is used:

- **Root files** — the base tier. Holds both the raw Radix (and other vendor)
  wrapper families — `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`,
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
  job it does (`ListRow`, `PageHeader`), never for the feature that first needed
  it.
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
  [packages/README.md](frontend/packages.md)). The
  settings family (`SettingsRow`, `SettingsSection`, `SettingsPageHeader`, and
  siblings), `PrStatusBadge`, `ProductPageShell`, and the `secrets/` sub-tree
  live here for that reason, not because they belong to a "settings" or
  "secrets" feature folder.

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
  Enforced by `RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY` in
  [check_frontend_boundaries.py](../scripts/check_frontend_boundaries.py),
  scanned across every frontend package and app.
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

Feature code may still define feature-specific components — a component that only
composes library primitives/patterns and tokens does not need to live in the
library. A component graduates **into** the library when it becomes the canonical
implementation for its job, or gets reused across independent feature surfaces;
at that point it moves to the tier matching its role and gets a row in the
sanctioned index below.

### The sanctioned index

Every component below has one canonical `#product/primitives/...` subpath and a
row here. A styled component with no row here is not library-sanctioned; the
index is the closed set, not a sample of it.

#### Primitives (`product-client/src/primitives/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `AlertDialog` | [AlertDialog.tsx](../apps/packages/product-client/src/primitives/AlertDialog.tsx) | Raw `@radix-ui/react-alert-dialog` wrapper, styled to tokens. |
| `AnimatedCollapsibleContent` | [AnimatedCollapsibleContent.tsx](../apps/packages/product-client/src/primitives/AnimatedCollapsibleContent.tsx) | Height + opacity disclosure motion for expand/collapse content; collapsed subtree is inert. |
| `AnimatedSwapText` | [AnimatedSwapText.tsx](../apps/packages/product-client/src/primitives/AnimatedSwapText.tsx) | Crossfade transition when a keyed text value changes. |
| `Badge` | [Badge.tsx](../apps/packages/product-client/src/primitives/Badge.tsx) | Tone-based label/status chip. |
| `Button` | [Button.tsx](../apps/packages/product-client/src/primitives/Button.tsx) | The button primitive — variant/size/loading/destructive API every other button-shaped component composes. |
| `Checkbox` | [Checkbox.tsx](../apps/packages/product-client/src/primitives/Checkbox.tsx) | One-line re-export of `checkbox-primitive` — see Collision pairs below. |
| `checkbox-primitive` | [checkbox-primitive.tsx](../apps/packages/product-client/src/primitives/checkbox-primitive.tsx) | Raw `@radix-ui/react-checkbox` wrapper — see Collision pairs below. |
| `Command` | [Command.tsx](../apps/packages/product-client/src/primitives/Command.tsx) | Raw `cmdk` wrapper. `CommandPalette` (below) imports `cmdk` directly rather than this wrapper; today's only consumer is [WorkspacesCommandList.tsx](../apps/packages/product-client/src/components/workspace/repo-setup/WorkspacesCommandList.tsx) — two parallel `cmdk` consumers, a transitional gap, not a migration in progress. |
| `Dialog` | [Dialog.tsx](../apps/packages/product-client/src/primitives/Dialog.tsx) | Raw `@radix-ui/react-dialog` wrapper; `ModalShell` composes it. |
| `DotCellLoader` | [DotCellLoader.tsx](../apps/packages/product-client/src/primitives/DotCellLoader.tsx) | Nine-dot activity indicator with wave, orbit, scan, helix, and breathe motion variants. |
| `DropdownMenu` | [DropdownMenu.tsx](../apps/packages/product-client/src/primitives/DropdownMenu.tsx) | Raw `@radix-ui/react-dropdown-menu` wrapper — see DropdownMenu status below. |
| `FixedPositionLayer` | [FixedPositionLayer.tsx](../apps/packages/product-client/src/primitives/FixedPositionLayer.tsx) | Fixed-position wrapper for viewport-anchored overlay content. |
| `IconButton` | [IconButton.tsx](../apps/packages/product-client/src/primitives/IconButton.tsx) | Icon-only button, tone/size variants. |
| `Input` | [Input.tsx](../apps/packages/product-client/src/primitives/Input.tsx) | Text input field. |
| `Label` | [Label.tsx](../apps/packages/product-client/src/primitives/Label.tsx) | Form field label. |
| `PaneIconButton` | [PaneIconButton.tsx](../apps/packages/product-client/src/primitives/PaneIconButton.tsx) | Pane-scoped icon button (24px box), composes `Button`. |
| `Popover` | [Popover.tsx](../apps/packages/product-client/src/primitives/Popover.tsx) | Raw `@radix-ui/react-popover` wrapper; `PopoverButton` composes it. |
| `PopoverButton` | [PopoverButton.tsx](../apps/packages/product-client/src/primitives/PopoverButton.tsx) | Popover-backed trigger/content wrapper with `triggerMode` (`click`/`doubleClick`/`contextMenu`); the sanctioned menu/popover trigger. |
| `PopoverMenuItem` | [PopoverMenuItem.tsx](../apps/packages/product-client/src/primitives/PopoverMenuItem.tsx) | Plain-button popover menu row; the sanctioned menu-item companion to `PopoverButton`. |
| `PopoverSearchField` | [PopoverSearchField.tsx](../apps/packages/product-client/src/primitives/PopoverSearchField.tsx) | Search input for popover pickers, with an in-place list-navigation keyboard hook. |
| `ProgressBar` | [ProgressBar.tsx](../apps/packages/product-client/src/primitives/ProgressBar.tsx) | Determinate progress bar. |
| `RadioCardGroup` | [RadioCardGroup.tsx](../apps/packages/product-client/src/primitives/RadioCardGroup.tsx) | Radio-selectable card group with label/description/icon per option. |
| `RangeSlider` | [RangeSlider.tsx](../apps/packages/product-client/src/primitives/RangeSlider.tsx) | Native range input styled to tokens. |
| `RowActionIconButton` | [RowActionIconButton.tsx](../apps/packages/product-client/src/primitives/RowActionIconButton.tsx) | Sanctioned hover-revealed row-action icon button (sidebar kebab, archive, tab close, file-row actions) — 28px hit target, 16px glyph. |
| `SegmentedControl` | [SegmentedControl.tsx](../apps/packages/product-client/src/primitives/SegmentedControl.tsx) | Segmented tab-like control. |
| `Select` | [Select.tsx](../apps/packages/product-client/src/primitives/Select.tsx) | Native select styled to tokens. |
| `ShortcutBadge` | [ShortcutBadge.tsx](../apps/packages/product-client/src/primitives/ShortcutBadge.tsx) | Keyboard-shortcut badge. |
| `Skeleton` | [Skeleton.tsx](../apps/packages/product-client/src/primitives/Skeleton.tsx) | Shimmer loading placeholder block. |
| `Sonner` | [Sonner.tsx](../apps/packages/product-client/src/primitives/Sonner.tsx) | Sole toast treatment, split in two: `Sonner` is the transparent positioner (stacking, swipe, 3-visible cap), and the toast body pattern ([ToastBody.tsx](../apps/packages/product-client/src/primitives/patterns/ToastBody.tsx)) paints the whole card — popover frame, always-visible corner close, 28px action cluster with only the primary filled, and the in-place Details expansion (356→480px). |
| `Spinner` | [Spinner.tsx](../apps/packages/product-client/src/primitives/Spinner.tsx) | Inline loading spinner. |
| `Switch` | [Switch.tsx](../apps/packages/product-client/src/primitives/Switch.tsx) | Toggle switch. |
| `Textarea` | [Textarea.tsx](../apps/packages/product-client/src/primitives/Textarea.tsx) | Multi-line text input (default/ghost/flush/code variants). |
| `Tooltip` | [Tooltip.tsx](../apps/packages/product-client/src/primitives/Tooltip.tsx) | Formatting wrapper over `tooltip-primitive` — see Collision pairs below. |
| `tooltip-primitive` | [tooltip-primitive.tsx](../apps/packages/product-client/src/primitives/tooltip-primitive.tsx) | Raw `@radix-ui/react-tooltip` wrapper — see Collision pairs below. |
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
tier. Four files still import it directly:
[WorkspaceItemMenu.tsx](../apps/packages/product-client/src/components/workspace/shell/sidebar/WorkspaceItemMenu.tsx),
[RightPanelNewTabMenu.tsx](../apps/packages/product-client/src/components/workspace/shell/right-panel/RightPanelNewTabMenu.tsx),
[WorkspaceActionsMenu.tsx](../apps/packages/product-client/src/components/workspace/shell/topbar/WorkspaceActionsMenu.tsx)
(all `product-client`), and
[ProposedPlanCard.tsx](../apps/packages/product-client/src/components/workspace/chat/transcript/ProposedPlanCard.tsx)
(`product-client`). Migrating them onto `PopoverButton`/`PopoverMenuItem` is pending:
Radix's dropdown-menu primitive provides roving-tabindex arrow-key navigation,
typeahead, and managed focus-return-to-trigger that
`PopoverButton`/`PopoverMenuItem` do not implement today. `DropdownMenu` is not
banned outright — it has no CI gate — but new menu call sites should use
`PopoverButton`/`PopoverMenuItem`; only the four existing consumers above are
grandfathered.

#### Patterns (`product-client/src/primitives/patterns/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `AuthProviderButton` | [AuthProviderButton.tsx](../apps/packages/product-client/src/primitives/patterns/AuthProviderButton.tsx) | Auth-provider sign-in button with a loading state, composes `Spinner`. |
| `AutoHideScrollArea` | [AutoHideScrollArea.tsx](../apps/packages/product-client/src/primitives/patterns/AutoHideScrollArea.tsx) | Scroll area whose scrollbar affordance auto-hides. |
| `CommandPalette` | [CommandPalette.tsx](../apps/packages/product-client/src/primitives/patterns/CommandPalette.tsx) | Command-palette shell/context, built directly on `cmdk` (not on the `Command` primitive — see `Command` row above). |
| `ComposerActionButton` | [ComposerActionButton.tsx](../apps/packages/product-client/src/primitives/patterns/ComposerActionButton.tsx) | Composer primary-action button, composes `Button`. |
| `ComposerControlButton` | [ComposerControlButton.tsx](../apps/packages/product-client/src/primitives/patterns/ComposerControlButton.tsx) | Composer control pill (icon/label/detail/trailing/active), composes `Button`. |
| `ComposerTextarea` | [ComposerTextarea.tsx](../apps/packages/product-client/src/primitives/patterns/ComposerTextarea.tsx) | Composer-sized text input, composes `Textarea`. |
| `ComposerTextareaFrame` | [ComposerTextareaFrame.tsx](../apps/packages/product-client/src/primitives/patterns/ComposerTextareaFrame.tsx) | Composer textarea's outer frame/top-inset shell. |
| `ConfirmationDialog` | [ConfirmationDialog.tsx](../apps/packages/product-client/src/primitives/patterns/ConfirmationDialog.tsx) | Confirm/cancel dialog, built on `ModalShell` + `Button`. |
| `EmptyState` | [EmptyState.tsx](../apps/packages/product-client/src/primitives/patterns/EmptyState.tsx) | Title/description/action empty-state block. |
| `EnvironmentSearchSelect` | [EnvironmentSearchSelect.tsx](../apps/packages/product-client/src/primitives/patterns/EnvironmentSearchSelect.tsx) | Searchable environment picker, composes `PopoverButton`/`PopoverMenuItem`/`PickerPopoverContent`. |
| `LevelBarsButton` | [LevelBarsButton.tsx](../apps/packages/product-client/src/primitives/patterns/LevelBarsButton.tsx) | Stepped-level control button (level-bars affordance), composes `ComposerControlButton`. |
| `ListRow` | [ListRow.tsx](../apps/packages/product-client/src/primitives/patterns/ListRow.tsx) | Clickable list row with leading/trailing slots. |
| `ModalShell` | [ModalShell.tsx](../apps/packages/product-client/src/primitives/patterns/ModalShell.tsx) | Modal composition built on `Dialog`. |
| `PageContentFrame` | [PageContentFrame.tsx](../apps/packages/product-client/src/primitives/patterns/PageContentFrame.tsx) | Page content frame with header slot and sticky action/title. |
| `PageHeader` | [PageHeader.tsx](../apps/packages/product-client/src/primitives/patterns/PageHeader.tsx) | Page-level header (title/description/actions). |
| `PaneOptionsMenuItem` | [PaneOptionsMenuItem.tsx](../apps/packages/product-client/src/primitives/patterns/PaneOptionsMenuItem.tsx) | Pane options-menu row, composes `Button`. |
| `PickerPopoverContent` | [PickerPopoverContent.tsx](../apps/packages/product-client/src/primitives/patterns/PickerPopoverContent.tsx) | Popover content shell for pickers: search field + list + empty row. |
| `SettingsMenu` | [SettingsMenu.tsx](../apps/packages/product-client/src/primitives/patterns/SettingsMenu.tsx) | Labeled select-style menu, composes `PopoverButton`/`PopoverMenuItem`. |
| `SidebarActionButton` | [SidebarActionButton.tsx](../apps/packages/product-client/src/primitives/patterns/SidebarActionButton.tsx) | Sidebar action button, composes `RowActionIconButton`. |
| `SidebarNavRow` | [SidebarNavRow.tsx](../apps/packages/product-client/src/primitives/patterns/SidebarNavRow.tsx) | Sidebar navigation row (icon/label/status/shortcut), composes the `ShortcutBadge` primitive + `SidebarRowSurface`; modifier-held shortcuts overlay an existing rightmost status instead of widening its trailing region. |
| `SidebarRowSurface` | [SidebarRowSurface.tsx](../apps/packages/product-client/src/primitives/patterns/SidebarRowSurface.tsx) | Shared sidebar row interaction surface (active/disabled/press state) other sidebar rows build on. |
| `ThinkingText` | [ThinkingText.tsx](../apps/packages/product-client/src/primitives/patterns/ThinkingText.tsx) | Animated "thinking" gleam text. |

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
| `ModelTable` | [ModelTable.tsx](../apps/packages/product-client/src/components/patterns/ModelTable.tsx) | Model-config table rows, composes `Badge`/`Switch`. |
| `PrStatusBadge` | [PrStatusBadge.tsx](../apps/packages/product-client/src/components/patterns/PrStatusBadge.tsx) | PR status dot (`PrStatusDot`), icon-overlay wrapper (`PrStatusIconOverlay`), and tooltip-text helper (`prStatusTooltip`); hand-rolls its own tone map, composes nothing. |
| `ProductPageShell` | [ProductPageShell.tsx](../apps/packages/product-client/src/components/patterns/ProductPageShell.tsx) | General product page shell, composes `PageContentFrame` + `PageHeader`. |
| `SettingsEmptyState` | [SettingsEmptyState.tsx](../apps/packages/product-client/src/components/patterns/SettingsEmptyState.tsx) | Settings-scoped empty state (compact/full sizes). |
| `SettingsEyebrow` | [SettingsEyebrow.tsx](../apps/packages/product-client/src/components/patterns/SettingsEyebrow.tsx) | Settings section eyebrow label. |
| `SettingsPageHeader` | [SettingsPageHeader.tsx](../apps/packages/product-client/src/components/patterns/SettingsPageHeader.tsx) | Flat settings page header (title/description/action). |
| `SettingsRow` | [SettingsRow.tsx](../apps/packages/product-client/src/components/patterns/SettingsRow.tsx) | Settings row (label/description/control), fixed 240px control-width companion for menus. |
| `SettingsSaveFooter` | [SettingsSaveFooter.tsx](../apps/packages/product-client/src/components/patterns/SettingsSaveFooter.tsx) | Settings save/revert footer with a status badge, composes `Badge` + `Button`. |
| `SettingsScopeTabs` | [SettingsScopeTabs.tsx](../apps/packages/product-client/src/components/patterns/SettingsScopeTabs.tsx) | User/org/repo/agents underline scope-switcher tabs, composes `Button`. |
| `SettingsSection` | [SettingsSection.tsx](../apps/packages/product-client/src/components/patterns/SettingsSection.tsx) | Settings section (title/description), composes `SettingsEyebrow`. |
| `secrets/SecretManagementPanel` | [secrets/SecretManagementPanel.tsx](../apps/packages/product-client/src/components/patterns/secrets/SecretManagementPanel.tsx) | Presentational secrets-management pattern (list, editor/delete dialogs, scope notice are private internals of this one export). |

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
5. **Consume it** via the exact internal subpath
   (`#product/primitives/Button`,
   `#product/components/patterns/SettingsRow`) — never a relative import across
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
| [check_appearance_scaling.py](../scripts/check_appearance_scaling.py) | Banned class shapes at every call site (arbitrary radius/z/gap/size, non-token shadows, low-alpha foreground overlays, retired state classes, fixed text/glyph sizes, numeric durations and inline beziers, unowned `backdrop-filter`, raw hex, unsanctioned long lists). Its contract is owned by [appearance-scaling.md](codebase/systems/product/settings/appearance-scaling.md). |
| [check_frontend_boundaries.py](../scripts/check_frontend_boundaries.py) | Radix containment inside ProductClient's library tiers, the closed `primitives/**` root/support-directory set, the nested primitives purity/layer law, and the broader frontend import boundaries. |
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

## Failure Modes

| Condition | What a consumer observes | Recovery |
| --- | --- | --- |
| `tokens.ts` edited without rebuilding | `check-theme.mjs` fails byte-equality — or, worse, passes on a stale `dist/theme.css` if `tsc` was skipped | Run `pnpm --filter @proliferate/design build`; never run the generator alone. |
| A token value is syntactically invalid CSS | The Tailwind `compile()` pass in `check-theme.mjs` fails; unguarded, the JIT stylesheet 500s at runtime and the app renders unstyled | Fix the value in `tokens.ts`; the compile pass keeps this pre-merge. |
| A `color-mix()` token ships without a resolved `themeFallback` | `check-theme.mjs` fails; unguarded, the `@theme` half of that color is missing and Tailwind utilities built on it silently do nothing | Add the resolved literal alongside the mix expression. |
| A banned class lands (arbitrary radius/z/gap/size, non-token shadow, `bg-foreground/<alpha>` ≤ 10%, `text-[…]`/`leading-[…]`, numeric duration, fixed glyph size) | `check_appearance_scaling.py` fails in pre-commit and CI, naming file and match | Replace with the semantic token utility, or obtain a written sanction — baseline growth is not a fix. |
| A hard-coded value lands in `product.css` instead of `tokens.ts` | The token-declaration case is gated: `check_design_css_source` emits `authored-root-token` for any `--x:` in a global `:root` block and `authored-theme-block` for any `@theme`. Only a non-token literal inside a component rule (e.g. `background: #212121` in `.foo`) escapes, since `RAW_HEX_RE` is not run over design CSS — that one silently becomes a second source of truth and diverges mode-to-mode | Move the value into `tokens.ts` and regenerate. |
| A raw `ms`/`s` literal or inline bezier lands in design CSS | `checkRawMotionAuthority` in `check-theme.mjs` fails, naming the owning rule and declaration | Use a `--duration-*`/`--ease-*`/`--activity-*` variable, or add the `/* activity-motion */` marker if it is genuinely an infinite loop. |
| A `@radix-ui/*` import lands outside a root primitive file or `product-client/src/primitives/patterns/**` | `RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY` fails in `check_frontend_boundaries.py`, naming file and line | Move the wrapper into the legal tier, or compose the existing library primitive. |
| A non-source file or unsupported directory is added at the primitives root | `PRODUCT_CLIENT_PRIMITIVES_TOP_LEVEL_ENTRY` fails, naming the offending entry | Move it to a root primitive file or the `patterns`, `icons`, `utils`, `overlays`, or `__tests__` owner. |
| A styled component ships outside the library with no library equivalent and gets reused across surfaces | No mechanical check catches this — review only | Promote it into the matching tier per "How to add a component". |
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
  [SidebarActionButton.tsx](../apps/packages/product-client/src/primitives/patterns/SidebarActionButton.tsx)
  (`size-6`) and
  [Button.tsx](../apps/packages/product-client/src/primitives/Button.tsx)
  (`icon-sm` = `h-7 w-7`). Closing it means either a gate rule or dropping the
  claim.
- `apps/packages/design/dist/theme.css` is generated, not checked in, so a fresh
  checkout has no emitted file to read; every statement here about the generated
  stylesheet is verified against `src/tokens.ts` plus the generator and checker
  scripts.
- No automated rendered-visual check exists. Nothing compares a served build
  against an expected appearance, so a change that is token-correct and visually
  wrong is caught only by human inspection, with no artifact retained.
- `DropdownMenu`'s four grandfathered consumers have no tracking mechanism beyond
  this document — nothing fails CI if a fifth call site starts importing
  `DropdownMenu` directly.

Test coverage for the two mechanical library rules:
[test_check_frontend_boundaries.py](../scripts/test_check_frontend_boundaries.py).
