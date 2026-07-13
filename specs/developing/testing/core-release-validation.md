# Core Release Validation Contract

Status: target contract for automated Tier 2, Tier 3, and Tier 4 product
qualification. The final section names current-main enforcement exceptions;
none of them count as qualification.

This document is the complete target manifest for deciding whether a
Proliferate release works as intended. It owns the required guarantees and the
meaning of a passing release. The surrounding testing documents have narrower
roles:

- [`README.md`](README.md) owns tier mechanics, placement, and test-writing
  rules.
- [`flows.md`](flows.md) is the current legacy flow view. Its future pointer,
  collection, lane, and run-status columns are generated from the target
  manifest, executable registries, and run evidence; they are not separately
  hand-owned truth.
- [`scenarios.md`](scenarios.md) is the current migration/finding ledger. Stable
  journey semantics move to the tier contracts below; implementation history
  belongs in issues and generated evidence rather than registry prose.
- [`release-worlds-and-fixtures.md`](release-worlds-and-fixtures.md) owns
  candidate artifacts, world topology, infrastructure lifetime, and readiness.
- [`tier-3-scenario-contract.md`](tier-3-scenario-contract.md) owns the agreed
  Tier 3 journey composition beneath the target IDs in this manifest.
- [`tier-4-scenario-contract.md`](tier-4-scenario-contract.md) owns the two
  standing upgrade journeys and their retained-production artifact contract.
- [`self-hosting.md`](self-hosting.md) owns the self-host deployment fixture,
  current mechanism notes, and lower-tier implementation hand-off. The Tier 3
  contract owns `SH-*` qualification actions and assertions; this contract and
  the target manifest own stable guarantee identity and qualification state.
- [`core-release-scenario-manifest.json`](core-release-scenario-manifest.json)
  is the one machine-owned target inventory. It contains stable guarantee IDs
  and composed journey children. Presence is not coverage: `planned` means
  unqualified until a real collector, collected test id, required cells, gate,
  and evidence mapping are audited.
- The execution manifest is generated from actual Playwright collection and
  the Tier 3/4 code registry. It is deliberately not recovered from the old
  worktree because that file referenced collectors absent from current main.
- Every run emits immutable evidence separately from both manifests. Static
  implementation state never substitutes for an observed result.
- [`../qa/README.md`](../qa/README.md) owns manual verification that cannot be
  automated.

When another testing document describes a smaller or provisional matrix, this
contract wins. Product behavior remains owned by the relevant feature and
primitive specs under `specs/codebase/**`.

## Contract Vocabulary And Source Of Truth

The testing system keeps five concepts separate:

1. A **guarantee** is a stable product claim such as `T3-AUTHROUTE-1` or
   `T4-RUNTIME-1`. The target manifest owns its identity, tier, implementation
   state, and qualification disposition. Journey rows own world and host
   composition; change-trigger predicates remain beside their guarantee until
   the executable selector is added to the manifest.
2. A **journey** is a composed execution such as `LOCAL-2` or
   `CLOUD-COMPUTE-EXHAUST-1`. The Tier 3 and Tier 4 contracts own its actions,
   assertions, and evidence. A journey can prove several guarantees.
3. A **cell** is one required expansion of a guarantee or journey across a
   derived dimension: host, runtime lane, harness, auth route, plan, role, or
   changed artifact. Qualification resolves the exact cell set before running.
4. A **collector** is executable test code. Tier 2 Playwright metadata and Tier
   3/4 `ScenarioDefinition` registrations declare which cells they collect.
5. **Run evidence** records what actually happened for one candidate. It binds
   every final cell result to the merged SHA, candidate manifest, world handle,
   artifacts, correlations, and cleanup result.

No hand-maintained document owns collector pointers or current run status.
CI discovers collectors in both directions and fails when a required manifest
cell has no collector, a collector names an unknown cell, an implemented cell
is not selected by its claimed gate, or duplicate collectors claim one final
cell. `flows.md` and execution reports are generated views.

Matrix collectors return explicit child-cell results. A parent scenario that
returns successfully after swallowing a per-harness, per-route, or per-host
skip cannot qualify the matrix.

## Qualification rule

A release is qualified only when all of the following are true for the exact
merged `main` SHA and the exact artifacts being promoted:

1. Every required Tier 1 check passes.
2. Every Tier 2 row in this document passes on the merge candidate or exact
   merged SHA.
3. Every active standing Tier 3 row selected by the target manifest passes
   against the deployed candidate.
4. Every Tier 4 row triggered by the changed artifacts passes against kept
   N-1 artifacts and data.
5. The qualification evidence contains no missing, skipped, blocked,
   expected-fail, cancelled, duplicate, or failed final required result.
   Superseded attempts remain recorded separately and never replace a product
   assertion failure.

`green` is the only passing state. Missing credentials, an unavailable
provider, fixture exhaustion, or an infrastructure outage means the candidate
is not qualified; it never means the product passed. Provider recovery may
trigger a rerun of the same SHA. A product assertion failure requires triage
and normally a new SHA.

No required job, matrix cell, or assertion may be neutralized with
`continue-on-error`, a skipped-success fallback, or exit-code normalization.
Independent siblings may continue after one failure to collect complete
diagnostics, and cleanup/evidence steps run unconditionally, but the aggregate
check remains red.

Tier 3 and Tier 4 do not block ordinary merges. They block production
promotion, stable updater publication, and promotion of affected runtime,
worker, catalog, or template artifacts.

During foundation construction, the active standing Tier 3 set is the union
of Tier 3 guarantee references from composed journeys plus any explicitly
listed standalone standing guarantees. An unreferenced Tier 3 guarantee is
machine-classified `deferred`, appears in every evidence summary, and does not
silently pass. Such a run may be called **foundation qualification** for its
named set, never full core-release qualification. Full core-release
qualification is available only when the manifest has no deferred Tier 3
guarantees and every Tier 3 row is green. This lets the gate ratchet from an
honest vertical slice without weakening the end-state contract.

Cell selection and result behavior are separate. A selector resolves the exact
required cells before execution:

- the merge selector resolves the trusted Tier 1/2 set for the exact
  integration commit; and
- the release selector resolves standing Tier 3 plus change-triggered Tier 4
  cells for the exact candidate artifacts.

The runner has two result behaviors:

- `diagnostic` may report `blocked` and `expected_fail`, continues independent
  siblings, always emits non-qualifying evidence, and alerts when the blocked
  set grows; and
- `strict` requires every selected required cell to be present exactly once and
  green, with valid artifact/world identity and successful cleanup.

There is no blocked budget under `strict`, regardless of selector. Optional or
change-untriggered cells resolve to `not_required` before execution. Planning
or dry-run emits no green evidence. During the foundation migration, a smaller
strict baseline may ratchet upward, but its evidence is explicitly `partial`
and must never be labeled full core-release qualification. The end state
requires every core row in this contract.

## Required proof shape

Every core behavior has two proofs:

1. A deterministic lower-tier proof that enumerates decisions, permissions,
   errors, races, retries, replay, and persistence.
2. The smallest real deployed path proving that the server, clients,
   AnyHarness, agents, providers, and artifacts are connected correctly.

Every scenario asserts observable outcomes rather than implementation steps or
LLM prose. Where applicable, a scenario covers:

- the happy path and every supported role, plan, route, harness, and lane;
- unauthorized and alternate-entry bypass attempts;
- duplicate, concurrent, reordered, and lost-response delivery;
- provider failure, process crash, restart, and recovery;
- durable state and external effects after reconnect or relaunch;
- audit, usage, correlation, and redaction requirements;
- cleanup and absence of duplicate money movement or tool execution;
- the latency or propagation budget owned by the relevant feature spec.

Agent, model, mode, provider, tool, and auth-route matrices are derived from
the shipped catalogs and contracts. The same rule applies to Product MCPs,
workflow step and trigger kinds, worker reconcile domains, billing entry
points, and update mechanisms. A newly supported value enters the matrix
automatically; a hand-maintained allowlist cannot silently omit it.

## Gate cadence

| Gate | Required work | Required behavior |
| --- | --- | --- |
| Pull request | Tier 1 plus every collected Tier 2 row allowed by the event's trust boundary; trusted same-repository PRs also run secret-bearing rows | Any executed required row fails closed. A secret-bearing job on a fork or Dependabot PR is explicitly skipped and non-qualifying, never reported as product evidence. |
| Merge queue | Rerun Tier 1 and the complete Tier 2 manifest on the integration commit | Missing credentials or skipped required work fails qualification. Real-agent/E2B work remains Tier 3 and does not run conditionally inside this gate. |
| Staging qualification | Deploy immutable artifacts for the exact merged SHA; run the complete active standing Tier 3 set and triggered Tier 4 rows | The aggregate contains exactly one final green result per required ID/lane and enumerates deferred guarantees. All attempts remain visible; duplicate final claims or effects fail qualification. A full-core label additionally requires no deferred Tier 3 rows. |
| Production promotion | Verify trusted qualification evidence for the same SHA and artifact digests before mutating production | Missing, stale, mismatched, or non-green evidence fails closed. |
| Nightly | Rerun Tier 3, the full Tier 4 battery, native surfaces, and the broadest supported compatibility matrix | Failures remain visibly red and create incidents. Nightly signal does not replace exact-SHA release qualification. |

## Fixture contract

Live qualification uses a disposable, run-scoped world rather than shared
mutable staging state:

- fresh owner, admin, member, removed member, and outsider identities;
- separate personal and organization billing subjects for free, funded,
  exhausted, overage, payment-failed, and cancelled states;
- separate personal managed-LLM allocation/free-entitlement/budget states and
  activated Core organization budget states for funded, exhausted, capped,
  top-up-enabled, top-up-declined, and needs-review paths;
- Stripe test customers, subscriptions, payment methods, checkout sessions,
  and test clocks;
- LiteLLM provider configuration and subject-scoped LiteLLM virtual keys with
  cheap-model, token, and spend caps; administrative credentials remain private
  to the server/provisioner;
- fresh E2B sandboxes built from the candidate template;
- dedicated GitHub repositories or branches and GitHub App grants;
- run-scoped integration credentials, poll feeds, email capture, and Slack
  destinations;
- a disposable self-hosted installation when self-host scenarios run.

Every resource carries the run correlation id, has deterministic teardown, and
has a TTL janitor for interrupted runs. Secrets never appear in logs or
qualification artifacts.

Cheap real models are intentional. Live scenarios use bounded turns, tool
budgets, deadlines, and the cheapest catalog-compatible model. Deterministic
scripted agents remain the correct lower-tier tool for exact permission,
crash, malformed-message, and replay matrices; real-agent tests prove the
shipped integration path.

### Billing invariants

Every billing row proves the applicable invariants, not merely the expected
HTTP response:

- closed billable compute seconds equal credit-covered seconds plus
  overage-attributed seconds plus explicit write-off seconds;
- locally exported compute-overage cents equal Stripe's accepted meter
  quantity under the declared rounding/remainder rule and never exceed the
  configured cap;
- for managed-LLM events, LiteLLM-recorded LLM cost equals the imported
  event and entitlement debit after bounded reconciliation; BYOK cost may be
  imported for attribution but never debits managed credit;
- one paid invoice issues at most one grant; every billable second is consumed,
  exported, or written off exactly once across any number of accounting passes;
  and each Stripe meter-event identifier is accepted at most once;
- personal work bills the personal subject; organization work bills the
  organization and correct member, with no cross-subject leakage;
- an open, failed, incomplete, or uncollected invoice grants nothing;
- an active compute hold blocks every compute-dependent entry point;
  managed-credit exhaustion blocks managed starts/turns and disables its
  virtual key, but does not itself block valid BYOK or require immediate E2B
  pause;
- compute seconds and managed-LLM currency are separate ledgers: a mutation in
  one cannot refill, debit, hold, or attribute the other without an explicit
  product transition;
- LiteLLM budgets bound runtime spend while Proliferate's imported ledger is
  canonical; missing, zero, or unsafe cost remains `needs_review` and blocks
  new managed launches until reconciled;
- Stripe, Postgres, LiteLLM, E2B, billing APIs, workspace events, and every
  supported visible billing surface agree after bounded convergence.

## Tier 2 required manifest

Tier 2 runs the real server, product browser surfaces, and Postgres. It stops
at a sandbox, real-agent, or provider-execution boundary, except that Stripe
test mode and the mock OIDC/email/poll fixtures are part of the Tier 2
contract.

Stripe test mode is an explicit real-network exception, not a fake. Trusted CI
must provide an `sk_test_` credential and treat absence, provider failure, or a
skipped billing cell as a red merge result. Untrusted fork events cannot access
the credential and are visibly non-qualifying; the trusted merge-queue commit
must execute the complete Tier 2 set. Local diagnostics may report these cells
blocked when the developer intentionally omits Stripe.

### Authentication, organizations, and surfaces

| ID | Required validation |
| --- | --- |
| `T2-AUTH-1` | Fresh `/setup` claim, password login, logout, relogin, wrong-password rejection, and permanent second-claim rejection. |
| `T2-AUTH-2` | Access/refresh rotation and revocation: every existing browser or token loses access immediately and cannot silently reauthenticate. |
| `T2-AUTH-3` | Mock-OIDC discovery, start, callback, JIT membership, identity reuse, disabled JIT, disallowed domain, unknown user, tampered state, issuer mismatch, and audience mismatch. |
| `T2-AUTH-4` | Google/GitHub availability, PKCE/state/callback error handling, button truthfulness, and uniform non-enumerating failures up to the real-provider boundary. |
| `T2-AUTH-5` | Slug, org-id, join, and cold-login SSO entry points; unknown and unconfigured organizations return the same non-enumerating answer. |
| `T2-AUTH-6` | Unknown email, inactive user, OAuth-only user, wrong password, normalized-email/IP throttles, trusted-proxy rules, and the password-login kill switch preserve non-enumerating responses and dummy verification. Exact-email/domain Web-beta allowlists match case-insensitively for existing users and OAuth callbacks, deny with the stable 403/redirect code, and never gate Desktop or mobile. |
| `T2-INV-1` | Invite, fresh-browser acceptance, role assignment, resend/rotation, revoke, expiry, reuse, duplicate, and wrong-email rejection. |
| `T2-INV-2` | Single-org register-via-invite creates the account and membership atomically; a bad token or email creates neither. |
| `T2-ORG-1` | Every supported organization-creation path, role promotion and demotion, last-owner protection, member removal, and immediate permission refresh. |
| `T2-ORG-2` | Owner/admin/member/removed-member/outsider visibility and mutation boundaries across organization, workspace, secret, billing, integration, and workflow APIs and UI. |
| `T2-SURF-1` | Desktop-web, hosted Web, and mobile-web auth/navigation/settings entry points render the same server truth, preserve auth correctly, and expose no unsupported native action. |
| `T2-SURF-2` | Onboarding and pending-shell states preserve the user's prompt/config through readiness blockers, remap projected ids to one durable workspace/session, and never duplicate or lose intent on failure, retry, or abort. |

### Product clients, chat, delegated work, and support

| ID | Required validation |
| --- | --- |
| `T2-COMPOSER-1` | Prompt, approval, user-input, MCP form, runtime/delegated context, model/mode switch, plan/todo, and parent-with-background-work states obey ordering and availability rules. Proposed plans remain durable transcript cards; plan-reference attach/handoff preserves the trusted snapshot hash and never leaks content to telemetry. |
| `T2-TRANSCRIPT-1` | Controlled SSE/history covers batch flush, detach/reconnect, gap-free replay, optimistic/waiting reconciliation, bounded older-history paging, virtualization, scroll anchoring, repinning, streaming handoff, tool/delegated receipts, file/provider links, code blocks, unknown tools, and malformed fallbacks without missing or duplicate rows. |
| `T2-SETTINGS-1` | User/Org/Repo/Agents scopes, section order, renamed-route redirects, focus deep links, Web filtering, and Integrations/Workflows/Plugins placement are exact. Member-hidden/direct admin routes and server mutations deny consistently; owner/admin routes work; status vocabulary and telemetry section ids match the contract. |
| `T2-MOBILE-1` | Mobile-web intent covers auth/readiness, repo/owner/model selection, final-looking pending shell, ordered materialize/start/send, zero/new/existing session sends, claim, config accept/rollback, navigation/deep links, Automations/Settings queries, and auth/network failure without losing input or duplicating a command. |
| `T2-DISPATCH-1` | Continue remotely creates or reuses one cloud workspace and private exposure; disable removes Web/mobile visibility without a passive wake. Open-in-Web/mobile/Desktop, QR/copy, signed-out handoff, source/exposure indicators, scoped direct attach, and deep links enforce the same access decision. |
| `T2-API-1` | Personal and admin-gated organization Cowork API keys show the raw value once, persist only an HMAC/prefix, expire/revoke, and deny cross-organization use. Programmatic create/send/poll with auto-cascade converges runtime-config then agent-auth once, caps retry, and reports typed failure without duplicate work. |
| `T2-DELEGATE-1` | Subagent, Cowork, plan-review, and code-review items share canonical identity/status ordering across tabs, popovers, sidebar, transcript, and details. Parent provenance, wake receipts, raw-id hiding, contiguous hierarchy, close/delete confirmation, and parent-composer availability remain correct. |
| `T2-SUPPORT-1` | With controlled S3 and tracker providers, native-window/modal job shapes, diagnostics scope, attachments, urgent/notify/credit/log flags, outreach email, immediate-close queueing, immutable idempotent creation, safe target reissue, exact completion manifest, unauthorized workspace handling, no-wake collection, and full content/secret sanitization hold. |

### Workspaces, configuration, secrets, and integrations

| ID | Required validation |
| --- | --- |
| `T2-WS-1` | Cloud workspace happy request reaches `pending` or `materializing` and the projected UI shell; missing repo configuration, billing block, duplicate request, and lost response create no duplicate workspace. |
| `T2-WS-2` | Local, linked-local, worktree, and cloud Add-Repo branches validate inputs and native/web capability boundaries truthfully. |
| `T2-WS-3` | Repository environment CRUD, default branch, action/setup scripts, environment variables, protected-name validation, and authorization round-trip to the launch seam. |
| `T2-WS-4` | Pending workspace/session projection hands off once to durable ids; passive reads never wake a paused sandbox; archived or superseded targets reject late results. |
| `T2-WS-5` | Shared-unclaimed claim is atomic and one-way; non-claimers lose interaction while admins retain audit-only visibility; queued pre-claim work may finish, later unauthorized work is denied, and only Desktop may request direct-attach credentials. |
| `T2-MOBILITY-1` | Every supported move direction, claimer/admin eligibility, destination and direct-attach preflight, exposure intent, atomic canonical-side cutover, per-item cleanup, retry caps, cleanup failure, repair, and resume preserve one durable workspace/session identity and never roll back after cutover. |
| `T2-GHAPP-1` | GitHub product identity and GitHub App repository authority stay separate. User authorization, installation, selected-repo and human-access coverage, invalid webhook signature, replay/reordered install/repository events, suspend/delete/remove, missed-webhook live fallback, and authorize/install/grant/reconnect states fail closed; no raw lease, refresh token, or App secret reaches a product client. |
| `T2-SEC-1` | Personal, organization, workspace env-var, and file secret create/update/delete; values never echo, versions advance, binary/invalid uploads fail, member writes are denied, and materialization enters pending exactly once. |
| `T2-INT-1` | API-key and OAuth kickoff seams; connect, rotate, enable/disable, organization policy composition, health, disconnect, write-only credentials, and unauthorized administration. |
| `T2-MCP-1` | MCP/skill/plugin CRUD, ownership, organization publication, write-only auth/OAuth reconnect state, and unauthorized access are exact; mutations emit the owning runtime-config refresh intent rather than constructing a launch bundle directly. |
| `T2-AGENTAUTH-1` | Personal/organization credential CRUD, sharing, slot selection, capability flags, resync, target replacement, grant-rotation intent, revoke-cleanup plan, and restart revisioning are exact at browser/server seams. Missing/expired/stale selections fail typed; compiled protected-env and cleanup paths are allowlisted before command persistence and captured plans contain no secret echo. |
| `T2-RUNTIMECFG-1` | Resolver/compiler intent covers plugin expansion, dependencies, publicization, deterministic duplicate renaming, manifest redaction/content-hash idempotency, OAuth reconnect blockers, desired/applied drift, seeded resolution responses, disable/removal, revisioning, and stale-launch preflight, with no legacy plugin-bundle/MCP launch path. |
| `T2-MODELREG-1` | Bundled catalog, trusted registry snapshot, cloud projection, and seeded ACP projection remain distinct truths. Alias canonicalization, opt-in/visibility overrides, last-visible protection, stale saved intent, explicit fallback, target/workspace scope, refresh errors, and shared chat/Automation/Slack defaults never silently substitute a model. |

### Agent policy, permissions, and session-control seams

| ID | Required validation |
| --- | --- |
| `T2-POL-1` | Organization agent-policy UI/API CRUD, plan and role gates, route/harness allowlists, stale-violation reporting, compliant selection, denied selection, remediation, and personal-scope isolation. |
| `T2-PERM-1` | Seeded permission interactions render the exact options and context; allow/deny submission is scoped to the session/request, duplicate or stale resolution is rejected, and cancel/close removes pending UI. |
| `T2-SESSION-1` | Create, prompt, queued-prompt edit/delete, config update, cancel, dismiss/restore, close, fork, title, goal, loop, and workflow-held mutation boundaries reach the correct runtime seam and preserve idempotency keys. |
| `T2-AUTHZ-1` | Every registered AnyHarness and cloud route declares method/scope authorization; expired, revoked, wrong-issuer, wrong-audience, wrong-target, cross-workspace, and cross-session tokens fail closed. Forged advisory origin, prompt provenance, attachment source, MCP summary, or public `workflow_internal` fields never grant authority. |
| `T2-CMD-1` | Every registered cloud-command kind declares wake, runtime-config, agent-auth, exposure, ordering, and idempotency behavior. Lease/redelivery, lost result, archived-target supersession, concurrent wake, wake denial/failure/timeout, passive no-wake reads, inactive projection, and mismatched results converge to one typed state. |

### Workflows and automations

| ID | Required validation |
| --- | --- |
| `T2-WF-1` | UI definition creation/edit, immutable versions, live reference validation, input coercion/interpolation, manual launch, and local/cloud delivery intent. |
| `T2-WF-2` | Poll item deduplication, invalid item reporting, cursor advancement only after scheduling, replay safety, dead endpoint behavior, and enabled-state truth. |
| `T2-WF-3` | Function invocation CRUD, args schema, reserved namespace, write-only headers, rotation, and endpoint validation. |
| `T2-WF-4` | Chat/workflow default-access authoring composes to the frozen provider/tool scope carried by a run. |
| `T2-WF-5` | Session binding, wrong workspace/harness, all-mutation lockout, acknowledged takeover, cancellation, quiescence, and ownership release. |
| `T2-WF-6` | Both `/init` flows, signature derivation/diff, SSRF validation, first-call failure, and saved-definition truth. |
| `T2-WF-7` | Schedule/poll CRUD, every missed-run policy, disabled-trigger behavior, concurrent tick claiming, queue ordering, and crash-safe outbox/retry seams. |
| `T2-AUTO-1` | Personal/team automation CRUD, ownership/admin gates, target mode, immutable run-config snapshot, pause/enable/delete, manual trigger, and exposure intent. |
| `T2-AUTO-2` | Scheduled occurrence deduplication and the runtime-config/agent-auth preflight cascade enqueue each convergence command once, read back applied revisions, retry within policy, and fail with a typed terminal error. |
| `T2-SLACK-1` | Slack Bot OAuth state, one active connection, admin configuration, fixed/auto repo routing, allowed channels, inherited run config, and write-only token storage are exact. Signature/timestamp/challenge, event/thread dedupe, sub-three-second ack, follow-up reuse, ambiguity with zero workspace, config/auth cascade, outbound idempotency, rate limiting, retry, and reauth all hold. |

### Billing

Billing Tier 2 uses Stripe test mode and test clocks. A missing Stripe test
credential fails the required check.

| ID | Required validation |
| --- | --- |
| `T2-BILL-1` | Checkout to subscription/grant, ordered consumption, cutoff, LLM and compute top-up/reactivation, Core subscription/payment recovery, duplicate checkout, and lost-response idempotency. Unsupported top-up attempts fail with the declared typed error and grant nothing. |
| `T2-BILL-2` | A GitHub-deduplicated free personal identity receives one lifetime `$2` managed-LLM grant. Core costs `$20` per active billed seat per month and contributes `$5` managed-LLM plus `$15`-equivalent compute allocation per seat to separate shared organization pools. Cancellation retains period entitlement through `current_period_end`, then downgrades. |
| `T2-BILL-3` | Seat invite/accept/remove/reinvite, exact Stripe quantity, prorated grant once, no refund/double grant, retry exhaustion, and later convergence. |
| `T2-BILL-4` | Core checkout pending organization, successful activation only after verified payment, staged invites, failed billing state, 24-hour expiry, replay, and absence of orphan active organizations. |
| `T2-BILL-5` | Compute overage seconds-to-cents conversion, remainder carry, Stripe export idempotency, per-seat cap, writeoff after cap, and immediate cutoff when disabled. |
| `T2-BILL-6` | Managed-LLM exhaustion disables the scoped LiteLLM virtual key and blocks managed turns without pausing compute; a valid user API key remains usable. Explicit LLM auto-top-up is independent from compute overage/top-up: successful payment grants and reactivates once, while disabled or declined top-up charges/grants nothing and stays blocked. |
| `T2-BILL-7` | Stripe webhook signature, exact replay, concurrent duplicate, handler crash/reclaim, out-of-order convergence, and one notification per real transition. |
| `T2-BILL-8` | Payment-failed hold/recovery, period-end and immediate cancellation, clean deletion versus dunning, rollover grace, and off/observe/enforce behavior. `invoice.upcoming` and `trial_will_end` each emit one informational decision/patch and never hold or block. |
| `T2-BILL-9` | Free cloud-compute allocation uniqueness by verified GitHub identity, allocation kind, and canonical period; concurrent claim safety, cross-account deduplication, and explicit no-identity UX/state. |
| `T2-BILL-10` | Stripe test-clock renewal, invoice generation, new-period grants, seat renewal, dunning, payment recovery, cancellation, and carry/expiry behavior across period boundaries. |
| `T2-BILL-11` | Reconciler startup, singleton/advisory lock, concurrent workers, crash after claim/export/charge, restart, shutdown, and exactly-once convergence. |
| `T2-BILL-12` | Usage summary, timeseries, per-user attribution, LLM balance, billing settings, portal/refill actions, blocked-state copy, and audit values match seeded ledger truth. Workspace billing envelopes and `billing_patch` SSE update every matching workspace and no unrelated workspace, including warning, hold/block reason, remaining seconds, cap, and used cents. |
| `T2-BILL-13` | Every create/ensure/resume/connect/wake/command/workflow/automation and managed-credit start/turn seam covers allowed, compute-exhausted, cap-exhausted, payment-held, organization-capped, and user-capped subjects. Compute gates the sandbox; managed-credit exhaustion gates managed starts without requiring an immediate sandbox pause; compute holds also block managed turns; BYOK still obeys the compute gate. Denial precedes downstream delivery and records one typed decision. |
| `T2-BILL-14` | Personal onboarding creates the `$2` `agent_gateway_free_credits` allocation once, guarded by GitHub provider id across concurrent/cross-account attempts; missing identity gets no allocation. Activated Core creates an organization budget subject, not another personal free entitlement. Budget, provider configuration, and subject-scoped LiteLLM virtual key are idempotent with explicit allowed models and no raw administrative credential. Mocked LiteLLM no-key/unlisted-provider/model/key, admin outage, missing returned secret, and auth-apply failure leave no incomplete plan, block launch, expose typed pending/failed state, and recover idempotently; lifecycle changes disable old keys and audit. |
| `T2-BILL-15` | LiteLLM usage import uses overlap-window pagination, resumes its cursor, deduplicates spend logs, resolves payer/materialization, and debits managed credit once. Unknown cost becomes `needs_review` and fails closed; crashes around event/cursor writes and remote-disable failure converge. Concurrent keys enforce the configured shared budget; any permitted in-flight allowance must be defined by the owning primitive and recorded in evidence before this row can pass. |

### Self-hosted and degraded configuration

| ID | Required validation |
| --- | --- |
| `T2-SH-1` | Single-org claim/owner semantics, invite registration, adaptive password/GitHub/SSO entry, and permanently closed setup. |
| `T2-SH-2` | Live `/meta` capability/version/deployment/support contract for base, add-on, and hosted postures. |
| `T2-SH-3` | Missing or partial E2B, gateway, SSO, support, and billing configuration never crash-loops the control plane and returns actionable, secret-safe errors. |
| `T2-SH-4` | Gateway-only model eligibility rejects native ids and accepts cataloged gateway ids through a real local runtime HTTP seam without an LLM call. |
| `T2-OBS-1` | Telemetry routing is exact for local development, self-managed, and hosted-product postures. Vendor capture is hosted-only, anonymous telemetry honors opt-out and typed low-cardinality schemas, exceptions emit once, replay defaults off, and prompts/files/paths/repos/settings/credentials stay masked or blocked. |
| `T2-UPDATER-1` | Desktop and Supervisor component-updater decision matrices reject equal/downgrade versions, bad signatures/checksums, unsafe component/path/size/archive input, partial downloads, interrupted staging, and unhealthy activation. Atomic swap, last-good rollback, retry, and cleanup leave exactly one trusted active version; no failed candidate is reported healthy. |

## Tier 3 required manifest

Tier 3 tests the deployed candidate with real AnyHarness binaries, real E2B,
real provider handshakes where supported, Stripe test mode, and cheap real
models. Before a target row can become `implemented` or `blocking`, the machine
manifest must assign its concrete lane: local runtime, packaged native Desktop,
deployed cloud/E2B, hosted Web, mobile Web, iOS, Android, self-hosted, or a
declared combination. A `planned` row has no execution claim. No mapped row
silently inherits a local or cloud lane, and matrices enumerate only routes
valid for that target.

### Identity, surfaces, and workspace lifecycle

| ID | Required validation |
| --- | --- |
| `T3-AUTH-1` | Real hosted Google and GitHub sign-in, PKCE/state/callback, account linking, logout/revocation, and provider denial against deployed TLS/DNS. |
| `T3-AUTH-2` | Deployed OIDC SSO and invitation/email delivery round-trip with JIT, existing-user reuse, role assignment, and negative identities. |
| `T3-AUTH-3` | Native iOS/Android Apple sign-in plus mobile password/provider session path covers callback/deep link, account-link collision, SecureStore refresh after kill/reopen, provider revocation, logout/cache clearing, and GitHub-readiness transition against deployed TLS. |
| `T3-SURF-1` | Desktop native, Desktop web-port, hosted Web, mobile Web, and native mobile can sign in, open the same cloud workspace, send a bounded prompt, observe completion, and reload history. Desktop/Web render billing management; mobile renders the supported plan summary and policy/account state without inventing unsupported checkout/portal controls. |
| `T3-ONBOARD-1` | Fresh Desktop, Web, iOS, and Android users traverse identity, provider, run, and workspace readiness to first useful work. GitHub, billing, managed-credit/BYOK, agent-auth, and target blockers preserve the prompt and resume; pending ids reconcile once; analytics contain only stable blocker codes. |
| `T3-PROV-1` | First user completes real GitHub App authorization and provisions the first personal E2B sandbox/workspace from zero within budget; negative or cancelled authorization provisions nothing. |
| `T3-PROV-2` | Existing workspace pause makes it inaccessible; wake/reconnect restores commandability, files, session history, secrets, and billing attribution within budget. |
| `T3-PROV-3` | Failure after provider create, worker enrollment, runtime launch, repo clone, materialization, or session start is adopted or cleaned on retry; stale results are inert and no sandbox/workspace/session/prompt is duplicated. |
| `T3-WT-1` | Local and sandbox worktrees use the correct base branch, isolate edits, run a session, and clean up without modifying the base tree. |
| `T3-REPO-1` | Default branch, setup/action scripts, environment variables, and protected configuration take effect in fresh local and sandbox workspaces. |
| `T3-MOBILITY-1` | Local-to-cloud and cloud-to-local migration preserve files, git state, sessions, secrets references, and ownership. Retry or pre-cutover rollback never duplicates or loses a workspace; after cutover, destination remains canonical and recovery proceeds only through cleanup/repair. |
| `T3-MOBILITY-2` | Shared-to-personal, shared-to-local, personal-to-shared, and cloud-to-cloud moves preserve files, dirty state, sessions/transcript, stable cloud identity, ownership, and exposure. Cutover happens once; stale source reports are fenced; cleanup retries per item; executor loss after cutover enters repair without reverting or orphaning rows. |
| `T3-LIFE-1` | Archive, restore, retire, purge, and orphan cleanup preserve visibility/access rules, reject late commands/results, and never wake on passive reads. |
| `T3-CLAIM-1` | Claim/direct-attach scopes a shared workspace to the claimer, denies forced non-claimer/admin interaction, supports concurrent direct/cloud prompts without duplication, rotates/revokes tokens, and never exposes a direct token to Web or mobile. |
| `T3-FILES-1` | Browse/search/open/edit/save, stale-version conflicts, binary/large-file safety, Changes/stage/undo/branch views, and terminal stream/replay/resize/close match real filesystem and git state in local and sandbox workspaces. |
| `T3-FILES-2` | Every Viewer/Scratch/Changes entry opens the canonical target; legacy tabs normalize; render/edit and split/unified state persist. Scratch is the default tool without forcing the panel open, persists in Tauri app data across workspace switch/relaunch, and never enters the repository. Staged/unstaged and Last-turn filters stay truthful; unsafe/stale/conflicted/partial undo changes nothing. |
| `T3-TERM-1` | First terminal uses the renderer's measured grid and shows a clean prompt on row one; reopen/history replay, font-driven resize, hidden-pane fallback grid, stream reconnect, resize, and close remain usable without wrap artifacts or duplicate output. |
| `T3-DISPATCH-1` | Packaged Desktop exposes a local workspace through Continue remotely; Web/mobile see it and send one prompt to the local target. Authenticated deep links and claimed Desktop open work; disabling access stops tailing, removes remote visibility, and rejects later commands without affecting local work. |
| `T3-API-1` | Real personal and organization Cowork API keys create work, auto-converge stale config/auth, start a session, send a cheap-model prompt, and poll terminal state. Expired/revoked/cross-org and unauthorized org keys create no work; lost response/retry creates one workspace/session/prompt. |
| `T3-GHAPP-1` | A real GitHub App authorization and selected-repository installation lets the Worker mint a short-lived user-to-server lease; clone/fetch/commit/push-dry-run works through the helper. Rotation precedes expiry; repo removal, installation suspend/delete, user-access loss, or revocation blocks later Git with no OAuth fallback/leak. During transient refresh failure the current lease works only to expiry, then Git fails closed; provider recovery rotates without reusing/exposing the old token. |
| `T3-MOBILE-1` | iOS and Android cover fresh auth/link, cloud create and final-looking pending shell, first response, session create/switch/send, blocker recovery, claim/send, config accept/reject, projection fallback, background/network recovery, universal link, Automations, Settings, keyboard/safe area, and relaunch continuity. |
| `T3-MOBILE-2` | On iOS and Android, real Automations list/create/pause/resume/delete and run-to-workspace/session navigation work. Settings shows account/GitHub, organizations/owner scope, supported plan summary, repo/profile defaults, agent readiness, build/support/legal state, and sign-out; auth expiry, refresh, Android Back, keyboard/safe area, and claim failure recover. |

### Agents, sessions, policy, permissions, and MCP

| ID | Required validation |
| --- | --- |
| `T3-CHAT-1` | In the Desktop-local runtime world, every probed, registry-supported, target-compatible harness installs its trusted pin, selects the cheapest eligible real model, completes a bounded turn, and reopens history. Managed cloud and self-host use one representative compatible harness to prove their distinct wiring rather than repeating the harness Cartesian product. Cataloged-but-incompatible entries return truthful typed unsupported/readiness state; every resolved matrix cell is independently required. |
| `T3-AUTHROUTE-1` | In the Desktop-local runtime world, every harness completes one managed-LiteLLM and one user-API-key bounded turn. Managed cloud repeats each route with one representative harness to prove Worker/runtime materialization; self-host proves only routes its deployed posture advertises. Invalid, revoked, or lane-incompatible routes fail closed in deterministic lower tiers. Route choice is frozen per agent process: a setting change affects a new session or explicit process restart, never an existing process in place. |
| `T3-AGENT-1` | Install a missing harness, reinstall/update it from its trusted pin, and switch harnesses inside one workspace without leaking config/credentials; existing sessions remain attached to their original harness. |
| `T3-CFG-1` | Create-time model/mode/defaults derive from the bundled catalog. In an existing session, mutate only controls and values advertised by live ACP, read back exactly, apply on the next turn, and survive reconnect; stale/unknown values fail without mutating state. |
| `T3-SESSION-1` | Queued prompts, config-while-busy, cancel, fork, dismiss/restore, runtime restart, worker restart, and sandbox pause/resume preserve exact event ordering and execute effects at most once. |
| `T3-TRANSCRIPT-1` | Scripted high-volume plus real-agent transcript across Desktop/Web/mobile survives disconnect during batch, background/reopen, older-history paging, and turn completion with every sequence once. Scroll anchor/pinning and streaming-status-to-prose handoff remain stable in virtualized and normal rows. |
| `T3-PLAN-1` | Real agents emit structured todo and proposed-plan events. Plans persist through reload; approve, reject, implement-here, trusted-snapshot attach, and handoff perform exactly their contract without mutating source decision state, leaking content, or duplicating a plan. |
| `T3-POL-1` | Admin narrows route/harness policy; UI and materialization update; new selection, stale selection, on-disk key, existing session, new session, second member, and workflow trigger cannot bypass; widening restores access. |
| `T3-PERM-1` | Every production harness's permission adapter performs a bounded file/shell action: allow-once executes exactly once, deny executes zero times, and allow-always persists only in intended scope. Read-only/plan cannot write; supported bypass completes unattended; unsupported modes fail preflight. Malformed/duplicate/wrong-session resolution and crash/reconnect settle once. |
| `T3-MCP-1` | Each product MCP server and required third-party MCP completes one real read and permitted mutation; capability tokens enforce workspace/session/read-only/expiry/revocation/frozen-target boundaries. |
| `T3-CRASH-1` | Scripted and real-agent process kills at prompt, tool, permission, persistence, and terminal-event boundaries recover without missing/duplicated events or external effects. |
| `T3-BYOK-1` | Personal/organization user API keys materialize only into the explicitly permitted runtime target and bypass managed LiteLLM spend. Unlisted provider/model/key makes zero provider data-plane calls; private/metadata destinations receive zero bytes; unsafe redirects never reach forbidden targets; wrong Bedrock ExternalId performs one denied STS exchange and zero inference. Lifecycle changes remove old materializations and repair orphans. |
| `T3-AGENTAUTH-1` | Synced-file auth revoke, share revoke, profile disable, and selection replacement apply allowlisted cleanup paths, report `applied_cleanup_paths`, and force-restart/fence old sessions where required. Near-expiry grants rotate with bounded overlap; target replacement rematerializes; failed cleanup/apply remains unapplied and blocks launch without deleting unallowlisted paths. |
| `T3-RUNTIMECFG-1` | In cloud, install a plugin with MCP/skill children: Server compiles, Worker fetches hash-pinned artifacts/materializes credentials, AnyHarness resolves, and a real agent uses both. In Desktop-local, the same compiled intent applies directly to AnyHarness without a Worker. Restart re-resolves safely; disable/revoke removes capability before launch; no legacy bundle bypass exists. |
| `T3-MODELREG-1` | Dynamic discovery refreshes locally and Cloud-to-Worker-to-runtime; Web/mobile/Slack see the same scoped list. Alias resolves to the exact live id, stale online refreshes, stale offline fails explicitly, workspace-scoped models do not leak, and harness update invalidates the snapshot. |
| `T3-SUBAGENT-1` | Subagents MCP covers catalog launch options, create with prompt/config, busy-child queued send, atomic wake-on-completion, one parent wake, status/list/latest-turn/search, close, and descendant cascade. Token/handle isolation, completion race, restart, lost response, and replay produce no duplicate child/prompt/wake. |
| `T3-COWORK-1` | Cowork creates a managed workspace and multiple scoped agents, sends/reads/wakes/closes, opens the correct child UI, and preserves parent relationship. Limits, wrong scope, nested-cowork denial, restart, and lost response create no duplicate. Closing hides the relationship and ends active delegated work but never deletes the managed directory, durable history, or transcript. |
| `T3-REVIEW-1` | Plan/code review sessions expose only reviewer authority and finish only through one submitted result; multiple results aggregate into durable artifacts once. Parent feedback/revision/finish, retryable reviewer failure, stale result, active delete, reload, and parent revision preserve run identity and a commandable parent. |
| `T3-ARTIFACT-1` | Markdown, HTML, SVG, JSX, and TSX artifact create/list/get/update/delete preserve stable ids, safe paths, types, sorted manifest, renderer, protection, and one turn-end commit. Read-only/wrong-scope tokens, unsupported paths/types, traversal, duplicates, and commit failure leave zero partial mutation. |
| `T3-DELEGATE-UI-1` | In packaged Desktop, live subagent, Cowork, plan-review, and code-review work agrees across tabs, Agents popover, sidebar, transcript receipts, and details. Canonical identity/status, contiguous hierarchy, breadcrumb, attention filtering, close-tab versus end-work confirmation, reload, and transcript retention hold. |
| `T3-ARTIFACT-2` | Thread open, turn end, and manual refresh fetch the normalized artifact manifest; HTTP detail selects the correct renderer for every type, unknown id returns 404, and missing/invalid backing file returns 409. Clients never parse or mutate the manifest themselves. |

### Worker, supervisor, isolation, and packaged runtime

| ID | Required validation |
| --- | --- |
| `T3-WORKER-1` | Enrollment, inventory, control polling, runtime-config/agent-auth/exposure/revocation reconcile domains, content-hash readback, heartbeat, and lost-doorbell recovery converge exactly once without owning command delivery or event-tail semantics. |
| `T3-WORKER-2` | Atomic private materialization rejects root escape, traversal, symlink/special-file and unsafe-archive attacks; a kill mid-write leaves a complete old or new state and no token enters git URLs, inventory, events, or logs. |
| `T3-WORKER-3` | Repeated failure in one reconcile domain backs off without hot-looping; siblings and unrelated commands continue, dependent commands fail fast, applied state advances only after runtime readback, and a new revision/provider recovery resumes without duplicate apply. |
| `T3-SUP-1` | Supervisor stays alive through child failure: Worker exit restarts Worker only; AnyHarness exit kills/waits Worker and restarts both in dependency order. Identity, revisions, cursors, pending results, workspace, and session recover without duplicate work; a second Worker process is rejected by the process lock. |
| `T3-ISO-1` | Adversarial agent shell cannot read/write runtime home, SQLite, credential vault, private callbacks/sockets, leases, checkpoints, control-process environment/memory, or signal/ptrace control processes; unsupported isolation fails preflight. |
| `T3-ISO-2` | One tenant's sandbox cannot access another tenant's filesystem/materialization or target auth. In unattended workflow/bypass isolation, repo config cannot override protected provider/base-url/key settings and control listeners/cloud metadata are reachable only through authenticated brokered channels; unsupported isolation fails preflight. |
| `T3-CMD-1` | Against a paused sandbox, wake-required commands persist before one wake and the full workspace/session family leases/delivers in order once. Worker/Cloud loss after local acceptance uploads one saved result; archived reports are inert. Exposure tailing owns inactive-drop and contiguous cursor/gap/backfill repair before live tail resumes. |
| `T3-DESKTOP-1` | Packaged native Desktop locates and authenticates bundled sidecars, hydrates seeds, completes a local real-agent turn, and preserves auth/runtime/workspace/session across quit/relaunch. |
| `T3-TEMPLATE-1` | The exact immutable candidate template reports expected runtime/worker/supervisor versions and checksums, contains catalog pins, enrolls successfully, and completes one throwaway real session before a rolling tag moves. |
| `T3-SDK-1` | Published `@anyharness/sdk` dynamically covers every curated public resource group—including runtime, agents/readiness/install, workspace/session, file/git/terminal, processes, hosting, and pull requests—plus SSE reconnect and typed errors; transcript reduction is replay-stable. `@anyharness/sdk-react` invalidation and forward-field tolerance need no app fallback. |

### Secrets, integrations, and notifications

| ID | Required validation |
| --- | --- |
| `T3-SEC-MAT-1` | Personal/organization/workspace environment secrets and supported personal/workspace text-file secrets materialize to correct scopes; update/delete propagates within budget; manifests match; another user/workspace cannot read them. Binary secret-file upload remains rejected. |
| `T3-SEC-2` | Rotate/delete while paused and while a session is live; only the new value reaches future permitted work, old processes cannot retain it, failed apply remains blocked/retryable, and no transcript, support artifact, telemetry, log, or crash output contains plaintext. |
| `T3-INT-1` | Every harness in the Desktop-local runtime world calls one real API-key integration through Product MCP. Managed cloud repeats the positive call with one representative harness to prove cloud materialization without duplicating the Cartesian product. Audit records exact provider/tool/outcome; deterministic lower tiers own disable/revoke and zero-upstream-call failure matrices. |
| `T3-INT-2` | OAuth/hosted-MCP integration authorization, refresh, expiry, revocation, reconnect, and organization policy work through a real provider test account. |
| `T3-INT-3` | Provider timeout, 429, 401/reauth, malformed response, partial failure, credential rotation, worker re-enrollment, and provider recovery produce typed errors, isolate sibling calls, invalidate caches, and retry at most once externally. |
| `T3-NOTIFY-1` | A real email and Slack notification is delivered once with the correct sanitized content; retry, replay, and post-acceptance crash create no duplicate. |
| `T3-SLACK-1` | Real Slack OAuth/config, signed mention, sub-three-second ack, one shared-unclaimed workspace/session/prompt, cheap-agent result, and sanitized same-thread reply complete. Duplicate/ambiguous/429/revoke/reauth/crash paths do not duplicate; disallowed channel creates zero work; after claim, claimer follow-up reuses the session while non-claimer creates zero prompt and receives the claimed-work error. |
| `T3-SUPPORT-1` | Packaged Desktop uploads message/attachments and bounded local/authorized-cloud diagnostics through real private presigned S3 targets. Expiry resumes the same job; completion, Slack, GitHub, and optional Linear effects occur once; privacy/encryption/retention, no-wake, public consent, correlation, and content/secret redaction hold. |

### Billing golden lifecycle

The Tier 3 billing rows share one run-scoped lifecycle but report independent
results. Setup may move test clocks or seed a deliberately tiny grant; the
money movement, provider delivery, metering, gates, and recovery under test
are real.

| ID | Required validation |
| --- | --- |
| `T3-BILL-1` | A fresh GitHub-backed personal identity receives one lifetime `$2` managed-LLM grant across concurrent/replayed enrollment and cross-account attempts. A real LiteLLM turn debits the exact imported USD cost; a real user-key turn debits nothing. |
| `T3-BILL-2` | Real Core Stripe test checkout activates only after verified payment at `$20` per active billed seat. Seat add/remove/re-add and proration produce exactly `$5` managed-LLM plus `$15`-equivalent compute allocation per billed seat; Stripe, portal, product UI, and ledgers agree. |
| `T3-BILL-3` | Real organization-member LiteLLM turns and a real E2B running interval debit their separate shared organization pools while retaining correct member attribution. Personal grants remain unchanged; LiteLLM spend logs, imported LLM events, E2B segments, and compute ledger reconcile exactly. |
| `T3-BILL-4` | Test-clock renewal, payment failure, dunning recovery, voluntary/immediate cancellation, and webhook replay transition subscription and period grants identically. Only a paid invoice creates one per-seat grant in each ledger; finalized, failed, open, or uncollected invoices grant nothing. |
| `T3-BILL-5` | Managed-LLM exhaustion disables or rejects the scoped LiteLLM key and blocks existing/new managed turns with a typed error, but does not pause E2B. No charge or grant occurs when LLM auto-top-up is disabled; a valid user API key remains usable. |
| `T3-BILL-6` | Explicit LLM auto-top-up is independent from compute overage/top-up. Crossing its threshold creates at most one Stripe payment attempt; successful payment grants once, rematerializes/reactivates the scoped key, and permits a real managed turn. Decline grants nothing, remains blocked, preserves user-key use, and cannot charge-storm. |
| `T3-BILL-7` | Compute exhaustion creates the owned hold and pauses/blocks real E2B without changing LLM credit. Direct create/ensure/resume/wake, stale session, forced provider resume, old token, second member, workflow, and automation cannot bypass the gate; provider-side resume is re-paused. |
| `T3-BILL-8` | A successful compute top-up or paid Core renewal grants compute once, clears the applicable hold, genuinely wakes E2B, and preserves repository/workspace/session/filesystem state. Failed or uncollected payment grants nothing. Compute recovery never refills LLM credit, and LLM recovery never clears a compute hold. |
| `T3-BILL-9` | Compute overage bills exact cents to the configured per-seat cap, then writes off and blocks without overcharge. Enabling compute overage never authorizes an LLM top-up, charge, or grant. |
| `T3-BILL-10` | Delay/drop/replay real E2B, LiteLLM, and Stripe callbacks; restart server, reconciler, Worker, and usage importers; overlap spend-log pages and materialization drift. Provider polling and repair converge, every interval/log/payment/grant imports once, held sandboxes re-pause inline, and no receipt/export/cursor stays stuck. |
| `T3-BILL-11` | Concurrent sandboxes/virtual keys spend the same nearly exhausted personal or Core organization pool. Usage stays within its configured budget plus only an owning-spec-defined evidenced in-flight allowance; all keys/gates converge, a later launch fails before scheduling, every event imports once, and personal/organization plus LLM/compute balances remain isolated. An undefined allowance fails qualification. |

### Workflows and automations

The strict workflow matrix is additive: each row must produce durable run,
step, receipt, audit, and external-effect evidence. Denial is proven by zero
upstream calls, never by agent prose.

| ID | Required validation |
| --- | --- |
| `T3-WF-1` | UI author/launch, strict emit schema, corrective retry, deterministic branch, and required-invocation receipt reach a terminal run. |
| `T3-WF-2` | Allowed function call captures schema-valid arguments once; denied call records scope denial and makes zero upstream requests. |
| `T3-WF-3` | Connected-but-ungranted integration is absent from listing, forced call is denied, and zero provider traffic occurs. |
| `T3-WF-4` | Sequential slot reuse and parallel dirty-state fork/lane work/merge/join preserve lane-qualified state and downstream visibility. |
| `T3-WF-5` | Poll `/init`, item-to-input delivery, exactly-once cursor advancement, invalid item handling, failure recovery, and replay safety work end to end. |
| `T3-WF-6` | Cloud schedule fires within budget, queue drains FIFO, every missed-run policy holds, and duplicate scheduler ticks create no duplicate run. |
| `T3-WF-7` | Desktop schedule claim, heartbeat, execution, relay, terminal completion, lost response, and reclaim are exactly once. |
| `T3-WF-8` | Workflow agent listing and messaging respect run/session scope and persist messages exactly once across reconnect. |
| `T3-WF-9` | Bound-session lockout covers every mutation; acknowledged takeover quiesces the prior owner before releasing the binding. |
| `T3-WF-10` | One real Slack notification survives post-acceptance crash/retry and is reconciled exactly once. |
| `T3-AUTO-1` | Personal and organization manual/scheduled automations converge stale config/auth, create one workspace/session/prompt, complete a cheap real-agent turn, preserve the frozen config, and enforce private/shared exposure; disabled or policy-blocked automations create no work. |
| `T3-AUTO-2` | Packaged Desktop claims, heartbeats, executes, and relays a local scheduled automation once; kill/relaunch after claim resumes or fails the same run durably without a second workspace/session/prompt. |

### Self-hosted and operational product paths

| ID | Required validation |
| --- | --- |
| `T3-SH-1` | Production compose cold boot over real TLS/DNS, claim, invite, registration, login, workspace, and one real agent turn. |
| `T3-SH-2` | Native Desktop connects to server A, stores credentials in the keychain, relaunches, switches to B, and cannot leak A credentials or state. |
| `T3-SH-3` | Optional gateway profile boots and completes a real cheap-model turn; base install remains commandable without hosted capabilities. |
| `T3-SH-4` | `/meta`, `/health`, advertised auth methods, support, pricing, versions, and capabilities match the real deployed posture. |
| `T3-SH-5` | Self-host cloud-sandbox add-on with its GitHub App, E2B key, and self-built immutable template configures a repo, provisions one workspace, completes a real turn, and pauses/wakes with state intact; disabling the add-on leaves the base installation healthy and truthful. |
| `T3-OBS-1` | Core journeys emit required audit/usage/correlation records, redact secrets and user content as specified, and produce enough identifiers for support diagnosis. |

## Tier 4 required manifest

Tier 4 boots kept N-1 artifacts and data, then exercises the shipped upgrade
mechanism to N. The standing core is `T4-DESKTOP-1` plus `T4-RUNTIME-1`, with
the applicable `T4-CATALOG-1` assertions composed into both rather than run as
a third live world. [`tier-4-scenario-contract.md`](tier-4-scenario-contract.md)
owns their exact artifact, fixture, action, and evidence contract.

Every other row below is mandatory when its trigger changed. Nightly may run
the broadest implemented compatibility set, but the table does not create 27
always-on deployed worlds or require unrelated permutations. Public artifact
integrity remains an every-release gate without becoming a third upgrade world.

| ID | Trigger | Required validation |
| --- | --- | --- |
| `T4-WORKER-1` | Worker artifact or update protocol changes | N-1 Worker observes desired N, writes the atomic mailbox request, and stays out of download/swap/restart ownership. Supervisor consumes the mailbox, downloads/verifies and atomically swaps Worker N, restarts it, health-gates convergence, and rolls back to last-good on corrupt or unhealthy N. Identity, cursors, pending results, and a live session survive. |
| `T4-RUNTIME-1` | Standing core when AnyHarness/runtime artifacts are promoted | A sandbox from the exact retained production N-1 E2B template completes a turn while its target-scoped desired version remains N-1. After only that target changes to exact candidate N, Worker writes the atomic mailbox request rather than activating it; Supervisor verifies/stages and swaps AnyHarness N, restarts in dependency order, health-gates N, and rolls back on failed activation; AnyHarness reconciles installed agents from N's bundled inputs. Worker state and the completed durable session remain commandable, event sequence stays monotonic, and a post-update turn succeeds. |
| `T4-SUPERVISOR-1` | Supervisor artifact, config, install layout, service, mailbox, or update-staging changes | N Supervisor consumes Worker-authored component mailbox requests, verifies and privately stages artifacts, rejects invalid component/path/size/checksum, swaps/restarts/health-gates Worker and AnyHarness in dependency order, and rolls either component back to last-good. Managed-cloud and SSH-generated service/config layouts provide the explicit child environment. Supervisor self-upgrade activation remains a separate unclaimed mechanism until its owner is specified and tested. |
| `T4-CATALOG-1` | Bundled catalog, trusted registry, agent pins, installer, or reconciliation changes | Embedded in both standing worlds rather than a third live world: N AnyHarness contains the N bundled catalog and trusted registry inputs; installed-only reconcile verifies sources/pins, updates naturally drifted managed native CLIs and ACP agent processes, preserves sessions, and leaves equal pins alone. No server-pushed catalog becomes a trusted runtime input. |
| `T4-MODELREG-1` | Model catalog, registry, alias, visibility, or saved-intent changes | N-1 saved intents, aliases, snapshots, visibility overrides, Automation defaults, and Slack defaults resolve under N without silent model-class substitution. Renames canonicalize; removed/unavailable models surface repair or only the explicitly stored fallback. |
| `T4-RUNTIMECFG-1` | MCP/skill/plugin schema, compiler, manifest, artifact, or launch-contract changes | N-1 configured items, publicization, revisions, artifacts, and OAuth state upgrade and recompile idempotently; Worker applies and existing sessions relaunch with intended tools. Secrets stay absent, lazy resolution survives restart, and no legacy bundle path reactivates. |
| `T4-SEED-1` | Desktop agent seed, launcher, or bundled agent resources change | Seed-owned unchanged/missing artifacts upgrade or repair; user-owned or modified artifacts remain untouched; unsafe archive/checksum/target fails; launchers resolve the final runtime home. |
| `T4-DESKTOP-1` | Standing core when Desktop artifacts are promoted | A disposable copy of the exact retained production N-1 Desktop with real sidecars/seed completes a turn, then discovers, verifies, installs, and actually relaunches the exact signed candidate N from an isolated feed without moving public stable. Bundled runtime/worker identities and installed native/ACP agent pins converge to N; the same runtime home, auth, workspace, completed session, and transcript persist; a post-update turn succeeds. |
| `T4-MOBILE-1` | Native mobile release, storage, auth, or deep-link changes | N-1→N preserves secure auth and navigation state, applies storage migrations, and still completes login/deep-link/chat on supported platforms. |
| `T4-DATA-1` | Alembic, SQLite, event, catalog, or persisted-contract changes | Kept N-1 Postgres, AnyHarness SQLite, and Worker SQLite migrate forward once and repeatedly idempotently. Realistic product rows plus Worker identity, applied revision/backoff state, upload cursor/gap state, exposure cache, command-result outbox, and pending reconciliation remain readable and commandable. |
| `T4-MOBILITY-1` | Mobility schema, executor, exposure, or cleanup changes | Upgrade moves in preparing, transferring, pre-cutover, cleanup-pending, cleanup-failed, and repair-required states. N preserves canonical side/attestation, never repeats import/cutover, fences N-1 reports, resumes each cleanup item once, and leaves no orphan exposure/projection/cursor. |
| `T4-DELEGATE-1` | Session-link, subagent, Cowork, review, wake, or prompt-policy changes | Upgrade while children/reviewers run, messages queue, wakes arm, a review is partially submitted, and a Cowork workspace is active. Handles, provenance, cursors, prompts, results, hierarchy, and closure survive; each queued effect occurs once and old tokens cannot widen scope. |
| `T4-COWORKART-1` | Artifact manifest/domain/MCP/HTTP/rendering changes | N reads N-1 manifests for every supported type and old Cowork aliases while preserving ids, paths, metadata, files, git history, and protection. New routes and atomic mutations work; malformed/partial old manifests fail visibly without rewriting user files. |
| `T4-SLACK-1` | Slack schema, Worker, OAuth, event, or outbound queue changes | Upgrade an active connection/thread with claimed inbound work, accepted/queued outbound work, and a rate-limit retry. Config and mappings persist, replay creates no second work, accepted messages are not resent, and N drains retryable work with the same idempotency keys. |
| `T4-SUPPORT-1` | Desktop support job, server report, S3 manifest, or tracker schema changes | An N-1 queued/partial report survives N; compatible defaults apply, local upload resumes, targets refresh without object-set conflict, and completion/Slack/GitHub/Linear effects occur once while privacy/correlation/redaction remain intact. |
| `T4-TEMPLATE-1` | E2B image, bootstrap, runtime, Worker, or agent seed changes | New sandboxes use the N immutable template. An existing paused N-1 sandbox wakes on its existing image with data intact; only separately supported Worker/runtime/catalog mechanisms may converge in place. Rolling-tag movement affects new sandboxes only. |
| `T4-ROLLING-1` | Server/API/Worker/runtime deployment order changes | Supported mixed-version rollout orders preserve health, command/event continuity, and in-flight work while components drain/restart; rollback returns to the last-good operational set. Wire-shape compatibility belongs to `T4-CONTRACT-1`. |
| `T4-CONTRACT-1` | AnyHarness/OpenAPI/SDK/event/Worker wire contract changes | N-1 SDK/Desktop/Worker with N peers and N clients with supported N-1 peers complete workspace/session/stream flows. Empty resume bodies, optional fields, unknown events, enum/error casing, generated artifacts, and reducers remain compatible; unsupported breaks fail explicitly instead of corrupting or misrouting. |
| `T4-DISPATCH-1` | Cowork API key, exposure, live stream, or deep-link contract changes | N-1 Desktop/Web/mobile and API keys remain within the supported N server window; exposure and SSE resume without lost/duplicate patches, revoked keys stay revoked, auto-cascade converges once, and deep links retain workspace/session identity after client upgrade. |
| `T4-CREDENTIAL-1` | Auth, secret, integration, keychain, or materialization schema changes | Existing native/provider auth, LiteLLM/agent-auth keys, integrations, and secret materializations survive or rotate through upgrade without plaintext leakage or stale authorization. |
| `T4-GHAPP-1` | GitHub App auth, Worker lease, helper, or repository-authority schema changes | N-1 encrypted authorization/install/cache and active lease metadata migrate; N refreshes and Git fetch succeeds. Revoked/expired authority stays revoked, old token files stop working, and no product-OAuth fallback appears. |
| `T4-BILL-1` | Billing, managed-credit, LiteLLM-materialization/importer, accounting, webhook, price, meter, or entitlement schema changes | N-1 subjects/subscriptions/grants/segments/holds/receipts/exports/remainders/limits plus allocation guard, `AgentGatewayBudgetSubject`, `AgentGatewayFreeCreditEntitlement`, `SandboxAgentAuthSelection`, LiteLLM materialization/usage/import cursor, auth revision, encrypted key references, and audit rows upgrade with conservation intact; new and replayed N-1 events process once. |
| `T4-BILL-2` | Server, worker, runtime, template, or billing reconciler changes | Checkout, billed sandbox interval, LiteLLM request/spend-log import, compute meter export, and webhook in flight across N-1→N produce no lost/duplicate charge, grant, debit, log, or export. Import cursor and scoped key state survive; desired-state key replacement is atomic and no provider/admin secret leaks. |
| `T4-BILL-3` | Stripe catalog or public billing artifact changes | Historic N-1 subscriptions continue renewal, seats, cancellation, overage, and replay under N while new checkout uses the N test catalog; account mode, currency, prices, meter names, webhook endpoint, and API version are verified before promotion. |
| `T4-BILL-4` | Desktop, SDK, billing envelope, SSE, or typed-error changes | N-1 Desktop/SDK against N server, then upgraded N client, can read plan/usage/hold envelopes, consume billing patches, open Checkout/Portal, and handle typed denials. Additive fields remain compatible and a stale client cannot bypass a new server-side gate. |
| `T4-SELFHOST-1` | Self-host bundle, compose, migration, or update script changes | Production N-1 updates to N over real TLS and preserves data/auth/config through success plus injected image-pull, migration/restart, and post-update-health failures. N is never reported healthy early; N-1 stays recoverable; retry converges without reopening setup or duplicating effects; a post-update agent turn succeeds. |
| `T4-ARTIFACT-1` | Every public release | Server redirects, CDN trees, manifests, signatures, checksums, tags, platform artifacts, versions, and immutable SHA lineage agree before any rolling tag or stable feed moves. |

## Qualification evidence

Trusted CI emits one immutable qualification artifact containing:

- merged SHA, trusted workflow/run identity, and required-manifest hash;
- server, Web, Desktop, mobile, runtime, worker, and self-host artifact digests;
- E2B template immutable reference and content hash;
- Supervisor version/digest, bundled agent-catalog hash, trusted-registry hash,
  generated OpenAPI/SDK artifact hashes, Alembic revision, and distinct
  AnyHarness/Worker SQLite schema revisions;
- every required scenario id, lane, status, duration, attempt, and correlation
  id;
- sanitized Stripe, E2B, LiteLLM provider/key/spend-log,
  router-materialization, budget-subject, free-entitlement, and import-cursor
  identifiers plus repository, integration, and notification fixture ids;
- separate compute-conservation and managed-credit-reconciliation results;
- zero non-green final-result counters, superseded attempt history, and the
  cleanup result.

Production promotion verifies the evidence signature/attestation, repository,
workflow identity, `main` ref, SHA, manifest hash, and artifact identities.
User-supplied JSON or evidence from a different SHA is never accepted.

Blind retries that may repeat an external effect are forbidden. After a
timeout or lost response, the scenario reconciles provider state first; any
retry uses the same correlation and provider idempotency key. A fresh,
full-scenario rerun may replace an infrastructure-failed attempt on the same
artifacts, but both attempts remain in the evidence and the replacement uses a
new run-scoped world. Sharding may change execution time but cannot change the
required manifest or allow a partial aggregate to pass.

## Traceability and change control

The machine-readable target inventory and this document contain the same
scenario ids; CI enforces that equality, uniqueness, tier counts, local link
integrity, and explicit implementation state. Target presence never counts as
execution. A row may remain `planned`; a row marked `collected` or `enforced`
must name its concrete collector, collected test id, required cells, lanes,
gate, and evidence status, and CI validates that mapping. Full qualification additionally requires
an execution manifest that validates that:

- every required id has a collected test implementation;
- every required lane is present exactly once;
- the owning workflow invokes it in strict mode;
- no required test contains an unconditional skip, expected-fail, or
  environment-based green escape;
- every generated collector pointer exists; and
- every collected Tier 2/3/4 core scenario maps back to one id here.

A product change that adds a supported plan, provider, auth route, harness,
model, mode, tool, workspace type, trigger, billing transition, cloud-command
kind, runtime-config/plugin expansion kind, SDK public resource group, GitHub
App webhook/lease contract, or upgrade mechanism updates this contract, its
machine-readable manifest, and the enforcing test in the same PR.

## Legacy Collector ID Migration

Current collectors predate the target manifest. Until the bidirectional
collector audit is implemented, they must be ported through this table rather
than copied or treated as target coverage by name.

| Legacy claim | Canonical destination |
| --- | --- |
| legacy `T2-SH-1` connect/switch | Retire the Tier 2 claim; native connection is composed by `SH-DESKTOP-OWNER` and `SH-SWITCH-ISOLATION` under `T3-SH-2`/`T3-SH-4`. |
| legacy `T2-SH-2`, `T2-SH-3`, `T2-SH-4` | Fold claim, invite/register, and adaptive-auth collectors into canonical `T2-SH-1`. |
| legacy `T2-SH-5` | Rename the live `/meta` capability collector claim to canonical `T2-SH-2`. |
| legacy `T2-SH-6` | Reclassify partial-E2B safety as one cell of canonical `T2-SH-3`. |
| legacy `T2-SH-7` | Split incomplete-SSO truth into `T2-SH-3`/`T2-AUTH-5`; gateway eligibility becomes canonical `T2-SH-4`. |
| legacy `T3-GW-1` | Retire the guarantee ID and audit its real gateway collector beneath `LOCAL-2`, contributing to `T3-CHAT-1`, `T3-AUTHROUTE-1`, and the managed-spend cell of `T3-BILL-1`. |
| legacy `T3-UPDATE-1` | Split steady-state install/catalog proof into `T3-AGENT-1`/`T3-MODELREG-1`; real N-1→N behavior belongs to `T4-RUNTIME-1` with `T4-CATALOG-1`. The old server-pushed catalog model is not trusted input. |
| old `T3-SH-1` through `T3-SH-4` | Keep the canonical IDs only after expanding their partial collectors across the `SH-*` journeys. Name equality alone is not coverage. |
| old `T3-SH-5` adaptive sign-in | Move the collector under `T3-SH-4`. Canonical `T3-SH-5` now means the self-host cloud/E2B add-on; this semantic collision must not be auto-renamed. |
| legacy `T4-CLOUD-1` | Rewrite, not merely rename, as `T4-RUNTIME-1` plus `T4-CATALOG-1` using target-scoped desired state, Worker mailbox, and Supervisor activation. |
| legacy `T4-SH-1` | Audit the success collector beneath change-triggered `T4-SELFHOST-1`; do not infer N-1 by patch decrement. |
| legacy `T4-SH-2` | Audit the HTTP/CDN collector beneath every-release `T4-ARTIFACT-1`. |
| legacy `T3-FIXTURE`, `T3-EXAMPLE`, `T3-A`, `T3-B` | Fixture/reporter test data, not guarantees. Rename outside the `T[234]-*` production namespace before registry auditing. |

## Current enforcement exception

Current main is materially fail-open and no current run may claim qualification
from this contract:

- both Tier 2 workflow jobs use `continue-on-error`; the billing job skips all
  billing specs when `STRIPE_TEST_SECRET_KEY` is absent;
- every Tier 3/4 workflow job is advisory, and whole-lane preflights can skip
  cleanly when credentials or public infrastructure are absent;
- the release runner converts missing dependencies, explicit blocked errors,
  and expected failures into a successful process exit when no ordinary error
  was thrown; some matrix scenarios also swallow individual harness failures;
- only red scenarios write structured reports, so green, blocked, missing, and
  expected-fail cells have no immutable aggregate evidence;
- production promotion validates staging deployment evidence but does not
  invoke or verify Tier 3/4 qualification evidence;
- hosted Web is not booted by the existing Tier 2 world;
- the Tier 4 Desktop and cloud update journeys cannot qualify in CI today; and
- canonical agent-auth primitive docs still describe Bifrost as the managed
  data plane even though the settled target is LiteLLM only. Those product
  specs and owning code must be reconciled before their collectors can be
  audited; the stale Bifrost contract does not override this target; and
- product billing constants still encode the prior `$5` free managed-LLM grant
  and twenty managed-cloud hours per seat rather than the settled `$2` free and
  Core `$5 LLM + $15 compute` allocation.

The foundation closes these gaps in this order:

1. restore this target contract and bind composed journeys into the target
   manifest;
2. add collector metadata and bidirectional manifest/collection audits;
3. always emit per-cell run summaries with candidate and world identity;
4. add strict runner behavior and make missing Stripe credentials fail trusted
   CI;
5. wire exact-SHA qualification evidence into production promotion;
6. build and validate each world foundation as a vertical slice; and
7. fan out scenario implementation and bug fixing in parallel, ratcheting the
   enforced baseline upward until every core cell is required.

`continue-on-error` may remain only on explicitly diagnostic callers during
the migration. It is never allowed on a job or matrix cell whose output is
consumed as merge, promotion, updater-feed, template-tag, catalog, or runtime
qualification evidence.
