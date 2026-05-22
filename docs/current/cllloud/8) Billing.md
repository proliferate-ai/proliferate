## High level model

Billing consumes usage facts from cloud running and agent gateway. It should not
own runtime implementation. It does own the entitlement decision and the durable
block state that tells cloud running whether a sandbox may create, resume, or
connect.

V1 billing decisions:

- no overage billing for included LLM credits;
- cloud compute overages can exist, but only for paid orgs that explicitly
  enable them;
- managed credits are hard-capped;
- sandbox/compute usage is metered for plan limits and cost visibility;
- paid plans can increase included credits and compute limits;
- when limits are hit without overages enabled, pause/fail closed instead of
  silently charging.

The most important implementation rule:

```text
LLM credits can be delegated to LiteLLM for hard enforcement.
Compute credits cannot be delegated to E2B webhooks alone.

Proliferate must maintain its own sandbox-slot state, compute usage period, and
provider reconciliation. E2B auto-pause/auto-resume saves money, but Cloud still
owns the entitlement gate and wake orchestration.
```

## Product Packaging

The product motion should feel simple from the user's perspective:

```text
Free
  "I can try the cool stuff."
  personal account
  GitHub-authenticated identity
  mobile/Dispatch
  limited managed cloud
  BYO native/synced auth
  1 SSH target
  unlimited automation definitions
  unlimited plugins/connectors

Team
  "I want to bring my team."
  org/team workspace
  Slack integration
  shared cloud sandbox
  team automations
  shared MCPs/skills/plugins
  shared synced auth with owner consent
  included managed LLM credits
  included cloud compute allowance
  optional explicit cloud compute overages

Enterprise
  "I need custom deployment/security/procurement."
  self-hosted/private deployments
  custom models
  gateway BYOK where LiteLLM Enterprise or equivalent isolation is available
  SSO/audit/retention/security review
  automation engineering / implementation support
```

Do not make Free feel blocked from core workflows. Free should let a user try
cloud, automations, plugins, and mobile without talking to sales. The limits
should be usage and collaboration limits, not product-discovery gates.

Free is still abuse-sensitive because it includes managed compute and managed
LLM credits. Treat GitHub auth as the first eligibility gate:

```text
Free cloud eligibility:
  user has a Proliferate account
  user has a linked GitHub identity
  GitHub identity has a stable provider user id
  user has accepted cloud terms
  user has not already consumed a free managed-cloud allocation on that
    GitHub identity

Optional later hardening:
  verified email
  account-age / abuse-score check
  payment method before higher limits
  org-domain verification for team trials
```

Do not key the free allocation only by Proliferate user id. The durable abuse
key should include the GitHub provider user id because users can create new
Proliferate accounts faster than they can create credible GitHub identities.

Free plan entitlements should be concrete and hard-capped:

```text
Free personal subject
  personal_sandbox_slots = 1
  shared_sandbox_slots = 0
  cloud_concurrency_limit = 1
  included_compute_seconds = finite monthly/trial amount
  compute_overage_allowed = false
  included_llm_credit_usd = finite monthly/trial amount
  llm_overage_allowed = false
  ssh_target_limit = 1

When exhausted:
  managed LLM credits -> gateway returns credits_exhausted
  managed compute -> pause running sandbox, deny new create/resume/connect
  local/SSH/BYO native auth -> still usable where user supplies resources
```

That keeps the free experience generous while bounding the two real COGS
surfaces: E2B runtime and Proliferate-owned LLM provider spend.

The main upgrade moment is team collaboration:

```text
user wants Slack
user wants team automations
user wants shared sandbox
user wants org/shared credentials/config
user wants more managed cloud usage
  -> upgrade to Team, optionally with trial
```

Use "unlimited" only for logical/configuration things whose marginal cost is
near zero:

```text
safe to call unlimited:
  automation definitions
  plugin/connector configuration
  local/SSH work where user supplies compute
  worktrees/sessions inside the included sandbox subject to pruning/storage

not safe to call unlimited without qualification:
  always-on managed cloud compute
  concurrent managed sandboxes
  managed LLM credits
  storage/retention forever
```

If marketing says "unlimited cloud", the product definition should be:

```text
unlimited cloud workspaces/worktrees inside included sandbox slots
bounded sandbox slots:
  1 personal sandbox per user
  1 shared sandbox per org
usage governed by hibernation, concurrency, storage, and overage policy
```

That keeps the user-facing promise generous while bounding COGS.

## UI

Plans show:

- included managed LLM credits;
- cloud compute/sandbox allowance or limits;
- shared sandbox/team features;
- automations/Slack availability;
- what happens when limits are exhausted.

Usage page shows:

- managed LLM credit remaining;
- cloud sandbox hours/active sandboxes;
- recent automation/Slack/cloud runs;
- limit reset date;
- actions to upgrade, or to add BYOK credentials only where BYOK is enabled.

## DB models + schemas

```text
billing_subject
  id
  subject_kind: user | organization
  user_id
  organization_id
  plan_id
  status

subscription
  id
  billing_subject_id
  provider: stripe
  provider_subscription_id
  status
  current_period_start
  current_period_end

plan_entitlement
  plan_id
  included_llm_credit_usd
  llm_overage_allowed
  managed_cloud_allowed
  shared_cloud_allowed
  automation_allowed
  slack_allowed
  ssh_target_limit
  personal_sandbox_slots
  shared_sandbox_slots
  included_compute_seconds
  compute_limit_seconds
  compute_overage_allowed
  compute_overage_requires_opt_in
  cloud_concurrency_limit

free_cloud_allocation
  id
  user_id
  github_provider_user_id
  billing_subject_id
  allocation_kind: personal_free | team_trial
  period_start
  period_end
  status: active | exhausted | closed | revoked
  unique(github_provider_user_id, allocation_kind, period_start)

billing_overage_policy
  id
  billing_subject_id
  compute_overage_enabled
  monthly_spend_limit_usd
  current_period_spend_usd
  status: active | disabled | limit_reached

compute_rate_card
  id
  provider: e2b
  sandbox_shape_key
  cpu_count
  memory_mb
  disk_size_mb
  provider_cost_per_second_usd
  customer_price_per_second_usd
  effective_at
  retired_at

llm_credit_period
  id
  billing_subject_id
  period_start
  period_end
  included_budget_usd
  litellm_team_id
  status: active | exhausted | closed

sandbox_slot
  id
  billing_subject_id
  slot_kind: personal | shared
  provider: e2b
  provider_sandbox_id
  state: not_created | creating | running | pausing | paused | blocked | error |
    killed
  lifecycle_on_timeout: pause | kill
  lifecycle_auto_resume
  provider_timeout_seconds
  running_started_at
  last_checked_at
  blocked_reason
  retention_kill_after

compute_subject_period
  id
  billing_subject_id
  period_start
  period_end
  included_compute_seconds
  included_compute_seconds_used
  overage_seconds_used
  included_cost_used_usd
  overage_cost_used_usd
  status: active | exhausted | closed

compute_usage_segment
  optional audit/overage table
  id
  billing_subject_id
  target_id
  workspace_id
  e2b_sandbox_id
  sandbox_shape_key
  compute_rate_card_id
  started_at
  ended_at
  measured_seconds
  billable_seconds
  provider_cost_usd
  overage_amount_usd
  status: open | closed | reconciled | disputed
  close_reason: stopped | paused | killed | timeout | reconciled_missing |
    limit_exceeded | provider_error
  provider_event_id
  idempotency_key

compute_runtime_block
  id
  billing_subject_id
  target_id
  reason: compute_credits_exhausted | spend_limit_reached |
    payment_failed | metering_unhealthy | abuse
  blocks_create
  blocks_resume
  blocks_connect
  created_at
  cleared_at

sandbox_pause_request
  id
  sandbox_slot_id
  billing_subject_id
  target_id
  provider_sandbox_id
  reason: compute_credits_exhausted | spend_limit_reached |
    admin_requested | idle_timeout | payment_failed | abuse
  status: queued | in_progress | succeeded | failed | escalated_to_kill
  attempt_count
  next_attempt_at
  last_error_code
  last_error_message
  requested_at
  completed_at

billing_event
  id
  billing_subject_id
  event_kind
  source_id
  amount_usd
  payload_json
  created_at
```

Field meanings:

```text
included_compute_seconds
  amount bundled in the plan/trial before overage or pause behavior

compute_limit_seconds
  hard stop when overages are disabled, or a usage cap alongside the
  admin-configured spend ceiling when overages are enabled

personal_sandbox_slots / shared_sandbox_slots
  bounded managed sandbox allocations, not worktree/session counts

billing_overage_policy.monthly_spend_limit_usd
  explicit customer-controlled cap for billable compute overages

compute_rate_card
  immutable price/cost snapshot for a provider shape. A usage segment stores the
  rate card id observed at start so later E2B pricing or Proliferate packaging
  changes do not rewrite past usage.

compute_subject_period
  the simple monthly meter. There is one active row per billing subject per
  period. `included_compute_seconds_used` is the accumulated completed running
  time. If a sandbox is currently running, current usage is:

    included_compute_seconds_used + (now - sandbox_slot.running_started_at)

compute_usage_segment
  optional for audit, debugging, and compute overage invoicing. V1 enforcement
  can be built from `compute_subject_period` plus `sandbox_slot`; segments are
  needed before charging reconciled compute overages.
```

LiteLLM remains current-spend source for managed LLM credits. Proliferate stores
the entitlement/budget it provisioned and periodic snapshots/events for product
display and reconciliation.

E2B is not the source of truth for product entitlement. E2B is the provider
runtime state. Proliferate is the source of truth for:

```text
who is allowed to run
how much included compute remains
whether overages are enabled
whether a target is blocked
which provider sandboxes belong to which billing subject
```

## End to end flows through the product

New free trial:

1. User/org is created.
2. User links GitHub.
3. Server upserts billing subject.
4. Server creates free allocation keyed by GitHub provider user id.
5. Server creates current compute and LLM credit periods.
6. Server provisions managed-credit budget in LiteLLM.
7. UI shows remaining included credits.

Compute periods are lazy:

```text
ensure_compute_subject_period(billing_subject_id, now)
  period = current trial/subscription period containing now
  if row exists:
    return it
  else:
    create one row with included seconds from current entitlement

Called before:
  create/resume/connect managed cloud
  cloud automation run
  Slack cloud run
  usage page render
```

Free cloud launch:

1. User asks to create/resume/connect managed cloud.
2. Server verifies GitHub-backed free allocation is active.
3. Server checks `compute_runtime_block` does not block the operation.
4. Server checks sandbox slot/concurrency limit.
5. Server checks the current compute period has remaining included seconds.
6. Server selects the active `compute_rate_card` for the sandbox shape.
7. Server creates or resumes E2B sandbox with Proliferate metadata:

```text
metadata:
  proliferate_billing_subject_id
  proliferate_target_id
  proliferate_workspace_id
  proliferate_sandbox_slot_id
  proliferate_compute_segment_id optional, when audit/overage segments are enabled
  proliferate_environment: hosted-cloud
```

8. Server marks `sandbox_slot.state = running` and
   `sandbox_slot.running_started_at = now`.
9. If audit/overage segments are enabled, server also opens
   `compute_usage_segment` with the rate-card id.
10. Worker/AnyHarness starts only after the slot and provider sandbox are
    associated.

If steps 2-5 fail, no E2B sandbox is created or resumed.

Provider-level backstop:

```text
on create/resume/connect:
  set provider timeout to a bounded window
  cap the timeout by remaining included/allowed compute where practical
  enable provider auto-pause/timeout behavior where available

This is only a backstop. Proliferate's own watchdog and reconciliation loop is
still the authority because provider timeout settings can be wrong, extended,
or bypassed by future code.
```

E2B lifecycle settings:

```text
default hosted-cloud create:
  lifecycle.onTimeout = "pause"
  lifecycle.autoResume = true
  timeout = short active window, e.g. 5-15 minutes

Proliferate-gated resume/connect:
  Proliferate checks billing first
  Proliferate performs the E2B SDK operation only if allowed
  Proliferate sets a fresh bounded timeout

auto-resume:
  allowed for managed cloud because product wake paths are Cloud-gated
```

Managed cloud should use E2B auto-pause and auto-resume. Auto-pause is how we
save money when the user is idle. Auto-resume is how reconnecting to the same
sandbox feels like a persistent environment. The constraint is not "never
auto-resume"; the constraint is "never expose ungated wake paths."

E2B auto-resume wakes a paused sandbox on SDK operations or HTTP traffic. That
is desirable when the operation came through Proliferate after a billing check.
It is dangerous if the user can hold a raw E2B URL or credential that wakes the
sandbox without Proliferate seeing it.

If a product surface needs auto-resume, make the wake path explicit:

```text
safe auto-resume path:
  browser/user hits Proliferate preview URL
  Proliferate checks billing/blocks
  if allowed, Proliferate resumes/connects sandbox or allows gated E2B traffic
  if not allowed, Proliferate returns upgrade/credits-exhausted UI

unsafe auto-resume path:
  browser/user hits raw E2B preview URL
  E2B resumes sandbox directly
  billing block was never checked
```

Product rule:

```text
managed cloud passive metadata:
  Desktop/Web -> Proliferate Cloud DB
  no E2B wake

managed cloud live action:
  Desktop/Web/Slack/automation -> Proliferate Cloud
  Cloud checks billing/block state
  Cloud performs E2B SDK/HTTP operation
  E2B auto-resumes the sandbox
  worker/AnyHarness become available

raw E2B/AnyHarness URLs:
  not a durable product surface
```

Snapshots are not the normal billing pause mechanism:

```text
pause/resume:
  one-to-one same sandbox
  preserves filesystem and memory/process state
  right primitive for idle/billing pause

snapshot:
  point-in-time checkpoint that can spawn new sandboxes
  original sandbox briefly pauses and resumes
  active connections/PTY streams can drop
  useful for rollback/fork/delete-retention, not the default billing stop
```

Subscription update:

1. Stripe webhook updates subscription.
2. Server updates plan entitlement.
3. Server updates LiteLLM budget subject for the current period.
4. UI and gateway readiness reflect new limit.

LLM usage:

1. Sandbox calls Proliferate Gateway.
2. Gateway validates runtime grant.
3. Gateway checks local budget subject is active and LiteLLM mirror is ready.
4. LiteLLM routes request and tracks spend against team budget.
5. If budget exhausted, LiteLLM/gateway fails request closed.
6. Gateway maps budget errors to `credits_exhausted`.
7. UI reads LiteLLM spend snapshot or reconciled budget status.

Sandbox hours:

1. Managed compute starts.
2. Server marks `sandbox_slot.running_started_at = now`.
3. E2B lifecycle webhook updates the slot or closes the running interval.
4. Watchdog computes live usage from `running_started_at`.
5. Reconciler compares DB slot state against E2B list/get state.
6. If limit exceeded, Cloud pauses/denies new managed compute.

The watchdog is mandatory. Without it, a sandbox that never emits a stop
webhook can continue running while the DB still believes usage is unchanged.

E2B lifecycle webhook:

1. Receive webhook.
2. Verify E2B signature.
3. Deduplicate on delivery/event id.
4. Locate slot by `proliferate_sandbox_slot_id` metadata or sandbox id.
5. On created/resumed -> mark sandbox slot running if Cloud expected it.
6. On paused/killed/timeout -> close the open running interval into the period.
7. On updated -> refresh shape/timeout/state metadata.

Webhooks are latency optimization, not correctness authority.

Compute watchdog:

1. Runs frequently, e.g. every 1-5 minutes.
2. Selects `sandbox_slot` rows in `running` or `pausing`.
3. For each running slot, computes:

```text
current_used_seconds =
  compute_subject_period.included_compute_seconds_used
  + (now - sandbox_slot.running_started_at)
```

4. If under limit, update `last_checked_at` and do nothing else.
5. If over included limit and overages are disabled:
   - close the open interval into `included_compute_seconds_used`;
   - create `compute_runtime_block`;
   - transition slot to `pausing`;
   - enqueue `sandbox_pause_request`.
6. If overages are enabled, continue until spend limit is reached.
7. If spend limit is reached, block and pause the same way.

Provider reconciliation job:

1. Lists E2B running/paused sandboxes with Proliferate metadata.
2. For each DB running slot whose provider sandbox is no longer running, closes
   the running interval at the best known provider/end time.
3. For each E2B running sandbox without a running slot, adopts it into the
   matching `sandbox_slot`, marks the observation disputed, and immediately
   evaluates limits.
4. For any orphan/over-limit sandbox, pause first; kill only if pause fails,
   abuse is suspected, or retention policy requires deletion.
5. Emits audit events for every correction.

This is the path that protects us from missed webhooks, failed workers,
manual E2B changes, and long-running sandboxes.

Cloud compute overage:

1. Paid org admin enables overages with an explicit spend limit.
2. Server records `billing_overage_policy` on the billing subject/org.
3. Managed compute usage first consumes included compute allowance.
4. After allowance, usage segments become billable overage events.
5. UI shows current month usage and projected overage.
6. If `monthly_spend_limit_usd` is reached, Cloud pauses/denies new managed compute.
7. Reconciler repairs missed lifecycle events before invoicing.

Limit exhausted:

1. LLM credits exhausted -> gateway returns budget exhausted.
2. Compute limit exhausted -> pause running sandboxes and deny new cloud
   sessions.
3. Paid org with overages enabled can continue until spend limit.
4. User can upgrade, wait for reset, or use BYOK where supported/enabled.

Compute limit enforcement:

```text
before create/resume/connect:
  read entitlement + compute period + overage policy
  reject if blocked or exhausted

while sandbox is running:
  watchdog computes live usage from running_started_at
  if exhausted:
    set compute_runtime_block
    queue pause_sandbox

after pause succeeds:
  close current running interval
  mark target paused_for_billing
  AnyHarness/worker sees target blocked and does not auto-resume

if pause fails:
  retry with short backoff
  if still running past cost-protection threshold, kill sandbox
  mark target needs_manual_recovery if state preservation is uncertain
```

The server must gate every operation that can resume E2B. E2B `connect` can
resume a paused sandbox, so billing checks have to run before connect/resume as
well as before create.

Pause vs kill:

```text
pause:
  default for free exhaustion, paid spend-limit exhaustion, and temporary
  payment/entitlement problems
  preserves sandbox state where provider supports it
  can be resumed after reset/upgrade/payment recovery

kill:
  abuse/fraud
  repeated pause failure
  customer explicitly deletes target
  retention window expired after exhaustion/cancellation
```

Pause request flow:

```text
1. Enforcement decides sandbox is no longer allowed to run.
2. Server creates compute_runtime_block.
3. Server closes the open running interval into used_seconds.
4. Server transitions sandbox_slot running -> pausing.
5. Server enqueues sandbox_pause_request.
6. Worker calls E2B pause endpoint.
7. On success:
     sandbox_slot pausing -> paused or blocked
     sandbox_pause_request -> succeeded
8. On already paused / not found:
     treat as idempotent success if provider state is not running
9. On transient failure:
     retry with bounded backoff
10. On repeated failure or abuse:
     escalate to kill
```

Resume after billing pause:

```text
reset/upgrade/admin action clears compute_runtime_block
user/automation requests resume/connect
server checks current compute period and overage policy
if allowed:
  sandbox_slot paused/blocked -> running
  running_started_at = now
  call E2B connect/resume with bounded timeout
if not allowed:
  keep blocked and do not call E2B
```

Command delivery wake gate:

```text
queue command that requires worker/AnyHarness
  -> persist CloudCommand
  -> check compute_runtime_block and current compute period
  -> if blocked/exhausted:
       reject or leave blocked with clear status
  -> if sandbox paused:
       perform Proliferate-gated E2B SDK operation to wake/auto-resume
       mark sandbox_slot running and set running_started_at
       wait for worker heartbeat / target online
  -> worker long-poll leases command
```

Do not assume a paused worker will notice a newly queued command by itself. The
worker's long-poll is suspended while the E2B sandbox is paused. Cloud must wake
the sandbox before expecting command delivery. After E2B resumes the sandbox,
the preserved worker process should reconnect/poll again.

Commands that need this wake gate:

```text
start_session
send_prompt
materialize_workspace
materialize_environment
materialize_environment_runtime_config
refresh_agent_auth_config
resolve_interaction
cancel_turn / close_session when the target must observe it
automation run
Slack run
```

Hosted cloud V1 credit enforcement:

```text
plan/free trial entitlement
  -> included_llm_credit_usd
  -> agent_gateway_budget_subject
  -> LiteLLM team max_budget
  -> gateway runtime request
```

There is no managed LLM overage ledger in V1. The product behavior is:

```text
under budget:
  gateway allows managed-credit route
  LiteLLM tracks spend
  UI shows remaining/used from synced LiteLLM budget state

budget exhausted:
  LiteLLM rejects or budget status reconciles exhausted
  gateway maps to credits_exhausted
  new managed-credit launches remain selectable but show blocked/exhausted
  user can upgrade or wait for reset

LiteLLM mirror stale/failed:
  gateway/launch preflight fails closed
  UI shows provider/budget readiness problem, not "out of credits"
```

BYOK is not the hosted V1 escape hatch unless enabled. Copy should say "add
BYOK where supported" or hide the action entirely while hosted BYOK is disabled.

## Overage Guardrails

Cloud overage billing is allowed only if the metering path is solid enough to
protect both the customer and Proliferate.

Required before enabling cloud overages:

```text
usage segments, if used for overage invoices, are idempotent
start/stop events are reconciled against provider state
stale running slots are closed by a reconciler
admin explicitly enables overages
admin can set monthly spend limit
UI shows current usage and limit
system fails closed if metering is unhealthy
invoices use reconciled segments, not raw worker heartbeats
```

No surprise billing rule:

```text
Free user hits limit
  -> pause/deny new managed cloud
  -> show upgrade CTA

Team org without overages enabled hits included compute
  -> pause/deny new managed cloud
  -> admin can enable overages or upgrade

Team org with overages enabled hits included compute
  -> continue running
  -> create billable overage events from reconciled segments
  -> stop at configured spend limit
```

Do not use cloud overages as a substitute for managed LLM credit overages. LLM
credits remain hard-capped in V1.

## Hooks / things used and why

Stripe webhooks:

- subscription created/updated/cancelled;
- payment failure;
- plan changes.

LiteLLM budget sync:

```text
plan/free-trial changed
  -> update agent_gateway_budget_subject
  -> update LiteLLM team max_budget/budget_duration
  -> mark synced or fail closed
```

Budget identity:

```text
one managed-credit budget subject per org/current period
all managed-credit harness policies for that org point at it
do not create one budget per harness
```

This is what makes "$X included credits" mean one org-level pool, not "$X for
Claude plus $X for Codex plus $X for OpenCode".

Compute lifecycle:

```text
target/workspace started
  -> set sandbox_slot.running_started_at
target/workspace stopped/paused/deleted
  -> add running interval to compute_subject_period.used_seconds
watchdog
  -> checks running slots and pauses when no longer allowed
reconciler
  -> corrects DB/provider drift and adopts/stops orphan provider sandboxes
```

Compute invoice lifecycle:

```text
optional usage segment
  -> close segment from stop/pause/provider reconciliation
  -> calculate measured_seconds and billable_seconds
  -> mark reconciled
  -> if overage enabled and allowance exceeded:
       calculate overage_amount_usd
       emit billing_event with amount_usd
       increment billing_overage_policy.current_period_spend_usd
  -> invoice consumes billing_events
```

Gateway usage:

- LiteLLM enforces budget.
- Proliferate periodically snapshots spend for UI/reconciliation.

## One offs

- Do not implement a managed LLM overage ledger in V1.
- Cloud compute can have explicit paid-org overages once usage segments and
  reconciliation are solid.
- Do not silently fall back from managed credits to customer BYOK.
- Do not show BYOK as a remediation in hosted V1 unless BYOK is enabled.
- Free trial and paid included credits can use same budget-subject model.
- Keep raw provider invoices separate from product usage display.
- Compute pause should attempt to preserve git/worktree/session state.
- BYOK through gateway assumes LiteLLM Enterprise/team isolation or equivalent
  isolated router topology. Synced native auth is the V1 bring-your-own-auth
  path.

## Deeper concepts

LiteLLM budgets:

- team-level max budget;
- budget duration such as `30d`;
- spend tracking for gateway-managed model calls.

Compute metering:

- lifecycle hooks are ideal;
- reconciler is required for missed stop events;
- compute_subject_period + sandbox_slot are the V1 enforcement facts;
- usage segments are not invoices. They are optional audit/accounting facts and
  required before compute overage billing.

Stripe:

- source of truth for subscription/payment state;
- Proliferate is source of truth for product entitlements derived from plan.
