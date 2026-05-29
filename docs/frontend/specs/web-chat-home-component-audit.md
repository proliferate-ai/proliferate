# Web Chat And Home Component Audit

Status: current-state extraction inventory. This is a planning artifact for the
Web/Desktop parity work. If this conflicts with the older green checklist in
`docs/frontend/specs/web-desktop-parity.md`, treat this audit as the more
literal statement of what is currently shared versus what is only approximated.

Read this before continuing Web chat, Web home/new-chat, sidebar, or shared chat
component extraction.

## Goal

Web should not maintain a parallel chat UI. The desired shape is:

```tsx
<SharedChatView
  transcript={transcriptView}
  composer={composerView}
  sidebar={sidebarView}
  actions={clientActions}
/>
```

Desktop and Web should differ in controllers/adapters only:

- Desktop controller: local AnyHarness stores, Tauri/native actions, local
  file/workspace actions.
- Web controller: cloud SDK hooks, cloud commands, cloud workspace/session
  routing.
- Shared packages: presentational chat/home/sidebar components and pure product
  view-model derivation.

## Extraction Labels

- `pure move`: component is already basically props in, JSX out.
- `prop split`: component is visually reusable but imports Desktop stores,
  hooks, routing, access, or measurement; move UI and inject behavior as props.
- `controller only`: keep per-client. It wires backend state/actions.
- `model only`: shared pure transformation belongs in `apps/packages/product-domain`.
- `temporary parallel`: current Web implementation approximates Desktop and
  should be replaced by extracted Desktop-grade pieces.

## Current Web Chat Route

| Current Web file/component | Role today | Desired shared seam | Extraction status | Next action |
| --- | --- | --- | --- | --- |
| `apps/web/src/components/chat/screen/ChatScreen.tsx` | Large Web controller: reads workspace/session snapshots, live events, command status, draft/config state, claim actions, optimistic rows, footer controls, and renders `CloudChatSurface`. | `WebCloudChatController` that builds view models and passes callbacks into shared product UI. | `controller only` | Split into smaller Web hooks: `useCloudChatWorkspace`, `useCloudChatTranscript`, `useCloudChatComposer`, `useCloudChatFooterActions`. Do not move this whole file to product UI. |
| `apps/packages/product-ui/src/chat/CloudChatSurface.tsx` | Shared-ish Web page shell with header, chips, transcript, composer, and footer. | `ChatSurface` shared by Web and Desktop shell variants where possible. | `temporary parallel` | Keep as the first Web wrapper, but make transcript/composer children the exact extracted shared components instead of Web approximations. |
| `apps/packages/product-ui/src/chat/CloudChatTranscript.tsx` | Web transcript renderer over flat `CloudChatTranscriptRowView` rows. Has user/assistant/tool/thought/system/error rows and a partial uncommitted plan-card direction. | `ChatTranscriptView` that consumes shared transcript render model from `product-domain`, using Desktop leaves. | `temporary parallel` | Replace row rendering gradually with extracted Desktop leaves. Keep flat projection fallback only for legacy/no-envelope cases. |
| `apps/web/src/lib/domain/chat/cloud-transcript-view.ts` | Converts cloud session envelopes/projection items/pending interactions into flat product-ui rows. | `CloudSessionEvents -> TranscriptState -> shared transcript row model`; projection rows remain fallback. | `model only` | Stop flattening rich events into string rows. Prefer retained envelopes and `reconstructTranscriptState`; map only fallback projections into degraded rows. |
| `apps/packages/product-ui/src/chat/CloudChatComposer.tsx` | Web composer approximation with textarea, send button, grouped controls, popovers, footer controls. | Extracted Desktop composer leaves with a generic `ChatComposerView` data contract. | `temporary parallel` | Replace internals with Desktop `ChatComposerSurface`, `ComposerTextarea`, `ComposerControlButton`, `ComposerPopoverSurface`, and shared config control rows. |
| `apps/web/src/lib/domain/chat/cloud-composer-controls.ts` | Builds Web composer control view data from cloud session live config and pending command state. | Web adapter into shared composer control view model. | `model only` | Keep Web-specific command/config interpretation here; align output with the shared composer contract. |
| `buildOptimisticPromptRows` helpers in `ChatScreen.tsx` | Synthesizes user/waiting/error rows while cloud commands are pending. | Shared pending prompt view model plus shared pending row presentation. | `model only` plus `temporary parallel` | Move pure reconciliation rules to `product-domain`; render through extracted `TranscriptPendingPromptRow`/turn chrome equivalents. |
| Claim/copy/footer controls in `ChatScreen.tsx` | Web-specific claim, copy branch/repo, desktop deep-link actions. | Shared composer footer control presentation with Web callbacks. | `prop split` | Keep claim/copy command logic in Web; use exact Desktop footer control primitives. |

## Desktop Transcript Components To Extract

| Desktop component | What it owns | Extraction status | Required split |
| --- | --- | --- | --- |
| `apps/desktop/src/components/workspace/chat/transcript/MessageList.tsx` | Full transcript orchestration: virtual rows, optimistic prompt visibility, outbox rows, trailing status, file/session open handlers, debug measurement. | `prop split` | Create shared `ChatTranscriptView` that takes transcript state, row model inputs, and action callbacks. Keep Desktop hook wiring in a Desktop wrapper. |
| `VirtualTranscriptViewport.tsx`, `VirtualTranscriptRowList.tsx`, `VirtualizedTranscriptRowList.tsx`, `FullTranscriptRowList.tsx`, `TranscriptRowListShared.tsx` | Long-history/virtualized row presentation and estimation. | `prop split` | Move row-list UI and virtualization to product-ui; keep history loading callbacks as props. |
| `TranscriptTurnRow.tsx`, `TranscriptTurnChrome.tsx`, `TurnItemSequence.tsx`, `TurnSeparator.tsx`, `TurnMetadata.tsx` | Desktop turn shells, action rows, timing/status chrome. | `pure move` to `prop split` | Remove Desktop import aliases and accept all callbacks/context values through shared props/context. |
| `AssistantMessage.tsx`, `UserMessage.tsx`, `SystemMessage.tsx`, `SessionErrorItem.tsx`, `StreamingIndicator.tsx`, `CopyMessageButton.tsx` | Core message rendering, markdown, copy affordances, telemetry masking. | `prop split` | Move UI to product-ui; inject copy handler and shared markdown renderer. Preserve masking markup. |
| `ProposedPlanCard.tsx`, `ClaudePlanCard.tsx`, `ConnectedProposedPlanItem.tsx`, `ProposedPlanToolCallIdsContext.tsx` | Proposed plan cards, Claude ExitPlanMode fallback, duplicate suppression. | `prop split` | Move card UI and plan classification helpers; Desktop/Web controllers provide handoff actions. |
| `TranscriptItemBlock.tsx`, `ScopedTranscriptBlocks.tsx`, `TranscriptToolCallItemBlock.tsx`, `TranscriptToolCallGroupBlock.tsx`, `TranscriptToolGroupUtils.tsx`, `TranscriptToolKindIcon.tsx` | Rich tool-call rendering and grouping. | `prop split` | Move renderer and pure utilities; replace Desktop file/cowork/session actions with callbacks. |
| `TranscriptAgentGroupBlock.tsx`, `SubagentCreationGroupBlock.tsx`, `SubagentLaunchLedger.tsx`, `SubagentWakeBadge.tsx`, `DelegatedAgentReceiptName.tsx` | Subagent/delegated-work transcript UI. | `prop split` | Move display pieces; keep open-session routing as injected callback. |
| `TurnDiffPanel.tsx` and tool-call file rows under `apps/desktop/src/components/workspace/chat/tool-calls/**` | Diff/file/tool output presentation. | `prop split`, some `controller only` edges | Move pure display rows and parsers; keep "open file/review pane" as callbacks. |

## Desktop Composer Components To Extract

| Desktop component | What it owns | Extraction status | Required split |
| --- | --- | --- | --- |
| `ChatInput.tsx` | Desktop connected composer: stores, draft state, model/session controls, queued prompt edit, attachments, paste/drop, submit/cancel, measurement. | `controller only` | Do not move as-is. Split into Desktop controller plus shared composer presentation. |
| `ChatComposerDock.tsx` | Dock shell, backdrop, slots, footer positioning. | `pure move` | Move to product-ui. Slot content should be data-driven or callback-rendered, not Desktop nodes. |
| `ChatComposerSurface.tsx` | Composer card surface. | `pure move` | Move directly; Web approximation already uses matching class names. |
| `ComposerTextarea.tsx`, `ComposerTextareaFrame.tsx` | Exact textarea/frame presentation. | `pure move` | Move directly and reuse from Web. |
| `ComposerControlButton.tsx`, `ComposerPopoverSurface.tsx` | Exact control button and popover surface. | `pure move` | Move directly and reuse from Web. |
| `ChatInputControlRow.tsx`, `ComposerModelConfigSelector.tsx`, `ModelSelector.tsx`, `SessionConfigControls.tsx`, `SessionModeControl.tsx`, `SessionReasoningEffortControl.tsx`, `PendingConfigIndicator.tsx` | Model/mode/config controls and pending indicators. | `prop split` | Move presentation; Web and Desktop pass normalized controls and selection callbacks. |
| `ChatInputDraftArea.tsx`, `ComposerCommandEditor.tsx`, `ComposerSlashCommandSearch.tsx` | Draft editing, slash-command overlay, keyboard behavior. | `prop split` | Move visual/editor shell; keep command catalogs and submit behavior in controllers. |
| `ChatInputHiddenFileInput.tsx`, attachment previews, `PlanPickerPopover.tsx`, `PlanReferenceAttachmentCard.tsx`, `PromptContentRenderer.tsx` | File/plan attachment UI. | `prop split` | Move UI; keep file reading and local file access in client controllers. |
| `ApprovalCard.tsx`, `UserInputCard.tsx`, `McpElicitation*`, `TodoTrackerPanel.tsx`, `PendingPromptList.tsx`, `QueuedPromptEditBanner.tsx` | Active/outbound composer dock panels. | `prop split` | Move presentational cards; controllers provide accept/reject/submit/edit callbacks. |
| `WorkspaceMobilityFooterRow.tsx`, `WorkspaceOpenInWebFooterControl.tsx`, `WorkspaceRemoteAccessFooterControl.tsx`, `WorkspaceMobilityLocationPopover.tsx` | Desktop workspace footer/location controls. | `prop split` | Move generic footer/control primitives; keep Desktop-only "open in web" or Web-only claim/copy as adapters. |
| `DelegatedWorkComposerPanel.tsx`, `DelegatedWorkComposerControl.tsx`, delegated-work popover sections | Delegated work composer UI. | `prop split` | Move UI once shared view model exists; keep review/session actions injected. |

## Current Web Home / New Chat Route

| Current Web file/component | Role today | Desired shared seam | Extraction status | Next action |
| --- | --- | --- | --- | --- |
| `apps/web/src/components/home/screen/HomeScreen.tsx` | Web controller for repo selection, model selection, workspace creation, pending initial prompt, and navigation. | `WebHomeController` that feeds shared `NewChatView`. | `controller only` | Keep cloud repo/workspace creation here; move only pure picker model builders if reused. |
| `apps/packages/product-ui/src/new-chat/NewChatSurface.tsx` | Centered Web new-chat page using `CloudChatComposer`, notices, pending transcript preview, and action rows. | Shared Desktop-grade empty/new-chat surface using extracted composer and pending transcript rows. | `temporary parallel` | Replace composer internals with shared composer; align empty/ready/pending states with Desktop `ChatReadyHero`, `ChatLaunchIntentPane`, and pending prompt rows. |
| `buildPendingPromptRows` in `HomeScreen.tsx` | Displays initial prompt as fake user + setup assistant rows while workspace is being created. | Shared optimistic/pending prompt model and rows. | `model only` plus `temporary parallel` | Move to shared pending prompt model; render through extracted transcript pending row/chrome. |
| `buildTargetPicker`, `buildModelPicker`, `buildModePicker` in `HomeScreen.tsx` | Web-only picker view models for repo/model/mode. | Shared composer picker/control data contract. | `model only` | Keep repo choices Web-specific; move generic picker-to-composer-control shape to product-domain/product-ui. |
| `savePendingHomePrompt` / pending-home-prompt store | Persists Web initial prompt across workspace materialization/reload. | Web cloud access/controller. | `controller only` | Keep in Web; present it through shared pending prompt rows. |

## Current Web Sidebar And Shell

| Current Web file/component | Role today | Desired shared seam | Extraction status | Next action |
| --- | --- | --- | --- | --- |
| `apps/web/src/components/app/shell/WebAppShell.tsx` | Wraps routes with `AppShell` and Web sidebar. | Client shell wrapper. | `controller only` | Fine as-is. |
| `apps/web/src/components/app/navigation/WebSidebarController.tsx` | Reads cloud workspaces/sessions, route state, collapse state, and feeds `ProductSidebar`. | Web adapter into shared sidebar view model. | `controller only` | Keep cloud data wiring here; move reusable grouping/sorting only if Desktop can consume it. |
| `apps/web/src/lib/domain/sidebar/cloud-sidebar-model.ts` | Pure Web cloud workspace/session grouping, labels, sorting. | Potential product-domain sidebar logic if Desktop/Web converge on the same workspace/session model. | `model only` | Keep until Desktop needs the same shape; already a good pure seam. |
| `apps/packages/product-ui/src/sidebar/ProductSidebar.tsx` | Shared product sidebar presentation used by Web. | Shared sidebar presentation. | mostly `pure move` already done | Compare Desktop main sidebar behavior and fill missing actions/statuses, not by adding Web-only markup. |

## Extraction Order

1. **Composer leaves first.** Move `ChatComposerSurface`, `ComposerTextarea`,
   `ComposerTextareaFrame`, `ComposerControlButton`, and
   `ComposerPopoverSurface` into `apps/packages/product-ui/src/chat/composer/`.
   Re-consume them from Desktop and Web. This is low-risk and immediately
   removes duplicate Web composer visuals.

2. **Composer control row.** Extract model/mode/config controls as data-driven
   presentation. Desktop and Web both pass normalized control groups and
   pending state; only the mutation callback differs.

3. **Transcript message leaves.** Move assistant/user/system/error/streaming
   rows and shared markdown/copy affordances. Replace Web flat renderer leaves
   with these exact components.

4. **Plan cards.** Move proposed-plan and plan-reference cards plus duplicate
   suppression helpers. Update Web event mapping to emit `plan` render model
   rows from retained envelopes and plan-reference content parts.

5. **Tool/action rows.** Move tool action row primitives and grouped action
   rendering. Web degrades where raw tool I/O is absent, but uses the same
   component shells.

6. **Transcript view and virtualization.** Extract the row-list/turn shell once
   leaves are shared. Web should then feed reconstructed `TranscriptState`
   where envelopes exist and use projection fallback only as a compatibility
   path.

7. **Home/new-chat.** Replace `NewChatSurface` internals with the shared
   composer and pending transcript rows, then align empty/ready/pending states
   with Desktop launch/ready surfaces.

8. **Sidebar polish.** `ProductSidebar` already exists; compare Desktop
   workspace/session affordances and add missing shared view fields instead of
   Web-only branches.

## Non-Negotiable Boundaries

- Do not move Desktop controllers/hooks into `apps/packages/product-ui`.
- Do not make shared components call cloud SDK, AnyHarness clients, Tauri,
  react-query, Zustand stores, or raw endpoint paths.
- Preserve telemetry masking attributes inside shared transcript/composer JSX.
- Keep file reading, clipboard fallback, native file opening, and cloud command
  enqueueing in client adapters.
- Shared transcript rendering should prefer `TranscriptState`. Flat
  `CloudTranscriptItem` rows are a fallback/degraded path.
