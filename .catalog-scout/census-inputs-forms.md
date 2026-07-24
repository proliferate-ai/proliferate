# Component-duplication census — INPUTS + FORMS

Scout domain: text inputs, textareas (incl. composer-adjacent editors),
selects/comboboxes/model pickers, search fields, form field wrappers
(label+input+error), password/secret fields, key-value editors, form section
layouts in settings panes.

Search roots: `apps/packages/ui/src`, `apps/packages/product-ui/src`,
`apps/packages/product-client/src`, `apps/desktop/src` (tests excluded;
playground noted only where it clones a production pattern).

Head: `b395def3c` (ui-foundation target, worktree `ui-catalog`).

Note on adoption counts: counted via `grep -rl` for the import specifier
across the four search roots, non-test files, so counts include the
defining file itself where noted.

---

## Family 1 — Inline "search-in-a-box" filter field (bespoke, 5 independent reimplementations of `PopoverSearchField`'s job)

The canonical borderless picker-search recipe already exists
(`PopoverSearchField`, see Singleton list) and its own doc-comment says
"Single source of truth for every picker search; do not hand-roll a boxed
`bg-surface-control` field again." Five call sites did exactly that anyway,
each with near-identical markup (`Search` icon + `Input`, wrapped in either
`relative` positioning with an absolutely-centered icon, or a flex row on
`bg-surface-control`).

**Members:**

1. `FileTreeOverlay.tsx:144-168` (`FileTreeBody`, internal, not exported) —
   package `product-client`. Flex row on `bg-surface-control` with a clear
   ("X") button when non-empty. Height `h-7`, icon `icon-paired`.
2. `GitReviewTargetSelector.tsx:82-91` — package `product-client`, export
   `GitReviewTargetSelector`. Flex row on `bg-surface-control`, no clear
   button, `h-7`, icon `icon-compact`.
3. `PaneFileTree.tsx:57-69` (`PaneFileTree`) — package `product-client`,
   exported generic tree component. Flex row on `bg-surface-control`, `h-7`,
   icon `icon-compact`. Structurally identical to #2 but styled for the
   sidebar tree (`text-sidebar-foreground` / `text-sidebar-muted-foreground`).
4. `OrganizationMembersSection.tsx:71-80` — package `product-client`.
   `relative` positioning, absolutely-centered `Search` icon at `left-3`,
   `Input` with `pl-9` padding. No clear button.
5. `ProviderPickerModal.tsx:55-65` — package `product-client`. `relative`
   positioning, icon at `left-2.5`, `Input` with `pl-8`. No clear button.

**How they differ:**
- API: none of the five expose a reusable component — each is inlined
  JSX in its own file, so there is no shared prop surface to compare;
  every consumer re-derives value/onChange/placeholder wiring by hand.
- Styling: two visual sub-families exist — "boxed row on
  `bg-surface-control`" (#1-#3) vs. "icon absolutely positioned over a
  bordered `Input`" (#4, #5). Icon size varies (`icon-paired` vs
  `icon-compact`) with no evident semantic reason.
- Behavior: only #1 has a clear ("X") button; the rest silently drop that
  affordance. None of the five reuse `matchesPickerSearch` from
  `@proliferate/ui/utils/search` consistently — #2 uses `.toLowerCase().includes`,
  #4 uses a hand-rolled `row.searchText.includes`, #5 uses
  `.toLowerCase().includes` on two fields.

**Closest to canonical:** `PopoverSearchField` (`apps/packages/ui/src/primitives/PopoverSearchField.tsx`)
is already the right shape and is the documented canonical — it just needs
callers to actually use it. Where the "boxed on `bg-surface-control`"
treatment is a deliberate different look for tree filters (not a popover),
`PaneFileTree`'s version (#3) is the cleanest of that sub-family (already a
shared, exported, parameterized component with `searchAutoFocus`/
`searchPlaceholder` props) — `FileTreeOverlay`'s inline copy (#1) is pure
duplication of a pattern that `PaneFileTree` already generalizes.

**Adoption count:**
- `PopoverSearchField` (canonical): 6 import sites (`HarnessAllModelsSection`,
  `HomeTargetPickerParts`, `EnvironmentStatusCard`, `ComposerModelSelectorControl`,
  `KeyboardShortcutsDialog`, `GitPanelHeader`) + defined in `CloudRepoPicker.tsx`
  (7 total including the picker that also uses it internally) + re-exported
  through `PickerPopoverContent`/`EnvironmentSearchSelect`.
- Bespoke boxed variant (#1-#3 pattern): 3 sites, 0 shared component.
- Bespoke absolute-icon variant (#4, #5): 2 sites, 0 shared component.

**Consolidation recommendation:** keep `PopoverSearchField` as the popover/menu
search recipe and extend `PaneFileTree`'s boxed inline-filter markup into a
small exported `InlineFilterField` primitive in `@proliferate/ui/primitives`
(row-on-`bg-surface-control`, optional clear button) for non-popover
contexts (file trees, member lists); fold `FileTreeOverlay`, `GitReviewTargetSelector`,
`OrganizationMembersSection`, and `ProviderPickerModal`'s inline copies into
whichever of the two canonical recipes matches their context (popover →
`PopoverSearchField`, inline panel/tree → the new `InlineFilterField`).

---

## Family 2 — "Trigger button + searchable popover option list" comboboxes (six independent, near-identical implementations)

There is no single canonical combobox component; instead there are at least
six components in `@proliferate/ui/primitives` and `product-client` that all
solve "button trigger, opens a `PopoverButton` menu, filters a list of rows,
shows a `Check` on the selected row" — each reinventing filtering, trigger
styling, and row rendering slightly differently.

**Members:**

1. `EnvironmentSearchSelect.tsx` (`apps/packages/ui/src/primitives/EnvironmentSearchSelect.tsx`)
   — export `EnvironmentSearchSelect`. Full option objects with
   `detail`/`disabled`/`searchValues`, built-in `PopoverSearchField`,
   `closeOnSelect` toggle. Most complete API of the group (search +
   detail line + disabled state + custom leading node).
2. `SettingsMenu.tsx` (`apps/packages/ui/src/primitives/SettingsMenu.tsx`)
   — export `SettingsMenu`. Grouped options (`SettingsMenuGroup[]`), no
   search field, `outline`-variant trigger.
3. `OrganizationSelectMenu.tsx` (`apps/packages/product-client/.../organization/OrganizationSelectMenu.tsx`)
   — flat `value`/`options` API, no search, no groups, `unstyled`
   button styled inline as a bordered select-lookalike (duplicates
   `Select`'s visual language with a popover instead of a native
   `<select>`).
4. `AgentHarnessModelSelector.tsx` (`apps/packages/product-client/.../agents/AgentHarnessModelSelector.tsx`)
   — grouped-by-harness options, no search field, uses `ComposerControlButton`
   trigger (composer-specific) + `ProviderIcon`.
5. `RepoPicker.tsx` (`apps/packages/product-ui/src/settings/RepoPicker.tsx`)
   — flat items with `kind: "local"|"cloud"` chip, no search, footer
   "Add repository…" action baked in, bordered 200px trigger.
6. `ComposerModelSelectorControl.tsx`'s inline `ComposerModelPickerPopover`
   (`apps/packages/product-client/.../chat/input/ComposerModelSelectorControl.tsx:132-233`)
   — the most bespoke: keyboard nav via `useModelPickerKeyboardNav`, grouped
   models, inline search, footer actions ("Add provider" / "Settings").
   Not exported as a reusable component — logic and markup are private to
   this file.

Additional near-members outside `product-client`'s model-picker surface that
independently reimplement "flat list + optional search + Check trailing"
inside a `PopoverButton`: `AutomationAgentRunConfigPicker.tsx`,
`AutomationRunLocationSelector.tsx`'s `RunLocationRows`, `HomeTargetPicker.tsx`
(via `PickerPopoverContent`, which *is* closer to canonical since it composes
`PopoverSearchField`), and `KeyPicker.tsx` (thin wrapper that correctly
delegates to `EnvironmentSearchSelect` — this one is fine).

**How they differ (API surface):**
| | search | groups | disabled rows | detail line | footer actions |
|---|---|---|---|---|---|
| EnvironmentSearchSelect | yes | no | yes | yes | no |
| SettingsMenu | no | yes | yes | yes | no |
| OrganizationSelectMenu | no | no | yes (self+disabled) | no | no |
| AgentHarnessModelSelector | no | yes | no | yes | no |
| RepoPicker | no | no | no | yes | yes (add) |
| ComposerModelPickerPopover (private) | yes | yes | no | no | yes (add+settings) |

**Closest to canonical:** none of the six is a strict superset of the
others, but `EnvironmentSearchSelect` has the best a11y/completeness
(search, disabled rows, detail lines, custom leading node) and already uses
the new token vocabulary (`text-ui`, `bg-hover`/`bg-active` etc.) cleanly.
`ComposerModelPickerPopover` has the best *interaction* model (keyboard nav
+ grouping + search) but is composer-specific and not extracted.

**Adoption count:**
- `EnvironmentSearchSelect`: 3 import sites (`KeyPicker`, `RepoConfigurePane`,
  `CloudEnvironmentConfigSection`).
- `SettingsMenu`: 3 import sites (`GeneralPane`, `AppearancePane`,
  `SecretEditorDialog`).
- `OrganizationSelectMenu`: 1 definition + 2 call sites
  (`OrganizationInvitationsSection`, `OrganizationMembersSection`).
- `AgentHarnessModelSelector`: 1 definition + 2 call sites
  (`AgentHarnessConfigComposer`, `AutomationAgentHarnessControls`).
- `RepoPicker` (product-ui/settings): 1 call site (`RepoScopeHeaderControls`).
- `ComposerModelPickerPopover`: private to `ComposerModelSelectorControl`
  (1 call site, itself the composer's model trigger — the highest-traffic
  picker in the product).

**Consolidation recommendation:** do not force all six into one component —
`RepoPicker`'s footer-action chip and `AgentHarnessModelSelector`'s
composer-button trigger are genuinely different roles from a plain settings
dropdown. But `SettingsMenu` and `OrganizationSelectMenu` overlap almost
completely (flat/grouped list, trigger button, Check trailing, no search) —
fold `OrganizationSelectMenu` into `SettingsMenu` (wrap its 2 call sites'
flat options as a single unlabeled group) and delete the bespoke component.
Separately, extract `ComposerModelPickerPopover`'s search+keyboard-nav+group
logic into a generic `SearchableGroupedPicker` primitive in
`@proliferate/ui/primitives` that `EnvironmentSearchSelect` can also build
on, since both want "search + grouped + Check" and currently hand-roll it
independently.

---

## Family 3 — API-key / secret value input with reveal toggle (2 members, 1 clear winner)

**Members:**

1. `ApiKeyCreatorModal.tsx` (`apps/packages/product-client/.../agent-auth/ApiKeyCreatorModal.tsx`)
   — export `ApiKeyCreatorModal`. `Input type="password"`, no inline
   reveal/hide toggle (value is masked and stays masked — "never displayed
   again after saving" copy). Optional title field, optional validated
   env-var field (SCREAMING_SNAKE_CASE), `data-api-key-input`/`data-api-key-save`
   qualification hooks, `data-telemetry-mask`.
2. `SecretEditorDialog.tsx` (`apps/packages/product-ui/src/secrets/SecretEditorDialog.tsx`)
   — export `SecretEditorDialog`. Has a real Show/Hide toggle
   (`Eye`/`EyeOff` from `lucide-react`, local `toggleClass`) that flips
   `Input type` between `password`/`text`, plus a Single-line/Multi-line
   toggle that swaps `Input` for `Textarea`, plus file-secret upload mode
   (`SegmentedControl` for "Paste text"/"Upload file").

**How they differ:** `ApiKeyCreatorModal` is agent-vault-key focused (title +
value + optional env-var binding); `SecretEditorDialog` is environment/file
secret focused (env var name-or-path + value with reveal, or file content/
upload) and is materially richer (reveal toggle, multiline, file mode). They
are not truly duplicates of each other — different domains (agent auth keys
vs. cloud sandbox secrets) — but the *reveal-toggle button* pattern
(`Eye`/`EyeOff` + `toggleClass`) is unique to `SecretEditorDialog` and not
factored out, so if any other secret-value field is added later, it will be
re-invented a third time.

**Closest to canonical:** `SecretEditorDialog`'s reveal-toggle button is the
one worth promoting; `ApiKeyCreatorModal` deliberately has no reveal (by
design — its value is one-way "stored, never shown again"), so it should
stay password-masked-only.

**Adoption count:** `ApiKeyCreatorModal`: 3 call sites (`PersonalSecretsPane`,
`HarnessAuthApiKeyDetails`, `KeyPicker`). `SecretEditorDialog`: 1 defined,
consumed by whichever secrets pane wires it (not directly grep-countable
beyond its own file within this domain's search roots — it's product-ui
presentational, host wiring lives in product-client secrets panes).

**Consolidation recommendation:** keep both (genuinely different domains),
but extract `SecretEditorDialog`'s Eye/EyeOff reveal-toggle into a small
`RevealToggleButton` (or a `revealable` prop on `Input`) in
`@proliferate/ui/primitives` so the next secret-value field doesn't
hand-roll a third `Eye`/`EyeOff` button.

---

## Family 4 — Password sign-in / credential form (2 members, 1 unused)

**Members:**

1. `PasswordSignInForm.tsx` (`apps/packages/product-client/src/components/auth/PasswordSignInForm.tsx:19-72`)
   — export `PasswordSignInForm`. Email + password `Input`s (no `Label`,
   uses `aria-label` instead), single submit button with `ArrowRight` icon,
   `tabbable` prop for hidden/inactive panel states. **Wired up**: imported by
   `AuthScreenLayout.tsx` and `LoginScreen.tsx`.
2. `PasswordCredentialForm.tsx` (`apps/packages/product-ui/src/auth/PasswordCredentialForm.tsx:21-96`)
   — export `PasswordCredentialForm`. Email + password `Input`s each with a
   real `<Label>`, `busyLabel`/`submitLabel` customization, `error` slot.
   **Dead in production**: the only reference outside its own file across
   the whole repo is `apps/packages/product-ui/test/AuthPanels.test.tsx`.

**How they differ:** `PasswordCredentialForm` has the more complete API
(explicit `Label`s with `useId()`, `error` ReactNode slot, customizable
button copy) — objectively the better-built component — but it is not
wired into any real screen. `PasswordSignInForm` is the one actually
rendered by the sign-in flow, uses `aria-label` instead of visible
`<Label>`s (slightly worse a11y), and has no `error` prop of its own
(error display is hoisted to the parent screen per its own code comment).

**Closest to canonical:** `PasswordCredentialForm` is the better-designed
component but is orphaned; `PasswordSignInForm` is the live one.

**Adoption count:** `PasswordSignInForm`: 2 call sites + defined.
`PasswordCredentialForm`: 0 production call sites, 1 test-only reference.

**Consolidation recommendation:** delete `PasswordCredentialForm.tsx` (and
its test) as unused, or — if `AccountPasswordCredentialCard`'s inline
change-password form is meant to converge with it later — migrate
`PasswordSignInForm`'s two live call sites onto `PasswordCredentialForm`'s
better API (explicit `Label`s + `error` slot) and delete `PasswordSignInForm`
instead. Either direction collapses two into one; leaving both is pure
dead-code risk since they are >80% identical in shape.

---

## Family 5 — Env-var / key-value name+value editor rows (2 members, different enough to keep separate, but note overlap)

**Members:**

1. `ApiKeyCreatorModal`'s optional `envVarField` (SCREAMING_SNAKE_CASE
   validated name + password value) — `apps/packages/product-client/.../agent-auth/ApiKeyCreatorModal.tsx:156-181`.
2. `SecretEditorDialog`'s env/file name+value editor (name-or-path field +
   value with reveal/multiline/file-upload) — `apps/packages/product-ui/src/secrets/SecretEditorDialog.tsx:228-364`.

**How they differ:** #1 is a single name+value pair inside a larger "create
API key" form (env var name is optional metadata on the key, not the
primary identity). #2 is the primary key-value editor for cloud sandbox
secrets (name-or-path is the primary identity; duplicate-name validation
against `existingEnvKeys`/`existingFileKeys`). Genuinely different roles —
one is "bind an existing/new key to an env var slot," the other is "create
the secret itself." No consolidation warranted beyond the reveal-toggle
extraction already noted in Family 3.

---

## Family 6 — Repo/branch/target pickers built directly on `PopoverButton` (loose family, several near-duplicate "row with icon + label + Check" renderers)

This is a looser family: `GitReviewBaseSelector`, `GitReviewTargetSelector`,
`HomeTargetPicker`/`HomeTargetPickerParts`, `RepoPicker` (product-ui), and
`CloudRepoPicker`'s `RepositoryRow` all render "icon chip + name + optional
badge + Check-if-selected" rows inside a `PopoverButton`, each with its own
row component (`TargetPickerMenuItem`, `RepositoryRow`, inline `Button`
rows in `GitReviewTargetSelector`, `PopoverMenuItem` variants). None of
these import a shared "selectable row" primitive even though
`PopoverMenuItem` (see Singletons) already generalizes most of this and is
in fact used by 3 of the 5. The 2 holdouts (`GitReviewTargetSelector`'s
branch rows and `CloudRepoPicker`'s `RepositoryRow`) hand-roll their own
`<Button variant="ghost">`-based row instead of `PopoverMenuItem`, purely
because they need a two-line label+meta layout that `PopoverMenuItem`'s
`children`-as-detail-line slot already supports — i.e. no technical reason
for the divergence.

**Consolidation recommendation:** migrate `GitReviewTargetSelector`'s
branch-row `<Button>` and `CloudRepoPicker`'s `RepositoryRow` onto
`PopoverMenuItem` (using its `children` slot for the meta line and
`trailing` for the config-state icon), eliminating two more bespoke row
renderers. Not urgent — both are readable — but it's the same
"PopoverMenuItem already does this" story as Family 2's `SettingsMenu`/
`OrganizationSelectMenu` overlap.

---

## SINGLETONS (fine as-is)

- `Input` (`apps/packages/ui/src/primitives/Input.tsx`) — single input
  primitive, `default`/`unstyled` variants, 55 import sites. Canonical, no
  competing raw `<input>` usage found anywhere in scope except
  `RangeSlider.tsx` (a different family — range slider, not a text field).
- `Textarea` (`apps/packages/ui/src/primitives/Textarea.tsx`) — single
  textarea primitive, `default`/`ghost`/`flush`/`code` variants, 19 import
  sites. No raw `<textarea>` usage found outside it.
- `ComposerTextarea` (`apps/packages/ui/src/primitives/ComposerTextarea.tsx`)
  — thin, well-justified wrapper over `Textarea` for the composer's larger
  type scale; 4 call sites, no overlap with `Textarea`'s other variants.
- `ComposerTextareaFrame` (`apps/packages/ui/src/primitives/ComposerTextareaFrame.tsx`)
  — layout-only frame around the composer textarea, single responsibility.
- `Select` (`apps/packages/ui/src/primitives/Select.tsx`) — single native
  `<select>` wrapper with chevron affordance, 14 import sites, no raw
  `<select>` usage found outside it.
- `Label` (`apps/packages/ui/src/primitives/Label.tsx`) — single label
  primitive, used everywhere Label appears (27 files); no competing
  hand-rolled label span pattern found (a few call sites use `sr-only`
  Labels for a11y-only labeling, which is the correct use of this same
  primitive, not a fork).
- `PopoverSearchField` (`apps/packages/ui/src/primitives/PopoverSearchField.tsx`)
  — canonical picker-search recipe; already the right shape (see Family 1
  for the call sites that should adopt it instead of hand-rolling).
- `PickerPopoverContent` / `PickerEmptyRow` (`apps/packages/ui/src/primitives/PickerPopoverContent.tsx`)
  — canonical popover body shell (search + scrollable list + empty state);
  composes `PopoverSearchField` correctly.
- `PopoverMenuItem` (`apps/packages/ui/src/primitives/PopoverMenuItem.tsx`)
  — canonical selectable-row primitive; widely adopted (used inside
  `SettingsMenu`, `EnvironmentSearchSelect`, `AgentHarnessModelSelector`,
  `HomeTargetPicker`, `GitPanelHeader`'s jump-to-file menu, and more). See
  Family 6 for the 2 holdouts that should migrate onto it.
- `ConfirmationDialog` (`apps/packages/ui/src/primitives/ConfirmationDialog.tsx`)
  — not strictly in this domain but touched several forms (delete-secret,
  revoke-key, delete-SSO-connection flows); single implementation, no
  duplication found.
- `SupportCreditField` (`apps/packages/product-client/.../support/SupportCreditField.tsx`)
  — small, purpose-built checkbox+conditional-input combo shared by exactly
  the two support modals that need it; correctly extracted, not duplicated.
- `McpElicitationFieldControl` (`apps/packages/product-client/.../chat/input/McpElicitationFieldControl.tsx`)
  — single dynamic-form-field renderer for MCP elicitation schemas
  (boolean/select/multiselect/text/number); its internal `FieldFrame` is a
  private, single-purpose label+children+description wrapper (not a
  duplicate of `OrganizationSsoSettingsSurface`'s private `FormField` — see
  note below, they're independent one-offs, not a family, since neither is
  reused and both are trivially small).
- `RadioCardGroup` (`apps/packages/ui/src/primitives/RadioCardGroup.tsx`)
  — single radio-card-group primitive; 1 call site
  (`WorkspaceAvailabilityActionHost`), no competing implementation. Not a
  duplicate of `SelectionRow` (see dead-code note below) despite visual
  similarity — different layout contract (horizontal cards vs. full-width
  list rows) and `RadioCardGroup` is the one actually used.
- `AutomationAgentRunConfigPicker`, `AutomationRunLocationSelector`,
  `PlanHandoffModePicker`, `SessionModeControl`, `ComposerSlashCommandSearch`
  — each is a single-purpose composer/automation control with no
  duplicate elsewhere; loosely share the "PopoverButton + filtered rows"
  shape noted in Family 2 but are domain-specific enough (mode cycling,
  slash-command palette, run-location owner/target split) that forcing them
  into one generic component would lose real behavioral differences. Listed
  here rather than in Family 2 because each has exactly one implementation.
- `AddCustomIntegrationDialog`, `IntegrationConnectDialog`,
  `ConnectServerDialog`, `OrganizationSsoSettingsSurface`,
  `OrganizationLimitsEditor`, `WorktreeStorageSection`'s `WorktreeCountInput`,
  `PublishDialog` — each is a one-off `Label`+`Input`/`Select` form with no
  duplicate elsewhere in scope; the `space-y-1.5` label-stack convention
  they all share is a styling convention, not a code duplication (no shared
  component to extract without inventing a `FormField` wrapper that doesn't
  exist yet — see note below).
- `WorkflowInputEditor` / `WorkflowRunForm` / `WorkflowStageEditor` /
  `WorkflowDefinitionEditor` — each a distinct workflow-authoring form
  section (define inputs vs. run inputs vs. stages vs. full definition);
  share `Input`/`Select`/`Label` primitives correctly, no row-level
  duplication between them found.

---

## Dead code found in this domain

- **`SelectionRow`** (`apps/packages/ui/src/primitives/SelectionRow.tsx`) —
  fully unused. `grep -rn "SelectionRow"` across the entire repo (not just
  this domain's search roots) returns only the definition file itself — zero
  import sites anywhere. Recommend deleting outright; it is not folded into
  anything because nothing consumes it.
- **`PasswordCredentialForm`** — see Family 4: zero production call sites,
  test-only reference. Recommend deleting or promoting-and-migrating per the
  Family 4 recommendation.

## Cross-cutting note: no shared `FormField` (label+input+error) wrapper exists

Every settings/dialog form in this census (`OrganizationSsoSettingsSurface`,
`AddCustomIntegrationDialog`, `IntegrationConnectDialog`, `ApiKeyCreatorModal`,
`SecretEditorDialog`, `PublishDialog`, `WorkflowInputEditor`, `WorkflowRunForm`,
`AutomationCreatePanel`) hand-rolls its own `<div className="space-y-1.5">
<Label>...</Label><Input/><p className="text-ui-sm ...">{hint/error}</p></div>`
block inline. `OrganizationSsoSettingsSurface` even names its private
version `FormField` — a strong signal the pattern wants to be a real,
shared, exported primitive (label + control + hint/error, with consistent
`aria-invalid`/error-styling wiring) rather than re-typed by hand in 9+
files. This is not a "family" in the strict sense (no two are byte-similar
enough to call literal duplicates — the JSX shape is copied conceptually,
not verbatim) but it is the single highest-leverage extraction opportunity
in this domain: one new `FormField` primitive in `@proliferate/ui/primitives`
would let all 9+ call sites drop their private inline wrapper.
