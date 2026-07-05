# Team + Web v1 — bootstrap plan for the cloud/team product

*2026-07-04 draft. Companion to: self-hosting-v1.md, goals-and-workflows-v1.md, and the vault Scale Plan. Assumes single-player (local IDE + cloud sandbox, goals/loops) stable. This is pre-spec: V-items must be verified against code before build items are sized for real.*

## 0. Framing

No new control plane. The server already is the control plane (orgs, policies, budgets, command queue, projections, gateways). Web is a *view* of it; team features are *surfacing* of schema that mostly already exists. The work is exposure, not invention. Two corrections to the working mental model:

1. **Web sees cloud, not local.** Cloud sessions are server-mediated twice over (durable: worker event tail → `cloud_session_projection`; live: `cloud_workspace_exposure`; writes: `POST /v1/cloud/commands` → worker lease). Local desktop sessions do NOT project to the server — the desktop reads them via local SDK (evidence: Goals fleet pane reads "local via SDK, cloud via `cloud_session_goal` projection"). So web v1 = the org's **cloud** fleet. Local-session visibility on web = extending tail-upload to desktop targets — real work, privacy-sensitive (must be opt-in exposure), deferred.
2. **"Web is easy" is true only with the W5 cut.** Read/steer/approve/start is days (product-ui chat renderer is already factored for reuse; generated cloud client exists; password + OIDC web auth routes exist server-side). Terminal/file-tree/git-panel parity is a quarter. Web v1 is the fleet-and-steering surface, not a browser IDE. Desktop = do the work; web = see and steer the org's work.

## 1. The consolidation insight

If the desktop's live path is direct-to-sandbox (V1 below), web needs a server-side brokered attach path. Do NOT build that as web plumbing. Build it once as **the brokered attach API**: authenticated server→runtime relay (org ACLs enforced at the server), generalizing the runtime-access-gateway path already locked for workflow StartRun delivery. The same endpoint then serves: web live view, Slack producer (Gate 3), Developer API / "Programmatic access (CLIs + MCPs)" (enterprise pricing line). Three roadmap items, one artifact.

## 2. Verify list (V1–V5, ~half a day, do before sizing)

- **V1** Desktop cloud-session live path: direct E2B exposure URL or server-proxied? → decides whether brokered attach API is new or a generalization. Look: `cloud_workspace_exposure` model, live-sessions specs, `specs/codebase/primitives/cloud-commands.md`.
- **V2** Confirm local sessions never project (fleet scope for web v1).
- **V3** `sandbox_profile` → `cloud_targets` cardinality: does `profile_target_role='primary'` mean 1:1? → is org automation serialized on one sandbox (assumed yes; see T6).
- **V4** Generated cloud client auth mode (cookie vs bearer) + CORS/browser-origin readiness of server middleware.
- **V5** Workflow StartRun runtime-access-gateway status: landed, partial, or spec? (Reusable as §1's relay?)

## 2a. V-answers (2026-07-04 overnight code audit)

- **V1 ANSWERED — server-proxied.** Desktop attaches to cloud sessions via the server's gateway reverse proxy `/v1/gateway/cloud-sandbox/anyharness/*` (HTTP/SSE + WS). The brokered attach path already exists; Track W rides it with org ACLs added. No direct-to-sandbox URLs in the desktop.
- **V2 ANSWERED — stronger than assumed: NO projection plane on main at all.** Spec 04's command queue, preflight, wake gate, exposure ledgers, and session projections were deleted from main by #823 and survive only in the parked SSH stack (#881–886). Cloud transcript truth is sandbox SQLite, read live through the gateway. Consequence: web read-path v1 = live gateway reads (wakes the sandbox — violates the passive-view goal); durable fleet views (W3, T2, Goals fleet pane cloud lane) need the projection plane → **landing #881–886 is the enabler for Track W/T2**, on top of being the runner-cloud v1.
- **V3 PARTIAL:** #944 (org profiles v0 draft) chose unique index on (organization_id, display_name) — multiple named org sandboxes per org allowed, per-run sandboxes (T6) not foreclosed.
- **V5 ANSWERED:** no runtime-access-gateway on main; the gateway proxy is the live relay. StartRun delivery rides it or the parked command plane. V4 still open.

## 3. Track W — web surface (cloud-only, steer-first)

- **W1 App shell:** static SPA (Vite) consuming `product-ui` (shared chat/markdown renderer — desktop already consumes its built dist) + generated cloud client. Static SPA over Next: self-host parity (one Caddy route, same-origin API, no SSR runtime in compose). Mobile = responsive same app.
- **W2 Auth:** password route (exists, web/mobile-only today) + GitHub OAuth + SSO OIDC JIT (exists). Org context switcher. Web is where SSO actually earns its keep in the demo.
- **W3 Read path:** session/workspace list + transcript history from projections; live attach per V1 (exposure WS or brokered attach API). Goals/loops chips read same projections as desktop fleet pane.
- **W4 Write path:** composer → cloud commands (`send_prompt`, interrupt, approval responses via InteractionRendezvous); start session on an org profile; wake gate already handles sleeping sandboxes.
- **W5 Scope cut (the decision that makes web cheap):** NO terminal, NO file tree, NO git panel. Read, steer, approve, start, PR links out. Revisit only on customer pull.
- **W6 Self-host:** web ships as a compose service later — consciously revisits self-hosting-v1 D12 ("web out of v1"). D12 was scoped when the product was a single-player IDE; a team fleet product's shared pane of glass is the browser. Hosted-first now, compose service in Gate 3.

## 4. Track T — team execution

- **T1 Surface org sandbox profiles.** Schema landed (`owner_scope=organization`, `organization_id`; agent-auth selection already keyed `(sandbox_profile_id, agent_kind)`; org credential sharing already exists via `AgentAuthCredentialShare`). Work: provisioning binds org billing subject; org-settings UI (create profile, template, agents, auth selection); member-access policy (who may start sessions on it).
- **T2 Org session visibility ACL.** Decide default now, it shapes projection queries + UI: sessions on org profiles visible to all org members (Ramp-Inspect-style transparency — recommended); personal profiles stay private. Controller model unchanged (one active controller, explicit handoff — already the written teamwork model; no presence/CRDT/multiplayer editing this month).
- **T3 Service accounts v0.** User-shaped principal with `kind=service`: excluded from login, seats, SSO JIT, invites, email; owns integration connections (admin OAuths on its behalf), an `AgentGatewayBudgetSubject` + virtual key, agent-auth selections. Every existing ownership FK (`workflow_run.executor`, profile owner, credential owner) just works. Deliberate shortcut — first-class table is a post-pilot refactor; wrong trade this month.
- **T4 Run-as.** `workflow.run_as = self | <service_account>`; `workflow_run.executor` already exists in schema (always owner today). Admission: org-admin-only to bind an SA. Dispatcher already synthesizes `AgentAuthExternalScope` on `start_session` — scope from the SA's selections instead of the human's. Policy overlay evaluates the SA as the actor. This is the "automation that outlives people" demo.
- **T5 Shared automations.** Org-scoped workflows runnable by members, editable by admins (fuller delegation later — user-journeys A2/B2 bottleneck). Scheduler tick is hosted-only; self-host scheduling needs the worker tier in compose (Gate 3, already flagged in self-hosting-v1).
- **T6 Run-scoped sandboxes (deferred, but don't bake against it).** If V3 confirms 1:1 primary-target, org automations serialize on one sandbox. Pilot-scale fine (runs queue). Post-pilot: per-run ephemeral sandbox from the profile template, metered per run to org billing. T1 must not deepen the 1:1 assumption.

## 5. Sequencing + sizing (post-F0; deployed-week mornings + Gate 2)

V1–V5 (0.5d) → T1 (2–3d) → W1–W4 skeleton (3–4d given product-ui reuse; +1–2d if brokered attach is new) → T3+T4 (2–3d) → T2 (1d) → W5-level polish for the enterprise demo. T5 partial (org-runnable workflows), T6 deferred. Total ≈ 9–13 eng-days — the team-lane budget for Gates 1–2, tight but real.

**What the enterprise demo gains:** open a browser, see the org's whole cloud fleet live (every agent, whose identity it runs under, what it's spending), click in, steer, approve — then show one automation owned by a service account with its own budget and revocable key. That upgrades the 4-beat demo's governance beat into the close.

## 6. Explicit non-goals this month

Local sessions on web; browser IDE parity (terminal/files/git); presence/multiplayer editing/comments; per-run sandbox pooling (T6); Slack producer (rides brokered attach API in Gate 3); SCIM; first-class service-account table.
