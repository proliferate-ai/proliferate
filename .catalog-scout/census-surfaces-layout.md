# Component-duplication census — Surfaces, Layout, Feedback

Scope: cards, panels, page/section headers, skeletons/spinners/progress,
status cards, banners/alerts, avatars/identicons, dividers/separators,
scroll-area wrappers, resize handles.

Search roots: `apps/packages/ui/src`, `apps/packages/product-ui/src`,
`apps/packages/product-client/src`, `apps/desktop/src`. Tests and
`playground/` excluded except where a playground clone of a production
pattern is worth flagging.

Repo head: `b395def3c302f54e92ad99c6121f5cc2a0c84034` (worktree
`ui-catalog`).

All paths below are relative to `/Users/pablohansen/proliferate/.worktrees/ui-catalog/`.

---

## FAMILY 1 — Hand-rolled resize/drag separators (4 near-identical clones vs. 1 real component)

**Family name:** Panel resize handle / drag separator

**Members:**
1. `apps/packages/product-client/src/components/workspace/shell/screen/WorkspaceResizeSeparator.tsx:7` — `WorkspaceResizeSeparator` (product-client). Exported component, `role="separator"`, `aria-orientation="vertical"`, `aria-controls`, edge-aware negative margin.
2. `apps/packages/product-client/src/components/workspace/shell/screen/MainSidebarPageShell.tsx:96-102` — inline `<div role="separator" aria-orientation="vertical" aria-controls="main-sidebar" ...>` with class `"relative z-10 -ml-1 flex w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/30 active:bg-primary/50"`.
3. `apps/packages/product-client/src/components/workspace/cowork/CoworkWorkspaceShell.tsx:166-173` (left) and `:224-230` (right) — two more inline separators, near-byte-identical className to #2, just `-ml-1`/`-mr-1` swapped and no `aria-controls` on the right one.
4. `apps/packages/product-client/src/components/settings/screen/SettingsScreen.tsx:209-213` — inline `<div role="separator" ...>` with the exact same className string as #2.
5. `apps/packages/product-client/src/components/workspace/pane/AttachedPaneShell.tsx:135-167` — `AttachedPaneResizeGutter`, a *different* anatomy: 4px hit target + separate 1px visible line that only paints on hover/active/focus (more refined than #2-4, uses `twMerge` + design tokens `bg-sidebar-background`/`bg-sidebar-border` instead of `bg-primary/30`).
6. `apps/packages/product-client/src/components/workspace/files/tree/FileTreeOverlay.tsx:96` — another inline `cursor-col-resize` handle, 8px (`w-2`) hit target with `focus-visible:outline` and a `resizing` boolean toggling `bg-active`.

**How they differ:**
- API: #1 takes `edge`, `onMouseDown`, `ariaControls` as props — reusable. #2-4 are copy-pasted JSX with no shared component, no `aria-controls` consistently wired (right-side handle in #3 has none). #5 and #6 are one-off local functions with their own hit-area/visual-line conventions.
- Styling: #2-4 use `hover:bg-primary/30 active:bg-primary/50` (a full-width color wash on the 4px strip). #5 uses a thin 1px line that only appears on hover/focus/active, sitting inside a wider invisible 4px hit strip — visually calmer and closer to the codex-style hairline aesthetic. #6 uses `bg-active` with `focus-visible:outline`.
- A11y: #1 and #6 include `aria-orientation`/`focus-visible` treatment; #3's right-hand separator omits `aria-controls`; #5 has no `role="separator"` at all (plain `div` with `tabIndex={0}`, missing `role`/`aria-orientation`).

**Closest to canonical:** `WorkspaceResizeSeparator` (#1) for the outer shell-level split (already extracted, already has the accessible props), but its *visual* treatment (`bg-primary/30` full-strip wash) is cruder than `AttachedPaneResizeGutter`'s (#5) hover-hairline treatment, which best matches the "codex" token-driven aesthetic seen elsewhere in this codebase (`bg-sidebar-border`, transition-only-on-interaction). A consolidated primitive should take #1's prop API + #5's visual treatment, and should always render `role="separator" aria-orientation="vertical"`.

**Adoption count:**
- `WorkspaceResizeSeparator`: 2 call sites (`StandardWorkspaceShell.tsx:248`, `WorkspaceShellRightRail.tsx`).
- Inline duplicate #2-4 pattern: 4 call sites (`MainSidebarPageShell` x1, `CoworkWorkspaceShell` x2, `SettingsScreen` x1) — all with the literal identical className string, hand-copied instead of importing #1.
- `AttachedPaneResizeGutter`: 1 call site (module-local, `AttachedPaneShell.tsx`).
- `FileTreeOverlay` inline handle: 1 call site, module-local.

**Recommendation:** Promote `WorkspaceResizeSeparator` to a shared `apps/packages/ui/src` primitive (e.g. `ResizeSeparator`) with edge + accessible-line-on-hover treatment borrowed from `AttachedPaneResizeGutter`; fold the 4 copy-pasted inline separators in `MainSidebarPageShell`, `CoworkWorkspaceShell` (x2), and `SettingsScreen` into it. Keep `FileTreeOverlay`'s handle separate only if its 8px/resizing-state contract genuinely differs — otherwise fold it in too.

---

## FAMILY 2 — "Bordered card with heading" section wrapper (9 copies of one literal className, no shared primitive used)

**Family name:** `rounded-lg border border-border bg-card p-4` section/card shell

**Members (all use the literal Tailwind string `"rounded-lg border border-border bg-card p-4"`):**
1. `apps/packages/product-ui/src/workflows/WorkflowDefinitionEditor.tsx:135`
2. `apps/packages/product-ui/src/workflows/WorkflowRunDetail.tsx:82` (Run details section)
3. `apps/packages/product-ui/src/workflows/WorkflowRunDetail.tsx:92` (`<details>` element, Inputs)
4. `apps/packages/product-ui/src/workflows/WorkflowRunDetail.tsx:106` (Steps section)
5. `apps/packages/product-ui/src/workflows/WorkflowInputEditor.tsx:25`
6. `apps/packages/product-ui/src/workflows/WorkflowRunForm.tsx:53`
7. `apps/packages/product-ui/src/workflows/WorkflowRunList.tsx:29`
8. `apps/packages/product-ui/src/workflows/WorkflowStageEditor.tsx:56`
9. `apps/packages/product-ui/src/workspaces/CloudWorkspaceList.tsx:64` (`<article>`, workspace card)
10. `apps/packages/product-ui/src/account/AccountIdentityCard.tsx:20` — same literal className, but this component is **dead** (see Singleton/dead-code note below).

Each of #1–#8 additionally repeats the identical header idiom inline:
`<h2 className="text-heading font-medium text-foreground">{title}</h2>` — no shared header sub-component, just copy-pasted JSX in every file.

**How they differ:** Functionally identical shell (rounded-lg/border/bg-card/p-4) and identical header typography; only the body content differs. None of them import `apps/packages/ui/src/layout/SectionHeader.tsx` (see Family 3) or any card primitive — every file re-declares the wrapper and the `<h2>` from scratch.

**Closest to canonical:** None of the 9 is more "correct" than another — they're all the same code, just not deduplicated. The existing unused `SectionHeader` primitive (`apps/packages/ui/src/layout/SectionHeader.tsx`) already expresses `title`+`description`+`actions` and would need only a wrapping `<section className="rounded-lg border border-border bg-card p-4">` to match this family exactly.

**Adoption count:** 9 live occurrences, all confined to `apps/packages/product-ui/src/workflows/*` and one in `workspaces/CloudWorkspaceList.tsx`. Zero of them use `SectionHeader` (0 adopters — see Family 3) or any shared `Card` wrapper (there is no shared `Card` primitive at all in `ui/src`).

**Recommendation:** Introduce a `Card`/`SectionCard` primitive in `apps/packages/ui/src/layout` wrapping this exact recipe + the repeated `<h2>` header, and fold all 9 workflow/workspace call sites into it. Do this at the same time `SectionHeader` gets its first adopters (Family 3) — they're the same underlying need (bordered card + heading) appearing twice, once with a border and once without.

---

## FAMILY 3 — Dead layout primitives with zero adopters

**Family name:** Unused `apps/packages/ui/src/layout` / `kit` primitives

**Members:**
1. `apps/packages/ui/src/layout/SectionHeader.tsx:10` — `SectionHeader` (title/description/actions). **0 external imports** anywhere in `ui`, `product-ui`, `product-client`, `desktop`.
2. `apps/packages/ui/src/kit/Avatar.tsx:6` — Radix-based `Avatar`/`AvatarImage`/`AvatarFallback`. **0 external imports.** Every real avatar in the app (sidebar account footer, org avatar, member list, prompt attachment thumbnails) is a hand-rolled `<div className="rounded-full ...">`/`<img>` pair instead (see Family 4).
3. `apps/packages/ui/src/primitives/ProgressBar.tsx:8` — `ProgressBar` (ARIA `role="progressbar"` div). **0 adopters.** Every real progress bar in the app (billing usage meter in `BillingOwnerCard`, update-download progress in `UpdateToastPresenter`/`HarnessUpdateToastPresenter`) is a hand-rolled `<div className="h-1.5 rounded-full bg-.../..."><div style={{width}}/></div>` pair instead.
4. `apps/packages/product-ui/src/account/AccountIdentityCard.tsx:11` — `AccountIdentityCard`. **0 external imports** (only self-references in its own file).
5. `apps/packages/product-ui/src/billing/BillingOwnerCard.tsx:23` — `BillingOwnerCard`. **0 imports anywhere.** `BillingPane.tsx` (the only plausible caller) renders `BillingSettingsSurface` from `product-surfaces` instead — a completely different, apparently newer implementation that never adopted this component. `BillingOwnerCard` still transitively pulls in `SettingsSection`/`SettingsRow`/`Badge`/`Metric`/`Notice` and is exported from the package, but nothing in the three apps renders it.
6. `apps/packages/product-ui/src/account/AccountPasswordCredentialCard.tsx:217` — `AccountPasswordCredentialCard` (wrapper around `AccountPasswordCredentialRow`, explicitly commented `"Legacy standalone card export — kept for API compatibility"`). The only consumer (`AccountSettingsPane.tsx`) uses the row form directly, not this wrapper — the wrapper itself has 0 real call sites beyond its own module.

**Consolidation recommendation:** Delete #2–#6 outright (confirmed zero call sites via grep across all four search roots). For #1 (`SectionHeader`), either wire it up as the header half of the new `SectionCard` from Family 2, or delete it too if the workflows surfaces keep their own inline `<h2>` — don't leave it sitting unused.

---

## FAMILY 4 — Avatar/initials-monogram implementations (real component exists, but is unused; 5 hand-rolled clones live in production)

**Family name:** Circular avatar with image-or-initials fallback

**Members:**
1. `apps/packages/ui/src/kit/Avatar.tsx:6` — Radix `Avatar` (dead, Family 3 #2).
2. `apps/packages/product-client/src/components/organizations/OrganizationAvatar.tsx:17` — `OrganizationAvatar`. Best-documented member ("the single org avatar used across every surface"), takes `name`/`logoImage`/`className`, size fully controlled by caller, exports `organizationInitials`. Uses `rounded-lg` (not `rounded-full`) + `border border-border-light bg-foreground/5`.
3. `apps/packages/product-ui/src/sidebar/ProductSidebarAccountFooter.tsx:14-20` — inline avatar: `rounded-full bg-surface-control`, `size-7`, `<img>` with `referrerPolicy="no-referrer"` or initials text.
4. `apps/packages/product-client/src/components/app/sidebar/SidebarAccountFooter.tsx:110-121` — inline avatar, near-identical to #3 (`rounded-full bg-surface-control`, `size-7`, same `referrerPolicy`) but hand-copied into a different file rather than sharing a component. This is the product-client counterpart of the product-ui sidebar footer above — two parallel sidebar-footer implementations each with their own copy of the same avatar markup.
5. `apps/packages/product-client/src/components/settings/panes/organization/OrganizationLogo.tsx:29-45` — local `Avatar` function (member avatar for org member lists): `rounded-full`, `size-8`, `border border-border-light bg-foreground/5` — this is `OrganizationAvatar`'s exact visual recipe (#2) but reimplemented from scratch for members instead of reusing it with a different size class.
6. `apps/packages/product-ui/src/repos/CloudRepoPicker.tsx:254` — repo-owner avatar `<img>`, `size-full object-cover` inline, no initials fallback path visible at that line (image-only).
7. `apps/packages/product-ui/src/account/AccountSettingsPane.tsx:205` — another inline `size-full object-cover` avatar image.

**How they differ:**
- Shape: `OrganizationAvatar` (#2) uses `rounded-lg` (squared/rounded-square identity tile); the sidebar footers (#3, #4) and member-list `Avatar` (#5) use `rounded-full` (circular). This is a real, intentional visual distinction (org identity = squarish logo tile; person identity = round) — not simply a bug, but it means "avatar" in this codebase is actually two separate visual languages that have never been named/split into two primitives.
- API: only #2 (`OrganizationAvatar`) takes props cleanly (`name`, `logoImage`, `className`). All others (#3, #4, #5, #6, #7) are inline JSX with no reusable component boundary — every consumer re-derives initials (`.trim().slice(0,2).toUpperCase()`) and re-declares the `rounded-full bg-surface-control`/`bg-foreground/5` + `<img>`-or-text branching from scratch.
- A11y: all consistently use `alt=""` (decorative) which is fine, but none expose a way to pass an accessible label to the wrapping element — that's left to callers.

**Closest to canonical:** `OrganizationAvatar` (#2) for the squared/org-identity role — already documented, prop-driven, adopted in 3 places (`SidebarAccountFooter.tsx`, `OrganizationLogo.tsx` for org's own logo, `OrganizationMembersList` via `Avatar`). For the circular/person-identity role, there is no canonical component yet — #3 and #4 duplicate each other verbatim across the product-ui/product-client split.

**Adoption count:**
- `OrganizationAvatar`: 3 real call sites (`SidebarAccountFooter.tsx`, `OrganizationLogo.tsx` `OrganizationLogo` wrapper, `SidebarAccountFooter.tsx` popover org-switcher rows).
- Inline circular sidebar-footer avatar pattern (#3/#4): 2 call sites, one per app-layer (product-ui's `ProductSidebarAccountFooter`, product-client's `SidebarAccountFooter`) — these look like two competing sidebar-footer implementations rather than one shared one; worth flagging to whoever owns sidebar consolidation (adjacent domain, not fully this scout's territory, but the avatar duplication is the visible symptom here).
- Member-list `Avatar` (#5): 1 call site (`OrganizationMembersList.tsx`).
- `kit/Avatar` (Radix): 0.

**Recommendation:** Extract a `PersonAvatar` primitive (circular, image-or-initials) into `apps/packages/ui/src` covering #3/#4/#5's shared recipe, parameterized by size; keep `OrganizationAvatar`'s squared recipe as a second, deliberately distinct primitive (rename/promote it into `ui/src` since it's already the most complete implementation). Delete the dead Radix `kit/Avatar`. Do NOT merge the two shapes into one component — round-vs-square is an intentional person/org distinction, not an accident.

---

## FAMILY 5 — Composer-docked interaction cards (well-consolidated; documenting for completeness)

**Family name:** Composer attached-panel interaction cards

**Members:**
1. `apps/packages/product-client/src/components/workspace/chat/input/ApprovalCard.tsx:46` — `ApprovalCard`
2. `apps/packages/product-client/src/components/workspace/chat/input/UserInputCard.tsx:77` — `UserInputCard`
3. `apps/packages/product-client/src/components/workspace/chat/input/McpElicitationCard.tsx:28` — `McpElicitationCard`
4. `apps/packages/product-client/src/components/workspace/chat/surface/WorktreeMissingAttachedPanel.tsx:18` — `WorktreeMissingAttachedPanel`
5. `apps/packages/product-client/src/components/workspace/chat/surface/CloudRuntimeAttachedPanel.tsx:30` — `CloudRuntimeAttachedPanelView`

**Verdict — already consolidated, no action needed.** All five compose the shared `ComposerAttachedPanel` + `ComposerAttachedPanelRow` + `ComposerCardFooter` primitives from `apps/packages/product-client/src/components/workspace/chat/input/ComposerAttachedPanel.tsx`, and the option-row anatomy shares `ComposerOptionRow`/`ComposerOptionKeyBadge`. This is the correct pattern — cite it as the model other card families (Family 2) should follow. One genuine specialization: `EnvironmentStatusCard.tsx`'s `StatusSection`/`StatusRow` (own file, `workspace-status/StatusCardPrimitives.tsx`) is a parallel-but-distinct anatomy (codex "card.html" sticky-header + hoverable rows) reused by the environment status popover and advanced-config sections — genuinely different role (hoverable summary list vs. modal-style interaction card), correctly kept separate.

---

## FAMILY 6 — Plan card family (well-consolidated; documenting for completeness)

**Family name:** Transcript plan cards

**Members:**
1. `apps/packages/product-ui/src/chat/transcript/ProposedPlanCard.tsx:72` — `ProposedPlanCard` (decision chip + footer actions)
2. `apps/packages/product-ui/src/chat/transcript/CollapsiblePlanCard.tsx:36` — `CollapsiblePlanCard` (shared shell: header, copy/expand controls, markdown body)
3. `apps/packages/product-client/src/components/workspace/chat/transcript/ClaudePlanCard.tsx:13` — `ClaudePlanCard` (streaming precursor, thin wrapper over #1 with `decisionState="streaming"`)
4. `apps/packages/product-client/src/components/workspace/chat/transcript/ProposedPlanCard.tsx:1` — pure re-export shim of #1 for the product-client import path.

**Verdict — already consolidated, no action needed.** `ProposedPlanCard` renders through `CollapsiblePlanCard`; `ClaudePlanCard` deliberately reuses the exact same component (documented inline: "same shell — no chip, no footer... no unmount/remount-driven chrome change"). This is a textbook correct one-canonical-form family.

---

## FAMILY 7 — Empty/placeholder states (three distinct-but-overlapping recipes; borderline, not urgent)

**Family name:** Empty-state / placeholder block

**Members:**
1. `apps/packages/ui/src/layout/EmptyState.tsx:10` — `EmptyState`. Dashed-border boxed card (`border-dashed`), title+description+action. 6 adopters (`WorkflowDefinitionList`, `CloudWorkspaceList`, `WorkspaceInventory`, `AutomationSurface`, `CoworkArtifactsPanel`, `WorkflowDefinitionsAccessScreen`).
2. `apps/packages/product-ui/src/settings/SettingsEmptyState.tsx:19` — `SettingsEmptyState`. Flat (no border/card), icon+title+description+action, `compact`/`full` size variants. 18 adopters, all in settings panes.
3. `apps/packages/product-client/src/components/workspace/git/GitReviewEmptyState.tsx:9` — `GitReviewEmptyState`. Flat, `panel`/`inline` variants, sidebar-scoped tone tokens (`text-sidebar-foreground/90`), ships its own `GitReviewEmptyStateAction` button. 2 real adopters (`GitReviewInlineState`, playground clone in `PlaygroundSidebarGitDiff`) — genuinely narrow, git-panel-specific tone.
4. Several one-off inline empty/placeholder blocks that don't use any of the three: `RightPanelPlaceholder.tsx:20` (`flex h-full items-center justify-center px-6 text-center`), `TerminalPanel.tsx:103` `TerminalEmptyState` (`flex h-full items-center justify-center px-6 text-center`) — **these two are near-identical to each other** (same wrapper classes, same "centered muted text" shape) but neither uses `SettingsEmptyState`/`EmptyState`.

**How they differ:** #1 (`EmptyState`) is deliberately boxed/dashed for "nothing here yet, add something" contexts (lists). #2 (`SettingsEmptyState`) is deliberately flat per the settings CONTRACT (documented in the file: "no card"). #3 is sidebar/git-panel tone-scoped. These three are legitimately different registers, not accidental duplicates — recommend keep-as-three. The real finding is #4: `RightPanelPlaceholder` and `TerminalPanel`'s local `TerminalEmptyState` hand-roll the exact same "centered flex, h-full, px-6, text-center" shape that #2's `compact`/`full` sizing already generalizes — these two should adopt `SettingsEmptyState` (or a shared non-settings-scoped alias of it) instead of re-deriving it.

**Adoption count:** `EmptyState` 6, `SettingsEmptyState` 18, `GitReviewEmptyState` 2 (+1 playground clone).

**Recommendation:** Keep all three named primitives (different registers, correctly named per-domain). Fold the two orphan inline placeholders (`RightPanelPlaceholder`, `TerminalPanel`'s `TerminalEmptyState`) into whichever flat empty-state primitive gets promoted out of `product-ui/settings` into a domain-neutral location — they don't need a fourth bespoke shape.

---

## FAMILY 8 — Skeleton / loading placeholders (well-consolidated; documenting for completeness)

**Family name:** Skeleton shimmer block

**Members:**
1. `apps/packages/ui/src/primitives/Skeleton.tsx:19` — `SkeletonBlock` + `shimmerDelay` (canonical: motion-safe shimmer, `prefers-reduced-motion` fallback, per-row stagger helper).
2. `apps/packages/product-client/src/components/feedback/Skeleton.tsx:1` — pure re-export shim of #1 for the `#product/...` import alias.
3. `apps/packages/product-client/src/components/feedback/LoadingIllustration.tsx:6` — `LoadingState`, composes #1 into a full "icon + message + optional subtext" block.
4. `apps/packages/product-ui/src/chat/CloudChatTranscriptLoadingState.tsx:13` — `CloudChatTranscriptLoadingState`, composes #1 into a fake-conversation skeleton (8 staggered rows).
5. `apps/packages/product-client/src/components/workspace/chat/surface/ChatLoadingHero.tsx:7` — `ChatLoadingHero`, composes #1 for the chat-hero variant.

**Verdict — already consolidated, no action needed.** Every consumer composes the one real primitive (`SkeletonBlock`/`shimmerDelay`); no duplicate shimmer implementation found anywhere.

---

## FAMILY 9 — Spinner (well-consolidated; documenting for completeness, flagging one adjacent inconsistency)

**Family name:** Loading spinner icon

**Members:**
1. `apps/packages/ui/src/primitives/Spinner.tsx:5` — `Spinner`. Custom SVG (270° arc), `motion-safe:animate-spin`. 15 real adopters across product-ui/product-client (`AuthProviderButton`, `Button` loading state, `TranscriptRowListShared`, `WorkspacesCommandList`, `AutomationInventoryList`, several tool-call rows, `HarnessUpdateToastPresenter`, etc.) — this is the dominant, correctly-adopted form.
2. `Loader2` from `lucide-react` + manual `animate-spin` class — used directly in `apps/packages/product-ui/src/chat/composer/CloudChatComposerFooter.tsx:110` and `CloudChatComposerControlParts.tsx:67`. Same visual effect (spinning glyph) achieved via a different icon set + raw Tailwind class instead of the `Spinner` primitive.
3. `RefreshCw` from `lucide-react` + manual `animate-spin` — used as a "refreshing" affordance (not a generic loading spinner) in `HarnessAllModelsSection.tsx` (x2), `HarnessAuthCliDetails.tsx`, `TurnDiffFileCard.tsx` (x2), `GitReviewFileRow.tsx`, `WorkspacesSurface.tsx`. This is a distinct semantic (refresh-in-progress icon, not a content-loading spinner) — correctly kept separate from `Spinner`.

**How they differ:** #1 is the sanctioned generic spinner (own component, motion-safe guard already baked in). #2 (`Loader2` + `animate-spin`) is functionally the same "generic loading" role but bypasses the shared component and its `prefers-reduced-motion` handling — worth a one-line fix (swap the two `CloudChatComposer*` call sites to `<Spinner>`), but low-severity (2 call sites only).

**Adoption count:** `Spinner` 15, raw `Loader2`+`animate-spin` 2, `RefreshCw`+`animate-spin` (refresh-affordance, different role) 6.

**Recommendation:** Keep `Spinner` as canonical; fold the 2 `Loader2` call sites in `CloudChatComposerFooter.tsx`/`CloudChatComposerControlParts.tsx` into it. Leave `RefreshCw`+`animate-spin` alone — different semantic (refresh action feedback, not content loading).

---

## FAMILY 10 — Notice/banner surfaces (three tone-driven card-banners, no shared primitive; moderate duplication)

**Family name:** Inline tone-colored notice/banner box

**Members:**
1. `apps/packages/product-ui/src/layout/ProductNotice.tsx:21` — `ProductNotice`. `rounded-lg border p-4`, 4 tones (`neutral`/`info`/`warning`/`destructive`) via a `toneClasses` record, icon+title+description. 2 adopters (`WorkspacesSurface`, `AutomationDetailSurface`).
2. `apps/packages/product-ui/src/billing/BillingUiParts.tsx:54` — `Notice` (billing-local). `rounded-lg border p-3`, 2 tones (`warning`/`destructive` only), icon+title+description+optional action button. Same shape as #1 but reimplemented from scratch with its own tone map and no `neutral`/`info` tones — used only inside `BillingOwnerCard` (which itself is dead code per Family 3, so this `Notice` is transitively unused too).
3. `apps/packages/product-client/src/components/settings/panes/agents/harness/HarnessConfigIssueBanner.tsx:13` — `HarnessConfigIssueBanner`. `rounded-lg border border-warning/30 bg-warning/5 p-3.5`, single fixed warning/destructive tone (driven by `agent.readiness`), icon-in-square + title/badge/description — a one-off variant of the same "tone-colored bordered box with icon+text" shape, not parameterized as a reusable tone component.
4. `apps/packages/product-ui/src/chat/ClaimBanner.tsx:23` — `ClaimBanner`. `rounded-lg border border-info/40 bg-info/10 p-3` (claim-request variant) and `rounded-lg border border-border bg-card p-3` (claimed-by-other variant) — two more one-off tone boxes inline in a single-purpose component.
5. `apps/packages/product-client/src/components/workspace/chat/transcript/SessionErrorItem.tsx:91` — inline `rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2` — another one-off destructive-tone box, richer (has retry/fallback/details actions) but structurally the same recipe as #1-#4.
6. `apps/packages/product-client/src/components/app/OfflineIndicator.tsx:16` — full-width banner (not boxed/rounded — spans the top edge with `border-b`), `bg-warning` solid fill rather than the `/10` tint used by #1-#5. Different visual register (persistent top-of-app strip vs. inline contextual notice) — correctly distinct, not a duplicate.
7. `apps/packages/product-client/src/components/workspace/chat/input/QueuedPromptEditBanner.tsx:9` — `bg-surface-control` (neutral, non-tone) notice strip — different register again (a quiet UI-state notice, not a warning/error), correctly distinct.

**How they differ:** #1-#5 all converge on the same visual grammar (`rounded-lg border`, tone-tinted bg at ~10% opacity, icon + title + description, optional action) but each reimplements its own tone-to-class mapping instead of sharing one. #1 (`ProductNotice`) is the most complete (4 tones, cleanest API) but has only 2 adopters; #2-#5 each hand-roll a narrower subset of the same thing.

**Closest to canonical:** `ProductNotice` (#1) — most complete tone set, cleanest `title`/`description`/`icon`/`tone` API, uses `twMerge`. `BillingUiParts`'s `Notice` (#2) is redundant with it and is dead code besides (transitively unused via dead `BillingOwnerCard`).

**Adoption count:** `ProductNotice` 2; `BillingUiParts.Notice` 1 (dead); `HarnessConfigIssueBanner`, `ClaimBanner`, `SessionErrorItem` inline boxes: 1 each (single-purpose, not exported for reuse).

**Recommendation:** Promote `ProductNotice` to `apps/packages/ui/src` as the canonical tone-notice primitive; fold `HarnessConfigIssueBanner` and the destructive box in `SessionErrorItem` onto it (both are simple icon+title+description+action tone boxes that don't need bespoke JSX). Delete `BillingUiParts.Notice` along with dead `BillingOwnerCard`. Leave `ClaimBanner` if its two variants (claimed-by-other neutral card vs. unclaimed info banner) don't cleanly map to one tone — otherwise fold too. Leave `OfflineIndicator` and `QueuedPromptEditBanner` alone (different registers: full-width persistent strip, and neutral state notice, respectively).

---

## SINGLETONS (fine as-is, no duplication found)

- `apps/packages/ui/src/layout/ListSurface.tsx:4` — `ListSurface` (bordered/rounded list container). 33 adopters across product-ui/product-client settings and sidebar surfaces; single canonical form, no competing implementation found.
- `apps/packages/product-ui/src/settings/SettingsSection.tsx:20` + `SettingsRow.tsx:25` — flat settings section/row pair, explicitly documented as "the retirement of `SettingsCard`/`SettingsCardRow`" — old card-boxed forms are gone, only the flat replacement remains; no leftover `SettingsCard` code found in the tree (grep confirms zero definitions, only comments referencing the retired name).
- `apps/packages/product-ui/src/settings/SettingsPageHeader.tsx:13` — settings-scoped page header (title/description/action). 27 adopters, single form, no duplicate.
- `apps/packages/ui/src/layout/PageHeader.tsx:11` — generic page header. 1 adopter (`ProductPageShell`), which itself is the shared page shell for workflows/automations/workspaces surfaces (7 adopters) — correctly layered (`ProductPageShell` wraps `PageHeader`+`PageContentFrame`), not duplicated elsewhere.
- `apps/packages/ui/src/layout/PageContentFrame.tsx:13` — scrollable page frame with sticky title-on-scroll. Single implementation, used only via `ProductPageShell`.
- `apps/packages/ui/src/layout/AutoHideScrollArea.tsx:42` — custom scroll-area wrapper with auto-hiding thumb + wheel-chaining. 20 real adopters (sidebar layout, settings shell, transcript rows, tool-call rows, cowork panels, diff viewer, publish dialog). One single implementation; no second scroll-area component found. (`web-scrollbar` CSS-class-only scrollbar styling in `chat/CloudChatSurface.tsx`, `CloudChatTranscriptState.tsx`, `CloudChatTranscriptLoadingState.tsx`, `NewChatSurface.tsx` is a lighter-weight *native*-scrollbar alternative used specifically for the main chat column, and `PageContentFrame` also uses the `web-scrollbar` class for its outer viewport — this is an intentional two-tier system: `AutoHideScrollArea` for chrome-heavy panels that need a custom thumb, `web-scrollbar` CSS class for plain native-scrollbar columns. Not a duplication, a documented split.)
- `apps/packages/ui/src/primitives/Skeleton.tsx` / `Spinner.tsx` — see Families 8/9 above (consolidated, canonical).
- `apps/packages/product-ui/src/workspaces/RecentWorkStatusDot.tsx:10` and `apps/packages/product-ui/src/automations/AutomationStatusGlyph.tsx:19` — both render small inline status indicators but serve different visual roles (a colored dot with optional pulse vs. an animated progress-ring/checkmark SVG glyph) — correctly kept as two separate components, not a duplication family.
- `apps/packages/product-client/src/components/workspace/git/GitPanelHeader.tsx` and `apps/packages/product-client/src/components/workspace/chat/transcript/TurnDiffPanelHeader.tsx` — both "diff-area headers" but for genuinely different surfaces (full git-review-panel toolbar with filter/base/target selectors vs. a per-turn diff card header with undo/review actions) — correctly separate, not duplicates.
- `apps/packages/product-client/src/components/workspace/terminals/TerminalPanel.tsx:28` — single terminal-panel-frame implementation (header + viewport + empty states), one canonical form; `RightPanelFrame.tsx` composes it rather than reimplementing it.
- `apps/packages/product-client/src/components/workspace/delegated-work/DelegatedAgentIdenticon.tsx:17` — bespoke SVG identicon (deterministic grid from a seed hash), single implementation, distinct role from avatar/initials (Family 4) — not a duplicate of anything, a genuinely singular pattern.
- `apps/packages/ui/src/kit/Separator.tsx` (Radix separator) — used inside `ContextMenu`/`DropdownMenu`/`Command` kit components only; no duplicate hairline-divider primitive found competing with it (the many inline `border-t`/`border-b border-border` hairlines throughout the codebase are page-specific layout dividers, not attempts at a reusable "Separator" component, so not counted as a duplication family here).

---

## Summary table

| Family | Members | Adopted canonical form | Dead members | Action |
|---|---|---|---|---|
| 1. Resize separators | 6 | `WorkspaceResizeSeparator` (2 sites) | — | Consolidate 4 inline copies + fold `AttachedPaneResizeGutter` visual treatment in |
| 2. Bordered card+heading | 10 (9 live workflows/workspaces + 1 dead) | none (no shared primitive exists) | `AccountIdentityCard` | Introduce `SectionCard` primitive, fold all 9 in |
| 3. Dead layout/kit primitives | 6 | n/a | `SectionHeader`, `kit/Avatar`, `ProgressBar`, `AccountIdentityCard`, `BillingOwnerCard`, `AccountPasswordCredentialCard` wrapper | Delete all 6 |
| 4. Avatar/initials | 7 | `OrganizationAvatar` (squared/org role, 3 sites) | `kit/Avatar` | Extract `PersonAvatar` for circular role; delete `kit/Avatar` |
| 5. Composer interaction cards | 5 | `ComposerAttachedPanel` (already canonical) | — | None — cite as model |
| 6. Plan cards | 4 | `CollapsiblePlanCard`/`ProposedPlanCard` (already canonical) | — | None — cite as model |
| 7. Empty states | 3 named + 2 orphan inline | 3 legitimately distinct registers | — | Fold 2 orphan inline placeholders into flat empty-state primitive |
| 8. Skeletons | 5 | `SkeletonBlock` (already canonical) | — | None |
| 9. Spinners | Spinner + 2 stray Loader2 | `Spinner` (15 sites, canonical) | — | Fold 2 `Loader2` sites in |
| 10. Notice/banner boxes | 7 | `ProductNotice` (best form, only 2 sites) | `BillingUiParts.Notice` (dead) | Promote `ProductNotice`, fold `HarnessConfigIssueBanner`/`SessionErrorItem` box in |

**Families found: 10** (5 requiring consolidation action, 2 well-consolidated already, 1 borderline/legitimate-split, 1 dead-code-only, 1 avatar/mixed). Confirmed dead code discovered along the way: `apps/packages/ui/src/layout/SectionHeader.tsx`, `apps/packages/ui/src/kit/Avatar.tsx`, `apps/packages/ui/src/primitives/ProgressBar.tsx`, `apps/packages/product-ui/src/account/AccountIdentityCard.tsx`, `apps/packages/product-ui/src/billing/BillingOwnerCard.tsx` (+ its private `BillingUiParts.Notice`/`Metric`/`BillingButton`), `apps/packages/product-ui/src/account/AccountPasswordCredentialCard.tsx`'s `AccountPasswordCredentialCard` wrapper export.
