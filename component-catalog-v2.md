# Component catalog v2 — foundation decision sheet

Base: `origin/main` @ `c0dd0e32b` (worktree `foundation-recon`, read-only recon).
Supersedes `component-catalog-v1.md` in full — this document is the single
source; the addendum/movability sections that were appended to v1 are folded
in below, not layered on top.

Scope unchanged from v1: `apps/packages/ui/src/`, `apps/packages/product-ui/src/`,
`apps/packages/product-surfaces/src/`, `apps/packages/product-client/src/components/`
(shared/reusable pieces; one-off `product-client` page compositions excluded
except where they duplicate a reusable job).

**Counting method** (unchanged from v1): per public `exports` subpath,
`grep -rlE 'from ["\']@<pkg>/<subpath>["\']'` across `apps/`, excluding
`node_modules`, `dist`, test/story files, and the component's own source.
Every finding below that the review flagged as contested was re-grepped from
scratch against the checkout for this revision — see "Errata" at the end for
what changed and why.

---

## 1. Purpose and the two-level unification thesis

Two closed sets, one hierarchy:

- **`tokens.ts` (`design` package)** — the closed set of *values*: colors,
  spacing, type scale, radii. Nothing outside it is a legal raw value in
  product code.
- **The library (this catalog's subject)** — the closed set of *components*:
  the only components allowed to define visual vocabulary using those tokens.
- **This catalog** — the library's index. Every entry in the library has a row
  here; nothing without a row here is library-sanctioned.

Feature code (pages/panes/screens) composes library components and wires
state. It does not invent new visual vocabulary — see the governance rule
(§2, D-NEW) for exactly how strict that boundary is and how it's enforced.

---

## 2. The governing architecture

### 2.1 Package end state: 6 → 3

Post web/desktop unification, `ui`, `product-ui`, and `product-surfaces` have
exactly one real DOM consumer: `product-client` (verified — web/desktop shells
import zero symbols from `ui`/`product-ui`/`product-surfaces`; those
packages' own `package.json` entries in the shells are stale). The end state:

- **`design`** stays a package — consumed by web, desktop, *and* mobile.
- **`product-domain`** stays a package — the mobile sharing point; the
  no-DOM constraint is load-bearing (mobile imports `product-domain` +
  `design/react-native` + SDK only, never the DOM packages).
- **`product-client`** eventually absorbs `ui`, `product-ui`, and
  `product-surfaces`.

**No big-bang merge in this program.** The culling PR relocates only the
components it already touches (deletions, migrations, and the handful of
already-movable components below) onto their final-taxonomy path where the
current import direction allows it. It does not perform unrelated live-component
relocations — per standing review guidance, a deletion/cull PR never also
carries unrelated component moves. Full package absorption is a separate,
later mechanical follow-up, sequenced for whenever the packages fold.

### 2.2 The library model (RULED)

Inside the merged package there is **one** component-library space —
the only place visual components may live — organized by **component role,
never by feature area**:

- **`library/primitives/`** — single-purpose visual atoms (Button, Input,
  Label, Badge, Switch) **and** the raw Radix wrapper families (Dialog,
  AlertDialog, Tooltip, Checkbox, the Popover/menu behavior layer). Raw Radix
  wrappers live here, not in a separate tier — this resolves old v1-D1
  ("should Radix wrappers live in primitives?") and it is now **RESOLVED**,
  not open.
- **`library/patterns/`** — opinionated reusable compositions (ModalShell,
  ConfirmationDialog, EmptyState, Table, Tabs, PageHeader, SettingsRow/Section,
  composer controls). Named for intent, not address — `SettingsRow` lives
  here, not in a `settings/` folder.
- **`library/icons/`** — icon sets: `icons.tsx` + detail modules,
  `proliferate-icons`, `provider-icons`, `command-palette-icons`. Kept as its
  own tier rather than forced into primitives/patterns — icon sets are barrels
  of glyphs, not components in the atom/composition sense (v1 flagged this as
  unresolved; this revision resolves it by giving icons a named third tier
  rather than shoehorning `command-palette-icons` into `primitives/`).
- **`library/lib/`** (optional) — shared UI utilities, e.g. `cn()` /
  `lib/utils.ts` (13 internal `ui/src` consumers today, confirmed by grep —
  load-bearing, not dead).

Two content tiers (primitives, patterns) plus icons — **no `surfaces/` tier**
(RULED). See §6 for where ex-`product-surfaces` connected surfaces go instead.

`library/` is a placeholder name for the protected subtree, finalized at
ruling time.

### 2.3 Governance rule — how strict is the feature-code boundary (D-NEW — RULED)

**RULED (Pablo, 2026-07-25): the synthesis below is adopted.** Everything above assumes
feature code is composition-only, but "composition-only" needs a precise
line. Three readings were considered:

- **Strict** — every styled component, however narrow, must live in the
  library. *Rejected*: turns the library into a dumping ground for one-off,
  never-reused feature dressing, defeating the "closed set of designed
  components" premise.
- **Loose** — any component a feature defines is fine as long as it doesn't
  duplicate an existing library component. *Rejected*: this is exactly the
  status quo that produced `PillControlButton` and the two page-header
  systems — a rewording of "duplicate loophole," not a fix for it.
- **Recommended synthesis** — feature code MAY define feature-specific
  components, but they may only **compose** library primitives/patterns and
  tokens. They may not introduce new visual vocabulary: no raw Radix imports,
  no hardcoded values (colors/spacing/radii outside tokens), no
  re-implemented behaviors (their own popover positioning, their own dialog
  focus-trap, etc.) outside the library. Promotion to the library happens
  when a feature component becomes canonical for its job or gets reused
  across independent feature surfaces.

**RULED: synthesis adopted (Pablo, 2026-07-25).** Enforcement is mechanical,
not just documentation (§2.4).

### 2.4 Enforcement

- **Import-direction lint**, generalizing the existing CI-enforced repo-shape
  check (`scripts/check_frontend_boundaries.py`, referenced in
  `specs/codebase/structures/frontend/README.md` §"CI-Enforced Repo Shape"):
  Radix imports and styled-primitive definitions are only legal inside
  `library/`; feature folders that import Radix directly, or define new
  styled components with hardcoded values, fail CI.
- **Appearance gates**: the existing appearance-scaling machinery
  (`specs/codebase/systems/product/settings/appearance-scaling.md`) is the
  natural home for a check that hardcoded pixel/color values outside the
  library fail review — it already owns the "every visual surface must ride
  the token system" property for type scale.
- **Catalog-as-index**: this document (or its living successor) is the
  library's index. A component with no entry here is not library-sanctioned,
  full stop — CI or review should treat an uncataloged new file under
  `library/` as a process violation, and an uncataloged styled component
  outside `library/` as a boundary violation.
- **kit/DropdownMenu CI gate** (already ruled, carried forward): new use of
  `kit/DropdownMenu` is banned; the lint added for that ruling generalizes
  naturally into the same import-direction check above.

### 2.5 Canonical docs to update at fold time

The following canonical docs currently describe the 6-package world as
current-state fact, not history. They are correct **today** (verified against
the checkout) and must **not** be silently contradicted by this catalog. Do
not edit them now; carry this list forward and update them when the
foundations PR lands / when the packages actually fold — whichever comes
first for a given doc's claim:

| Doc | What it currently asserts that will change |
|---|---|
| `specs/codebase/structures/frontend/architecture.md` (§2, "Shared packages — two foundations + a three-layer DOM stack") | Describes `product-surfaces → product-ui → ui → design` as the live DOM stack; will collapse to `product-client` + `design` (+`product-domain`). |
| `specs/codebase/structures/frontend/packages/README.md` | Full package map/table (`design`, `product-domain`, `product-ui`, `product-surfaces`, `product-client`, `ui`) with per-package "May import / Must NOT import" rules keyed to the 6-package boundary. |
| `specs/codebase/structures/frontend/README.md` ("CI-Enforced Repo Shape") | Describes `scripts/check_frontend_boundaries.py` enforcing the current 6-package dependency direction; the lint itself needs updating alongside the doc. |
| `specs/codebase/structures/frontend/guides/components.md` | References `product-ui`/`product-surfaces` component placement rules. |
| `specs/codebase/structures/frontend/guides/mental-model.md` | References the current package boundaries as part of the onboarding mental model. |
| `specs/codebase/structures/frontend/guides/styling.md` | References package-scoped styling ownership. |

---

## 3. Decisions (ALL RULED as of 2026-07-25 — sheet closed)

Renumbered from v1; each carries a recommendation. D3 from v1 is **removed**
(its factual premise was wrong — see Errata).

### D1 — RESOLVED (was: kit/Dialog vs ModalShell / Radix-in-primitives)

Folded into the ruled library model (§2.2): `kit/Dialog` is the raw
`library/primitives/` Radix wrapper; `ModalShell` is the `library/patterns/`
composition built on it (verified — `ModalShell.tsx` imports `Dialog`,
`DialogContent`, `DialogClose`, `DialogTitle`, `DialogDescription` from
`../kit/Dialog`). No fold-into-ModalShell migration is needed; both stay as
documented tiers, same shape as the already-ruled `ConfirmationDialog` /
`kit/AlertDialog` split. No longer open.

### D2 — No sanctioned user-avatar component (RULED)

`OrganizationAvatar` is the one true reusable avatar (org logo + initials
fallback). Person/user avatars are ad-hoc `<img src={avatarUrl}>` with no
initials fallback, confirmed in three places: `ProductSidebarAccountFooter.tsx`
(product-ui), `SidebarAccountFooter.tsx` (product-client, alongside an
`OrganizationAvatar` usage for the org half), and `AccountSettingsPane.tsx`
(product-ui, a `<img>`-based fallback with `avatarFailed` state — closer to a
real avatar component than the other two ad-hoc spots, but still not shared).
`AccountPane.tsx` (product-client) delegates to `AccountSettingsPane`'s prop
rather than rendering its own `<img>`.

**RULED (Pablo, 2026-07-25): accepted** — extract a `UserAvatar` primitive
(sibling to `OrganizationAvatar`, ~1 file) before the cull locks "avatar" as a
single-component job — 3 call sites to touch, small.

### D3 — REMOVED (was: fold ProductPageShell into SettingsPageHeader family)

**v1's D3 rested on a wrong premise and is deleted, not carried forward.** v1
claimed the workflows-access page-header stack had "only two" holdout
consumers, implying it was a stray migration remnant. Re-verified against the
checkout: `ProductPageShell` (`product-ui/src/layout/ProductPageShell.tsx`)
has **8 source-level importers** — 6 in `product-ui` (`WorkspacesSurface`,
`WorkflowDefinitionEditor`, `WorkflowRunDetail`, `WorkflowDefinitionList`,
`AutomationSurface`, `AutomationDetailSurface`), 1 in `product-surfaces`
(`WorkflowResourceState`), 1 in `product-client`
(`WorkflowDefinitionsAccessScreen`).

Tracing reachability one hop further (a check the reviewer's "6/1/1" note
didn't go into, and this revision adds): of those 8, **5 are actually reachable
from a live route, 3 are dead code that merely still imports `ProductPageShell`**.
`WorkflowDefinitionEditor`/`WorkflowDefinitionList`/`WorkflowRunDetail`
(product-ui) and `WorkflowDefinitionsAccessScreen`/`WorkflowResourceState`
route through `WorkflowsPage.tsx` (live, mounted at `/workflows`) — genuinely
live. But `WorkspacesSurface.tsx` (product-ui) has 0 external importers of
its own (the live workspaces route, `WorkspacesPage.tsx`, builds its own UI on
`MainSidebarPageShell` and never touches it — confirmed by reading its
imports) — it's dead code that happens to import `ProductPageShell` internally,
not a live consumer. `AutomationSurface`/`AutomationDetailSurface` are dead
for the same reason: their only importer, `AutomationsScreen.tsx`
(product-client), is never mounted at any route — `/automations` is a
redirect to `/workflows` (`LegacyRouteRedirect` in `AuthenticatedAppHost.tsx`),
and no other file references `AutomationsScreen`. See the new dead-chain
finding in §5.2 and Errata #9.

Net effect on D3 itself: the wrong-premise correction still stands — this is
not "two workflow-access holdouts," it's a shell pattern reachable from
workflows *and* workspaces-adjacent code *and* (dead) automations code — but
the *live* import-direction picture is 5 reachable consumers (4 product-ui +
1 product-client + workflows-surfaces chain), not 8. Either way,
`ProductPageShell` is a general product-page-shell pattern distinct from
`SettingsPageHeader`, with no fold to consider. It keeps its own
`library/patterns/` entry, importer count annotated with the live/dead split
above rather than a flat "8."

### D4 — CloudChatSurface family: dead-composer-generation deletion (RULED)

`chat/CloudChatComposer.tsx` / `CloudChatTranscript.tsx` / `CloudChatSurface.tsx`
(product-ui) are the last remnant of a superseded chat-composer generation.
Re-verified: `CloudChatSurface`'s **only** consumer anywhere is
`product-client/src/components/playground/loading/PlaygroundLoadingStates.tsx`
— a playground fixture, not a production surface (confirmed by direct grep:
the only three files referencing `CloudChatSurface` in the whole tree are its
own source, its own test, and this one playground import). `CloudChatComposer`
and `CloudChatTranscript` are each consumed only by things that are themselves
dead (`NewChatSurface`, `AutomationCreatePanel`) or by `CloudChatSurface`
itself. The real chat surface lives in
`product-client/src/components/workspace/chat/*`.

v1 contained two different, conflicting descriptions of this importer (one
calling it "`CloudRepoPicker`-adjacent" in the §1 dead-components table, one
correctly calling it the playground fixture in the old D4 prose) — see
Errata; the playground-fixture description is the true one and is the only
one kept here.

**RULED (Pablo, 2026-07-25): accepted** — delete the whole family and repoint
`PlaygroundLoadingStates.tsx` at the real `workspace/chat/*` loading surface
(~1 file to touch). No evidence in the code that the playground intentionally
exercises the old surface for regression coverage.

### D5 — CloudSecretsSettingsSurface split (RULED)

`CloudSecretsSettingsSurface` (`product-surfaces/src/settings/`) has 3 real
call sites, confirmed: `OrganizationSecretsPane.tsx`, `PersonalSecretsPane.tsx`,
`RepoEnvironmentPane.tsx` (all `product-client`) — plus one further internal
hop through `CloudEnvironmentDetail.tsx`, which also renders it. This is the
one genuinely multi-spot connected block that the no-surfaces-tier ruling
(§2.2, §6) doesn't cleanly dissolve into single-call-site feature code.

**RULED (Pablo, 2026-07-25): split accepted** — presentational
secrets pattern moves to `library/patterns/`, a shared access hook stays in
`hooks/access`. This is the one exception to "surfaces dissolve into feature
code" and should be documented as such at fold time, not treated as a
precedent for keeping other surfaces intact.

---

## 4. Sanctioned library index

Organized by target tier. **INBOUND-SAFE CANDIDATE** replaces v1's "MOVABLE
NOW" language throughout this document — the verdict proves only that no
`ui`/`product-ui`/`product-surfaces` package currently imports the
component (i.e., moving it into `product-client` would not break any
still-outside consumer). It does **not** mean the move is free. An actual
move additionally requires, per component:

1. **Outbound-dependency check** — does the component's own source import
   something `product-client`'s `package.json` doesn't yet declare? (Verified
   below per candidate — `product-client` currently declares **zero**
   `@radix-ui/*` and zero `sonner` dependencies; `ui`'s `package.json` carries
   `@radix-ui/react-alert-dialog`, `-avatar`, `-checkbox`, `-context-menu`,
   `-dialog`, `-dropdown-menu`, `-popover`, `-radio-group`, `-separator`,
   `-slot`, `-tooltip`, and `sonner`.)
2. **Package exports-map update** — `product-client/package.json` already
   has an `exports` block (like `ui`'s); a moved component needs a new
   subpath entry there, not just a file move.
3. **Test relocation** — component tests move with the component.
4. **Tailwind/content-glob discovery** — `design/src/css/dom.css` currently
   declares `@source` scan roots for `ui/src`, `product-ui/src`,
   `product-surfaces/src`, and `product-client/src` (verified). A component
   moving *within* `product-client/src` (e.g. into a new
   `product-client/src/library/primitives/` subtree) is already covered by
   the existing `@source "../../../product-client/src"` root — no Tailwind
   config change needed for intra-package moves. This caveat matters more for
   the eventual full-package fold, when `ui/src` etc. stop existing as
   `@source` roots and must be removed from `dom.css`.

### 4.1 Primitives (target: `library/primitives/`)

| Component | Current path | Importers (ui/p-ui/p-surf/p-client) | Verdict | Radix/outbound dep needed |
|---|---|---|---|---|
| `Button` | `ui/src/primitives/Button.tsx` | 8/59/4/177 (240 total, spot-verified) | BLOCKED (ui, product-ui, product-surfaces) | none (no external deps) |
| `LevelBarsButton` | `ui/src/primitives/LevelBarsButton.tsx` | 0/0/0/1 | **INBOUND-SAFE CANDIDATE** | none (composes local `ComposerControlButton`) |
| `PaneIconButton` | `ui/src/layout/PaneIconButton.tsx` | 0/0/0/4 | **INBOUND-SAFE CANDIDATE** | none |
| `ProgressBar` | `ui/src/primitives/ProgressBar.tsx` | 0/0/0/3 | **INBOUND-SAFE CANDIDATE** | none |
| `RadioCardGroup` | `ui/src/primitives/RadioCardGroup.tsx` | 0/0/0/1 | **INBOUND-SAFE CANDIDATE** | none |
| `kit/AlertDialog` | `ui/src/kit/AlertDialog.tsx` | 0/0/0/2 | **INBOUND-SAFE CANDIDATE** | `@radix-ui/react-alert-dialog` — must be added to `product-client/package.json` |
| `kit/Dialog` | `ui/src/kit/Dialog.tsx` | 1/2/0/4 | BLOCKED (ui, product-ui) | `@radix-ui/react-dialog` (when unblocked) |
| `kit/Tooltip` | `ui/src/kit/Tooltip.tsx` | 1/0/0/1 (internal-only blocker: `primitives/Tooltip`) | BLOCKED (ui, internal) | `@radix-ui/react-tooltip` (when unblocked) |
| `Tooltip` (primitives) | `ui/src/primitives/Tooltip.tsx` | 0/3/0/13 | BLOCKED (product-ui) | (wraps `kit/Tooltip`) |
| `Checkbox` (kit) | `ui/src/kit/Checkbox.tsx` | 1/1/0/0 | BLOCKED (ui, product-ui) | `@radix-ui/react-checkbox` (when unblocked) |
| `Checkbox` (primitives re-export) | `ui/src/primitives/Checkbox.tsx` | 0/2/0/8 | BLOCKED (product-ui) | (re-exports kit/Checkbox) |
| `PopoverButton` | `ui/src/primitives/PopoverButton.tsx` | 2/4/0/47 (52 total, spot-verified) | BLOCKED (ui, product-ui) | `@radix-ui/react-popover`, `@radix-ui/react-slot` (when unblocked) |
| `PopoverMenuItem` | `ui/src/primitives/PopoverMenuItem.tsx` | 2/5/0/28 | BLOCKED (ui, product-ui) | none beyond `Popover` stack |
| `IconButton` | `ui/src/primitives/IconButton.tsx` | 1/4/0/17 | BLOCKED (ui, product-ui) | none |
| `Input` | `ui/src/primitives/Input.tsx` | 1/14/0/40 | BLOCKED (ui, product-ui) | none |
| `Label` | `ui/src/primitives/Label.tsx` | 0/9/0/18 | BLOCKED (product-ui) | none |
| `SegmentedControl` | `ui/src/primitives/SegmentedControl.tsx` | 0/1/0/6 | BLOCKED (product-ui) | none |
| `Select` | `ui/src/primitives/Select.tsx` | 0/6/0/8 | BLOCKED (product-ui) | none |
| `ShortcutBadge` | `ui/src/layout/ShortcutBadge.tsx` | 1/1/0/7 | BLOCKED (ui, product-ui) | none |
| `Badge` | `ui/src/primitives/Badge.tsx` | 0/17/1/13 | BLOCKED (product-ui, product-surfaces) | none |
| `Skeleton` | `ui/src/primitives/Skeleton.tsx` | 0/4/2/1 | BLOCKED (product-ui, product-surfaces) | none |
| `Spinner` | `ui/src/primitives/Spinner.tsx` | 3/1/0/1 | BLOCKED (ui, product-ui) | none |
| `Switch` | `ui/src/primitives/Switch.tsx` | 0/2/1/8 | BLOCKED (product-ui, product-surfaces) | none |
| `Textarea` | `ui/src/primitives/Textarea.tsx` | 1/9/0/10 | BLOCKED (ui, product-ui) | none |

### 4.2 Patterns (target: `library/patterns/`)

| Component | Current path | Importers (ui/p-ui/p-surf/p-client) | Verdict | Radix/outbound dep needed |
|---|---|---|---|---|
| `ModelTable` | `product-ui/src/settings/ModelTable.tsx` | 0/0/0/1 | **INBOUND-SAFE CANDIDATE** | none (composes `Badge`/`Switch`, both `library/primitives/`) |
| `PaneOptionsMenuItem` | `ui/src/layout/PaneOptionsMenuItem.tsx` | 0/0/0/3 | **INBOUND-SAFE CANDIDATE** | none |
| `PillControlButton` | `ui/src/primitives/PillControlButton.tsx` | 0/0/0/3 (all 3 dead-chain, unreachable from any route — see §5.1) | **DELETE (RULED 2026-07-25) — dies with the dead automations chain, never enters the library** | n/a |
| `SettingsSaveFooter` | `product-ui/src/settings/SettingsSaveFooter.tsx` | 0/0/0/2 | **INBOUND-SAFE CANDIDATE** | none |
| `SettingsScopeTabs` | `product-ui/src/settings/SettingsScopeTabs.tsx` | 0/0/0/1 | **INBOUND-SAFE CANDIDATE** | none |
| `kit/Sonner` | `ui/src/kit/Sonner.tsx` | 0/0/0/4 | **INBOUND-SAFE CANDIDATE** | `sonner` (non-Radix npm dep) — must be added to `product-client/package.json` |
| `ComposerActionButton` | `ui/src/primitives/ComposerActionButton.tsx` | 0/1/0/1 | BLOCKED (product-ui) | none |
| `ComposerControlButton` | `ui/src/primitives/ComposerControlButton.tsx` | 1/4/0/13 | BLOCKED (ui, product-ui) | none |
| `ComposerTextarea` | `ui/src/primitives/ComposerTextarea.tsx` | 0/1/0/3 | BLOCKED (product-ui) | none |
| `ComposerTextareaFrame` | `ui/src/primitives/ComposerTextareaFrame.tsx` | 0/1/0/5 | BLOCKED (product-ui) | none |
| `ConfirmationDialog` | `ui/src/primitives/ConfirmationDialog.tsx` | 0/3/0/11 | BLOCKED (product-ui) | (built on `ModalShell` + `Button`) |
| `ModalShell` | `ui/src/primitives/ModalShell.tsx` | 1/2/0/13 | BLOCKED (ui, product-ui) | (built on `kit/Dialog`) |
| `EnvironmentSearchSelect` | `ui/src/primitives/EnvironmentSearchSelect.tsx` | 0/1/0/2 | BLOCKED (product-ui) | none beyond Popover stack |
| `PickerPopoverContent` | `ui/src/primitives/PickerPopoverContent.tsx` | 1/0/0/3 (internal-only blocker) | BLOCKED (ui, internal) | none |
| `PageContentFrame` | `ui/src/layout/PageContentFrame.tsx` | 0/1/0/0 (internal to `ProductPageShell`) | BLOCKED (product-ui) | none |
| `PageHeader` | `ui/src/layout/PageHeader.tsx` | 0/1/0/0 (internal to `ProductPageShell`) | BLOCKED (product-ui) | none |
| `ProductPageShell` | `product-ui/src/layout/ProductPageShell.tsx` | 0/6/1/1 (8 total — see D3) | BLOCKED (product-ui, product-surfaces) | none |
| `PrStatusBadge` | `product-ui/src/workspaces/PrStatusBadge.tsx` | 0/2/0/2 | BLOCKED (product-ui) | none (built on `Badge`) |
| `SettingsEmptyState` | `product-ui/src/settings/SettingsEmptyState.tsx` | 0/2/0/16 | BLOCKED (product-ui) | none |
| `SettingsEyebrow` | `product-ui/src/settings/SettingsEyebrow.tsx` | 0/1/0/4 | BLOCKED (product-ui) | none |
| `SettingsMenu` | `ui/src/primitives/SettingsMenu.tsx` | 0/1/0/2 | BLOCKED (product-ui) | none |
| `SettingsPageHeader` | `product-ui/src/settings/SettingsPageHeader.tsx` | 0/2/2/23 (27 real import statements, verified) | BLOCKED (product-ui, product-surfaces) | none |
| `SettingsRow` | `product-ui/src/settings/SettingsRow.tsx` | 0/5/3/12 | BLOCKED (product-ui, product-surfaces) | none |
| `SettingsSection` | `product-ui/src/settings/SettingsSection.tsx` | 0/7/3/25 | BLOCKED (product-ui, product-surfaces) | none |
| `SidebarActionButton` | `ui/src/layout/SidebarActionButton.tsx` | 0/1/0/4 | BLOCKED (product-ui) | none |
| `SidebarNavRow` | `ui/src/layout/SidebarNavRow.tsx` | 0/1/0/1 | BLOCKED (product-ui) | none |
| `SidebarRowSurface` | `ui/src/layout/SidebarRowSurface.tsx` | 1/3/0/3 | BLOCKED (ui, product-ui) | none |
| `AutoHideScrollArea` | `ui/src/layout/AutoHideScrollArea.tsx` | 0/4/0/14 | BLOCKED (product-ui) | none |
| `ThinkingText` | `ui/src/primitives/ThinkingText.tsx` | 0/1/0/1 | BLOCKED (product-ui) | none |

### 4.3 Icons (target: `library/icons/`)

| Component | Current path | Importers (ui/p-ui/p-surf/p-client) | Verdict | Outbound dep needed |
|---|---|---|---|---|
| `command-palette-icons` | `ui/src/command-palette-icons.tsx` | 0/0/0/1 | **INBOUND-SAFE CANDIDATE** | none |
| `icons` (barrel + detail modules) | `ui/src/icons.tsx` | 0/18/2/177 (197 total, spot-verified) | BLOCKED (product-ui, product-surfaces) | none |
| `proliferate-icons` | `ui/src/proliferate-icons.tsx` | 1/1/0/5 | BLOCKED (ui, product-ui) | none |
| `provider-icons` | `ui/src/provider-icons.tsx` | 0/1/0/8 | BLOCKED (product-ui) | none |

### 4.4 Judgment calls carried from v1, restated against the resolved tier model

- The `kit/AlertDialog` / `kit/Sonner` primitives-vs-patterns placement
  question from v1 is **resolved** by §2.2: raw Radix wrappers are
  `library/primitives/` regardless of whether they're documented as tiered
  systems. `kit/AlertDialog` and `kit/Sonner` above are placed in Patterns
  in this table only because of what they wrap into (a documented dialog
  tier; a toast funnel) — if the primitives-only reading is preferred instead,
  move both rows to §4.1. Flag for final placement confirmation, but the
  primitives/patterns *tier model itself* is no longer open.
- `PickerPopoverContent` and `kit/Tooltip` are each blocked solely by one
  internal same-package consumer (`EnvironmentSearchSelect`,
  `primitives/Tooltip`) rather than by `product-ui`/`product-surfaces` — they
  move as a unit with their blocker once that blocker unblocks.
- `layout/PageHeader` / `layout/PageContentFrame` are internal-only to
  `ProductPageShell` (one importer each) — resolved to BLOCKED via
  `ProductPageShell`'s own chain, which is BLOCKED by product-ui/surfaces
  (not "only 2 workflow consumers" — see D3 removal above).

---

## 5. Kill list

### 5.1 Duplicate losers with migration notes

**Menu system (RULED — sanctioned system: `PopoverButton` + `PopoverMenuItem`).**
`kit/DropdownMenu.tsx` is banned for new use; 4 files migrate:
`WorkspaceItemMenu.tsx`, `RightPanelNewTabMenu.tsx`, `WorkspaceActionsMenu.tsx`
(all `product-client`), `product-ui/chat/transcript/ProposedPlanCard.tsx` —
re-verified, exactly these 4 files reference `DropdownMenu`/`DropdownMenuContent`
/`DropdownMenuItem`/`DropdownMenuTrigger` today, no more, no fewer.

**PARITY PRECONDITION, not a mechanical migration.** Reviewer flagged that
this migration was described as purely mechanical in v1; that's wrong, and
this revision corrects it. Radix `DropdownMenuPrimitive` (which
`kit/DropdownMenu.tsx` wraps) provides real keyboard/focus semantics that the
Popover-based menu system, as read from source, does not currently replicate:

- `kit/DropdownMenu.tsx` delegates entirely to `@radix-ui/react-dropdown-menu`
  (`DropdownMenuPrimitive.Root/Content/Item/...`), which implements
  roving-tabindex arrow-key navigation between items, typeahead-by-label, and
  managed focus-return-to-trigger on close, per Radix's Menu primitive
  contract.
- `PopoverButton.tsx` (`ui/src/primitives/PopoverButton.tsx`) is a thin
  wrapper over `@radix-ui/react-popover`'s `Root`/`Trigger`/`Content` — it
  explicitly calls `event.preventDefault()` on `onOpenAutoFocus` and
  `onCloseAutoFocus` (documented in-source as intentional, for
  terminal/composer focus neutrality), which is the opposite of Radix's
  managed dropdown-menu focus behavior.
- `PopoverMenuItem.tsx` renders a plain `<button>` with `onClick` — no
  `role="menuitem"`, no `onKeyDown`, no roving-focus coordination between
  sibling rows. There is no arrow-key or typeahead handling anywhere in
  `ui/src/primitives/PopoverButton.tsx` / `PopoverMenuItem.tsx` /
  `kit/Popover.tsx` (confirmed by grep for `ArrowDown`/`ArrowUp`/`roving`/
  `onKeyDown` across those three files — zero hits).

**Recommendation**: treat keyboard/focus parity as a precondition on the
sanctioned menu system, not a reason to keep `DropdownMenu` alive.
`PopoverMenuItem` needs arrow-key roving focus, typeahead, and focus-return
behavior added (or a shared hook it composes) **before** the 4-file
migration, not after. Until that lands, migrating `WorkspaceItemMenu`, etc.
onto `PopoverButton`/`PopoverMenuItem` is a real accessibility/interaction
regression, not a like-for-like swap.

**`trigger` vs `triggerMode` — corrected.** v1 documented `PopoverButton` as
supporting `` trigger="click"|"doubleClick"|"contextMenu" `` in two places
(§1 Menus table and the old §2a `kit/ContextMenu` row). That's the wrong prop
name. Reading `PopoverButton.tsx` source: `trigger` is the trigger *element*
prop (`trigger: ReactElement<{...}>`, line 28); the interaction-mode prop is
`triggerMode?: "click" | "doubleClick" | "contextMenu"` (line 47, default
`"click"`). Every reference to this prop in this catalog and elsewhere should
read `triggerMode="contextMenu"`, not `trigger="contextMenu"`.

`kit/ContextMenu.tsx` (0 importers) stays a confirm-delete candidate once the
4-file `DropdownMenu` migration lands — unaffected by the correction above.

**Dialogs (RULED — two tiers, both stay).** `ConfirmationDialog` (product
tier, built on `ModalShell`+`Button`, verified) and `kit/AlertDialog`
(primitive tier, 2 importers: `WorkspaceReconciliationDialog`,
`WorkspaceAvailabilityActionHost`) are the two ruled tiers.
`kit/Dialog.tsx` is not a third tier needing a decision — §3-D1 resolves it
as the `library/primitives/` raw wrapper that `ModalShell` (the pattern) is
built on.

**Avatars (RULED — `kit/Avatar` deleted).** 0 importers anywhere, no-op
removal.

**Password sign-in form — real duplicate, deletion not migration.**
`product-client/src/components/auth/PasswordSignInForm.tsx` is the live path
(rendered by `LoginScreen`/`AuthShell`). `product-ui/src/auth/PasswordCredentialForm.tsx`
has 0 importers, and its whole call chain (`AuthStartPanel` →
`ConnectGitHubRequiredPanel` → `AuthLayout`, etc.) is unreachable — confirmed,
see recount in §5.2. Delete the chain; nothing to migrate.

**Composer/automation control-pill — merge and delete, do not relocate first
(RULED, carried forward) — but the whole target chain is dead code, which
changes what "merge" actually means here.** `PillControlButton` has 3
source-level importers, all `automations/*` (`AutomationRunLocationSelector`,
`AutomationAgentRunConfigPicker`, `AutomationEditorControls` — re-verified,
same 3 files as v1). Tracing one hop further (new finding, not in v1 or the
review): all 3 are only reachable through `AutomationEditorDialog.tsx` →
`AutomationEditorModal.tsx` → `AutomationsScreen.tsx` (product-client) — and
`AutomationsScreen.tsx` itself has **zero importers anywhere** (confirmed by
full-tree grep). The `/automations` route in `AuthenticatedAppHost.tsx`
redirects to `/workflows` via an inline `LegacyRouteRedirect` component; no
route, lazy import, or dynamic import mounts `AutomationsScreen` today. This
whole editor-modal-and-controls chain is dead, unreachable code, not a live
duplicate needing a migration.

`PillControlButton` is near-identical to `ComposerControlButton` (17 live
importers) with a different token namespace and a `disclosure` auto-chevron
— that structural-duplicate observation from v1 still holds. But per this
finding, there is nothing live to "merge onto `ComposerControlButton`."
**RULED (Pablo, 2026-07-25): the automations page is genuinely removed, for
good.** The `AutomationEditorDialog`/`AutomationEditorModal`/
`AutomationsScreen` chain and its `Automation*Selector`/`Picker`/`Controls`
family are orphans of the workflows migration and get deleted outright in the
cull PR. `PillControlButton` and its 3 consumers go with them; the earlier
"merge into `ComposerControlButton`" ruling is void — there is nothing live to
merge. It never enters the library.

**`SidebarNavItem` superseded by `SidebarNavRow`.** 0 importers, delete
outright — nothing to migrate.

**Checkbox/Tooltip re-export indirection — cosmetic, no action.**
`primitives/Checkbox.tsx` is a 1-line re-export of `kit/Checkbox.tsx`;
`primitives/Tooltip.tsx` wraps `kit/Tooltip.tsx` with formatting logic. Both
single implementations, two entry points — not real duplicates.

### 5.2 Dead components (recounted)

Every entry re-checked for external cross-package imports and internal
same-package imports; both zero unless noted.

**`apps/packages/ui/src/`**: `kit/Avatar.tsx` (RULED deleted), `kit/ContextMenu.tsx`,
`kit/RadioGroup.tsx`, `kit/Separator.tsx`, `kit/Table.tsx`, `layout/AppShell.tsx`,
`layout/EnvironmentLayout.tsx`, `layout/ListSurface.tsx`, `layout/SectionHeader.tsx`,
`layout/SidebarFrame.tsx`, `layout/SidebarNavItem.tsx`, `layout/SizedPanel.tsx`,
`layout/EmptyState.tsx`, `primitives/CollapsibleSummaryRow.tsx`,
`primitives/SelectionRow.tsx`, `primitives/Tabs.tsx`, `primitives/Toggle.tsx`,
`primitives/GridTile.tsx` (transitively dead via dead `ModelConfigGrid`).

Not dead, flagged to avoid false "delete" calls: `kit/Popover.tsx` (internal
to `PopoverButton`), `lib/utils.ts` (13 internal `ui/src` consumers,
re-verified by grep).

**`apps/packages/product-ui/src/`**: `account/AccountIdentityCard.tsx`,
`account/ConnectedProviderRow.tsx`, `automations/AutomationCreatePanel.tsx`,
`brand/ProliferateMark.tsx`, `chat/ChatPreviewSurface.tsx`,
`chat/CloudChatComposer.tsx`, `chat/CloudChatTranscript.tsx`,
`chat/CloudChatSurface.tsx` (see D4 — only reachable via a playground fixture),
`code/VirtualizedCodeContent.tsx`, `new-chat/NewChatSurface.tsx`,
`settings/InstallGate.tsx`, `settings/ModelConfigGrid.tsx`,
`settings/SettingsShell.tsx`, `sidebar/ProductSidebar.tsx`,
`workspaces/CloudWorkspaceList.tsx`, `WorkspaceRow.tsx`, `workspaces/WorkspacesSurface.tsx`.

**New dead entries found in this pass, not flagged by v1 or the review:**
`automations/AutomationSurface.tsx` and `automations/AutomationDetailSurface.tsx`
(product-ui). Both surfaced during D3 re-verification as apparent
`ProductPageShell` importers, which read as "live" on a first-hop grep — but
their only importer, `AutomationsScreen.tsx` (product-client), is itself
unreachable from any route (`/automations` redirects to `/workflows` via
`LegacyRouteRedirect` in `AuthenticatedAppHost.tsx`; no lazy/dynamic import
mounts it either). `workspaces/WorkspacesSurface.tsx` is the same pattern one
layer down: it imports `ProductPageShell` internally, which makes it look
like a live consumer on a shallow grep, but it has zero importers of its own
— the live workspaces route (`WorkspacesPage.tsx`) builds its own UI on
`MainSidebarPageShell` and never touches this file. All three are correctly
dead by the "0 external importers" test; the trap is that a component being
dead doesn't stop it from importing other live-looking things internally,
which can make a first-hop importer grep on those internal imports
over-count "live" consumers. See D3 and §5.1 (PillControlButton) for the
downstream effects of this same trap.

**Corrected count — the dead `auth/*` subtree is 7 files, not 8.** v1's §2d
recommendation said "Delete the `product-ui/src/auth/*` chain (8 files, all
0-importer...)" but its own §3 list of dead auth files enumerated exactly
seven: `AuthLayout.tsx`, `AuthStartPanel.tsx`, `ConnectGitHubPanel.tsx`,
`ConnectGitHubRequiredPanel.tsx`, `GoogleGlyph.tsx`, `LegalLinks.tsx`,
`PasswordCredentialForm.tsx`. Re-verified against the checkout: the
`product-ui/src/auth/` directory contains **9** source files total, of which
**2 are live** (`ProviderBrandIcon.tsx` — imported by 8 files across
`product-client`/`product-ui`, including `AccountPane.tsx`,
`GitHubAppInstallationSection.tsx`, `OrgSsoLoginLink.tsx`; and
`RedirectCallbackScreen.tsx` — imported by `SettingsCloudRedirect.tsx` and
`DesktopWorkspaceDeepLinkPage.tsx`), leaving **7** genuinely dead files
matching the §3 list. "8" in the §2d recommendation line was simply a
miscount against the doc's own evidence — the correct number, and the number
to act on, is **7**.

Not dead: `chat/transcript/MarkdownContentSearchMarks.tsx` (internal to
`MarkdownBody.tsx`, distinct job from `product-client`'s `ContentSearchMarks.tsx`).

**`apps/packages/product-surfaces/src/`**: `settings/CloudEnvironmentsSettingsSurface.tsx`
+ its controller/detail dependents (bundled deletion unit — the live
repo-environments UI is `RepoEnvironmentPane.tsx`'s inline
`EnvironmentCloud`/`EnvironmentLocal`, unrelated); `support/CloudSupportSurface.tsx`
(transitively kills `product-ui/support/SupportSurface.tsx`, its only importer).
`use-add-cloud-environment.ts`/`use-cloud-environment-draft.ts` hooks are
**not** dead — reused directly by `product-client` independent of the surface.

**`apps/packages/product-client/src/components/`**: no fully-dead reusable
component found. Six pure re-export barrels flagged as tidy-up debt, not a
culling target: `components/feedback/ThinkingText.tsx`, `Skeleton.tsx`,
`components/session-controls/SessionControlIcon.tsx`,
`components/workspace/chat/transcript/AssistantMessage.tsx`, `ProposedPlanCard.tsx`,
`CopyMessageButton.tsx`, `components/workspace/shell/sidebar/SidebarShowToggleRow.tsx`.

---

## 6. Ex-product-surfaces dissolution plan

Per the no-surfaces-tier ruling (§2.2): single-call-site connected surfaces
(Billing, SSO, Workflows) dissolve into ordinary feature code that composes
library patterns + access hooks. Reused hooks (e.g. cloud-environment hooks)
belong to `hooks/access`, not the library — they were never library citizens
and don't get a catalog row.

Out of scope for the §4 library table by design (final home = feature code,
not the library): `BillingSettingsSurface` + `BillingManagementCards`/
`BillingUsageUnitsSection`/`BillingOwnerController`,
`CloudOrganizationSsoSettingsSurface`, `WorkflowDefinitionsSurface`,
`WorkflowRunsSurface`, `CloudEnvironmentsSettingsSurface` (+ controller/detail,
already flagged dead above), `CloudSupportSurface` (already flagged dead
above).

**Exception: `CloudSecretsSettingsSurface`** (§3, D5) — the one genuine
multi-call-site (3 sites) connected surface. Splits into a presentational
`library/patterns/` secrets pattern + a shared access hook, rather than
dissolving into three independent copies of feature code. RULED accept
(Pablo, 2026-07-25).

---

## 7. Culling-PR scope contract

- The culling PR **deletes** the dead-component list (§5.2, corrected counts,
  now including the `AutomationSurface`/`AutomationDetailSurface`/
  `WorkspacesSurface` finding), **migrates** the ruled duplicate losers where
  a migration ruling exists and the target is live (menu system — gated on
  the parity precondition in §5.1), and **relocates** only the components it
  already touches onto their final-taxonomy path where the current import
  direction allows (the INBOUND-SAFE CANDIDATE rows in §4, each subject to
  its own outbound-dependency/exports-map/test/Tailwind checklist).
  `PillControlButton` → `ComposerControlButton` is excluded from this PR's
  automatic scope until Pablo confirms whether the automations editor chain
  it lives in is dead-for-good or coming back (§5.1, Errata #9) — do not
  merge/relocate it on the strength of the old ruling alone.
- It does **not** perform a big-bang package merge, and it does not relocate
  any live, still-blocked component "while we're in the area." Per standing
  review guidance: never mix unrelated live-component relocations into a
  deletion PR.
- **Sanction-trail rule**: any relocation beyond the deletion/migration/
  already-inbound-safe set requires its own explicit sanction (a ruling or a
  founder decision entry in this doc) before landing in the culling PR —
  "it seemed convenient while I was in the file" is not sufficient
  justification for scope creep in a deletion-focused PR.

---

## 8. Foundation-coupling sequencing

Carried from v1's final section, re-verified to still read correctly, phrased
state-neutrally (relative to when the foundations PR lands / when the
packages fold — not "upcoming" or "has completed").

These sanctioned (§4) components are heavy consumers of the type/token system
(`--color-*`, the `text-ui`/`text-title` type scale, `--radius`). Any culling
migration landing *on* these components should be sequenced for **after** the
foundations/type pass lands on them, not before — otherwise migrated call
sites get restyled twice.

| Component | Token surface | Why it matters for sequencing |
|---|---|---|
| `Button` | 8 token/type-scale hits; every variant/size in tokens | Every menu/dialog/composer migration in §5 routes through `Button` underneath — a token change here ripples everywhere. |
| `PopoverMenuItem` | 7 token hits | The §5.1 `DropdownMenu → PopoverButton/PopoverMenuItem` migration (4 files, gated on keyboard parity) should land after this is restyled, so migrated rows don't need a second pass. |
| `ModalShell` | 7 token hits | Any dialog-adjacent work should wait for this — no longer gated on a D1 decision (D1 is resolved), but the token-restyle sequencing still applies. |
| `SettingsRow` | 5 token hits | High-traffic (15+ importers) — any Settings-scope migration work should follow the foundations pass here. |
| `ConfirmationDialog` | 3 token hits | Product-tier dialog (ruled) — stable role, but visual surface will shift. |
| `Badge` | 3 token hits | 31 importers; any badge-adjacent cleanup (e.g. `PrStatusBadge`) should wait. |
| `SettingsPageHeader` | 3 token hits | 27 importers — since D3 is removed, there is no fold decision waiting on this; the sequencing note now applies only to ordinary Settings-scope migration work, not to a page-header unification. |
| `SettingsSection` | 2 token hits | 28+ importers, same sequencing logic as `SettingsRow`. |
| `Input`, `Label` | 1 token hit each (54/27+ importers) | Lower own-token-density but extremely high fan-out — small foundations edits here have the widest blast radius in the catalog. |

Components with **zero** token/type-scale hits (`PopoverButton.tsx`,
`kit/Tooltip.tsx`) are structurally uncoupled from the foundations pass — safe
to migrate consumers onto whenever it unblocks other work, independent of
where the foundations pass lands.

---

## Errata — what changed from v1, and why

Every contested fact from the review was re-verified directly against the
`c0dd0e32b` checkout before being encoded above. Summary of what the truth
turned out to be:

1. **D3 premise (ProductPageShell importers)** — v1 implied ~2 consumers,
   "the workflows-access surfaces." Actual, at the source-import level: **8
   importers** — 6 product-ui (`WorkspacesSurface`, `WorkflowDefinitionEditor`,
   `WorkflowRunDetail`, `WorkflowDefinitionList`, `AutomationSurface`,
   `AutomationDetailSurface`), 1 product-surfaces (`WorkflowResourceState`),
   1 product-client (`WorkflowDefinitionsAccessScreen`) — matching the
   reviewer's "6/1/1" re-verification exactly. Tracing one hop further (this
   revision's addition, see #9 below): only 5 of those 8 are reachable from a
   live route; 3 (`WorkspacesSurface`, `AutomationSurface`,
   `AutomationDetailSurface`) are dead code that happens to still import
   `ProductPageShell`. D3 removed either way; `ProductPageShell` is a general
   cross-feature page-shell pattern, not a narrow workflows-access holdout.
2. **DropdownMenu migration "mechanical"** — false. Radix
   `DropdownMenuPrimitive` provides roving-focus/typeahead/focus-return that
   `PopoverButton`/`PopoverMenuItem` (grep-confirmed: no `onKeyDown`/arrow-key
   handling anywhere in those files) do not have. Encoded as a parity
   precondition on the sanctioned menu system, not a reason to keep
   `DropdownMenu`.
3. **`trigger` vs `triggerMode`** — v1's Menus table and old §2a
   `kit/ContextMenu` row both wrote `` trigger="click"\|"doubleClick"\|"contextMenu" ``.
   Source (`PopoverButton.tsx` line 47) names this prop `triggerMode`;
   `trigger` is a different prop (the trigger element itself). Corrected in
   both places above.
4. **Dead auth-file count** — v1's §2d recommendation said "8 files"; v1's
   own §3 list enumerated 7. Recount against the repo: the `auth/` directory
   has 9 source files, 2 of which (`ProviderBrandIcon.tsx`,
   `RedirectCallbackScreen.tsx`) are live with real importers. The dead
   subtree is **7 files**, matching the §3 list — "8" was a miscount in the
   recommendation line, now corrected.
5. **CloudChatSurface importer — two conflicting v1 descriptions** — the §1
   dead-components table called it "`CloudRepoPicker`-adjacent"; the old D4
   prose correctly identified `PlaygroundLoadingStates.tsx` (a playground
   fixture) as the sole importer. Verified: only three files reference
   `CloudChatSurface` anywhere — its own source, its own test, and
   `PlaygroundLoadingStates.tsx`. The playground-fixture description is kept;
   the `CloudRepoPicker`-adjacent description is dropped as simply wrong.
6. **"MOVABLE NOW" → "INBOUND-SAFE CANDIDATE"** — renamed throughout, with
   the outbound-dependency/exports-map/test/Tailwind checklist added. Concretely
   verified: `product-client/package.json` declares zero `@radix-ui/*` and
   zero `sonner` dependencies today, so `kit/AlertDialog` needs
   `@radix-ui/react-alert-dialog` added and `kit/Sonner` needs `sonner` added
   before either can actually move, even though both are import-direction-safe
   today.
7. **Canonical docs contradiction** — confirmed `specs/codebase/structures/frontend/architecture.md`,
   `packages/README.md`, and `README.md` (CI-Enforced Repo Shape,
   `scripts/check_frontend_boundaries.py`) all currently and correctly
   describe the 6-package world. Added §2.5 as the explicit "update at fold
   time" list instead of letting this doc silently contradict them.
8. **D1 (kit/Dialog vs ModalShell)** — resolved by the ruled library model,
   not left open: confirmed by source read that `ModalShell` imports `Dialog`/
   `DialogContent`/`DialogClose`/`DialogTitle`/`DialogDescription` from
   `../kit/Dialog` directly — the primitives/patterns tiering already
   describes the real relationship. Marked RESOLVED (§3, D1).

### New contradictions found in this pass (not caught by v1 or the review)

- **9. `AutomationsScreen` and the whole `/automations` editor chain are dead
  code, unreachable from any route — this undermines both D3's importer count
  and the standing `PillControlButton` migration ruling.** Tracing one hop
  past the reviewer's "6/1/1" `ProductPageShell`-importer re-verification
  (which is correct at the source-import level) surfaces something neither
  v1 nor the review checked: whether those importers are themselves live.
  `AuthenticatedAppHost.tsx` routes `/automations` and `/automations/:workflowId`
  through an inline `LegacyRouteRedirect` to `/workflows` (landed in the
  "add managed Cloud product experience" commit, `0a155125a`) — no route,
  lazy import, or dynamic import anywhere in the tree mounts
  `AutomationsScreen.tsx` (product-client). That makes the entire chain
  hanging off it dead: `AutomationEditorModal` → `AutomationEditorDialog` →
  `AutomationEditorControls` / `AutomationRunLocationSelector` /
  `AutomationAgentRunConfigPicker` (the last of which has 0 importers even of
  itself, beyond its own file), and — one more hop up — `product-ui`'s
  `AutomationSurface.tsx` / `AutomationDetailSurface.tsx`, whose only importer
  is the same dead `AutomationsScreen.tsx`.

  Two concrete consequences: (a) **D3's "8 importers" is 5 live + 3 dead** —
  `AutomationSurface`/`AutomationDetailSurface` (and, one further hop down a
  different branch, `WorkspacesSurface.tsx`, whose only import of
  `ProductPageShell` is internal to a file with zero importers of its own —
  the live workspaces route builds on `MainSidebarPageShell` instead) don't
  actually route-mount `ProductPageShell` in production; (b) **the standing
  `PillControlButton → ComposerControlButton` merge ruling targets a dead
  chain** — its 3 documented consumers are all inside the orphaned automations
  editor, so "migrate 3 files" is either moot (if the chain is deleted) or
  needs to happen as part of un-orphaning the automations UI (if it's coming
  back), not as an isolated component migration. See D3 (§3) and §5.1 for how
  this is encoded above; recommend Pablo confirm which of the two
  (delete-the-orphan vs. it's-coming-back) is true before the cull PR touches
  `PillControlButton`.

- **10. `sonner` (npm package) vs `kit/Sonner` (the ui-package toast wrapper)
  is a real outbound dependency, not just an internal move.** v1's movability
  table listed `kit/Sonner` as movable with no outbound-dependency flag; it's
  the only "primitive-tier"/pattern candidate in the INBOUND-SAFE set whose
  outbound dependency is a plain npm package rather than a `@radix-ui/*`
  scope, so a literal reading of the review's "verify which Radix deps"
  instruction would have missed it. Called out explicitly in §4.2 and Errata
  #6 above so it isn't missed at fold time.
