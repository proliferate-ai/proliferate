# lucide-react retirement map

Generated for the lucide-retirement prep task (branch `vocab/lucide-glyphs`).
Enumerates every file under `apps/packages/product-client`, `apps/desktop`,
`apps/web` importing `lucide-react` directly, with a per-identifier
replacement. `apps/desktop` and `apps/web` had zero matches — all 49 files
are in `apps/packages/product-client`.

Legend:
- **EXISTING** — an identically-shaped glyph already lives in
  `primitives/icons/`. Import path + export name given. Some names differ
  from the lucide identifier (e.g. lucide `GitFork` → library `Fork`).
- **NET-NEW** — authored in this prep pass. Import path + export name given.
- **JUDGMENT-CALL** — no exact shape match; a recommendation is given but the
  applier (or review) should confirm before call-site rewrite.

Total: 49 files, 74 distinct lucide bindings (73 component identifiers + 1
type import). Net-new icons authored: 25, split across the four modules with
line-count headroom (`core.tsx` was already at its 483-line
`frontend_structure_allowlist.txt` ratchet ceiling — see note below — so none
landed there): `Laptop`, `Plug`, `Users`, `Gauge`, `MousePointerClick`,
`Scissors`, `Settings2` in `platform.tsx`; `Workflow`, `MessagesSquare`,
`Lightbulb`, `Hand`, `Quote` in `product.tsx`; `CircleCheck`, `Lock`,
`ShieldAlert`, `AlertTriangle`, `WifiOff`, `ChevronUp`, `RotateCw`, `Eye`,
`EyeOff` in `status.tsx`; `Braces`, `BookMarked`, `BookOpen`, `Save` in
`workspace.tsx`.

## Chat / activity (`components/workspace/chat/**`, `components/workspace/activity/**`)

| File | Identifier | Replacement |
| --- | --- | --- |
| `components/workspace/activity/ActivityChips.tsx` | `GitFork` | EXISTING → `Fork` (`#product/primitives/icons/core`) |
| `components/workspace/activity/ActivityChips.tsx` | `RotateCw` | NET-NEW → `RotateCw` (`#product/primitives/icons/status`) |
| `components/workspace/activity/ActivityChips.tsx` | `SquareTerminal` | EXISTING → `SquareTerminal` (`#product/primitives/icons/workspace`) |
| `components/workspace/activity/ActivityChips.tsx` | `type LucideIcon` | JUDGMENT-CALL → no library equivalent type; `CHIP_ICON: Record<ActivityChipKind, LucideIcon>` needs retyping to `ComponentType<IconProps>` (from `#product/primitives/icons/types`) at the call site — not a glyph swap. |
| `components/workspace/activity/GoalBar.tsx` | `ChevronUp` | NET-NEW → `ChevronUp` (`#product/primitives/icons/status`) |
| `components/workspace/activity/GoalBar.tsx` | `CircleAlert` | EXISTING → `CircleAlert` (`#product/primitives/icons/status`) |
| `components/workspace/activity/GoalBar.tsx` | `CircleCheck` | NET-NEW → `CircleCheck` (`#product/primitives/icons/status`) — same shape as `GoalTranscriptEventRow.tsx`/`TranscriptTurnChrome.tsx`/`BillingPlanComparison.tsx`'s `CheckCircle2`; one glyph, four call sites. |
| `components/workspace/activity/GoalBar.tsx` | `Pause` | EXISTING → `Pause` (`#product/primitives/icons/core`) |
| `components/workspace/activity/GoalBar.tsx` | `Pencil` | EXISTING → `Pencil` (`#product/primitives/icons/core`) |
| `components/workspace/activity/GoalBar.tsx` | `Play` | EXISTING → `Play` (`#product/primitives/icons/core`) |
| `components/workspace/activity/GoalBar.tsx` | `Target` | EXISTING → `Target` (`#product/primitives/icons/product`) |
| `components/workspace/activity/GoalBar.tsx` | `Trash2` | JUDGMENT-CALL → recommend reuse `Trash` (`#product/primitives/icons/core`); lucide `Trash2` adds two interior can lines `Trash` doesn't draw — visually close, not pixel-identical. Don't add a second trash glyph without a second-instance justification distinct from `SecretRow.tsx`/`LoopsPanel.tsx`/workflow editors below (rule of two — this would be the second implementation). |
| `components/workspace/activity/GoalBar.tsx` | `X` | EXISTING → `X` (`#product/primitives/icons/core`) |
| `components/workspace/activity/GoalBarObjectiveEditor.tsx` | `Check` | EXISTING → `Check` (`#product/primitives/icons/core`) |
| `components/workspace/activity/GoalBarObjectiveEditor.tsx` | `X` | EXISTING → `X` (`#product/primitives/icons/core`) |
| `components/workspace/activity/GoalBarResultPopover.tsx` | `Pencil` | EXISTING → `Pencil` (`#product/primitives/icons/core`) |
| `components/workspace/activity/LoopsPanel.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/workspace/activity/LoopsPanel.tsx` | `RotateCw` | NET-NEW → `RotateCw` (`#product/primitives/icons/status`) |
| `components/workspace/activity/LoopsPanel.tsx` | `Trash2` | JUDGMENT-CALL → recommend reuse `Trash` (`#product/primitives/icons/core`); see note above. |
| `components/workspace/activity/SubagentRosterRow.tsx` | `GitFork` | EXISTING → `Fork` (`#product/primitives/icons/core`) |
| `components/workspace/activity/TerminalRosterRow.tsx` | `SquareTerminal` | EXISTING → `SquareTerminal` (`#product/primitives/icons/workspace`) |
| `components/workspace/chat/ClaimBanner.tsx` | `Hand` | NET-NEW → `Hand` (`#product/primitives/icons/product`) |
| `components/workspace/chat/input/SelectedResponseContextList.tsx` | `Quote` | NET-NEW → `Quote` (`#product/primitives/icons/product`) |
| `components/workspace/chat/input/SelectedResponseContextList.tsx` | `X` | EXISTING → `X` (`#product/primitives/icons/core`) |
| `components/workspace/chat/transcript/GoalTranscriptEventRow.tsx` | `CircleAlert` | EXISTING → `CircleAlert` (`#product/primitives/icons/status`) |
| `components/workspace/chat/transcript/GoalTranscriptEventRow.tsx` | `CircleCheck` | NET-NEW → `CircleCheck` (`#product/primitives/icons/status`); the file's own comment ("Target/CircleCheck aren't in the curated ProductClient icon set") is now stale once this lands — delete it in the call-site pass. |
| `components/workspace/chat/transcript/GoalTranscriptEventRow.tsx` | `Target` | EXISTING → `Target` (`#product/primitives/icons/product`) |
| `components/workspace/chat/transcript/SelectedResponseActionMenu.tsx` | `MessageCircleQuestion` | EXISTING → `MessageCircleQuestion` (`#product/primitives/icons/core`) |
| `components/workspace/chat/transcript/SelectedResponseActionMenu.tsx` | `MessageSquarePlus` | EXISTING → `MessageSquarePlus` (`#product/primitives/icons/product`) |
| `components/workspace/chat/transcript/SelectedResponseActionMenu.tsx` | `MessagesSquare` | NET-NEW → `MessagesSquare` (`#product/primitives/icons/product`) |
| `components/workspace/chat/transcript/TranscriptTurnChrome.tsx` | `CircleCheck` | NET-NEW → `CircleCheck` (`#product/primitives/icons/status`); same stale-comment note as `GoalTranscriptEventRow.tsx`. |

## Settings / secrets / billing (`components/settings/**`, `components/patterns/secrets/**`, `components/billing/**`, settings playground)

| File | Identifier | Replacement |
| --- | --- | --- |
| `components/settings/panes/integrations/IntegrationIcon.tsx` | `Plug` | NET-NEW → `Plug` (`#product/primitives/icons/platform`) |
| `components/settings/panes/OrganizationBudgetsPane.tsx` | `ArrowLeft` | EXISTING → `ArrowLeft` (`#product/primitives/icons/core`) |
| `components/settings/panes/repo/CloudEnvironmentList.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/settings/panes/repo/CloudEnvironmentList.tsx` | `Folder` | EXISTING → `Folder` (`#product/primitives/icons/workspace`) |
| `components/settings/panes/repo/CloudEnvironmentList.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/settings/panes/repo/RepoCloudAuthorizationRequired.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/settings/panes/repo/RepoCloudGate.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/settings/panes/repo/RepoEnvironmentPane.tsx` | `KeyRound` | EXISTING → `KeyRound` (`#product/primitives/icons/core`) |
| `components/settings/panes/repo/RepoScopeStates.tsx` | `Folder` | EXISTING → `Folder` (`#product/primitives/icons/workspace`) |
| `components/settings/panes/repo/RepoScopeStates.tsx` | `Laptop` | NET-NEW → `Laptop` (`#product/primitives/icons/platform`) |
| `components/settings/panes/RepoPicker.tsx` | `Check` | EXISTING → `Check` (`#product/primitives/icons/core`) |
| `components/settings/panes/RepoPicker.tsx` | `ChevronsUpDown` | EXISTING → `ChevronUpDown` (`#product/primitives/icons/core`) |
| `components/settings/panes/RepoPicker.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/settings/panes/RepoPicker.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/settings/screen/AgentScopeHeaderControls.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/settings/screen/AgentScopeHeaderControls.tsx` | `Laptop` | NET-NEW → `Laptop` (`#product/primitives/icons/platform`) |
| `components/settings/screen/RepoScopeHeaderControls.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/settings/screen/RepoScopeHeaderControls.tsx` | `Laptop` | NET-NEW → `Laptop` (`#product/primitives/icons/platform`) |
| `components/settings/screen/SettingsScreen.tsx` | `ArrowLeft` | EXISTING → `ArrowLeft` (`#product/primitives/icons/core`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Blocks` | EXISTING → `Blocks` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Brain` | EXISTING → `Brain` (`#product/primitives/icons/product`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Building2` | EXISTING → `Building2` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `CircleUser` | EXISTING → `CircleUser` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `CreditCard` | EXISTING → `CreditCard` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Gauge` | NET-NEW → `Gauge` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `KeyRound` | EXISTING → `KeyRound` (`#product/primitives/icons/core`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `LifeBuoy` | EXISTING → `LifeBuoy` (`#product/primitives/icons/core`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Link2` | EXISTING → `Link2` (`#product/primitives/icons/core`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `MousePointerClick` | NET-NEW → `MousePointerClick` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Palette` | EXISTING → `Palette` (`#product/primitives/icons/core`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `RefreshCw` | EXISTING → `RefreshCw` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Scissors` | NET-NEW → `Scissors` (`#product/primitives/icons/platform`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Settings2` | NET-NEW → `Settings2` (`#product/primitives/icons/platform`) — distinct nav-row glyph from the app-chrome `Settings` gear; do not collapse the two, they read at different visual weights side-by-side in the same section. |
| `components/settings/sidebar/SettingsSidebar.tsx` | `SlidersHorizontal` | EXISTING → `SlidersHorizontal` (`#product/primitives/icons/core`) |
| `components/settings/sidebar/SettingsSidebar.tsx` | `Users` | NET-NEW → `Users` (`#product/primitives/icons/platform`) |
| `components/patterns/secrets/SecretEditorDialog.tsx` | `Eye` | NET-NEW → `Eye` (`#product/primitives/icons/status`) |
| `components/patterns/secrets/SecretEditorDialog.tsx` | `EyeOff` | NET-NEW → `EyeOff` (`#product/primitives/icons/status`) |
| `components/patterns/secrets/SecretList.tsx` | `KeyRound` | EXISTING → `KeyRound` (`#product/primitives/icons/core`) |
| `components/patterns/secrets/SecretList.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/patterns/secrets/SecretManagementPanel.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/patterns/secrets/SecretRow.tsx` | `Edit3` | JUDGMENT-CALL → recommend reuse `Pencil` (`#product/primitives/icons/core`); same edit-action semantics, confirm the pen-tip silhouette reads fine at the row's icon size before rewrite. |
| `components/patterns/secrets/SecretRow.tsx` | `Trash2` | JUDGMENT-CALL → recommend reuse `Trash` (`#product/primitives/icons/core`); see interior-line note above. |
| `components/billing/BillingOwnerCard.tsx` | `Building2` | EXISTING → `Building2` (`#product/primitives/icons/platform`) |
| `components/billing/BillingOwnerCard.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/billing/BillingOwnerCard.tsx` | `CreditCard` | EXISTING → `CreditCard` (`#product/primitives/icons/platform`) |
| `components/billing/BillingOwnerCard.tsx` | `Gauge` | NET-NEW → `Gauge` (`#product/primitives/icons/platform`) |
| `components/billing/BillingOwnerCard.tsx` | `Server` | EXISTING → `Server` (`#product/primitives/icons/platform`) |
| `components/billing/BillingPlanComparison.tsx` | `Check` | EXISTING → `Check` (`#product/primitives/icons/core`) |
| `components/billing/BillingPlanComparison.tsx` | `CheckCircle2` | NET-NEW → `CircleCheck` (`#product/primitives/icons/status`); lucide renamed `CheckCircle2` → `CircleCheck` upstream, same glyph as the goal-bar/transcript uses above — one shared authored icon. |
| `components/billing/BillingUiParts.tsx` | `AlertTriangle` | NET-NEW → `AlertTriangle` (`#product/primitives/icons/status`) |
| `components/playground/AgentsSettingsPlayground.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/playground/AgentsSettingsPlayground.tsx` | `Laptop` | NET-NEW → `Laptop` (`#product/primitives/icons/platform`) |

## Shell (`components/app/**`, toast kit)

| File | Identifier | Replacement |
| --- | --- | --- |
| `components/app/OfflineIndicator.tsx` | `WifiOff` | NET-NEW → `WifiOff` (`#product/primitives/icons/status`) |
| `components/app/sidebar/SidebarAccountFooter.tsx` | `CreditCard` | EXISTING → `CreditCard` (`#product/primitives/icons/platform`) |
| `components/app/sidebar/SidebarAccountFooter.tsx` | `Keyboard` | EXISTING → `Keyboard` (`#product/primitives/icons/core`) |
| `components/app/sidebar/SidebarAccountFooter.tsx` | `LogOut` | EXISTING → `LogOut` (`#product/primitives/icons/core`) |
| `components/app/sidebar/SidebarAccountFooter.tsx` | `Settings` | EXISTING → `Settings` (`#product/primitives/icons/core`) |
| `components/app/sidebar/SidebarHelpSection.tsx` | `BookMarked` | NET-NEW → `BookMarked` (`#product/primitives/icons/workspace`) |
| `components/app/sidebar/SidebarHelpSection.tsx` | `BookOpen` | NET-NEW → `BookOpen` (`#product/primitives/icons/workspace`) |
| `components/app/sidebar/SidebarHelpSection.tsx` | `Globe` | EXISTING → `Globe` (`#product/primitives/icons/platform`) |
| `components/app/sidebar/SidebarHelpSection.tsx` | `Lightbulb` | NET-NEW → `Lightbulb` (`#product/primitives/icons/product`) |
| `components/app/sidebar/SidebarHelpSection.tsx` | `MessageSquare` | EXISTING → `MessageSquare` (`#product/primitives/icons/product`) |
| `primitives/patterns/ToastBody.tsx` | `X` | EXISTING → `X` (`#product/primitives/icons/core`); this file is itself inside the library (a toast-kit internal), so its rewrite is a same-tier import-source fix, not a feature-code call-site change. |

## Workflows + rest (`components/workflows/**`, diff viewer, repo-setup)

| File | Identifier | Replacement |
| --- | --- | --- |
| `components/workflows/WorkflowDefinitionEditor.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/workflows/WorkflowDefinitionEditor.tsx` | `Save` | NET-NEW → `Save` (`#product/primitives/icons/workspace`) |
| `components/workflows/WorkflowDefinitionEditor.tsx` | `Trash2` | JUDGMENT-CALL → recommend reuse `Trash` (`#product/primitives/icons/core`); see interior-line note above. |
| `components/workflows/WorkflowDefinitionList.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/workflows/WorkflowDefinitionList.tsx` | `RotateCcw` | EXISTING → `RotateCcw` (`#product/primitives/icons/core`) |
| `components/workflows/WorkflowDefinitionList.tsx` | `Workflow` | NET-NEW → `Workflow` (`#product/primitives/icons/product`) |
| `components/workflows/WorkflowInputEditor.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/workflows/WorkflowInputEditor.tsx` | `Trash2` | JUDGMENT-CALL → recommend reuse `Trash` (`#product/primitives/icons/core`); see interior-line note above. |
| `components/workflows/WorkflowStageEditor.tsx` | `Plus` | EXISTING → `Plus` (`#product/primitives/icons/core`) |
| `components/workflows/WorkflowStageEditor.tsx` | `Trash2` | JUDGMENT-CALL → recommend reuse `Trash` (`#product/primitives/icons/core`); see interior-line note above. |
| `components/content/ui/diff/DiffContextExpander.tsx` | `ChevronDown` | EXISTING → `ChevronDown` (`#product/primitives/icons/core`) |
| `components/content/ui/diff/DiffContextExpander.tsx` | `ChevronUp` | NET-NEW → `ChevronUp` (`#product/primitives/icons/status`) |
| `components/content/ui/diff/DiffContextExpander.tsx` | `ChevronsUpDown` | EXISTING → `ChevronUpDown` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/AddRepoFlow.tsx` | `ArrowLeft` | EXISTING → `ArrowLeft` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/AddRepoFlow.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/workspace/repo-setup/AddRepoFlow.tsx` | `FolderOpen` | EXISTING → `FolderOpen` (`#product/primitives/icons/workspace`) |
| `components/workspace/repo-setup/AddRepoFlow.tsx` | `GitBranch` | EXISTING → `GitBranch` (`#product/primitives/icons/workspace-git`) |
| `components/workspace/repo-setup/CloudRepoPicker.tsx` | `Archive` | EXISTING → `Archive` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/CloudRepoPicker.tsx` | `Check` | EXISTING → `Check` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/CloudRepoPicker.tsx` | `Lock` | NET-NEW → `Lock` (`#product/primitives/icons/status`) |
| `components/workspace/repo-setup/CloudRepoPicker.tsx` | `RotateCw` | NET-NEW → `RotateCw` (`#product/primitives/icons/status`) |
| `components/workspace/repo-setup/CloudRepoPicker.tsx` | `ShieldAlert` | NET-NEW → `ShieldAlert` (`#product/primitives/icons/status`) |
| `components/workspace/repo-setup/CloudRepoPickerBlocker.tsx` | `Check` | EXISTING → `Check` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/CloudRepoPickerBlocker.tsx` | `ShieldAlert` | NET-NEW → `ShieldAlert` (`#product/primitives/icons/status`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `Bot` | JUDGMENT-CALL → recommend reuse `Robot` (`#product/primitives/icons/product`); same "agent" semantic, different silhouette proportions (custom-tuned, not a lucide `Bot` clone) — confirm it reads correctly at the inventory-row icon size before rewrite. |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `Braces` | NET-NEW → `Braces` (`#product/primitives/icons/workspace`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `CalendarClock` | EXISTING → `CalendarClock` (`#product/primitives/icons/platform`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `Cloud` | EXISTING → `CloudIcon` (`#product/primitives/icons/platform`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `HelpCircle` | EXISTING → `CircleQuestion` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `Monitor` | EXISTING → `Monitor` (`#product/primitives/icons/platform`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `Smartphone` | EXISTING → `Smartphone` (`#product/primitives/icons/platform`) |
| `components/workspace/repo-setup/WorkspaceInventoryGlyphs.tsx` | `UsersRound` | EXISTING → `UsersRound` (`#product/primitives/icons/platform`) |
| `components/workspace/repo-setup/WorkspaceInventoryGroup.tsx` | `ChevronRight` | EXISTING → `ChevronRight` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/WorkspaceInventoryRow.tsx` | `ExternalLink` | EXISTING → `ExternalLink` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/WorkspaceReconciliationBody.tsx` | `GitBranch` | EXISTING → `GitBranch` (`#product/primitives/icons/workspace-git`) |
| `components/workspace/repo-setup/WorkspacesCommandList.tsx` | `ChevronRight` | EXISTING → `ChevronRight` (`#product/primitives/icons/core`) |
| `components/workspace/repo-setup/WorkspacesCommandList.tsx` | `FolderPlus` | EXISTING → `FolderPlus` (`#product/primitives/icons/workspace`) |
| `components/workspace/repo-setup/WorkspacesCommandList.tsx` | `GitPullRequest` | EXISTING → `GitPullRequest` (`#product/primitives/icons/workspace-git`) |

## Judgment-call summary

1. **`Trash2` (6 call sites: `GoalBar.tsx`, `LoopsPanel.tsx`, `SecretRow.tsx`, `WorkflowDefinitionEditor.tsx`, `WorkflowInputEditor.tsx`, `WorkflowStageEditor.tsx`)** — recommend consolidating on the existing `Trash` (`core.tsx`) rather than authoring a second trash glyph; the only visual delta is lucide `Trash2`'s two interior can-lines. Authoring both would itself violate the rule of two (two implementations of one shape). If review decides the interior lines are load-bearing (e.g. distinguishing "delete permanently" from "archive"), promote a `TrashLines` variant instead of duplicating.
2. **`Edit3` (`SecretRow.tsx`)** — recommend reuse of `Pencil` (`core.tsx`); same edit semantics.
3. **`Bot` (`WorkspaceInventoryGlyphs.tsx`)** — recommend reuse of `Robot` (`product.tsx`); same "agent" semantic, custom-tuned silhouette rather than a lucide clone, confirm it reads at the row size used.
4. **`type LucideIcon` (`ActivityChips.tsx`)** — not a glyph; the applier needs to retype `CHIP_ICON: Record<ActivityChipKind, LucideIcon>` to something like `Record<ActivityChipKind, ComponentType<IconProps>>` using `IconProps` from `#product/primitives/icons/types`.

## Open questions for the applier agents

- `core.tsx` was already sitting exactly at its `frontend_structure_allowlist.txt` ratchet ceiling (483 lines, "existing consolidated icon module pending split") before this pass, so none of the 25 net-new icons could land there without a `check_max_lines.py`/`report_frontend_structure.py --strict` failure. They're distributed across `platform.tsx`, `product.tsx`, `status.tsx`, and `workspace.tsx` by whichever had headroom under the 400-line soft threshold, not strictly by semantic role — `ChevronUp`/`RotateCw`/`Eye`/`EyeOff` in particular are general-utility glyphs that would have read more naturally in `core.tsx` next to `ChevronDown`/`RotateCcw`/`Copy`/`Search`. If `core.tsx` gets split before the call-site rewrite lands, consider moving these four back to whichever module inherits the general-utility role.
- `GoalTranscriptEventRow.tsx` and `TranscriptTurnChrome.tsx` carry code comments explaining *why* they source `CircleCheck`/`Target` from lucide directly ("aren't in the curated ProductClient icon set"). Both claims are now false — delete the stale comments as part of the rewrite, not just the imports.
- `SettingsSidebar.tsx`'s `Settings2` sits in the same nav list as other library icons at the same visual weight; double check the mechanical gate (`report_frontend_structure.py` / icon-source review check 5) doesn't also want the sidebar's `general` row de-duplicated against the app-chrome `Settings` gear before shipping — this map treats them as intentionally distinct per the in-code nav mapping (`general: Settings2` is a sub-section icon, not the top-level Settings entry point).
