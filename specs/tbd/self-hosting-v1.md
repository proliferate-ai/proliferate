# Self-Hosting V1 — End-to-End Design

Status: decisions D1–D14 ratified by Pablo (2026-07-01), grounded in a full
code-scoping pass (file references below were verified against the tree, not
assumed). This document is the narrative design of record. The deploy
mechanics it builds on live in `specs/developing/deploying/self-hosted-deploy.md`
and `self-hosted-aws.md`; the public docs live in the landing repo at
`content/docs/deployment/`.

---

## 1. Why we're doing this, and for whom

There are exactly two self-hosting audiences, and they want opposite things:

1. **"I want to use the product."** The large wave of developers who ask about
   self-hosting mostly as a trust signal. The right answer for them, stated
   out loud in the docs, is: *self-hosting is real and supported, but you're
   better off on the hosted control plane — point your desktop at it and go.*
   Most of them are actually served by the desktop app alone, which is already
   fully local. We optimize the message for these people, not the funnel.
2. **The team champion with a reason** — compliance, data locality, a network
   boundary. They run the VM lane, they have patience for GitHub App + E2B
   setup, and they're the commercially interesting self-hosters. Everything in
   this document targets them.

(Enterprise — Kubernetes, air-gapped, SCIM — routes to /enterprise. Not built.)

The four happy paths, in order of how much we invest:

| Path | State |
|---|---|
| Hosted control plane + repointed desktop | Recommended default; docs say so |
| Desktop-only local | Already the OSS story; zero server |
| Self-hosted control plane on a VM | **This document.** Base install → add-ons |
| Scale-out (ECS, 200+ users) | Later; gated on the worker tier RFCs |

The core framing that keeps the work small: **base install is never gated on
anything external.** A self-hoster gets sign-in, the org, invitations, and
self-managed compute targets from `bootstrap.sh` alone. Cloud sandboxes
(GitHub App + E2B + public URL), the LiteLLM gateway, and SSO are *add-ons*
layered afterwards.

---

## 2. The mental model

A deployment is four pieces; only the first is required.

```text
                        ┌───────────────────────────────┐
   official CDN         │   Self-hosted VM               │
   downloads.proliferate│   ┌───────┐  ┌────────────┐    │
   .com (signed desktop │   │ caddy │──│ api (FastAPI)│   │
   builds, runtime      │   └───────┘  │  + migrate   │   │
   tarballs, manifests) │      443     └──────┬───────┘   │
        ▲               │                     │           │
        │ version pins  │              ┌──────┴───────┐   │
        │ declared by ──┼──────────────│ postgres 16  │   │
        │ the API       │              └──────────────┘   │
        └───────────────┴───────────────────────────────┘
              ▲                    ▲                 ▲
              │                    │                 │
        Desktop app          E2B sandboxes     Self-managed
        (official build,     (operator's own   targets (their
        repointed via        E2B team +        Linux boxes via
        config.json /        template)         enrollment token)
        in-product connect)
```

Two architectural facts, verified in code, shape everything else:

**Fact 1 — the runtime is push-model.** The local anyharness sidecar is never
told the API base URL. The desktop spawns it with no URL at all
(`apps/desktop/src-tauri/src/sidecar.rs` `build_spawn_command` ~line 358: just
`serve --host 127.0.0.1 --port <port>`), and every piece of server-derived
state arrives over the local HTTP API and persists in `db.sqlite`:

- agent-auth config (gateway URLs + virtual-key tokens, encrypted) via
  `PUT apply_agent_auth_config` (`anyharness-lib/src/api/router.rs:59`)
- the runtime-config manifest (JWT issuer, RS256 verification keys,
  `target_id`, credential refs, MCP launches) via `PUT apply_runtime_config`
  (`api/http/runtime_config.rs:23`), persisted in `runtime_config_current`
  (`domains/runtime_config/store.rs:34`) and re-applied on every boot
  (`app/mod.rs:188-192`)

The one recent wrinkle: the integration catalog gateway (in-flight on
`codex/integration-catalog-gateway`) makes the runtime call the control plane
directly (`POST /v1/cloud/integration-gateway/mcp`, bearer JWT, 8h TTL,
in-memory only) — but the URL still arrives *inside the pushed manifest*,
synthesized server-side from `settings.api_base_url`
(`server/.../runtime_config/domain/manifest.py:158-172`). Same push model.
Consequences: (a) "point the runtime at a new server" means *invalidate and
re-push persisted state*, not plumb a URL; (b) `API_BASE_URL` on a self-hosted
server is load-bearing — get it wrong and every pushed manifest points
integrations at a dead gateway.

**Fact 2 — configuration is env-only, read once.** The server is a pydantic
`Settings` loaded from `.env`/`.env.local` (`server/proliferate/config.py`);
the desktop reads `~/.proliferate/config.json` exactly once at boot
(`apps/desktop/src/main.tsx:199` → `bootstrapProliferateApiConfig()`,
resolution order in `lib/infra/proliferate-api.ts:31-37`: config file →
`VITE_PROLIFERATE_API_BASE_URL` → `http://127.0.0.1:8000`). Neither hot-reloads.
So "apply a change" is always "restart" (D2), and anything that must be
changeable at runtime (GitHub App credentials, below) goes in the DB, not env.

---

## 3. The install, end to end (what the operator actually does)

This is the journey the docs' Quickstart encodes; every step here maps to a
build item or already works.

### 3.1 Bootstrap (works today)

```bash
# B7 will make this a versioned tarball / curl|sh instead of a repo clone
cd server/deploy
cp .env.production.example .env.static
$EDITOR .env.static
```

```bash
# .env.static — the minimal truthful set for base install
SITE_ADDRESS=proliferate.corp.example.com
API_BASE_URL=https://proliferate.corp.example.com     # load-bearing, see Fact 1
PROLIFERATE_TELEMETRY_MODE=self_managed
PROLIFERATE_SERVER_IMAGE_TAG=0.3.0                    # pin, or `stable`
# JWT_SECRET / CLOUD_SECRET_KEY / POSTGRES_PASSWORD left blank:
# bootstrap.sh generates and persists them in .env.generated
```

```bash
./bootstrap.sh
# ...compose up: caddy (auto-HTTPS), db, migrate, api
# ...waits for health, then prints:
#
#   Setup token: 7f3a-...-c91b
#   Claim your instance: https://proliferate.corp.example.com/setup
```

`bootstrap.sh`, `update.sh`, `ensure-secrets.sh` (merges `.env.static` +
`.env.local` → `.env.runtime`), and the Caddyfile all exist today under
`server/deploy/`. The setup-token line is new (B1). Operators who can't do
public DNS/ACME get a documented BYO-cert Caddyfile variant (B8).

### 3.2 First-run claim (B1 — the design)

Today a fresh database is **unclaimable**: there is no signup route (the
fastapi-users `register_router` is not mounted — `server/proliferate/main.py:225-233`),
`password_auth_enabled` (`config.py:61`) only gates *login* for users that
already exist with a password set (`auth/identity/password.py:82,125`),
accounts are created exclusively inside OAuth callbacks
(`auth/identity/service.py` → `ensure_provider_identity` → `create_auth_user`),
and invitations both require an existing sender and an existing acceptor
account. Result: healthy server, nobody can ever log in.

The fix is the classic self-host pattern (Grafana/Portainer/Gitea), which is
also exactly what Onyx defaults to (`AUTH_TYPE=basic`,
`deployment/docker_compose/env.template:61`) — with one bug of theirs fixed:

```text
while user_count == 0:
    the server exposes a server-rendered claim page at /setup
    (version-independent: works in any browser before anything is installed)

claim(setup_token, email, password):
    verify token (minted at boot, printed by bootstrap.sh)
    BEGIN advisory lock                       # Onyx's race: their
        assert user_count == 0                # user_count==0 → admin check
        create_auth_user(email)               # is not locked
        update_user_password_hash(...)        # (onyx users.py:595-605)
        create THE instance org, owner=user   # single-org mode, §5
    COMMIT
    signup closes permanently
```

We reuse the exact functions the OAuth path calls today — `create_auth_user`
(`auth/identity/store.py:112`) and the org-creation path
(`server/organizations/registration.py:23`) — so no new account machinery.
The setup token is what makes a publicly reachable URL safe between
`bootstrap.sh` finishing and the operator claiming: only someone with shell
access to the box has the token. Headless/env-seeded provisioning is a later
alternative *input* to the same claim function, not v1.

### 3.3 ADMIN_EMAILS (B1)

```bash
# .env.local
ADMIN_EMAILS=pablo@corp.example.com,ops@corp.example.com
```

Semantics (deliberately stronger than Onyx's EE `admin_user_emails`, which
applies at account creation only — `backend/ee/onyx/server/seeding.py:43,55`):

- asserted at account creation **and at every login** — so adding an email to
  the list and restarting is the lockout-recovery path
- env is a **floor, not a ceiling**: removal from the list never demotes;
  in-product admin management moves people up

Paired with two invariants (D13): the instance must always have ≥1 admin, and
a listed user can't be demoted below admin while listed. The claimer is
otherwise an ordinary org owner — promotable, demotable, deletable. No
permanent superuser.

### 3.4 Inviting the team (B2 — invite-as-allowlist)

Adopt Onyx's model wholesale because it's simpler than "invitation creates the
account": an invite **allowlists an email**; the invitee self-registers with
email+password through the *same registration path the claim built*, reopened
for allowlisted emails only. Invite email delivery stays optional and
orthogonal (Onyx: `backend/onyx/auth/invited_users.py:29-32` allowlist,
`ENABLE_EMAIL_INVITES` orthogonal). Optional `ALLOWED_EMAIL_DOMAINS`
registration gate, kept strictly separate from role-granting (Onyx's
`VALID_EMAIL_DOMAINS`, `app_configs.py:174-184` — a gate, never a grant).
OAuth/SSO arrivals bypass the allowlist per SSO JIT policy.

Net effect of 3.2–3.4: **base install needs no GitHub OAuth app at all.**
GitHub sign-in becomes optional polish (`GITHUB_OAUTH_CLIENT_ID/SECRET`,
callback `https://<site>/auth/desktop/github/callback`).

### 3.5 Connecting desktops (B4-desktop)

**Status:** manual connect (URL entry -> `/meta` validation ->
trust-confirmation -> `set_app_config` -> relaunch) plus the origin guard
under "Server switch" below shipped in `feat/desktop-connect-server`. The
deep link, the settings "switch server" affordance, and per-server homes are
still open — see §9's backlog table for the exact split.

Before that PR, this worked only via a hand-edited file, read once at startup:

```json
// ~/.proliferate/config.json
{ "apiBaseUrl": "https://proliferate.corp.example.com" }
```

V1 target is in-product: a "connect to self-hosted server" entry on the
sign-in screen (`apps/desktop/src/components/auth/LoginScreen.tsx` /
`LoginPage.tsx`), a "switch server" affordance in settings, and a shareable
deep link:

```text
proliferate://connect?server=https://proliferate.corp.example.com
```

Mechanics, all verified against the code:

- a new `set_app_config` Tauri command using the existing atomic writer
  (`app_config.rs:155` `write_json_file_atomic` — currently only wired to
  `runtime-info.json`; there is no config write path today)
- **relaunch-to-apply** (D2): config is read-once, and the relaunch + idle
  restart machinery already exists for the updater
  (`lib/access/tauri/updater.ts:45-52` `relaunch()`,
  `hooks/access/tauri/use-update-restart-watcher.ts:37`)
- the deep-link bridge must be armed **before** the control-plane
  reachability gate (`orchestration-bootstrap.ts:57-77` currently arms it
  after), since connect must work signed-out; routing itself is a new
  `hostname === "connect"` branch in
  `lib/domain/auth/desktop-navigation.ts` next to the existing `join` handler
- a **trust-confirmation dialog** ("you are connecting to X") — a deep link
  that can repoint the app at an arbitrary API is a phishing vector

**Server switch = clean slate (D1), implemented structurally.** Rather than
adding a server-origin column to every runtime store, the entire app/runtime
home derives from the hashed origin:

```text
~/.proliferate/                       # official hosted (legacy root, no migration)
~/.proliferate/servers/<sha256(origin)[..12]>/   # each self-hosted server
```

Each server gets its own `db.sqlite`, so the boot-time rehydration
(`app/mod.rs:188`) *cannot* resurrect another server's JWT keys, gateway
tokens, or integration-gateway callback URLs — the class of stale-state bug
disappears instead of being managed. This is the same trick dev profiles
already use (`~/.proliferate-local/...`). The keychain data key
(`ANYHARNESS_DATA_KEY`) stays shared — it's a user-level secret. Local repos
associate with the server that registered them, so workspaces partition by
association; one server active at a time (D3); remote runtimes already read
the base URL from config (`commands/cloud_worker.rs:79`,
`ssh_tunnel.rs:557-583`) and follow the switch for free.

---

## 4. Versioning: the API is the root, and it actively converges the fleet

This is D6/D7, the deepest design in the effort. The problem: we ship fast,
self-hosted servers sit pinned, desktops auto-update — so *desktop newer than
server* is the steady state, and runtime binaries + E2B templates drift
silently. Today nothing even reports a true version: `/health` hardcodes
`0.1.0` (`server/proliferate/server/health.py:7-14`); the root `VERSION` file
is release tooling only.

The ruling: **everything the operator runs is downstream of the API version
they control, and convergence is mandatory, not advisory.**

```text
                 release CI stamps pins automatically
                 (DESKTOP_VERSION, RUNTIME_VERSION)
                              │
                    ┌─────────▼─────────┐
                    │  API (self-hosted) │  GET /meta
                    │  "I am server 0.3.0│  → { serverVersion,
                    │   desktop → 0.3.2  │      desktopVersion,
                    │   runtime → 0.3.1" │      runtimeVersion, ... }
                    └───┬───────────┬────┘
            desktop     │           │      heartbeat
        ┌───────────────▼──┐   ┌────▼──────────────────┐
        │ updater checks    │   │ supervisor compares    │
        │ {api}/desktop/    │   │ running vs declared,   │
        │ updater/latest.json│  │ downloads pinned binary,│
        │ → 302 to official │   │ verifies checksum,     │
        │ CDN manifest      │   │ swaps + restarts (B10) │
        └───────────────────┘   └────────────────────────┘
```

**Desktop (B4).** The Tauri updater takes runtime endpoints
(`updater.ts:9-21` currently calls `check()` bare; the endpoint is baked in
`tauri.conf.json:43-51`). We pass
`[{apiBaseUrl}/desktop/updater/latest.json, <official feed>]`, skipping the
server endpoint on official origins (`isOfficialHostedApiBaseUrl()`,
`proliferate-api.ts:54-60`). The server endpoint **302-redirects** to
`downloads.proliferate.com/desktop/stable/<pinned>/latest.json` — the server
carries only a version string, never the manifest, because manifests contain
per-platform minisign signatures that are a desktop-release artifact. The
safety property that makes all of this fine: the minisign pubkey baked into
the app (`tauri.conf.json:44`) verifies artifacts *no matter which endpoint
served the manifest* — a self-hosted server can choose the version but can
never ship an unofficial build. Release pipeline change: publish versioned
manifest paths (today only `desktop/stable/latest.json` exists,
`release-desktop.yml` publish-updater job).

**Runtime (B10 — new, mandatory per Pablo).** AnyHarness learns which version
it is *supposed to be* from the API through its existing heartbeat; the
**supervisor** performs the update: download the pinned binary (the API
already serves runtime binaries — `server/.../artifact_runtime/api.py`; the
desktop already tracks `runtime-version.json`), verify the checksum, swap and
restart **without losing active sessions** (drain or idle-window, the same
semantics as the desktop's idle restart). This applies to cloud sandboxes and
self-managed targets alike, and it is how desktop, anyharness, and cloud stay
in sync. It also self-heals stale E2B templates at boot instead of failing.
The session-preserving swap is the genuinely hard part; that's why B10 is its
own M-sized item, sequenced after B4-server's `/meta` endpoint exists.

**The promise to operators (D6):** N releases back on the API; `update.sh` is
the one operator motion; everything else follows. One command:

```bash
./server/deploy/update.sh
#  = docker compose pull
#    docker compose run --rm migrate
#    docker compose up -d
#    install-runtime.sh   (refreshes host runtime binaries)
#  + B3: template-staleness check → "run build-template.sh" if drifted
```

CI stamps the pins at release cut (no human bump); holding a shaky desktop
back is an exceptional manual override, not the workflow.

---

## 5. The org model: single-org mode as a membership policy

Hosted behavior today: every sign-in auto-creates a personal default org
(`ensure_default_organization_for_account`, fired from **three** call sites —
`auth/users.py:30`, `identity/service.py:484`, `auth/sso/service.py`), and
there is no superuser concept anywhere (`identity/store.py:112` hardcodes
`is_superuser=False`; no seed, no CLI).

A company self-hosting expects the opposite: *instance = our org.* The ruling
(D4) is **single-org mode behind an explicit flag**:

```bash
SINGLE_ORG_MODE=true    # default true everywhere EXCEPT hosted production
```

Explicit rather than derived from `PROLIFERATE_TELEMETRY_MODE` — deriving
would couple telemetry posture to org semantics. The mode is effectively
fixed once claimed; flipping a running instance is unsupported in v1.

The implementation rule that keeps this from rotting: **one policy object at
the registration boundary, not scattered `if` branches.** All three
account-creation call sites ask the same question through one function:

```python
# sketch — server/proliferate/server/organizations/membership_policy.py
class MembershipPolicy(Protocol):
    async def place_new_identity(self, db, user) -> Organization: ...

class HostedPolicy:          # today's behavior
    # create personal default org (registration.py:23)

class SingleOrgPolicy:       # self-host
    # instance org exists (created by the claim) → add user to it
    # no instance org yet → only the claim path may create one
```

Invite-as-allowlist (B2), the first-run claim (B1), and SSO JIT all become
*cases* routed through this policy instead of parallel code paths. This is
also why B1 and B2 are one design, built in that order.

---

## 6. Cloud sandboxes add-on: the two credentials and the template

Requirements recap (why this is an add-on, never base install): a publicly
reachable HTTPS URL (free with the VM lane), a GitHub App, an E2B account +
template. Two operator flows to fix:

### 6.1 GitHub App via manifest flow (B6)

Today: eight env vars (`github_app_*`, `config.py:172-180`) consumed at eight
call sites (`integrations/github/app_installations.py:41,44,51` — App JWT for
installation tokens; `app_user_tokens.py:39-40` — user-to-server exchange;
`cloud/github_app/service.py:75,253,339`; `webhooks.py:32` — HMAC), and
**zero prose documentation anywhere** on creating the App by hand. ~10 fiddly
manual steps; we've hit the PEM/ngrok gotchas ourselves.

GitHub's manifest flow collapses it to two clicks: the server POSTs an App
manifest, GitHub creates the App and redirects back with a code, the server
exchanges it (`POST /app-manifests/{code}/conversions`) and receives **all
five credentials at once** (`id`, `slug`, `client_id`, `client_secret`,
`webhook_secret`, `pem`).

```text
POST /admin/github-app/manifest/start    (operator-admin gated)
  → builds manifest {name, url, hook_attributes.url, redirect_url,
     callback_urls, permissions/events matching repo_authority + webhooks}
  → UI form-POSTs to github.com/settings/apps/new?state=<signed>

GET  /admin/github-app/manifest/callback?code=&state=
  → exchange, persist, redirect to settings
```

Storage is the interesting decision: env can't hot-reload (Fact 2), so the
credentials go in the DB — a single-row `github_app_instance_config` with
`*_ciphertext` columns using the existing Fernet pattern keyed off
`CLOUD_SECRET_KEY` (`utils/crypto.py:13-16`; precedent: Slack tokens, MCP
secrets, LiteLLM virtual keys, repo env vars). The eight call sites switch
from `settings.github_app_*` to a `github_app_credentials()` provider —
DB-first, env-fallback, **cached in-process with invalidation on admin
update**, because webhook HMAC verification and App-JWT minting are hot
paths. Two sharp edges to carry into the security runbook: `CLOUD_SECRET_KEY`
becomes the root of repo-access trust, and rotating it must re-encrypt.

Sequencing: **after** `codex/cloud-github-app-auth-flow` lands (~27k-line
refactor of exactly these files). Until then, the docs' manual page (exact
permissions, webhook URL, callback URL, the six env vars) is the path.

### 6.2 E2B template: every self-hoster builds their own (B3)

E2B has **no public templates** — templates are team-scoped, so the AWS
stack's current default pointing `E2B_TEMPLATE_NAME` at Proliferate's family
(`server/infra/self-hosted-aws/template.yaml:999,1075`) is broken for anyone
else's API key and must be fixed.

The good news from scoping `scripts/build-template.mjs`: **no Rust toolchain
needed.** The script consumes prebuilt binaries via
`CLOUD_RUNTIME_SOURCE_BINARY_PATH` / `CLOUD_WORKER_...` / `CLOUD_SUPERVISOR_...`
(`:490,497,503`) — the same binaries `install-runtime.sh` already places at
`/opt/proliferate/bin` — needs only `E2B_API_KEY` (`:472-476`; `E2B_TEAM_ID`
only for `--publish`, which operators don't use), and builds through E2B's
*API* (the `Template` SDK builder, `:294-379`), not local Docker builds.

Design rule: **the deploy host needs only Docker.** So the builder ships as a
container, not a `make` target requiring Node on the host:

```bash
./server/deploy/build-template.sh
#  = docker run ghcr.io/proliferate-ai/template-builder \
#      -e E2B_API_KEY -v /opt/proliferate/bin:/bin/proliferate:ro ...
#  prints: E2B_TEMPLATE_NAME=proliferate-runtime-cloud   → .env.local
```

And drift becomes loud instead of silent: the template bakes a version stamp
at `/home/user/.proliferate/template-version`, the supervisor reports it at
boot, provisioning fails with a clear "rebuild your template" error on
mismatch, and `update.sh` runs the staleness check (today the compat contract
is purely implicit paths — `constants/sandbox/e2b.py`:
`/home/user/anyharness`, `/home/user/.proliferate/bin`, port 8457 — and a
stale template just fails weirdly at sandbox boot). B10 later softens this
further by self-updating the runtime inside booted sandboxes.

---

## 7. Model gateway add-on (B5, rides the agent-auth stack)

Docs and design are written against **LiteLLM as-if-landed** (Pablo's call).
The env surface is real on `agent-auth/02-litellm-service`:

```python
# server/proliferate/config.py on the branch — Bifrost fields all deleted
agent_gateway_enabled: bool = False
agent_gateway_litellm_base_url: str = "http://127.0.0.1:14000"  # admin, in-VPC
agent_gateway_litellm_public_base_url: str = ""                  # what sandboxes call
agent_gateway_litellm_master_key: str = ""
agent_gateway_litellm_timeout_seconds: float = 30.0
```

Reconciler and per-provider BYOK toggles are deleted concepts; managed
provider keys become LiteLLM-container env, not our DB. What the branch did
**not** do — and what B5 adds inside the stack's deploy slice — is the
self-host surface: `server/deploy/docker-compose.production.yml` has no
`litellm` service and `.env.production.example` still lists dead Bifrost vars
(silently ignored by `Settings`). The add-on gives operators two shapes:

```yaml
# docker-compose.production.yml (added services, mirroring the dev compose)
litellm:
  image: <in-repo server/litellm/Dockerfile image>   # config baked
  environment:
    LITELLM_MASTER_KEY: ${AGENT_GATEWAY_LITELLM_MASTER_KEY}
    ANTHROPIC_API_KEY: ${...}   # the operator's provider keys
litellm-db:
  image: postgres:16
```

…or external-URL mode (operator runs LiteLLM elsewhere, sets the two URLs).
Scope on self-host (D10): **central keys + per-user short-lived keys +
budgets.** Credits/billing/top-up surfaces must not render on a self-hosted
instance. Without the add-on, users simply bring their own agent
subscriptions (Claude/Codex sign-in) — the gateway is never required.

---

## 8. Operations: support, telemetry, CI

- **Telemetry (existing):** `PROLIFERATE_TELEMETRY_MODE=self_managed` means
  anonymous first-party telemetry only; vendor telemetry (Sentry etc.) is
  gated to `hosted_product` (`utils/telemetry_mode.py`, billing policy
  `server/billing/policy.py`). Fully disableable
  (`PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED`, desktop `telemetryDisabled`).
- **Support (D11):** v1 is GitHub issues. An opt-in "send support bundle to
  Proliferate" is a later add.
- **CI (B9, D14 — blocking on PRs to main):** a job that boots
  `docker-compose.production.yml` (http-only/sslip variant) and smokes the
  actual operator journey: bootstrap → claim with setup token → login →
  invite → `/health` + `/meta` + updater redirect. Rationale: path 1 ("we run
  it daily so it works") is true of dev, not of the production compose —
  nobody lives in this lane, and with an N-releases promise, regressions
  compound silently. This is the highest reliability-per-effort item in the
  plan.

---

## 9. Build items, dependency-ordered

| # | Item | Size | Blocked by |
|---|---|---|---|
| B1 | First-run claim + `ADMIN_EMAILS` + single-org membership policy | S/M | — |
| B2 | Invite-as-allowlist registration (+`ALLOWED_EMAIL_DOMAINS`) | S | B1 (same registration path) |
| B4-server | `/meta` version endpoint + updater 302 + real `/health` + CI-stamped pins | S | — |
| B7 | Deploy-bundle distribution (tarball / `curl\|sh`) | S | — |
| B9 | Self-host CI lane, blocking | S/M | B1 (smokes the claim) |
| B3 | Containerized template builder + version stamp + `update.sh` gate + AWS default fix | S/M | — |
| B8 | BYO-cert / internal-CA Caddyfile variant + docs | S | — |
| B5 | LiteLLM self-host compose surface + env rewrite | S | agent-auth stack deploy slice |
| B10 | Supervisor-driven runtime self-update (session-preserving swap) | M | B4-server |
| B4-desktop | ~~In-product connect~~ (shipped: manual entry + trust-confirm + `set_app_config` write + relaunch) + deep link + per-server homes + updater endpoints | M | ux/wave-3 landing (LoginScreen/settings churn) |
| B6 | GitHub App manifest flow (DB-stored creds + provider + admin pane) | M | `codex/cloud-github-app-auth-flow` |

**B4-desktop, shipped subset (`feat/desktop-connect-server`):** manual
connect on the sign-in screen (`AuthScreenLayout`/`LoginScreen` ->
`useConnectServer` -> `ConnectServerDialog`) — URL entry, `GET {url}/meta`
validation, trust-confirmation dialog, `set_app_config` (new Tauri command,
read-modify-write on `config.json`, preserves unknown fields), relaunch.
Also a quiet "connected to X" indicator + reset-to-default. Alongside it, the
worker/runtime side now guards against injecting a previous server's gateway
token after a switch: `agent-auth/state.json` is stamped with
`issuing_server_origin` at push time and the render plane
(`route_auth::resolve_launch_route_auth`) discards a mismatched document
(treated as absent/native) instead of rendering it — backward compatible, a
legacy unstamped file always matches.

**B4-desktop, still open:** the deep link
(`proliferate://connect?server=...`) — `ensureDeepLinkBridge` arms after the
control-plane reachability gate in `orchestration-bootstrap.ts`, so it
currently can't reach a signed-out, server-unreachable app the way connect
needs to; rearming it earlier is real but separable work. Also open: a
"switch server" affordance in settings (today it's sign-in-screen only),
per-server homes (`~/.proliferate/servers/<sha256(origin)>/`, D1's "clean
slate" — right now a server switch relies on the origin guard above rather
than a fully separate on-disk home), and the updater endpoints (§4).

Other in-flight collisions to sequence around: the `agent-auth/*` 12-PR
stack, `codex/integration-catalog-gateway` / `codex/remove-runtime-config`
(integration gateway + manifest wiring).

Explicitly **not** in v1: the worker/Celery tier (automations stay documented
hosted-only — the prod compose ships no worker; `specs/tbd/worker-tier-*`),
web app on self-host (D12), air-gapped artifact serving (artifacts always
come from the official CDN; serving them locally would require re-signing),
support bundles, headless env-seeded claim.

---

## 10. Docs map (landing `content/docs/deployment/`)

Restructured + de-jargoned 2026-07-01 (persona-CTA overview, Steps guides,
screenshot placeholders). What each build item unlocks:

| Docs page | Truthful when |
|---|---|
| Quickstart step "claim your instance" | B1 |
| Authentication → Email & password | B1+B2 (today it's OAuth-only reality) |
| Cloud sandboxes → GitHub App ("one-click" note) | B6 (manual steps until then) |
| Cloud sandboxes → E2B template build | B3 |
| Updates & versioning (lockstep story) | B4 + B10 |
| Model gateway (LiteLLM) | B5 (env names already real on the branch) |
| Reference → env-vars | keep `specs/developing/reference/env-vars.yaml` as the curated boundary for supported, preferred application/runtime inputs |

Also owed once B5 lands: purge Bifrost from
`specs/developing/deploying/self-hosted-*.md` and `.env.production.example`.

---

## 11. Decision registry

| # | Decision | Ruling |
|---|---|---|
| D1 | Server switch | Clean slate per server; per-server home dirs (hashed origin); repos belong to the server, workspaces partition by association |
| D2 | Apply policy | Relaunch-to-apply; config stays read-once |
| D3 | Multi-server per machine | Not a product goal; switching is safe, not simultaneous |
| D4 | Org model | Single-org mode; explicit `SINGLE_ORG_MODE`, default true except hosted prod; fixed once claimed |
| D5 | Auth without OAuth | Basic auth default: token-guarded first-run claim + invite-as-allowlist; `ADMIN_EMAILS` asserted at every login |
| D6 | Updates | N releases back; API is the version root and actively converges the fleet (heartbeat → supervisor update, mandatory); CI stamps pins |
| D7 | Desktop distribution | Official signed builds only; self-hosted API picks versions via 302, never hosts/signs artifacts |
| D8 | E2B templates | No public templates → every operator builds their own; containerized builder; version-stamped |
| D9 | GitHub App creds | DB-stored (Fernet/`CLOUD_SECRET_KEY`), manifest flow, env fallback |
| D10 | Gateway scope | Central keys + per-user keys + budgets; no credits/billing UI on self-host |
| D11 | Support | GitHub issues v1; opt-in bundles later |
| D12 | Web app | Out of v1; desktop-only |
| D13 | Admin lifecycle | No permanent superuser; ≥1 admin invariant; `ADMIN_EMAILS` floor can't be demoted below admin while listed |
| D14 | CI gating | Self-host smoke blocks PRs to main |

---

## 12. Where the post-launch pain will come from (named in advance)

1. **The identity boundary.** Single-org mode edge cases at the registration
   boundary (SSO JIT × allowlist × claim ordering). Mitigation: the
   membership-policy object and B9 smoking the real journey.
2. **The unexercised lane.** Self-host regressions CI never saw. Mitigation:
   B9 blocking, not nightly.
3. **Hot-path credential provider.** B6's DB-first provider on webhook/JWT
   paths without proper caching would be a latency regression factory.
4. **`CLOUD_SECRET_KEY` as trust root.** After B6 it encrypts repo-access
   credentials; rotation must re-encrypt; runbook entry required.
5. **The session-preserving swap (B10).** The one place we're building novel
   machinery rather than composing precedents; budget review time accordingly.

---

## 13. Amendments (2026-07-02, ratified)

- **D4 refined:** `SINGLE_ORG_MODE` default is the expression
  `telemetry_mode != "hosted_product"` (explicit env override wins), so hosted
  production is safe with zero infra change.
- **D5/B2 scope addition — desktop password sign-in.** Password login today
  backs only web/mobile routes; the desktop signs in exclusively via the
  GitHub OAuth callback. Self-host v1 is desktop-only, so Track A adds a
  desktop password login route + an email/password form on the sign-in
  screen, shown as the DEFAULT when GitHub OAuth is not configured (server
  advertises available auth methods). Basic auth is the default auth story
  for self-host.
- **Verification bar:** the stack is done only when the acceptance demo runs
  end to end on BOTH lanes: (1) Docker Compose tarball flow on a clean host,
  (2) the AWS one-click CloudFormation flow, driven via AWS CLI. Execution
  state + work orders: `~/delete/self-hosting-execution.md`.
