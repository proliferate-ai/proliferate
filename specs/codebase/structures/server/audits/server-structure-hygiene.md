# Server Structure Hygiene Handoff

Status: audit-only handoff plan.

Scope:

- `server/proliferate/**`
- `scripts/check_server_boundaries.py`
- `scripts/server_boundaries_allowlist.txt`
- `scripts/check_max_lines.py`
- `scripts/max_lines_allowlist.txt`
- server structure docs under `specs/codebase/structures/server/**`

This document is the coordination layer for removing server structure
migration debt. It is not the canonical architecture contract. The canonical
rules remain in `specs/codebase/structures/server/README.md` and the focused guides under
`specs/codebase/structures/server/guides/`.

Use `specs/tbd/structure-alignment-coordinator-model.md` with this document when
asking Codex to run one server lane, one phase, or the full server hygiene
sequence through implementer subagents, reviewer subagents, fix-up, and
merge-readiness.

Use this file to hand independent cleanup lanes to separate agents running in
separate worktrees. Each agent must read the canonical docs listed for its lane
before editing code.

## Migration Board

Use this board as the high-level PR queue. Status values are coordination
status, not product behavior status.

- **Swarm 1: Docs Truth And Guardrails**
  - Status: in progress.
  - Goal: make the server structure docs and executable checks describe the
    same target shape.
  - Boundary: docs and repo-shape scripts only; no product behavior changes.

- **Swarm 2: Database Session Threading**
  - Status: ready after Swarm 1.
  - Goal: move every store to explicit `db: AsyncSession` ownership and delete
    store session/commit allowlist debt.
  - Boundary: `db/store/**` plus the direct callers needed to thread sessions.

- **Swarm 3: Service Boundary Cleanup**
  - Status: ready after related stores are explicit-session capable.
  - Goal: remove service imports of ORM/session factories/query APIs and move
    transaction ownership to API or worker entry points.
  - Boundary: `server/**/service.py` and worker-facing service files.

- **Swarm 4: Billing Structure**
  - Status: ready after billing store threading starts.
  - Goal: split billing service/store by owner, promote Stripe to a proper
    multi-file integration package, and keep billing/accounting behavior
    unchanged.
  - Boundary: billing domain, billing store, Stripe integration, billing tests.

- **Swarm 5: Cloud Runtime Carve**
  - Status: ready after Swarm 1; may proceed in phases.
  - Goal: finish the documented runtime split so provisioning, liveness,
    config sync, setup monitoring, and AnyHarness protocol access have clear
    owners.
  - Boundary: `cloud/runtime/**`, `integrations/anyharness/**`, and directly
    related setup-run stores/tests.

- **Swarm 6: Agent Auth And Gateway**
  - Status: ready after Swarm 1; store/model work may depend on Swarm 2.
  - Goal: keep `cloud/agent_auth` as the documented gateway-auth owner, then
    split the large service/store/model files into stable concerns.
  - Boundary: `cloud/agent_auth/**`, `db/store/cloud_agent_auth/**`,
    `db/models/cloud/agent_auth.py`, and agent-auth primitive docs.

- **Swarm 7: Workspaces, Commands, And Worker Control**
  - Status: ready after relevant store threading.
  - Goal: separate workspace lifecycle, command lifecycle, and worker-control
    responsibilities while preserving command correlation and visibility
    contracts.
  - Boundary: `cloud/workspaces/**`, `cloud/commands/**`,
    `cloud/worker/**`, `cloud_workspaces.py`, and `cloud_sync/**`.

- **Swarm 8: Slack Cloud Bot**
  - Status: ready after Slack store transaction boundaries are clear.
  - Goal: make Slack API transport-only, move store reads behind services or
    access deps, and make Slack domain modules pure.
  - Boundary: `cloud/slack/**`, `db/store/cloud_slack/**`, Slack integration
    tests.

- **Swarm 9: Folder And Naming Hygiene**
  - Status: ready after Swarm 1; coordinate with active code-carving swarms.
  - Goal: remove single-file folders, underscore-prefixed modules, `_service.py`
    names, and parent-level helper files that violate the folder rules.
  - Boundary: import/path hygiene across server packages.

## Alignment Decisions

These decisions remove ambiguity before the swarms start. Change them only with
a doc-updating PR that names the new owner or rule.

- **Agent auth / gateway owner:** `server/proliferate/server/cloud/agent_auth/**`
  is the canonical server owner for agent LLM auth and gateway-backed auth for
  now. Do not create or revive a separate `server/agent_gateway/**` product
  domain during this cleanup. Primitive docs that say `agent_gateway/**` should
  be normalized toward `cloud/agent_auth/**` when Swarm 6 touches them.

- **Transaction exceptions:** the target remains the database guide rule:
  stores do not open sessions, commit, or rollback. Existing allowlist reasons
  that say "intentional" or "checkpoint" are migration notes, not permanent
  exceptions. If a flow needs a commit before an external side effect or before
  a follow-up request, the transaction boundary belongs in an explicit API,
  service entry point, worker entry point, or narrowly named orchestration
  function outside `db/store/**`.

- **Stripe integration shape:** billing's Stripe adapter should become a proper
  multi-file integration package, `server/proliferate/integrations/stripe/`,
  unless a PR discovers a smaller shape that still satisfies
  `guides/integrations.md`. Product pricing and billing policy stay in the
  billing domain; the Stripe package owns raw Stripe HTTP, Stripe payload
  parsing, webhook signature verification, Stripe errors, and typed Stripe
  payload models.

- **Cloud runtime carve:** make the non-mechanical ownership decisions before
  moving runtime files. The expected target is still the structure in
  `guides/domains.md`: runtime provisioning, liveness, credentials/config sync,
  setup monitoring, and target registration should each have a named owner once
  they earn it. Do not do broad file moves without first documenting the owner
  and preserving runtime lifecycle invariants.

- **Guardrail timing:** stronger server-specific guards may land before all
  cleanup is complete as long as they use explicit allowlists. By the end of
  the migration, server structure allowlists should be empty or limited to
  generated/static assets that are outside the server architecture contract.

- **Tests:** test paths are allowed to stay somewhat disorganized during the
  migration. Do not block ownership cleanup on a full test tree reshape. When a
  swarm adds or moves tests, prefer the current `tests/unit`,
  `tests/integration`, and `tests/e2e` structure and update stale doc
  references opportunistically.

- **Folder hygiene:** the desired end state is complete cleanup, not only
  touched-file cleanup. It is acceptable to stage this in separate PRs, but
  single-file folders, underscore-prefixed modules, `_service.py` files, and
  parent-level helper files should all have either been removed or explicitly
  justified in the canonical docs by the final migration PR.

## Shared Rules For Every Lane

- Preserve behavior unless a lane explicitly says otherwise.
- Do not add new allowlist entries to make a cleanup pass.
- When a cleanup removes a violation, reduce or delete the matching allowlist
  entry in the same PR.
- Keep each PR ownership-narrow. A lane may need multiple PRs; do not combine
  unrelated lane work to chase a bigger diff.
- Run the focused tests for the changed area plus:

```bash
python3 scripts/check_server_boundaries.py
python3 scripts/check_max_lines.py
```

- If a lane changes ownership, update the canonical server doc or focused guide
  in the same PR.

## Baseline Debt

The current boundary checker passes because all known violations are
count-allowlisted. The cleanup goal is to drive these counts to zero.

```text
API_STORE_IMPORT              3 findings across 2 files
DOMAIN_FORBIDDEN_IMPORT       4 findings across 4 files
INTEGRATION_PRODUCT_IMPORT    1 finding  across 1 file
SERVICE_DB_ENGINE_IMPORT      6 findings across 6 files
SERVICE_DB_METHOD_CALL       18 findings across 4 files
SERVICE_ORM_IMPORT           15 findings across 12 files
SERVICE_SQLALCHEMY_IMPORT     3 findings across 3 files
STORE_COMMIT_ROLLBACK        59 findings across 8 files
STORE_FORBIDDEN_IMPORT        4 findings across 1 file
STORE_SESSION_FACTORY_CALL   90 findings across 16 files
STORE_SESSION_FACTORY_IMPORT 16 findings across 16 files
```

The max-lines checker also passes through an allowlist. Server-specific hard
thresholds in `specs/codebase/structures/server/README.md` are enforced for the server
layers they cover, with the repo-wide 600-line guardrail as the fallback for
other files. The allowlist records observed line counts, so oversized files
cannot grow without updating the explicit exception and files that shrink must
lower or remove their exception.

The structure checker also tracks folder and naming migration debt through the
same count-based allowlist. Lane 4 removed the billing Stripe integration
single-file folder debt, and Lane 9 removes the remaining folder/name entries:

```text
SERVICE_SUFFIX_MODULE         0 findings
SINGLE_FILE_FOLDER            0 findings
UNDERSCORE_PREFIXED_MODULE    0 findings
```

## Lane 1: Docs Truth And Guardrails

Scope:

- `specs/codebase/structures/server/**`
- `scripts/check_server_boundaries.py`
- `scripts/check_max_lines.py`
- `scripts/server_boundaries_allowlist.txt`
- `scripts/max_lines_allowlist.txt`

Canonical docs:

- `specs/README.md`
- `specs/codebase/structures/server/README.md`
- all focused server guides

Current debt:

- Some server README transitional notes lag the current tree.
- Server docs define layer-specific size thresholds, but the repo-wide
  max-lines checker enforces only a broad 600-line ceiling.
- Some folder and naming hygiene rules are documented but not checked.

Target result:

- Canonical docs describe the current target shape without stale claims.
- Shape checks cover the server-specific rules that can be enforced safely:
  single-file folders except allowed one-file `domain/` pure-rule folders,
  single-underscore-prefixed modules, `_service.py` names,
  helper/misc/common junk-drawer names, server-specific line thresholds, and
  existing boundary allowlist shrinkage.
- Boundary and max-lines allowlists remain count-based so cleanup PRs can
  shrink debt incrementally.

Do not change:

- Product behavior.
- Existing code ownership, unless the guardrail change requires a tiny
  mechanical path exemption for generated or static assets.

Verification:

```bash
python3 scripts/check_server_boundaries.py
python3 scripts/check_max_lines.py
```

Done when:

- Server docs have no stale target-shape claims.
- Guardrails catch new server structure drift that the docs ban.
- Existing debt is either allowlisted with counts or already removed.

## Lane 2: Database Session Threading

Scope:

- `server/proliferate/db/store/**`
- services and workers that call changed store functions

Canonical docs:

- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/workers.md`
- relevant domain guide for each touched service

Current debt:

- `STORE_SESSION_FACTORY_IMPORT`
- `STORE_SESSION_FACTORY_CALL`
- `STORE_COMMIT_ROLLBACK`
- `STORE_FORBIDDEN_IMPORT`

Target result:

- Store functions accept `db: AsyncSession`.
- Stores never open sessions, commit, rollback, or import product services or
  integrations.
- HTTP request transaction ownership stays in `get_async_session`.
- Worker transaction ownership stays at worker/reconciler entry points.

Do not change:

- Transaction timing unless the PR is explicitly scoped to that behavior and
  has focused tests.
- Database schema.
- Public API responses.

Verification:

```bash
cd server
uv run pytest -q tests/unit tests/integration
python3 ../scripts/check_server_boundaries.py
python3 ../scripts/check_max_lines.py
```

Done when:

- Store session factory and commit/rollback allowlist entries reach zero.
- Stores return dataclasses or primitive write results, not ORM objects.
- Any remaining transaction entry points are outside `db/store/**`.

## Lane 3: Service Boundary Cleanup

Scope:

- `server/proliferate/server/**/service.py`
- worker-facing `service.py` files under promoted `worker/` folders

Canonical docs:

- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/workers.md`

Current debt:

- `SERVICE_DB_ENGINE_IMPORT`
- `SERVICE_DB_METHOD_CALL`
- `SERVICE_ORM_IMPORT`
- `SERVICE_SQLALCHEMY_IMPORT`

Target result:

- Services receive `db: AsyncSession` from API handlers or worker entry points.
- Services call stores for persistence and integrations for raw external
  access.
- Services do not import ORM models, session factories, SQLAlchemy query APIs,
  or call `db.commit()` / `db.rollback()`.
- Service-to-service imports use public functions only.

Do not change:

- Route contracts.
- Error codes or status codes.
- Cross-domain write behavior, except to route writes through the owning
  service when that is the cleanup target.

Verification:

```bash
cd server
uv run pytest -q tests/unit tests/integration
python3 ../scripts/check_server_boundaries.py
```

Done when:

- All `SERVICE_*` allowlist entries are gone.
- Services remain orchestration layers, not query builders or transaction
  owners.

## Lane 4: Billing Structure

Scope:

- `server/proliferate/server/billing/**`
- `server/proliferate/db/store/billing.py`
- `server/proliferate/integrations/stripe/**`
- billing tests

Canonical docs:

- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/integrations.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/codebase/primitives/billing.md`
- `specs/codebase/structures/server/audits/phase6-billing-reconciler.md`

Current debt:

- Billing store self-opens sessions and commits heavily.
- Billing store imports product code.
- Billing service imports ORM/session internals.
- Billing service and store are oversized.

Resolved debt:

- The old billing-scoped Stripe integration single-file folder and product
  import debt has been removed. Stripe now lives under
  `server/proliferate/integrations/stripe/**`.

Target result:

- Stripe raw HTTP code lives in `server/proliferate/integrations/stripe/**`
  and does not import product domains.
- Billing pricing/product policy stays in `server/billing/domain/**` or
  `server/billing/service.py`, not in the integration.
- Billing store accepts explicit sessions and owns only persistence.
- Billing reconciler stays a thin loop until it earns a promoted worker shape.

Do not change:

- Billing ledgers, accounting semantics, Stripe event handling semantics, or
  error codes.
- Stripe product/price IDs or meter behavior.

Verification:

```bash
cd server
uv run pytest -q tests/unit/test_billing_domain.py \
  tests/unit/test_billing_service_policy.py \
  tests/unit/test_billing_reconciler.py \
  tests/unit/test_stripe_billing.py \
  tests/integration/test_billing_accounting.py \
  tests/integration/test_billing_api.py \
  tests/integration/test_stripe_webhooks.py
python3 ../scripts/check_server_boundaries.py
python3 ../scripts/check_max_lines.py
```

Done when:

- Billing-related boundary allowlist entries are gone or materially reduced per
  PR.
- Stripe uses the legal multi-file `server/proliferate/integrations/stripe/**`
  package and does not import billing product domains.
- Billing files above server hard thresholds are split along documented
  ownership boundaries.

## Lane 5: Cloud Runtime Carve

Scope:

- `server/proliferate/server/cloud/runtime/**`
- `server/proliferate/integrations/anyharness/**`
- runtime setup-run stores and tests when needed

Canonical docs:

- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/integrations.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/codebase/structures/server/audits/phase6-cloud-runtime-background-loops.md`
- runtime primitives or feature docs touched by the PR

Current debt:

- `cloud/runtime/` still mixes provisioning, liveness, config sync, setup
  monitoring, target registration, sandbox command execution, and runtime
  connection concerns.
- Some old AnyHarness helper names remain in the product runtime folder even
  though the integration package exists.
- Several runtime files are oversized or worker-like without clean worker
  ownership.

Target result:

- Raw AnyHarness protocol access lives under `integrations/anyharness/**`.
- Runtime product code is carved into coherent subdomains such as
  provisioning, liveness, config sync, credentials, setup monitoring, or target
  registration when those folders earn `service.py` / `models.py` ownership.
- Worker-like loops call services and keep transaction ownership at entry
  points.

Do not change:

- Workspace lifecycle states.
- Setup apply token behavior.
- Runtime readiness, reconnect, or wake semantics.
- Sandbox command strings except where a test explicitly locks the same
  behavior after movement.

Verification:

```bash
cd server
uv run pytest -q tests/unit/test_cloud_runtime_provision.py \
  tests/unit/test_cloud_runtime_scheduler.py \
  tests/unit/test_cloud_runtime_ensure_running.py \
  tests/unit/test_anyharness_runtime.py \
  tests/unit/test_anyharness_workspaces.py \
  tests/unit/test_anyharness_sessions.py
python3 ../scripts/check_server_boundaries.py
python3 ../scripts/check_max_lines.py
```

Done when:

- Runtime product files no longer contain raw AnyHarness client logic.
- Runtime background loops match the worker guide.
- Runtime hard-threshold files are split along the target shape.

## Lane 6: Agent Auth And Gateway

Scope:

- `server/proliferate/server/cloud/agent_auth/**`
- `server/proliferate/db/store/cloud_agent_auth/**`
- `server/proliferate/db/models/cloud/agent_auth*.py`
- `specs/codebase/primitives/agent-auth.md`
- `specs/codebase/primitives/agent-auth-bifrost-byok.md`

Canonical docs:

- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/codebase/primitives/agent-auth.md`
- `specs/codebase/primitives/agent-auth-bifrost-byok.md`

Current debt:

- Max-lines debt for `cloud/agent_auth/service.py`,
  `db/store/cloud_agent_auth/store.py`,
  `db/models/cloud/agent_auth.py`, and `cloud/agent_auth/models.py` has been
  split below the enforced thresholds; those files now preserve stable import
  surfaces.
- Agent gateway language in primitive docs has been normalized toward
  `cloud/agent_auth/**`, the tracked implementation owner.
- Service-level session boundary debt remains in agent-auth service concern
  modules, currently `managed_credits.py`, `refresh.py`, and
  `session_loader.py`. The boundary checker classifies top-level
  `cloud/agent_auth` concern modules as service-layer files and allowlists
  those exact remaining violations until session ownership moves to an API,
  worker, or named orchestration entry point.

Target result:

- `cloud/agent_auth/**` is documented as the canonical owner for
  gateway-backed agent auth.
- Service code splits into owned concerns such as credentials, selections,
  router materialization, runtime grants, freshness, BYOK validation, and
  reconciler orchestration.
- Store/model files split by resource clusters while preserving the ORM →
  dataclass → Pydantic pipeline.

Do not change:

- Credential encryption/decryption behavior.
- Bifrost policy materialization semantics.
- Protected env allowlist behavior.
- BYOK gating or managed-credit gating.

Verification:

```bash
cd server
uv run pytest -q tests/unit/test_agent_auth_domain.py \
  tests/unit/test_agent_auth_synced_payload_domain.py \
  tests/unit/test_agent_gateway_integrations.py \
  tests/integration/test_cloud_agent_auth_api.py \
  tests/integration/test_cloud_agent_auth_sharing_api.py
python3 ../scripts/check_server_boundaries.py
python3 ../scripts/check_max_lines.py
```

Done when:

- Agent-auth service/store/model hard-threshold files are split by documented
  ownership.
- Agent-auth and gateway docs point to the same canonical code owner.
- Agent-auth max-lines allowlist entries are gone, and remaining session
  boundary allowlist entries are visible by service concern module until a
  later session-ownership migration removes them.

## Lane 7: Workspaces, Commands, And Worker Control

Scope:

- `server/proliferate/server/cloud/workspaces/**`
- `server/proliferate/server/cloud/commands/**`
- `server/proliferate/server/cloud/worker/**`
- related `db/store/cloud_workspaces.py` and `db/store/cloud_sync/**`

Canonical docs:

- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/primitives/workspace-lifecycle.md`
- `specs/codebase/primitives/claiming.md` when claim behavior is touched

Current debt:

- Workspace and command services are oversized and carry ORM/session debt.
- Worker service commits inside service functions.
- Cloud sync stores are large and own several resource concerns.
- Worker control helpers import private service helpers.

Target result:

- Workspaces own workspace lifecycle orchestration only.
- Commands own command enqueue/lease/result behavior.
- Worker-control API-facing surfaces stay API-facing; worker-process logic
  follows the worker guide.
- Cloud sync stores are split by resource while keeping explicit transaction
  ownership outside stores.

Do not change:

- Command leasing/correlation semantics.
- Workspace visibility, exposure, or claim behavior.
- Worker heartbeat or command status stream contracts.

Verification:

```bash
cd server
uv run pytest -q tests/unit/test_cloud_workspace_service.py \
  tests/unit/test_cloud_workspace_lifecycle_domain.py \
  tests/unit/test_cloud_workspace_access_policy.py \
  tests/unit/test_cloud_executor_worker_commands.py \
  tests/integration/test_cloud_commands_api.py \
  tests/integration/test_cloud_worker_updates_api.py \
  tests/integration/test_cloud_workspace_claims_api.py
python3 ../scripts/check_server_boundaries.py
python3 ../scripts/check_max_lines.py
```

Done when:

- Workspace, command, and worker-control service boundary debt is gone or
  reduced per PR.
- Files above hard thresholds are split by product subdomain or store resource.
- No service imports private helpers from another service.

## Lane 8: Slack Cloud Bot

Scope:

- `server/proliferate/server/cloud/slack/**`
- `server/proliferate/db/store/cloud_slack/**`
- Slack integration tests

Canonical docs:

- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/auth.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/integrations.md`
- `specs/codebase/features/slack-bot.md`

Current debt:

- Slack bot remains parked/disabled, so revive-path comments and feature docs
  must point at the current worker owners before the flow is re-enabled.
- Deferred Slack event, post-session, outbound, and command-launch work now
  lives under `server/proliferate/server/cloud/slack/worker/**`; future revive
  work must keep transaction ownership at those worker entry points.
- Slack API/store, Slack service session-helper, Slack domain purity, and Slack
  service max-lines allowlist debt has been removed by Lane 8.

Target result:

- API routes are transport only.
- Store access moves through access deps or service functions.
- Deferred Slack handlers have explicit worker/service entry points for
  transactions.
- Pure Slack policy and formatting stay in `domain/**`; Slack API calls stay in
  `integrations/slack/**`.

Do not change:

- Slack signature verification, dedupe, OAuth state, or repo-routing behavior.
- Outbound retry/idempotency behavior.
- Command launch payloads.

Verification:

```bash
cd server
uv run pytest -q tests/unit/test_slack_bot_service.py \
  tests/unit/test_slack_cloud_message_format.py \
  tests/unit/test_slack_messages.py \
  tests/unit/test_slack_notifications.py \
  tests/integration/test_cloud_api.py
python3 ../scripts/check_server_boundaries.py
python3 ../scripts/check_max_lines.py
```

Done when:

- Slack API and service allowlist entries are gone.
- Slack service is split into documented owners or remains below thresholds.
- Slack domain modules are pure.

## Lane 9: Folder And Naming Hygiene

Scope:

- All `server/proliferate/**` package folders

Canonical docs:

- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/integrations.md`
- `specs/codebase/structures/server/guides/workers.md`

Current debt:

- Lane 9 removes the non-billing single-file store folders, the cloud
  underscore-prefixed logging module, and the automation `_service.py` module.
- No folder/name hygiene entries remain in the server boundary allowlist.
- Parent-level sibling files that act like service helpers remain a broader
  folder-hygiene concern for future ownership cleanup when identified outside
  this path-only PR.

Target result:

- Single-file folders are inlined or promoted into meaningful multi-file
  folders, except allowed one-file `domain/` pure-rule folders.
- No underscore-prefixed modules at module scope.
- No `_service.py`, `_helper.py`, `_helpers.py`, `_utils.py`, `helper.py`,
  `helpers.py`, `misc.py`, `common.py`, or `utils.py` domain files.
- Parent-level sibling files either become `domain/<concern>.py`, legal
  `worker/` files, legal integrations, or promoted subdomains.

Do not change:

- Behavior. This lane should be import/path movement plus narrowly scoped
  ownership movement.

Verification:

```bash
python3 scripts/check_server_boundaries.py
python3 scripts/check_max_lines.py
cd server && uv run pytest -q tests/unit tests/integration
```

Done when:

- Folder/name hygiene has an executable guardrail.
- Non-billing single-file-folder and naming exceptions owned by Lane 9 are
  gone.

## Recommended PR Ordering

1. Lane 1 first, so every other agent has accurate docs and stronger checks.
2. Lane 2 in small resource clusters. Prefer stores with the fewest callers
   before billing or workspaces.
3. Lane 3 alongside Lane 2, but only for services whose stores are already
   explicit-session capable.
4. Lanes 4 through 8 in parallel worktrees after the relevant store/session
   groundwork exists.
5. Lane 9 can run in parallel for pure path hygiene, but avoid renaming files
   inside a lane another agent is actively carving.

## Swarm Handoff Template

Each subagent should receive a prompt in this shape:

```text
You are working in a dedicated worktree on Lane <n>: <name>.

Read first:
- specs/codebase/structures/server/README.md
- specs/codebase/structures/server/guides/<focused>.md
- specs/codebase/structures/server/audits/server-structure-hygiene.md
- <feature/primitive docs listed in the lane>

Scope:
- <exact files/folders>

Goal:
- <target result from lane>

Do not change:
- <invariants from lane>

Required cleanup:
- Reduce/delete the relevant allowlist entries in
  scripts/server_boundaries_allowlist.txt and/or scripts/max_lines_allowlist.txt
  when the code no longer violates them.

Verification:
- <focused pytest commands>
- python3 scripts/check_server_boundaries.py
- python3 scripts/check_max_lines.py

Deliverable:
- One behavior-preserving PR with docs updated only if ownership changes.
```
