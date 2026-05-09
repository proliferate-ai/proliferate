# Frontend Cleanup Final State

Status: current handoff reference for the desktop frontend cleanup after the
final safe tail lanes. Authoritative engineering rules remain in
`docs/frontend/**`; this file records what the migration has finished and what
is intentionally deferred.

Use this file when deciding whether to start another cleanup lane. If a rule in
this file conflicts with `docs/frontend/**`, the docs win.

## Read Order For Future Work

Before changing frontend code, read:

1. `docs/README.md`
2. `docs/frontend/README.md`
3. The focused layer guide:
   - `docs/frontend/guides/components.md`
   - `docs/frontend/guides/hooks.md`
   - `docs/frontend/guides/state.md`
   - `docs/frontend/guides/lib.md`
   - `docs/frontend/guides/access.md`
   - `docs/frontend/guides/telemetry.md`
   - `docs/frontend/guides/config.md`
   - `docs/frontend/guides/copy.md`
   - `docs/frontend/guides/styling.md`
4. The focused spec when touching covered surfaces:
   - `docs/frontend/specs/chat-composer.md`
   - `docs/frontend/specs/chat-transcript.md`
   - `docs/frontend/specs/workspace-files.md`

## Migration Status

The broad desktop frontend migration is structurally complete once the
`proliferate/frontend-tail-integration` branch is merged.

Done:

- Access and cache ownership is CI-enforced.
- `scripts/frontend_boundaries_allowlist.txt` is empty aside from comments.
- Product code no longer has allowlisted raw AnyHarness/Tauri/cloud/query-cache
  boundary violations.
- Stores are broadly aligned with the state guide: shared client state and
  synchronous local transitions, not remote caches or service layers.
- Most product hooks are organized by responsibility folders:
  `derived/`, `workflows/`, `lifecycle/`, `ui/`, `cache/`, and `facade/`.
- Generic UI hooks are organized by UI mechanic under `hooks/ui/**`.
- Small flat chat and workspace hooks have been foldered where safe.
- `desktop/src/components/ui/icons.tsx` has been split and removed from the
  max-lines allowlist.
- Frontend docs/spec paths have been refreshed for the post-migration shape.
- `lib/integrations/telemetry/**` is documented as the first-class telemetry
  transport home. `lib/integrations/auth/**` remains explicit auth migration
  debt, not generic access precedent.

## CI Ratchets

Run these after any frontend cleanup:

```bash
python3 scripts/check_frontend_boundaries.py
python3 scripts/check_max_lines.py
git diff --check
```

For code moves, also run targeted tests and usually:

```bash
pnpm --dir desktop exec tsc --noEmit
```

For broad hook/component moves, run:

```bash
pnpm --dir desktop build
```

The frontend boundary allowlist should stay empty. Do not add entries unless a
human explicitly accepts temporary migration debt.

## Remaining Max-Line Debt

These are the remaining desktop files in `scripts/max_lines_allowlist.txt`:

- `desktop/src/hooks/sessions/use-session-creation-actions.ts`
- `desktop/src/hooks/sessions/use-session-runtime-actions.ts`
- `desktop/src/hooks/workspaces/use-workspace-bootstrap-actions.ts`

They are intentionally not good broad-agent cleanup targets. Treat them as
complex product-system work.

## Remaining Flat Product Hooks

Only a small number of flat desktop hook files remain after the tail cleanup:

- `desktop/src/hooks/playground/use-replay-session.ts`
- `desktop/src/hooks/sessions/use-session-creation-actions.ts`
- `desktop/src/hooks/sessions/use-session-runtime-actions.ts`
- `desktop/src/hooks/workspaces/use-workspace-bootstrap-actions.ts`
- `desktop/src/hooks/workspaces/use-workspace-entry-actions.ts`

The session and workspace files are intentionally deferred because their hard
part is behavior and boundary design, not folder placement. Do not hand them to
agents as "move this into folders" tasks.

## Deferred Complex Cleanup Register

These systems need focused design before implementation. They should usually be
cleaned while doing a feature or bug fix in that subsystem.

### Session Creation And Materialization

Primary files:

- `desktop/src/hooks/sessions/use-session-creation-actions.ts`
- `desktop/src/hooks/sessions/workflows/use-session-find-or-create-actions.ts`
- `desktop/src/hooks/sessions/workflows/use-session-prompt-actions.ts`
- `desktop/src/lib/workflows/sessions/session-mcp-launch.ts`
- `desktop/src/lib/workflows/sessions/session-launch-defaults.ts`

Why deferred:

- Coordinates runtime readiness, session creation/reuse, model availability,
  MCP launch, prompt outbox binding, shell activation, stream pruning,
  telemetry, and rollback paths.

Do next:

- Design the boundaries first.
- Extract pure creation/readiness planners to `lib/domain/sessions/**`.
- Keep React/store/query dependency gathering in workflow hooks.
- Keep `lib/workflows/sessions/**` functions explicit `(input, deps)` with no
  hidden store/client imports.

### Session Runtime And Streams

Primary files:

- `desktop/src/hooks/sessions/use-session-runtime-actions.ts`
- `desktop/src/hooks/sessions/lifecycle/use-session-stream-flush.ts`
- `desktop/src/hooks/sessions/lifecycle/use-session-history-hydration.ts`
- `desktop/src/lib/workflows/sessions/session-runtime.ts`
- `desktop/src/lib/workflows/sessions/hot-session-ingest-manager.ts`

Why deferred:

- Coordinates live streams, reconnect timers, history hydration, summary
  refresh, hot ingest, transcript/cache updates, measurement, and multiple
  stores.

Do next:

- Separate lifecycle ownership from user-action callbacks.
- Move store-coupled workflow code out of `lib/workflows` or pass stores as
  explicit capabilities.
- Add focused tests before changing stream ordering.

### Workspace Bootstrap, Entry, And Selection

Primary files:

- `desktop/src/hooks/workspaces/use-workspace-bootstrap-actions.ts`
- `desktop/src/hooks/workspaces/use-workspace-entry-actions.ts`
- `desktop/src/hooks/workspaces/selection/run-workspace-selection.ts`
- `desktop/src/hooks/workspaces/selection/run-hot-workspace-reopen.ts`

Why deferred:

- Coordinates workspace open/reconcile, launch catalog resolution, session
  selection, file prefetch, pending entries, shell intent rollback, hot-paint
  measurement, and stale activation protection.

Do next:

- Design workspace bootstrap, entry creation, and selection as related but
  separate tracks.
- Extract pure staleness/activation planners to `lib/domain/workspaces/**`.
- Keep latency-sensitive behavior covered by targeted tests.

### Workspace Mobility And Shell Activation

Primary files:

- `desktop/src/hooks/workspaces/mobility/use-local-to-cloud-handoff.ts`
- `desktop/src/hooks/workspaces/mobility/use-cloud-to-local-handoff.ts`
- `desktop/src/hooks/workspaces/mobility/use-workspace-mobility-footer-flow.ts`
- `desktop/src/hooks/workspaces/tabs/use-workspace-shell-activation.ts`

Why deferred:

- Coordinates ordered handoff, failure recovery, cache refresh, runtime
  materialization, selection, overlays, durable shell intents, and measurement.

Do next:

- Compare both handoff directions before extracting shared concepts.
- Do not assign each direction to separate agents until the shared contract is
  named.

### Prompt Outbox Dispatcher

Primary file:

- `desktop/src/hooks/chat/lifecycle/use-prompt-outbox-dispatcher.ts`

Why deferred:

- It is correctly a mounted lifecycle hook, but it contains a sensitive dispatch
  loop: materialization waits, runtime target resolution, prompt request,
  failure classification, accepted-running reconciliation, title generation,
  and store patching.

Do next:

- Keep the mounted lifecycle shape.
- Extract small pure helpers or narrow workflow substeps only.
- Do not replace it with one giant `lib/workflows` function.

### MCP Connector And OAuth Persistence

Primary files:

- `desktop/src/lib/workflows/mcp/connector-persistence.ts`
- `desktop/src/lib/workflows/mcp/local-oauth-persistence.ts`

Why deferred:

- These workflow files still hide cloud/Tauri access and persistence details.
  They need boundary design, not a mechanical move.

Do next:

- Make access capabilities explicit.
- Keep domain decisions pure and transport effects behind access boundaries.

## Opportunistic Size And Polish Cleanup

These are not migration blockers. Split when touching the area anyway.

Component candidates:

- `desktop/src/components/workspace/shell/right-panel/RightPanel.tsx`
- `desktop/src/components/workspace/chat/tool-calls/cowork/CoworkCodingToolActionRow.tsx`
- `desktop/src/components/workspace/chat/transcript/MessageList.tsx`
- `desktop/src/components/workspace/chat/input/ChatInput.tsx`
- `desktop/src/components/home/screen/HomeNextScreen.tsx`
- `desktop/src/components/automations/editor/AutomationEditorModal.tsx`
- `desktop/src/components/plugins/detail/ConnectorDetailModal.tsx`
- `desktop/src/components/workspace/shell/topbar/HeaderTabs.tsx`

Lib/domain/infra candidates:

- `desktop/src/lib/infra/measurement/debug-measurement.ts`
- `desktop/src/lib/infra/terminals/terminal-stream-registry.ts`
- `desktop/src/lib/domain/sessions/activity.ts`
- `desktop/src/lib/domain/reviews/review-config.ts`
- `desktop/src/lib/domain/workspaces/sidebar/sidebar-indicators.ts`
- `desktop/src/lib/workflows/automations/local-automation-executor.ts`
- `desktop/src/lib/workflows/mcp/connector-persistence.ts`

Store watchlist:

- `desktop/src/stores/preferences/workspace-ui-store-*`
- `desktop/src/stores/sessions/session-records.ts`
- `desktop/src/stores/sessions/session-ingest-store.ts`
- `desktop/src/stores/editor/workspace-file-buffers-store.ts`

These stores are not current blockers. Do not split persisted store shapes
without explicit migration tests.

## Agent Guidance

Good agent tasks:

- Single component split with owned file paths.
- Pure helper extraction with tests.
- Import-path cleanup after a move.
- One small hook responsibility-folder move.
- One max-line allowlist burn-down entry.

Bad agent tasks:

- "Clean up sessions."
- "Organize workspace bootstrap."
- "Move all workflow logic to lib."
- Parallel edits to session creation/runtime and workspace bootstrap/selection.
- Any task that touches latency-sensitive activation paths without a specific
  test plan.

For complex systems, first ask an architect agent for:

- current call graph
- proposed ownership boundaries
- concrete file write sets
- test plan
- sequencing and conflict risks

Only then split implementation into parallel lanes.
