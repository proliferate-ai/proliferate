# Web Desktop Parity Plan

Status: working implementation checklist.

Scope:

- `web/src/**`
- `packages/product-ui/src/**` shared product presentation used by Web
- `packages/product-model/src/**` shared pure chat/workspace view logic used by Web
- Desktop components under `desktop/src/**` only when extracting presentation into shared packages

Read this before implementing Web chat, Web workspace navigation, Web new chat, Web automations, or Web settings parity work.

## Strict Goal

Web should feel like the Desktop chat/workspace product running against the cloud backend.

The UI target is not "similar Web screens." The target is Desktop-grade chat and workspace UX reused or cleanly extracted into shared packages, with Web supplying cloud-specific adapters and Desktop continuing to supply local AnyHarness/runtime adapters.

Desktop is the source of truth for chat/workspace presentation. Desktop behavior should remain unchanged unless a presentational component is deliberately extracted into `packages/product-ui` and re-consumed without changing Desktop semantics.

## Operating Rules

- Do not create parallel Web-only product visuals when Desktop presentation can be cleanly extracted.
- Keep shared UI data-driven. `packages/product-ui` components accept view models and callbacks; they do not call Desktop stores, Tauri, Web cloud clients, or raw endpoints.
- Keep pure derivation in `packages/product-model` when the same rules apply to Desktop and Web.
- Keep Web cloud command/session wiring in Web access/hooks/controllers.
- Keep Desktop local AnyHarness/runtime wiring in Desktop.
- Prefer vertical slices that are usable end to end over large incomplete moves.
- Test real prompts and reload behavior, not just typecheck.
- Do not ask for more product clarification unless Desktop cannot answer the decision and guessing would produce a materially different product.

## Architecture Target

```text
Desktop
  local stores/hooks/access
    -> shared product-model view logic where possible
    -> shared product-ui presentation where possible
    -> Desktop-only native/local adapters where required

Web
  cloud sdk/react-query/controllers
    -> shared product-model view logic where possible
    -> shared product-ui presentation where possible
    -> Web/cloud command adapters where required
```

## Work Checklist

### 1. Main New Chat Page

- [ ] Web new chat page uses Desktop-grade launch/composer presentation, not a lightweight form.
- [ ] Repo/workspace chooser matches Desktop interaction density and hierarchy.
- [ ] Prompt box uses the same shared composer surface and controls.
- [ ] Model/config choices are available before session creation when cloud capabilities allow.
- [ ] Creating a new cloud workspace from Web shows immediate pending shell state.
- [ ] Sending an initial prompt from new chat shows optimistic user work immediately.
- [ ] Successful workspace/session creation navigates into the real chat route without visual reset.
- [ ] Failure keeps the pending prompt/workspace inspectable and retryable.

### 2. Chat Transcript

- [ ] User messages use Desktop bubble formatting, spacing, masking, copy affordance, and long-text behavior.
- [ ] Assistant prose uses Desktop markdown rendering, spacing, streaming reveal behavior, and copy affordance.
- [ ] Reasoning/thought rows use Desktop reasoning block presentation.
- [ ] Tool calls use Desktop action row/group presentation where payload data is available.
- [ ] Grouped tool/action summaries match Desktop collapsed action treatment.
- [ ] Proposed plans and plan references render with Desktop cards where events exist.
- [ ] Error/system rows match Desktop transcript treatment.
- [ ] Transcript virtualization or long-history handling does not regress Web performance.
- [ ] Web can reload a chat and render the existing transcript without sending a new message.
- [ ] Web updates live from cloud session events/snapshots without requiring another user action.

### 3. Optimistic Prompt And Runtime Reconciliation

- [x] Existing-session prompt appears immediately as a user row.
- [x] Existing-session prompt shows assistant waiting/streaming state immediately.
- [x] First prompt with no session appears immediately before the session id exists.
- [x] First prompt remaps to the materialized session without losing visible state.
- [x] Queued prompt status transitions from sending to queued to reconciled.
- [ ] Transcript echo removes duplicate optimistic prompt rows.
- [ ] Agent progress removes the waiting row at the right time.
- [ ] Rejected/expired/failed prompt delivery leaves an inspectable failed row.
- [x] Reload during pending work does not erase user-visible intent when persistence exists.

### 4. Composer And Config Controls

- [x] Web composer uses shared `product-ui` presentation derived from Desktop composer components.
- [ ] Desktop composer remains unchanged.
- [x] Textarea, surface radius, shadow, spacing, send button, and disabled/loading states match Desktop.
- [x] Left-side mode control matches Desktop layout.
- [x] Right-side model/config control groups model, reasoning, effort, fast mode, and extras like Desktop.
- [x] Popovers use shared Desktop-like menu surfaces and item rows.
- [x] Config changes are optimistic immediately.
- [x] Config pending state shows sending/queued indicators.
- [ ] Live config confirmation clears pending state.
- [ ] Rejected/expired/failed config commands clear pending state and show a useful error.
- [ ] Controls remain inert when the composer is disabled or workspace is unclaimed.

### 5. Below-Composer Workspace Footer

- [x] Footer row uses Desktop `WorkspaceMobilityFooterRow` visual language.
- [x] Branch name is visible and copyable.
- [x] Repo/workspace identity is visible and copyable where useful.
- [x] Cloud/live/snapshot/runtime status is visible without noisy badges in the input.
- [x] Shared-unclaimed workspaces show a clear claim control.
- [ ] Claiming updates the workspace state and unlocks sending.
- [ ] Footer works on narrow viewports without clipping controls.

### 6. Sidebar And Workspace Bar

- [x] Web sidebar groups cloud workspaces by repo like Desktop groups workspace/session context.
- [x] Active workspace and active chat selection are obvious and stable.
- [x] Workspace status, exposure, claimed/unclaimed state, and branch are visible.
- [x] Recent/active sessions are listed in the same navigation surface.
- [x] Reload does not make workspaces disappear due to scope mismatch.
- [x] Workspace routes and legacy/cloud routes resolve consistently.
- [x] Sidebar actions include create/open/new-session paths where relevant.
- [x] Empty/loading/error states match Desktop product tone.

### 7. New Session In Existing Workspace

- [x] Web exposes a clear "new chat/session" action from a cloud workspace.
- [ ] New session uses the same composer/config presentation.
- [ ] Session creation uses cloud commands and navigates to the created session.
- [ ] Pending session appears immediately in sidebar/chat shell.
- [ ] Failed session creation remains visible and retryable.

### 8. Automations

- [x] Web lists automations with Desktop/product UI density and status treatment.
- [x] Web can create a cloud automation where supported by the API.
- [x] Web can enable/disable or otherwise manage supported automation fields.
- [x] Automation creation validates schedule, repo/workspace target, and prompt.
- [ ] Empty/loading/error states are product-grade and actionable.
- [ ] Unsupported Desktop-only automation capabilities are clearly absent or degraded, not broken.

### 9. Settings

- [x] Web settings uses a Desktop-like settings modal/page shell.
- [x] Scope is high-level Web/cloud concerns only: account, teams/orgs, billing/plan, connected providers, support.
- [x] Teams/org list is visible and useful.
- [x] Provider linking/sign-out remain available.
- [x] Billing/plan state remains available.
- [x] Desktop-only local settings are not copied into Web unless they have cloud meaning.

### 10. End-To-End Verification

- [x] Typecheck shared packages and Web.
- [x] Build Web production bundle.
- [x] Run server tests for touched cloud command paths.
- [ ] Browser-test workspace list reload.
- [ ] Browser-test opening an existing workspace.
- [ ] Browser-test no-session first prompt.
- [x] Browser-test existing-session follow-up prompt.
- [ ] Browser-test live transcript updates without sending another message.
- [ ] Browser-test config update success and failure.
- [ ] Browser-test shared-unclaimed claim flow.
- [ ] Browser-test new session in existing workspace.
- [ ] Browser-test automations list/create if API support exists.
- [ ] Browser-test settings modal/page navigation.

## Current Slice Tracker

Use this section to mark incremental progress during implementation.

- [x] Define Web/Desktop parity goal and checklist.
- [x] Shared Web composer component extracted into `packages/product-ui`.
- [x] Web chat surface consumes shared composer.
- [x] Web first-prompt optimistic row behavior implemented.
- [x] Web existing-session optimistic row behavior implemented.
- [x] Web prompt handoff keeps optimistic rows visible after session materialization.
- [x] Web materializes managed personal target config before starting/sending prompts.
- [x] Composer controls grouped like Desktop.
- [x] Composer footer added.
- [x] Transcript presentation extraction started.
- [x] Sidebar/workspace parity started.
- [x] New-session flow started.
- [x] Automations create/manage started.
- [x] Settings shell parity started.
- [x] Web persisted pending prompt rows through chat reload.

## Subagent Orchestration Plan

When using subagents, split work by disjoint ownership and keep one integrator responsible for final consistency.

- Reviewer: Desktop chat/component extraction audit.
- Reviewer: Web cloud command/session lifecycle audit.
- Implementer: shared composer and footer product-ui slice.
- Implementer: shared transcript presentation slice.
- Implementer: Web sidebar/workspace/session navigation slice.
- Implementer: Web new-session, automations, and settings slices.
- Integrator: merge results, avoid duplicate paths, run tests, browser-test real prompts, and keep Desktop unchanged.

## Done Definition

This effort is done when a user can use Web for cloud workspaces without feeling like it is a prototype:

- Web can start and continue real cloud chat sessions.
- Web chat transcript and composer presentation match Desktop closely.
- Web workspace/session navigation is reliable after reload.
- Web supports the expected new chat, new session, automations, and scoped settings flows.
- Desktop remains stable and visually unchanged except for intentional shared component extraction.
