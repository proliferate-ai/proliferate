# Flow Registry

The inventory of end-to-end flows that must never break. Owned and dictated by
Pablo; agents keep the pointers live. Rules:

- Adding or materially changing a flow adds/updates a row **in the same PR**.
- `Test pointer` names the spec/scenario file that enforces the flow at its
  tier. `—` means not yet implemented; an empty pointer is a to-do, not an
  excuse.
- A completeness audit (agent-run) checks: every row has a live pointer, and
  every pointer's test actually runs in the gate its tier claims.

Tiers per `README.md`: **2** = mocked intent (per-PR, blocks merge),
**3** = live end-to-end (release train), **4** = upgrade path (release train).

## Auth & identity — must work, even if basic

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Google OAuth sign-in (mocked provider per-merge) | 2 | — |
| `/setup` instance claim → password login → logout → re-login | 2 | — |
| Session revocation ends access | 2 | — |
| Invitation: invite → accept in fresh browser → membership + role | 2 | — |
| Invitation negatives: expired / reused / wrong-email token | 2 | — |
| SSO: OIDC round-trip via mock IdP → user linked, domain policy applied | 2 | — |
| SSO negatives: disallowed domain, unknown user, audience/issuer mismatch | 2 | — |
| Real provider handshakes (Google/GitHub OAuth dance) | 3 | — |

## Organization — must work, even if basic

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Create organization | 2 | — |
| Invite users; promote/demote roles | 2 | — |
| Admin-only surfaces gated: member cannot see/do admin actions | 2 | — |
| Member visibility boundaries (sees own work, not others' private state) | 2 | — |
| Remove user; access ends | 2 | — |

## Workspaces

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Local workspace create | 3 | — |
| Worktree workspace create — locally AND inside a cloud sandbox | 3 | — |
| Cloud workspace create: request path + UI state up to the provisioning seam | 2 | — |
| New user cold path: GitHub App authorization triggers first-ever sandbox provisioned from zero, within time budget | 3 | — |
| Existing user warm path: reopen, pause (inaccessible), resume, state intact | 3 | — |
| Cloud workspace pause/resume/connect on real E2B | 3 | — |
| Local ↔ cloud workspace migration | 3 | — |
| Add repo from cloud | 2 | — |
| Repo settings applied: default branch, action scripts, environment scripts/env vars take effect — locally AND in sandbox | 3 | — |

## Agents & sessions

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Every cataloged harness × its cheapest model via the gateway: send a message, get a real message back — local lane AND sandbox lane | 3 | — |
| Correct harness spawned: right binary, right version per catalog pin — asserted locally AND in the sandbox, before the chat | 3 | — |
| Install an agent; switch agents in a workspace | 3 | — |
| Per-agent catalog version bump gate (staging smoke before pin bump) | 3 | — |
| Config/harness option updates applied by a live agent: cycle every catalog-enumerated option (models, modes) in an existing session | 3 | — |
| Session resume after runtime restart | 3 | — |

## Secrets

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Secrets CRUD in UI: org, personal, file secrets | 2 | — |
| Org secret set → materializes in a new cloud sandbox | 3 | — |
| Personal secret set → materializes in a new cloud sandbox | 3 | — |
| File secret set → lands at the right path in the sandbox | 3 | — |

## Integrations

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Connect integration (fake provider), toggle on/off | 2 | — |
| Authenticate a real integration; **every cataloged harness** uses it through the gateway — local lane AND sandbox lane | 3 | — |

## Workflows

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Create/edit/trigger workflow via UI → run created, plan resolved, delivery attempted (up to the sandbox seam) | 2 | — |
| Workflow run reaches terminal state with a real agent | 3 | — |
| Poll trigger against stub feed: replay-safe, invalid items surfaced | 2 | — |
| Workflow services live: schedule + poll triggers, emit, chaining, Slack delivery | 3 | — |

## Billing

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Checkout → grants → overage → cut-off → reactivation (Stripe test mode + test clocks) | 2 | — |
| Credits consumed properly: real session → LLM **and compute** meter events + credit decrement match consumption; Stripe webhook delivery live on staging | 3 | — |
| Out of credits: sandbox paused and not accessible | 3 | — |
| Out of credits: gateway LLM access gated; reactivates on refill | 3 | — |
| Plan gates the model list: user sees/uses exactly the models their plan allows | 3 | — |

## Upgrade & release

There is no single "upgrade path" — five distinct mechanisms, each tested at
its own seam. Mechanism map and current-coverage audit: the tier-4 section of
`README.md`.

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Worker self-update: sandbox worker N−1 heartbeats, downloads N from stubbed CDN base (`DESKTOP_DOWNLOADS_BASE_URL`), verifies, swaps, execs — with a live session on the box that survives | 4 | — |
| Catalog convergence full chain (sandbox): server catalog version bump → heartbeat → worker push → runtime reconcile → agent CLI in an **existing** sandbox reinstalled at the new pin — independent of any worker binary update | 4 | — |
| Catalog convergence on desktop local: same chain through the bundled desktop worker → local runtime → agent CLI reinstalled at the new pin | 4 | — |
| Desktop app update replaces bundled anyharness + worker sidecars; post-update catalog reconcile installs the right agent CLIs | 4 | — |
| Desktop feed artifact valid per release: `latest.json` shape, signature verifies against bundled pubkey, bundle sidecars report correct versions | 4 | — |
| Desktop real N−1 → N auto-update (nightly native lane; needs a test build with overridable feed endpoint) | 4 | — |
| SQLite migrations forward-apply on real N−1 data | 4 | — |
| New release's sandboxes provision from the new E2B template; existing paused workspaces still wake on their old image | 4 | — |

Old-template → new-template workspace movement is the managed-target
replacement path, which is a placeholder runbook today
(`specs/developing/runbooks/managed-target-replacement.md`) — its test enters
this registry when the mechanism is built.

**Known non-mechanisms (product decisions, not test gaps):** the anyharness
binary has no in-place update path anywhere — sandboxes get it only via new
template → new sandbox (worker ignores `desiredVersions.anyharness`; the
supervisor `update/` module stages but never fetches or swaps), and desktop
gets it only inside the app bundle. Until that is either built or declared
immutable-by-replacement, there is nothing to test.

## Deferred — add on first production break

Explicitly not in scope until one breaks in production (postmortem rule then
applies and the test lands with the fix):

- OpenCode configuration correctness per harness
- Full agent × auth-method matrix (beyond the default auth method per agent)
