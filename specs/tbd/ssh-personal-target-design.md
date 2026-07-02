# SSH / Personal Target — End-to-End Design

Status: design (not yet approved). Written from a full read of the current
repo state, not from assumptions. Every claim below cites the file/commit
that grounds it. Companion specs: `sandbox-provisioning.md` (managed cloud,
the model this doc deliberately does NOT reuse), `agent-auth.md` (spec 02,
the LiteLLM gateway this doc extends), `settings-admin-ia.md` (spec 03, owns
the Compute pane shell), `claiming.md` (spec 05, documents the current auth
gap this doc closes), `web-cloud-local-parity.md` (owns presentation
vocabulary this doc feeds).

Verified against `main`-derived branch `agent-auth/15-agents-ui` on
2026-07-02.

## 0. The model: one concept, not three

There is exactly one new-ish concept in this design, and it is a
*unification*, not an addition:

> A **direct runtime** is a persistent, user-owned AnyHarness that Desktop
> **attaches to**. It is never provisioned, woken, or destroyed by the
> product — it is simply *there*, like a peer. "Local" is the degenerate
> case where the transport is loopback. An SSH target is the identical
> thing where the transport is an SSH tunnel. Nothing else differs at the
> model level.

The system therefore splits on **ownership**, and only on ownership:

```text
direct   user owns the machine and the AnyHarness lifecycle.
         Desktop attaches point-to-point. AnyHarness SQLite is the
         source of runtime truth. Credentials are pushed straight in.
         Attach/detach is purely a client-side concern.
         transport: loopback | ssh        <- a property, not a category

cloud    Proliferate provisions and owns the runtime (E2B sandbox).
         Reached through the gateway. Lifecycle (ensure/wake/destroy)
         owned by the control plane. Metered.
```

Everything in this doc is a consequence of refusing to let "ssh" become a
third category anywhere below the presentation layer. Where today's code
already has three-way splits (`RuntimeTarget.location: "local" | "target" |
"cloud"`, sidebar variants, spec vocabulary), those survive as *derived
presentation values*, computed from `(ownership=direct, transport=ssh)` —
they stop being load-bearing model distinctions.

What this unification buys, concretely:

1. **One agent-auth surface family instead of a new one.** The desktop→
   runtime credential push shipped for local in `36c003072` is already the
   correct mechanism for SSH boxes; it just needs to be instantiated per
   attached runtime instead of hardcoded to `runtimeUrl` = localhost.
2. **Symmetry across the user's machines for free.** A user's second Mac is
   just another loopback direct runtime pulling the same default document.
   An SSH box is another direct runtime pulling its own (or inherited — §3.4)
   document. No case is special.
3. **Enrollment becomes an orthogonal property, not part of the definition.**
   A direct runtime *may* be enrolled with Cloud (gets a `CloudTarget` row +
   worker + dispatchability from web/mobile/automations). Today's
   `desktop_dispatch` target kind is, under this model, precisely "an
   enrolled loopback runtime" — the codebase already accidentally agrees
   with the unification. SSH boxes happen to be born enrolled (the installer
   sets up the worker), but the model permits a cloud-free SSH runtime
   (pure direct attach, no worker) as a future option — see §8.
4. **Every runtime-scoped AnyHarness contract applies uniformly with zero
   extra design**: worktree retention policy sync, workspace registration,
   agent install/reconcile, terminals, files. These are already per-runtime
   APIs (`specs/codebase/structures/anyharness/src/workspaces.md`
   invariants); the unification means we never have to ask "but what about
   ssh?" for any of them again.

The one honest difference that does NOT collapse: **reachability.** A
loopback runtime is trivially up whenever Desktop is up. A remote direct
runtime has a real connection state machine (box online? tunnel
established? healthy?). That is a per-row *status*, carried by the unified
list — not grounds for a category. §3.2 and §4 make it explicit.

## 1. What already exists (verified, not assumed)

The mechanical layer is further along than "half-baked" suggests; the
product layer is much further behind. Both at once — which is exactly why it
reads half-baked: the plumbing works, but using it doesn't get you a working
agent.

### 1.1 Two independent planes, both real, both hitting the same AnyHarness

**Plane A — Enrollment + dispatch (built, `ef3c54d00` "connect SSH targets
end to end", 2026-05-23):**

- `CloudTarget` (`server/proliferate/server/cloud/targets/{models,service,api,domain}.py`)
  is a lightweight device-enrollment record: `kind` (`ssh` |
  `desktop_dispatch` | `self_hosted_cloud` | `managed_cloud` | `local_direct`
  — `server/proliferate/constants/cloud.py:226`), `owner_scope`, inventory
  (os/arch/git/node/providers), status
  (`enrolling`/`online`/`offline`/`degraded`/`archived`), and an update
  channel for the three shipped binaries.
- Enrollment: `POST` issues `CloudTargetEnrollmentResponse` — a target row,
  an enrollment token, and a generated install command
  (`domain/rules.py:build_install_command`).
- Install: Desktop streams `install/proliferate-target-install.sh` over SSH
  via `sh -s` stdin
  (`apps/desktop/src-tauri/src/commands/ssh_tunnel.rs::install_ssh_target_runtime`).
  The script downloads `anyharness`, `proliferate-worker`,
  `proliferate-supervisor`; writes `worker/config.toml` (cloud_base_url,
  enrollment_token, anyharness_base_url, optional
  `anyharness_bearer_token`) and `supervisor/config.toml`; installs a
  `systemd --user` unit (with `loginctl enable-linger` so it survives SSH
  logout) that runs `proliferate-supervisor run` forever.
- Once booted, the worker registers with Cloud using the enrollment token;
  Cloud flips the target `online` and starts accepting heartbeats.
- With the target online, Cloud can dispatch the **same** `cloud_commands`
  queue used for managed sandboxes: `ensure_repo_checkout`,
  `materialize_workspace`, `start_session`, `send_prompt`,
  `update_session_config`, `backfill_exposed_workspace`
  (`server/proliferate/server/cloud/workspaces/target_launch/service.py`,
  `remote_access/service.py`). This is what lets **web/mobile/automations**
  drive an SSH runtime even when Desktop isn't attached — same substrate as
  `desktop_dispatch` and `self_hosted_cloud`.

**Plane B — Direct attach (built, same commit, Desktop-only):**

- Desktop keeps a **local-only** SSH connection profile per target (host,
  user, port, identity file, remote AnyHarness port) —
  `apps/desktop/src/hooks/settings/workflows/use-ssh-direct-target-profile.ts`
  — never sent to Cloud, because Cloud has no business knowing a private-key
  path or a home-network hostname.
- `ensure_ssh_anyharness_tunnel` (Tauri, `ssh_tunnel.rs`) opens
  `ssh -N -L 127.0.0.1:<random>:127.0.0.1:8457 user@host`, polls `/health`
  until AnyHarness answers, and caches the child process keyed by
  `target_id` so repeated calls reuse a live tunnel.
- `apps/desktop/src/lib/access/anyharness/runtime-target.ts` resolves three
  `RuntimeTarget.location` values: `"local"` (localhost), `"target"` (SSH
  tunnel via `parseTargetWorkspaceSyntheticId` +
  `getSshDirectTargetProfile` + `ensureSshAnyHarnessTunnel`), `"cloud"`
  (managed sandbox gateway with a bearer). Once the tunnel is up, `"target"`
  and `"local"` are **the same code path** — same AnyHarness HTTP/WS client,
  same workspace/session/file/terminal semantics. The code already validates
  the unified model; only the type system and the product layer haven't
  caught up.
- Sidebar already carries a derived variant:
  `SidebarWorkspaceVariant = "local" | "worktree" | "cloud" | "ssh"`
  (`apps/desktop/src/lib/domain/workspaces/sidebar/sidebar-indicators.ts:11`).

**Both planes terminate at the same AnyHarness process on the box.** Plane A
reaches it via the worker's HTTP client (with the worker's configured
bearer). Plane B reaches it via Desktop's SSH-forwarded HTTP client. They
are complementary: plane A works when Desktop is closed; plane B works when
Cloud is down or the user is offline-but-on-LAN.

### 1.2 What's missing — the actual "half-baked" part

**(A) Agent-auth only knows about one direct runtime: localhost.**

```python
# server/proliferate/server/cloud/agent_gateway/models.py:26
AgentAuthSurface = Literal["local", "cloud"]
```

- `"cloud"` renders into `sandbox_profile_target_state` and is pushed by a
  dispatched `refresh_agent_auth_config` cloud_command — a pipeline
  structurally scoped to managed sandboxes (`agent-auth.md` §5).
- `"local"` is pushed by
  `apps/desktop/src/hooks/agents/lifecycle/use-local-auth-state-sync.ts`:
  fetch `useAgentAuthState("local", cloudActive)`, diff against the last
  pushed fingerprint (`planLocalAuthStatePush`, pure), `PUT` the state.json
  document straight to Desktop's own `runtimeUrl` via `applyAgentAuthState`.
  Runtime side: `PUT /v1/agent-auth/state`
  (`anyharness-lib/src/api/http/agent_auth.rs`) persists the document at
  `<runtime_home>/agent-auth/state.json` with stale-revision protection.
  AnyHarness itself has **no surface concept at all** — it trusts whatever
  reaches that endpoint; the trust boundary is the transport.

Under the unified model this is not "a missing ssh feature" — it is the
local push hook being accidentally hardcoded to one member of the direct
family. An SSH runtime never receives a state.json through either pipeline,
so today you can enroll a box, tunnel to it, open a workspace on it — and
hit a wall at session start, because nothing ever delivered credentials.
The user is left to manually run `claude login` on the remote box, which is
exactly what the unified agent-auth UI exists to eliminate.
`settings-admin-ia.md` §5.2 names a per-target `ComputeTargetAgentAuthCard`;
it does not exist on disk (only `ComputeTargetReadiness.tsx` does).

**(B) The direct tunnel is unauthenticated.**

AnyHarness's HTTP layer supports a static bearer
(`anyharness-lib/src/api/router.rs:463`, `require_bearer_auth`,
constant-time compare). The installer *can* write
`PROLIFERATE_ANYHARNESS_BEARER_TOKEN` into the worker's config
(`install/proliferate-target-install.sh:110-114`), but nothing populates it
during SSH install today, and `runtime-target.ts`'s `"target"` branch never
sets `RuntimeTarget.authToken`. `claiming.md` §4.1 records this as ground
truth: `runtime location 'target'  SSH tunnel; no token`. Tolerable while
the box holds empty workspaces; intolerable the moment (A) starts pushing
live provider API keys through the same pipe.

**(C) No product surface.** The Agents settings work on this branch
(`da0890709`) scopes to local and cloud only. The Compute pane lists SSH
targets but offers no credential story for them.

## 2. Non-goals (explicit, because the natural failure mode is to cloud-ify this)

- **Do not route direct-runtime agent-auth through
  `sandbox_profile_target_state` / `refresh_agent_auth_config`.** That
  pipeline exists because a managed sandbox is ephemeral,
  provider-provisioned, and gateway-only. A direct runtime is none of those;
  detouring a credential push through Cloud's command queue for a box
  Desktop reaches in one hop imports latency and failure modes for nothing.
- **Do not create a `managed_sandbox`-equivalent record for direct
  runtimes.** Even managed cloud keeps AnyHarness SQLite as runtime truth
  and Cloud DB thin (`sandbox-provisioning.md` §Runtime Truth). Direct
  runtimes follow the same rule more strictly: Cloud holds enrollment
  bookkeeping and rendered credential state, nothing else.
- **Do not require Cloud reachability for direct attach.** Cloud being down
  degrades to "credential edits don't sync right now" — never to "your own
  machines stopped working."
- **Do not share one AnyHarness bearer across runtimes.** Each enrolled
  runtime gets its own.
- **Do not let "ssh" leak below presentation.** No `if kind == "ssh"`
  branches in agent-auth, workspace identity, or session flows. Transport
  resolution happens in exactly one place (§3.2).

## 3. Target model

### 3.1 Agent-auth: surface = `direct(target_id?) | cloud`

Conceptually:

```text
AgentAuthSurface =
  | { kind: "direct", targetId: string | null }   # null = the default/loopback doc
  | { kind: "cloud" }
```

`targetId = null` **is today's `"local"`** — the default direct document
that any loopback runtime pulls (a user's second Mac is just another
consumer of the same doc; that is today's de-facto semantics and it is
correct). `targetId = <CloudTarget id>` scopes a document to one enrolled
runtime.

Wire/DB stays flat and additive — no data migration, no enum churn:

```text
surface: str stays 'local' | 'cloud' on the wire; 'local' is read as
  "direct, default". (Renaming the literal to 'direct' is a cosmetic
  follow-up, not part of this slice.)
add nullable target_id to route-selection rows (and any surface-keyed
  scoping row):
  unique key: (harness_kind, surface, target_id, slot), target_id NULL
  for default-direct and cloud rows
```

This mirrors how `cloud_commands.cloud_workspace_id` was added as a nullable
column rather than reshaping the envelope (`cloud-commands.md` §5.1): same
pattern, same reasoning.

API (`server/proliferate/server/cloud/agent_gateway/api.py`):

```text
GET/PUT/DELETE .../route-selections/{harness_kind}/{surface}
  optional ?targetId= — permitted only with surface=local(direct);
  ownership-checked via targets_store.get_visible_target_by_id

GET /agent-gateway/state?surface=local&targetId=<id>
  get_auth_state() gains target_id; response shape unchanged
```

**Render rule — inheritance with override (recommended, see open decision
#3):** a target-scoped document renders from per-target selections where
they exist, falling back per (harness, slot) to the default-direct
selections. A runtime with zero overrides gets exactly the default
document. This is the "it's just like local" mental model made literal:
your credentials follow you onto any machine you own unless you say
otherwise. Note `native`-route selections are inherently machine-local
(vendor login state lives on each box), so inheritance materially affects
only `api_key`/`gateway` routes — which are server-rendered and portable by
construction.

### 3.2 Desktop: one attach abstraction, one sync hook

Introduce the direct-runtime row as the thing Desktop iterates — replacing
the current hardcoded local singleton plus ad-hoc ssh profile lookups:

```text
DirectRuntimeRef = {
  targetId: string | null          // null = this machine
  transport: "loopback" | "ssh"    // derived: null targetId => loopback
  displayName: string
  connection: "attached" | "connecting" | "unreachable" | "detached"
}

resolveDirectRuntimeConnection(ref) -> { baseUrl, authToken? }
  loopback -> harnessConnectionStore.runtimeUrl (today's local path)
  ssh      -> getSshDirectTargetProfile + ensureSshAnyHarnessTunnel
              (today's "target" path) + per-target bearer (§3.3)
```

`RuntimeTarget.location` collapses `"local" | "target"` into the direct
family; the string values can survive as transport aliases for compat, but
no consumer may branch on them for anything except presentation.

Agent-auth sync: `use-local-auth-state-sync.ts` generalizes to
`use-direct-auth-state-sync.ts`, one instance per attached direct runtime
(loopback included — the current hook becomes the `targetId=null` instance):

1. Fetch `useAgentAuthState(surface=local, targetId)` per runtime.
2. Diff via `planLocalAuthStatePush` with a **per-runtime** fingerprint
   (the pure function is already target-agnostic; only the ref-keyed cache
   changes).
3. Push via the same `applyAgentAuthState(connection, state)` against the
   resolved connection.
4. Gate on `connection === "attached"`, not on the local
   harnessConnectionStore (which is loopback-only state).

Multi-writer note: two Desktops attached to the same SSH runtime both push
the same rendered document; the runtime's revision guard
(`RouteAuthError::StaleStateRevision`, 409) makes this idempotent. No
coordination needed.

No `cloud_commands` anywhere in this path. Cloud's role is identical to the
local case today: render and serve the document from durable rows; never
touch the box.

### 3.3 Close the bearer gap as part of this, not after

Mint a per-runtime AnyHarness bearer at enrollment (open decision #1), store
it encrypted on the `CloudTarget` row (mirror
`managed_sandbox.anyharness_bearer_token_ciphertext`,
`sandbox-provisioning.md` §Data Model), and:

- include it in the SSH install payload so the worker's
  `PROLIFERATE_ANYHARNESS_BEARER_TOKEN` is actually set (installer already
  supports it — it's just never populated);
- start AnyHarness on the box with the bearer enforced (verify the
  supervisor's `anyharness_args` wire a startup token flag into
  `require_bearer_auth`, not just the request-time check);
- surface the same bearer to Desktop for direct attach: thread through
  `getSshDirectTargetProfile` / `EnsureSshAnyHarnessTunnelInput`, and set
  `RuntimeTarget.authToken` in the ssh-transport branch.

One secret, two consumers (worker process, Desktop tunnel client), both
already-present config slots — wiring, not new infrastructure. The loopback
runtime keeps whatever localhost trust it has today; unifying local-sidecar
auth is out of scope.

### 3.4 Product IA: rows in a list, not a new category

Compute pane (spec 03 shell): the target list reads as **"Your machines"**
— "This Mac" (loopback, always first) plus each enrolled runtime, plus Add.
Cloud remains its own section. Per-row status chip from the connection
state machine; a row being configured is a different claim from it being
reachable right now (`web-cloud-local-parity.md`'s capability-vs-health
principle) — offline rows stay visible and editable, with the push
deferred.

Agents settings scope selector (this branch's `da0890709` UI): the "local"
scope becomes the **direct family** — "This Mac" plus one entry per
enrolled runtime, cloud unchanged. Under inheritance (§3.1), a runtime with
no overrides shows "Using your defaults" with an explicit per-harness
override affordance, rather than presenting every box as a blank slate.

`SidebarWorkspaceVariant` and the spec-03 vocabulary (`ssh -> "SSH"`) are
unchanged as display values — derived from `(direct, transport=ssh)`.

## 4. Full lifecycle (explicit — today it's implicit across three files)

```text
1. Enroll
   Compute pane -> Add SSH target -> AddSshTargetDialog
   Desktop: probe_ssh_target_connection (connectivity only, no install)
   Server: POST /v1/cloud/targets (kind=ssh, owner_scope=personal)
     -> CloudTarget{status=enrolling}, enrollment_token, install_command
   [new] Server mints the per-runtime AnyHarness bearer, stores it
     encrypted on the CloudTarget row, includes it in the install payload.

2. Install
   Desktop: install_ssh_target_runtime streams the installer over
     `ssh ... sh -s`; env now includes PROLIFERATE_ANYHARNESS_BEARER_TOKEN.
   Box: binaries + configs + systemd --user unit + lingering; supervisor
     runs AnyHarness (bearer-enforced) + worker forever.
   Worker registers with the enrollment token; target -> online.

3. Attach (Desktop, any number of Desktops, any time)
   Purely client-side: resolveDirectRuntimeConnection opens/reuses the
   tunnel, health-checks, yields {baseUrl, authToken}. The runtime was
   already running; nothing was provisioned. Identical in kind to Desktop
   attaching to its own loopback sidecar at launch.

4. Register agent auth [new — this design's core deliverable]
   User configures the runtime's row in Agents settings (or relies on
   inherited defaults). Server renders state.json for
   (surface=direct, targetId). use-direct-auth-state-sync pushes it over
   the attached connection to PUT /v1/agent-auth/state. Sessions started
   via either plane now have real credentials — no manual `claude login`
   on the box.

5. Operate
   Plane A: worker heartbeats; Cloud tracks online/offline/degraded;
     web/mobile/automation dispatch available whenever online — independent
     of any Desktop being attached.
   Plane B: tunnels are Desktop-process-scoped; reopened on demand, torn
     down with the process (SshTunnelState::drop).
   Workspaces/sessions/terminals/files: standard AnyHarness semantics,
     source of truth in the box's SQLite. Worktree retention policy syncs
     through the same runtime API as every other runtime.
   Credential edits: re-render + re-push on next attach (or immediately if
     attached). v1: push only from attached Desktops (open decision #2).

6. Decommission
   Archive target -> CloudTarget.archived_at set. Worker detects archival
   on next poll and stops (a re-enrollment is a fresh CloudTarget + fresh
   bearer — same "new identity, never revived" posture as
   cloud-commands.md §5.1 target replacement).
   Desktop drops the connection profile and tunnel.
   AnyHarness + state.json are left on the box untouched: this is a
   product decommission, not license to delete files on a machine we
   don't own (same non-destructive posture as workspace-lifecycle.md
   archive semantics). Surface copy tells the user how to remove the
   systemd unit + ~/.proliferate themselves.
```

## 5. Files to touch (first slice — agent-auth generalization + bearer)

Server:

```text
server/proliferate/server/cloud/agent_gateway/models.py
  target_id on selection/state request+response shapes (surface literal
  unchanged on the wire)
server/proliferate/server/cloud/agent_gateway/api.py
  ?targetId= on route-selection + state endpoints, ownership-checked
server/proliferate/server/cloud/agent_gateway/service.py
server/proliferate/server/cloud/agent_gateway/catalog.py
  thread target_id; implement the inheritance render rule
server/proliferate/db/store/agent_gateway.py
  nullable target_id column + composite key update
server/proliferate/server/cloud/targets/{service,models}.py
  mint + store encrypted per-runtime bearer at enrollment
server/alembic/versions/<new>_agent_auth_target_scoping.py
server/alembic/versions/<new>_cloud_target_anyharness_bearer.py
```

Desktop:

```text
apps/desktop/src/hooks/agents/lifecycle/use-direct-auth-state-sync.ts
  (generalize use-local-auth-state-sync; loopback = targetId null instance)
apps/desktop/src/lib/domain/agents/local-auth-state.ts
  unchanged (already pure/target-agnostic); add a target-scoped test fixture
apps/desktop/src/lib/access/anyharness/runtime-target.ts
  direct-family resolution; set authToken on the ssh-transport branch
apps/desktop/src/hooks/settings/workflows/use-ssh-direct-target-profile.ts
apps/desktop/src-tauri/src/commands/ssh_tunnel.rs
  thread the per-runtime bearer
apps/desktop/src/components/settings/panes/compute/ComputeTargetAgentAuthCard.tsx
  (new — named in settings-admin-ia.md §5.2, never built)
agents-scope tab list (da0890709 UI)
  direct family = This Mac + enrolled runtimes; "Using your defaults" +
  override affordance per runtime
```

Install / runtime:

```text
install/proliferate-target-install.sh
  no change needed beyond a caller finally populating
  PROLIFERATE_ANYHARNESS_BEARER_TOKEN
anyharness supervisor args
  verify serve-time bearer enforcement wiring
```

## 6. Open decisions (need your call before implementation)

1. **Bearer minting time.** At enrollment (`POST /v1/cloud/targets`) or on
   first successful install? Recommendation: enrollment — tokens are
   already short-lived/single-use, and an abandoned enrollment just leaves
   an unused bearer on an expired row. Install payload stays
   self-contained.

2. **Credential sync when no Desktop is attached (plane A only).**
   (a) v1: push only from attached Desktops — an SSH runtime that no
   Desktop has attached to since the last credential edit runs on its last
   pushed state; (b) the worker also polls
   `GET /agent-gateway/state?surface=direct&targetId=…` on its heartbeat
   cycle and applies locally with its own bearer — credentials stay fresh
   with Desktop fully absent, at the cost of a second writer (idempotent
   under the revision guard, but still a second moving part).
   Recommendation: ship (a), schedule (b) as an explicit fast-follow — it
   reuses plane A's existing poll loop and becomes important the moment
   automations regularly land on SSH runtimes with no Desktop around.

3. **Inheritance vs. explicit-only per-runtime credentials.** Inheritance
   with per-(harness, slot) override (recommended — it *is* the "just like
   local" mental model, and a fresh box working out-of-the-box is the whole
   point) vs. each runtime configured explicitly (simpler render rule,
   worse UX, every new box starts blank). If inheritance: overrides are
   sparse rows; deleting an override reverts to defaults; UI must always
   show which of the two a value comes from.

4. **Configure-while-offline.** Allow editing an unreachable runtime's
   credentials (store + defer push) or require reachability?
   Recommendation: allow unconditionally — matches the existing
   fire-and-forget, retry-on-next-change posture of the local hook, and
   inheritance makes the common case (no per-box edits) a non-issue.

## 7. Verification

No tests exist for any of this yet. First-slice targets, following existing
patterns:

```text
server/tests/integration/test_cloud_targets_api.py      extend: bearer mint
server/tests/integration/test_agent_gateway_api.py      extend: targetId
  scoping, ownership rejection, inheritance render
apps/desktop/src/lib/domain/agents/local-auth-state.test.ts
  target-scoped fingerprint fixtures
ssh_tunnel.rs                                            bearer threading
```

Manual (mirrors `sandbox-provisioning.md`'s QA posture; needs a real second
machine or an SSH-reachable VM/container):

```text
1. Enroll a fresh SSH runtime from a clean state.
2. Install completes; target reaches online.
3. Direct attach: tunnel opens, /health succeeds through it.
4. Bare curl against the tunnel port WITHOUT the bearer -> 401.
5. With NO per-runtime credential edits, confirm the runtime receives the
   inherited default document on first attach (decision #3's payoff).
6. Override one harness credential for the runtime; confirm the pushed
   state.json at <remote_runtime_home>/agent-auth/state.json reflects the
   override and untouched harnesses still show inherited values.
7. Start a session via direct attach; launches with the pushed credential,
   no manual `claude login` on the box.
8. Quit Desktop; plane A dispatch (target_launch start_session) still works
   on the last-pushed state (documents decision #2's v1 boundary).
9. Attach from a second Desktop; confirm the duplicate push is a no-op
   (revision guard) and both Desktops show the same state.
10. Archive the runtime; worker stops, Desktop drops profile/tunnel, files
    on the box untouched.
```

## 8. Follow-ups the model unlocks (explicitly not v1)

- **Cloud-free SSH runtimes**: pure direct attach with no worker/enrollment
  (installer gains a mode that skips worker config). The model already
  permits it; only credential sync would need a non-Cloud source.
- **Rename the wire literal** `local` -> `direct` once all consumers read
  target_id.
- **Worker-side credential reconcile** (decision #2 option b).
- **Workspace mobility between direct runtimes** (local -> SSH box): spec
  10's migration machinery applies with *fewer* moving parts than
  local -> cloud, since both ends are durable peers.
```
