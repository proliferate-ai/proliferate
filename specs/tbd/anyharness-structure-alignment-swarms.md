# AnyHarness Structure Alignment Swarms

Status: planning note, not authoritative architecture.

This document tracks the high-level cleanup lanes for bringing AnyHarness code
closer to the current structure docs. Each swarm should run in its own
worktree, read the listed docs first, and keep its PR scoped to the named
area. The canonical rules remain in `specs/codebase/structures/anyharness/**`,
`specs/codebase/primitives/**`, and `specs/codebase/features/agent-features/**`.

Use `specs/tbd/structure-alignment-coordinator-model.md` with this document when
asking Codex to run one AnyHarness swarm, one phase, or the full AnyHarness
sequence through implementer subagents, reviewer subagents, fix-up, and
merge-readiness.

## Shared Rules

- Preserve behavior unless the swarm explicitly owns a behavior change.
- Read and cite the owning docs in the PR description.
- Keep each PR to one alignment lane and one ownership boundary.
- Do not mix final topology moves with broad behavior cleanup.
- Delete old paths after moves; do not leave duplicate old and new code paths.
- Swarm 0 runs first. Final topology moves run late, after decomposition and
  coupling cleanup make the moves mostly mechanical.
- Update ratchets and allowlists when debt is removed:
  `scripts/anyharness_boundaries_allowlist.txt`,
  `scripts/max_lines_allowlist.txt`, and
  `scripts/check_anyharness_old_paths.py` when a completed split should stay
  blocked.
- Run the narrowest verification that proves the change, plus the AnyHarness
  boundary checks when imports or paths move.
- Shrink oversized files when it naturally supports the lane. Do not perform
  unrelated line-count gardening.

## Alignment Decisions Before Swarms

- `domains/artifacts/**` is outside these swarms. Current artifact behavior
  remains cowork-owned until artifacts has its own product-domain owner. Swarms
  may clean cowork artifact internals, but must not create a new artifact domain
  as incidental structure cleanup.
- `sessions/** -> domains/sessions/**`, `workspaces/** ->
  domains/workspaces/**`, `repo_roots/** -> domains/repo_roots/**`, and
  `live/sessions/connection/** -> live/sessions/driver/**` are final topology
  moves. They should happen after decomposition and coupling cleanup.
- Contract event and transcript payloads stay below `api/` only when they are
  deliberately the durable event-log or broadcast truth. Contract request and
  response DTOs should be mapped at the API boundary unless a focused doc
  explains why a specific type is runtime truth.
- Core domains should not import product surface domains directly. Use
  session/workspace-owned extension traits, neutral DTOs, or narrow ports wired
  in `app/`.

## Coupling Seam Decisions

- Sessions to plans:
  define a session-owned plan port for the narrow operations sessions need,
  such as resolving trusted plan snapshots, applying plan decisions, and
  producing handoff/prompt state. `domains/plans` implements the port; `app/`
  wires it into `SessionRuntime`.
- Sessions to mobility:
  sessions accept a neutral session-owned prompt attachment/import DTO. Mobility
  maps its product data into that DTO before crossing into the session domain.
  Sessions must not depend on mobility-owned model types.
- Workspaces/files to cowork artifacts:
  define a workspace/file-owned protection participant or registry for
  protected paths. Cowork implements the participant for artifact paths.
  `WorkspaceFilesRuntime` asks the generic protection seam instead of importing
  cowork directly.

## Swarm 0: Docs Truth And Ratchets

Goal: make the docs match the current repo before implementation swarms use
them as instructions.

Read:

- `specs/README.md`
- `specs/codebase/structures/anyharness/README.md`
- `specs/codebase/structures/anyharness/guides/repo-shape.md`
- `specs/codebase/structures/anyharness/guides/live-runtime.md`
- `specs/codebase/structures/anyharness/specs/session-engine.md`
- `specs/codebase/structures/anyharness/src/acp.md`

Focus:

- Replace stale `acp/**` current-path references with current
  `live/sessions/**` paths.
- Fix terminal current-state notes to reflect `domains/terminals/**` plus
  `live/terminals/**`.
- Clarify which path notes are still true and which are complete.
- Tighten old-path ratchets only for migrations already complete on the branch.

Done when:

- Current-path docs do not point developers to missing files.
- The canonical AnyHarness read map accurately distinguishes current paths from
  target owners.
- AnyHarness boundary and old-path checks pass.

## Swarm 1: Live Session Runtime

Goal: align live session code to the live runtime grammar: manager, handle,
actor, driver, event sink, interactions, background work, replay.

Read:

- `specs/codebase/structures/anyharness/guides/live-runtime.md`
- `specs/codebase/structures/anyharness/specs/session-engine.md`
- `specs/codebase/structures/anyharness/specs/session-actor.md`
- `specs/codebase/structures/anyharness/harnesses/claude.md`
- `specs/codebase/structures/anyharness/harnesses/codex.md`

Focus:

- Keep public access through `LiveSessionManager` and `LiveSessionHandle`.
- Keep actor commands private to `live/sessions/**`.
- Split oversized live files by live role or concern.
- Move `connection/**` toward the target `driver/**` role when that move is
  isolated and behavior-preserving.
- Keep protocol mechanics out of actor code; move reusable protocol pieces to
  `integrations/acp/**` only when they are genuinely protocol-neutral.

Done when:

- The live session path reads by role from the filesystem.
- `SessionActor` concern files stay focused on ordering and live state.
- Event sink, interactions, background work, and replay are not actor sprawl.
- Any old-path checks and max-line allowlist entries are tightened when
  completed splits land.

## Swarm 2: Core Session Domain

Goal: align session durable/product code with the target
`domains/sessions/**` model.

Read:

- `specs/codebase/structures/anyharness/guides/domains.md`
- `specs/codebase/structures/anyharness/specs/session-engine.md`
- `specs/codebase/structures/anyharness/src/sessions.md`
- `specs/codebase/primitives/mcp-runtime.md`
- `specs/codebase/features/agent-features/servers.md`

Focus:

- Split large session files by documented responsibility before any final
  topology move.
- Keep `store/**` as SQL and row mapping only.
- Keep `service/**` as durable session rules.
- Keep `runtime/**` as workflows that bridge durable state to live execution.
- Keep prompt preparation in session domain code and out of live actor code.
- Keep MCP binding assembly centralized under session MCP bindings.

Done when:

- Session files are small enough to move safely.
- Store/service/runtime boundaries are legible by path.
- The final `sessions/** -> domains/sessions/**` move can be mostly
  mechanical.

## Swarm 3: Core Workspace Domain

Goal: align workspace lifecycle code with the target
`domains/workspaces/**` model.

Read:

- `specs/codebase/structures/anyharness/guides/domains.md`
- `specs/codebase/structures/anyharness/src/workspaces.md`
- `specs/codebase/primitives/workspace-lifecycle.md`

Focus:

- Split `workspaces/runtime.rs`, `service.rs`, and `store.rs` by durable
  responsibility and workflow family.
- Keep workspace identity, materialization, worktree creation, retention,
  retire preflight, purge, setup, and access gates separated by path.
- Keep local filesystem and git mechanics in adapters.
- Prepare the final `workspaces/** -> domains/workspaces/**` move as a late
  mechanical step.

Done when:

- Workspace operations are discoverable by concern rather than gathered in
  large files.
- Workspace store code remains product SQL only.
- Final topology move can be reviewed without reading behavior changes.

## Swarm 4: Core/Product Coupling

Goal: remove direct core-domain imports of product surface domains.

Read:

- `specs/codebase/structures/anyharness/guides/domains.md`
- `specs/codebase/structures/anyharness/guides/app.md`
- `specs/codebase/features/agent-features/servers.md`
- `scripts/anyharness_boundaries_allowlist.txt`

Focus:

- Clear allowlisted core-domain product imports.
- Replace direct imports with extension traits, narrow ports, or app-wired
  collaborators.
- Keep core session/workspace domains from depending directly on cowork,
  reviews, mobility, or plans unless the docs define a core-owned extension
  point.

Done when:

- `scripts/anyharness_boundaries_allowlist.txt` shrinks or becomes empty for
  AnyHarness.
- Product surfaces plug into core lifecycles through documented extension
  seams.
- `python3 scripts/check_anyharness_boundaries.py` passes without new debt.

## Swarm 5: Adapter Shape

Goal: align local capability adapters with the adapter guide.

Read:

- `specs/codebase/structures/anyharness/guides/adapters.md`
- `specs/codebase/structures/anyharness/src/files.md`
- `specs/codebase/structures/anyharness/src/git.md`

Focus:

- Move adapter implementation toward `types.rs`, optional `executor.rs`, and
  `operations/**`.
- Keep adapters policy-free: no domain services, stores, API mapping, live
  handles, or contract request/response types as internal models.
- Split files and git adapters by local capability operation.

Done when:

- File, git, hosting, and process operations are discoverable by operation.
- Adapter `service.rs` files are either justified facades or removed.
- Oversized adapter entries shrink from `scripts/max_lines_allowlist.txt`.

## Swarm 6: API And Contract Boundary

Goal: make API handlers boring transport and keep public contract types at the
transport boundary unless they are durable event payloads.

Read:

- `specs/codebase/structures/anyharness/guides/api.md`
- `specs/codebase/structures/anyharness/contract.md`
- `specs/codebase/structures/anyharness/guides/repo-shape.md`

Focus:

- Split large HTTP handler files by route family or mapper responsibility.
- Move large request/response mapping into `api/http/*_contract.rs`.
- Keep handlers from reconstructing product workflows from multiple stores,
  services, and live handles.
- Audit contract request/response imports below `api/`; keep event payload use
  only where it is deliberately durable transcript/event truth.

Done when:

- `api/http/*.rs` files read as extract, authorize, map, call owner, map.
- Contract leakages are either removed or explicitly justified by the contract
  doc.
- API max-line allowlist entries shrink.

## Swarm 7: Agents, Catalog, Readiness, And Provider CLI

Goal: align agent catalog/readiness product meaning with provider CLI and
registry mechanics.

Read:

- `specs/codebase/primitives/agent-catalog-readiness.md`
- `specs/codebase/structures/anyharness/guides/domains.md`
- `specs/codebase/structures/anyharness/guides/integrations.md`
- `specs/codebase/structures/anyharness/src/agents.md`
- `specs/codebase/structures/anyharness/harnesses/claude.md`
- `specs/codebase/structures/anyharness/harnesses/codex.md`

Focus:

- Keep catalog projection, readiness meaning, install policy, credentials, and
  reconcile execution in `domains/agents/**`.
- Keep provider CLI probing, launcher scripts, registry parsing, and model
  discovery mechanics in `integrations/agent_cli/**`.
- Split oversized install/readiness files by role.

Done when:

- Product readiness and provider mechanics are not mixed in the same module.
- Agent files are within repo-shape thresholds or have smaller named
  responsibilities.
- Harness-specific behavior is documented in the provider harness docs.

## Swarm 8: MCP Product Structure

Goal: align user MCP bindings, product MCP servers, and MCP protocol mechanics
with the documented three-part model.

Read:

- `specs/codebase/primitives/mcp-runtime.md`
- `specs/codebase/primitives/mcp-skills.md`
- `specs/codebase/features/agent-features/servers.md`
- `specs/codebase/features/agent-features/definitions/README.md`
- `specs/codebase/structures/anyharness/guides/integrations.md`

Focus:

- Product tool behavior stays in the owning domain.
- Session attachment and launch assembly stay in session MCP bindings.
- JSON-RPC, capability-token, tool formatting, and generic server dispatch stay
  in `integrations/mcp/**`.
- Avoid feature-local copies of protocol/auth scaffolding.

Done when:

- Adding a product MCP follows one repeatable path.
- Product MCP launch selection and HTTP serving are clearly separate.
- No product MCP server owns generic MCP protocol machinery.

## Swarm 9: Artifacts Product Domain

Goal: move artifacts from cowork-owned implementation toward the target
artifact product domain when product scope is ready.

Read:

- `specs/codebase/features/cowork-artifacts.md`
- `specs/codebase/features/agent-features/definitions/artifacts.md`
- `specs/codebase/features/agent-features/servers.md`
- `specs/codebase/structures/anyharness/guides/domains.md`

Focus:

- Separate generic artifact lifecycle from cowork-specific delegation.
- Promote artifact behavior toward `domains/artifacts/**`.
- Keep cowork as a consumer of artifacts rather than the long-term owner.
- Preserve current manifest/file-backed behavior unless a separate storage
  change is explicitly scoped.

Done when:

- Artifact ownership is not hidden inside cowork.
- Cowork artifact compatibility remains intact.
- The artifacts MCP target definition maps to real code owners.

## Swarm 10: Final Topology Moves

Goal: perform mostly mechanical moves once decomposition and coupling cleanup
make the moves safe.

Read:

- `specs/codebase/structures/anyharness/README.md`
- `specs/codebase/structures/anyharness/guides/repo-shape.md`
- `specs/codebase/structures/anyharness/guides/domains.md`
- `specs/codebase/structures/anyharness/guides/live-runtime.md`

Focus:

- Move `sessions/**` to `domains/sessions/**`.
- Move `workspaces/**` to `domains/workspaces/**`.
- Move `repo_roots/**` to `domains/repo_roots/**`.
- Rename `live/sessions/connection/**` to `live/sessions/driver/**` after the
  live split is stable.
- Update imports mechanically, run focused tests, then update old-path
  ratchets.

Done when:

- Target top-level AnyHarness shape matches the README.
- Old roots cannot be resurrected.
- The move PRs contain no unrelated behavior cleanup.

## Suggested Sequencing

1. Docs Truth And Ratchets.
2. Low-conflict decomposition swarms: Live Sessions, Adapter Shape, Agents.
3. Session and Workspace decomposition.
4. Core/Product Coupling cleanup.
5. MCP Product Structure and Artifacts Product Domain.
6. Final Topology Moves.

Parallel work is safest before the final topology moves. Do not run multiple
swarms against broad `sessions/**` or `workspaces/**` moves at the same time.
