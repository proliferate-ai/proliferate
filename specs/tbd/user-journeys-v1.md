# User journeys v1

Distinct personas for every kind of user, split by lane (managed cloud vs
self-hosted), each with a validated flow. Grounded in the current docs
(`~/landing/content/docs`) and specs (`specs/tbd/self-hosting-v1.md`,
`specs/tbd/goals-and-workflows-v1.md`).

Legend: ✅ supported today per docs · ⚠️ friction or gap worth fixing · 🔮 not built (roadmap / enterprise-gated)

Persona map:

| Lane | Persona | One-liner |
| --- | --- | --- |
| Managed cloud | A1. Individual developer | Solo dev, converts from free credits to paying |
| Managed cloud | A2. Pilot basic user | Invited team member, touches zero setup |
| Managed cloud | A3. Org admin | Owns the org: identity, billing, policies |
| Managed cloud | A4. Testing user | QA persona — walks every surface end to end |
| Managed cloud | A5. Self-host-minded dev on hosted | BYO keys/local models, hosted control plane |
| Self-hosted | B1. OSS fanatic | Self-hosts for himself, BYO everything |
| Self-hosted | B2. Self-host operator | Stands it up for the team, day-2 owner |

---

## Lane A — Managed cloud

### A1. Individual developer

**Archetype**
- Current setup: Codex. Likes the smoothness of Codex.
- Agents: has some installed locally, not all. Workflows: never tried.
  Cloud: never tried.
- Mindset: wants day-one value with zero config; pays once the product has
  proven itself.

**Flow**

1. **Downloads product + authenticates** ✅ — desktop app from
   `downloads.proliferate.com`, GitHub OAuth sign-in, personal default org
   auto-created.
2. **Onboards** ✅ — quickstart: add repo, create workspace (local checkout /
   worktree / cloud), see the review surface. Free $5 gateway credit means
   models work with no keys.
3. **Uses an agent they have locally (Codex)** ✅ — native sign-in route on
   their existing subscription; local runs never touch billing.
4. **Uses an agent they don't have locally** ✅ — Proliferate auto-installs
   the harness on first use; with no subscription, the session routes through
   the gateway and draws LLM credits.
5. **Likes that agent** ✅ — keeps using it via the gateway. This is the
   conversion moat: the gateway let them try an agent they had no
   subscription for.
6. **Gateway credits expire → prompted to pay** ✅⚠️ — prompt must offer both
   outs: top-up/buy credits (Settings → Billing) *or* switch to native
   sign-in / own API key. Docs promise "the gateway is never required";
   verify the empty-credits UX shows the escape hatch, not just a paywall.
7. **Sets an API key** ✅⚠️ — Settings → Agents → harness → API-key route;
   stored on the account, follows across devices. Copy bug: the billing page
   lists "bring your own model provider keys" as Enterprise (it means
   org-wide gateway BYOK) — reads as contradicting personal BYOK.
8. **Creates a cloud workspace** ✅ — Connect GitHub App → Set up Cloud
   environment → personal E2B sandbox provisioned, repo materialized. Free
   plan: one cloud sandbox at a time.
9. **Syncs a test workspace to the cloud** ⚠️ — no true "sync" today; target
   is fixed for the workspace's life, so it's publish-branch + reopen in
   cloud. Real move is the workspace-mobility machinery (cloud→local landing
   now, local→cloud follow-up). Frame onboarding copy accordingly.
10. **Uses cloud until credits expire → prompted to pay again** ✅ — two
    ledgers: compute credits (PCUs) and LLM credits. Compute meters even
    with BYOK, so this paywall fires regardless. Upgrade: Core via Stripe,
    or top-up.
11. **Builds a workflow (locally)** ✅ beta — Workflows in sidebar; personal
    automation, run location Local (worktree); same harness/model/access
    controls as chat.
12. **Runs daily** ✅⚠️ — daily schedules supported (incl. weekday-only).
    Local schedules only fire while the app is open → natural nudge to
    "move to personal cloud," which re-engages the compute meter. Free plan
    caps at 1 workflow/person → another upgrade prompt.

**Net**: real end-to-end today. Polish: credits-exhausted UX (6), BYOK copy
contradiction (7), sync-to-cloud framing until mobility ships (9).

### A2. Pilot basic user

**Archetype**
- Engineer at a company running a Proliferate pilot. Did not choose the tool
  and sets nothing up; an admin (A3) did. Uses whatever agent the org allows.
- Success bar: from invite email to first reviewed agent diff in under
  15 minutes, without asking anyone for help.

**Flow**

1. **Receives invite** ✅ — email invite or org join link from the admin;
   signs in (GitHub OAuth, or company SSO on Enterprise) and lands in the
   org, role **member**.
2. **Downloads the desktop app** ✅ — signed build; no config needed on
   hosted.
3. **Inherits org setup** ✅ — org agent policies (allowed harnesses, auth
   routes, permission levels), org secrets, and pre-connected repos are
   already there. The GitHub App is installed on org repos by the admin;
   the user may still see a personal **Connect GitHub App** authorize prompt
   on first cloud setup. ⚠️ Validate this first-cloud-workspace moment for an
   invited member — it's the most likely "ask the admin" stall.
4. **Runs their first agent** ✅ — picks from allowed harnesses; auth via org
   gateway/budget or their own subscription per policy. Per-member budgets
   keep spend bounded.
5. **Works the core loop** ✅ — workspace per task, review diff, publish PR.
6. **Hits a policy wall** ✅ by design — disallowed harness or auth route is
   hidden/blocked by enforcement. ⚠️ The block should say *why* (org policy)
   and *who* to ask, or it reads as a bug.
7. **Uses team workflows** ✅⚠️ — can benefit from team automations but
   cannot create, edit, run, or pause them (org-admin only today). Wants at
   least "run now" delegation.

**Net**: the invited-member path mostly rides on A3's setup. The two moments
to test hard: first cloud workspace as a non-admin (3) and policy-block
messaging (6).

### A3. Org admin

**Archetype**
- Eng manager or staff eng who owns the Proliferate org on the hosted
  product. Accountable for access, spend, and governance; not necessarily a
  heavy agent user themselves.

**Flow**

1. **Creates the org + plan** ✅ — starts Core via Stripe checkout (org
   creation is gated on it) or an Enterprise trial. Settings → Billing shows
   org-wide usage; owners/admins manage plan and billing details.
2. **Invites the team** ✅ — email invites or join link; assigns owner /
   admin / member roles in Members & groups.
3. **Registers SSO (Enterprise)** ✅ — connects an OIDC IdP (Okta, Entra,
   Auth0, Google, GitLab guides exist). JIT provisioning: SSO sign-in
   creates the account, bypassing invites.
4. **Asks about SCIM registration** 🔮 — not available: no SCIM endpoint, no
   bearer token to generate, no IdP connector. Docs are honest and offer the
   interim: SSO for authentication + manual invites/roles for provisioning.
   ⚠️ **Deprovisioning gap, must be stated in every enterprise convo**:
   disabling a user at the IdP does *not* revoke Proliferate access; the
   admin must also remove them from Members. SCIM is planned in the
   Enterprise identity tier (with air-gapped/K8s).
5. **Sets governance** ✅ — org agent policies: allowed harnesses, auth
   routes, permission levels, command allow/deny, data boundaries; per-member
   budgets for spend.
6. **Manages org model access** ✅/🔮 — org members draw on org billing;
   org-wide provider keys for the managed gateway are Enterprise.
7. **Owns team workflows** ✅⚠️ — creates team automations in the org cloud;
   is also the bottleneck, since every create/edit/run/pause needs an org
   admin. Delegation is the top ask.
8. **Audits and offboards** ⚠️/🔮 — offboarding is manual member removal
   (see 4); audit trails are Enterprise. Verify member removal actually
   revokes live sessions and sandbox access, not just the roster row.

**Net**: identity is the soft spot — SSO registration works, SCIM doesn't
exist, and the IdP-disable ≠ access-revoked gap is the single most important
caveat to surface proactively.

### A4. Testing user

**Archetype**
- Us (or a designated QA hire) wearing a user hat: goes through every single
  surface on managed cloud to make sure it works, on a fresh account, before
  releases and after big lands.
- Not a persona we design *for* — a persona we *run*. This section is the
  checklist.

**Flow / checklist** (each item = fresh-account behavior to verify)

1. **Acquisition**: download page → install → GitHub OAuth → default org
   exists; re-login on second device carries auth selections.
2. **Agents × routes matrix**: for each harness (Claude Code, Codex,
   OpenCode, Grok, Cursor) × each route (native sign-in, API key, gateway):
   status badge correct in Settings → Agents, session actually starts,
   auto-install fires for a harness not on the machine.
3. **Workspace targets**: local checkout, new worktree, cloud — create, run
   an agent, review diff, publish PR from each. Confirm the fixed-target rule
   and the publish/reopen handoff between targets.
4. **Cloud provisioning edges**: GitHub App not authorized → prompt; app not
   installed on repo → admin-needed message; sandbox provision → reuse warm
   sandbox across repos; cloud-only repo (no local clone).
5. **Billing edges** (the money paths, most important to test by exhausting
   them): burn the $5 LLM credit to zero → verify the prompt offers BYOK
   escape hatch; exhaust/simulate compute credits → verify second paywall;
   top-up toggle; Free-plan limits (one concurrent sandbox, 1 workflow);
   Core upgrade via Stripe; downgrade doesn't kill running sandboxes.
6. **Workflows**: create personal-local, personal-cloud; daily + weekday
   schedule fire correctly; local schedule with app closed does *not* fire
   (and messaging says so); Run now; each run gets a fresh workspace.
7. **Org surface** (second test account as member): invite, role change,
   policy enforcement (blocked harness/route messaging), per-member budget
   hit, member removal revokes access.
8. **Integrations**: connect Linear/Notion, agent can call them in-session.
9. **Recovery paths**: expired native CLI login mid-session, revoked GitHub
   App, deleted repo, sandbox wake-after-idle.

⚠️ Standing gap: several of these (credit exhaustion, budget hit, downgrade)
need test hooks or a staging billing lane to be routinely testable — worth
building rather than testing them only in prod.

### A5. Self-host-minded dev on hosted cloud

**Archetype**
- The OSS/local-models type (loves self-hosted models, runs Ollama/vLLM,
  distrusts vendor lock-in) who nonetheless uses *our hosted* control plane
  because standing up a server for one person is overkill.
- Mindset: will use hosted as long as nothing is forced through our gateway
  and the exit door (self-host later) visibly exists.

**Flow**

1. **Signs into hosted, skips the gateway** ✅ — free credit sits unused;
   configures native sign-ins, own API keys, or a local/self-hosted model
   endpoint per harness. Docs state the gateway is never required.
2. **Runs everything local** ✅ — local checkouts/worktrees are free forever;
   code and model traffic stay on their machine even though the control
   plane is hosted. ⚠️ Document precisely what metadata the hosted control
   plane does see for local runs — this persona will ask.
3. **Points a harness at a local model** ✅ per the local & self-hosted
   models doc — with per-harness caveats; validate the doc's "what's really
   possible today" matches each harness's current behavior.
4. **Tries cloud selectively** ✅ — maybe one cloud workspace for
   laptop-closed runs; accepts compute metering, still BYOK for models.
5. **Keeps the exit door in view** ✅ — same desktop app repoints to a
   self-hosted server via `~/.proliferate/config.json`; hosted → self-host
   migration is account/repo re-setup. ⚠️ No documented data-export /
   migration path from hosted to self-hosted; even a manual guide would
   defuse the lock-in objection.

**Net**: hosted-with-BYO-everything works. The persuasion gaps are
transparency artifacts, not features: local-run metadata disclosure (2) and
a hosted→self-host migration note (5).

---

## Lane B — Self-hosted

### B1. OSS fanatic (self-hosts for himself)

**Archetype**
- Current setup: OpenCode + local models; allergic to lock-in and to code
  leaving their machine. Automates with cron + shell today.
- Found us via Show HN / the GitHub repo; reads the license and telemetry
  docs before the quickstart. Evangelizes if the self-host story is honest;
  churns loudly if anything is secretly gated.

**Flow**

1. **Audits the claims on GitHub** ✅ — open source, fully self-hostable;
   telemetry is first-party, anonymous in `self_managed` mode, disableable.
2. **Tries desktop-only first** ✅ — local checkouts/worktrees free forever;
   skips the gateway entirely (native sign-ins, API keys, local models).
3. **Stands up their own server** ✅ — `bootstrap.sh` → Docker Compose
   (Caddy, Postgres 16, API + migrations) on a cheap VM, ~15 min; base
   install never gated on anything external.
4. **Claims the instance** ✅ — setup-token claim, `ADMIN_EMAILS` floor,
   `SINGLE_ORG_MODE` default-on, secrets auto-generated.
5. **Points the desktop at their server** ✅ — `~/.proliferate/config.json`,
   same signed build. ⚠️ No web app in self-host v1; say so up front.
6. **Runs agents with BYO auth** ✅ — same harness support; no credits UI on
   self-host (verify nothing billing-shaped leaks through).
7. **Invites a friend** ✅ — invite-as-allowlist self-registration.
8. **Adds own cloud sandboxes (optional)** ✅⚠️ — GitHub App manifest flow +
   own E2B account/template + public HTTPS URL; heaviest lift in the
   journey, the add-on doc must be bulletproof.
9. **Adds the model gateway with own keys (optional)** ✅ — self-hosted
   LiteLLM: central keys, per-user virtual keys/budgets; no credits, no
   Stripe.
10. **Tries to schedule a workflow** ⚠️ — scheduler tick is server-side and
    the worker tier isn't in self-host v1, so scheduled automations are
    effectively hosted-only; Run now works. Sharpest gap for this persona —
    document it honestly.
11. **Asks about air-gapped / Kubernetes** 🔮 — route to /enterprise, not
    built; docs pages exist and must not overpromise.

**Net**: 1–9 genuinely un-gated, which is the whole pitch. Honesty
requirements: no web app (5), no self-hosted scheduled automations yet (10).

### B2. Self-host operator (stands it up for the team)

**Archetype**
- DevX/infra lead at a 50–500-person company; team on an ungoverned mix of
  Cursor and Claude Code personal subs, security asking questions.
- Provisions agents for others rather than running them; needs SSO, secrets
  handling, spend control, auditability, and a credible day-2 story — inside
  the company VPC.

**Flow**

1. **Evaluates hosting model** ✅ — hosted (recommended default) vs
   self-hosted in their VPC (AWS one-click / GCP / Docker anywhere); framed
   as a control-plane locality decision.
2. **Stands up the pilot** ✅ — self-host quickstart on a VM; claims the
   instance, sets `ADMIN_EMAILS`, ≥1-admin invariant holds, no permanent
   superuser.
3. **Wires identity** ✅/🔮 — invite-allowlist for the pilot; SSO OIDC with
   JIT provisioning (bypasses allowlist) on Enterprise. **SCIM registration:
   not built** — no endpoint, no bearer token, no IdP connector; interim is
   SSO + manual invites/roles, and ⚠️ IdP-disable does not revoke access
   (manual member removal required). This is the compliance question they
   will ask first; answer it before they do.
4. **Enables cloud sandboxes** ✅ — GitHub App via manifest flow (creds
   DB-encrypted, not env vars) + company E2B account with version-stamped
   template + public HTTPS URL.
5. **Centralizes model access** ✅ — LiteLLM gateway add-on with company
   provider keys; per-user virtual keys + budgets = predictable, revocable
   spend.
6. **Sets governance** ✅ — org-wide policies: allowed harnesses, auth
   routes, permission levels, command allow/deny, data boundaries.
7. **Rolls out the desktop app** ✅ — official signed app + managed
   `~/.proliferate/config.json` (MDM-distributable); no custom build.
8. **Stands up team workflows** ✅⚠️ — org-cloud automations survive laptops,
   but every create/edit/run/pause needs an org admin → this person becomes
   the bottleneck; delegation is the first ask. (Also see B1-10: scheduled
   automations depend on the hosted worker tier — confirm the self-host
   story here before promising it.)
9. **Operates day-2** ✅⚠️ — one-command updates, version pinning,
   `self_managed` telemetry, sizing guidance. Scale-out past a single VM
   (ECS, 200+ users) is gated on the worker-tier RFCs; support is GitHub
   issues in v1. Be upfront on both.
10. **Expands** 🔮 — air-gapped, Kubernetes, SCIM, audit trails →
    /enterprise conversation.

**Net**: VM pilot → governed rollout is coherent. This buyer pushes on three
things: SCIM + deprovisioning (3), team-workflow delegation (8), and the
single-VM ceiling (9).
