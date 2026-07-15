# Self-Hosting Test Hand-Off

Status: legacy implementation and evidence hand-off from the self-hosting
launch pass (2026-07-09). It remains useful for mechanism history and existing
collector pointers, but its old IDs and standing-server topology are not the
target qualification contract.

`core-release-validation.md` and `core-release-scenario-manifest.json` own
self-host guarantee IDs and qualification scope;
`release-worlds-and-fixtures.md` owns the run-scoped disposable self-host
world; `tier-3-scenario-contract.md` and `tier-4-scenario-contract.md` own
composed journey semantics. This file, `flows.md`, and `scenarios.md` are
legacy implementation/evidence views and must not define or renumber target
scenarios. The standing `alpha`/`beta` notes below describe prior evidence;
strict qualification provisions disposable EC2 instances by candidate digest.

---

## 1. The surface (mental model, validated)

Every self-host deploy path is the same thing: the production Docker Compose
bundle (`server/deploy/`) pulling public GHCR images
(`ghcr.io/proliferate-ai/proliferate-server:stable`), whether the operator ran
`bootstrap.sh` by hand on any Linux box or the AWS CloudFormation one-click did
it for them on EC2. **There is no separate CFN architecture** — testing
compose-on-EC2 covers both.

Orthogonal layers, each independently on/off:

- Auth: password (default) / GitHub OAuth / Google / OIDC SSO — desktop asks
  `GET /auth/desktop/methods` and renders what's configured.
- Add-on: cloud sandboxes (GitHub App + E2B key + self-built template).
- Add-on: model gateway (`--profile agent-gateway`, LiteLLM).
- Lifecycle: `./update.sh` pulls + migrates + restarts; desktops follow the
  server's pin via `GET /desktop/updater/latest.json`.

Invariants: every self-hosted server is single-org
(`single_org_mode`, `config.py:376` — derived from non-`hosted_product`
telemetry mode); `/setup` is claimed exactly once and 404s forever after;
invitees register in a browser via the invitation's registration token.

What already exists: `self-host-smoke.yml` (required merge check) boots the
real compose stack http-only and walks health → `/meta` → claim → password
login → invite → register → membership at the **API** level. Everything below
is coverage that does not exist yet.

## 2. Flow registry rows

The rows below record the legacy collector vocabulary. The canonical ID
migration table in `core-release-validation.md` controls how each pointer is
folded, renamed, split, or rewritten before it can claim target coverage.

## 3. Scenario definitions

### Tier 1

**T1-SH-1: single-org derivation.** Pure config test: `telemetry_mode=
"self_managed"` ⇒ `single_org_mode` true; `"hosted_product"` ⇒ false;
`single_org_mode_override` wins in both directions. (`config.py:376`.)

**T1-SH-2: SSO alias equivalence.** Settings built from `SSO_CLIENT_ID=x`
equals settings built from `PROLIFERATE_SSO_CLIENT_ID=x`, for every SSO var.
Guards the docs' canonical-form promise (docs standardized on bare `SSO_*`).

**T1-SH-3: `/meta` contract.** Golden-fixture the response shape
(`serverVersion` et al.) — this is the wire contract the connect dialog's
trust-confirmation renders; a field rename breaks every desktop silently.

### Tier 2 (stack-boot fixture per `scenarios.md` conventions)

**T2-SH-1: connect + switch (fixture-driven, see §4).**
Preconditions: two server fixtures A and B on different ports.
Steps: from sign-in surface → "Connect to a server" → enter A's URL →
assert checking state → trust screen shows A's host + `Server version X` →
Connect → assert config write + relaunch requested → assert "Connected to
{A}" banner → Reset → connect to B.
Negatives: non-Proliferate URL (no `/meta`) fails loudly with the entry
retained; malformed URL rejected before any request; scheme-less input gets
`https://` assumed.

**T2-SH-2: `/setup` claim UI.** T2-AUTH-1 already covers claim + password
lifecycle; extend its asserts with the self-hosted specifics: claimed user is
**owner** of the single instance org; second browser hitting `/setup`
post-claim gets the already-claimed state (404 surface).

**T2-SH-3: invite → register → desktop login.**
Steps: admin invites from the UI → read the registration token from the
invitation (no email locally — `delivery_status=skipped`; **invitations have
no secret token**, auth is UUID + email-match per the 2026-07-07 survey) →
fresh browser context to `/register` with token → set password → desktop-web
sign-in as invitee.
Assert: invitee active member of the instance org; wrong-email registration
rejected.

**T2-SH-4: adaptive sign-in.** Server fixture without GitHub OAuth vars ⇒
password form rendered (no GitHub button); with `GITHUB_OAUTH_CLIENT_ID/
SECRET` set ⇒ GitHub button rendered. Driven purely by
`GET /auth/desktop/methods`.

### Tier 3 (historical standing-server evidence)

Two long-lived EC2 boxes, `alpha` and `beta`, each running the production
compose bundle behind real DNS + Caddy-issued TLS (staging subdomains — needs
one-time provisioning, §6). These attach to the existing
`tests/release-runner` lanes.

**T3-SH-1: cold boot to second user on real infra.** Fresh instance (reset
motion, §6) → `bootstrap.sh` → claim → admin login → invite → register →
invitee login. Same walk as the CI smoke but through real TLS/DNS, asserting
rows in the instance Postgres ("shows up in the database in AWS").

**T3-SH-2: real desktop against alpha/beta.** Real (Tauri) desktop build:
connect to alpha → password login → reset → connect to beta. This is the
only lane that proves the relaunch + config.json + keychain path end-to-end.

**T3-SH-3: gateway add-on.** On alpha: set the `AGENT_GATEWAY_*`/`LITELLM_*`
env block (per `.env.production.example`, post-#1054) → compose up with
`--profile agent-gateway` → agent request through the gateway with the
staging test key on the cheapest model → real response. (Consistent with the
no-mock-LLM ruling.)

### Tier 4 (upgrade path)

**T4-SH-1: operator update motion.**
Boot with `PROLIFERATE_SERVER_IMAGE_TAG=<N−1>` → run `./update.sh` → assert:
migrations applied, health green, `/meta` reports N, existing session/user
data intact.

**T4-SH-2: artifact chain (the incident test — see §5).**
Mechanics (confirmed by the 2026-07-09 release-pipeline investigation): the
desktop's Tauri updater feed is hardcoded to the CDN
(`downloads.proliferate.com`, S3 `proliferate-desktop-downloads` behind
CloudFront); the server's `GET /desktop/updater/latest.json` 302-redirects to
the versioned manifest for its pinned `desktopVersion`, falling back to the
flat manifest when the versioned one is missing — so the server pin is
display-only today and the CDN is the ground truth.
Asserts, against the release under test:
1. `GET <server>/desktop/updater/latest.json` follows to HTTP 200.
2. `https://downloads.proliferate.com/desktop/stable/latest.json` →
   `version` == the release's desktop version, `pub_date` fresh (== release
   day; a stale pub_date with a "new" version means the manifest was
   hand-edited, not published).
3. `https://downloads.proliferate.com/desktop/stable/<version>/latest.json`
   → HTTP 200 (the versioned manifest the server redirect targets).
4. **HEAD every platform artifact URL in the manifest → HTTP 200.**
5. The tag `desktop-v<version>` exists and contains the release SHA
   (`git merge-base --is-ancestor <release-sha> desktop-v<version>`).
Version-string equality is not a pass; only a fetchable artifact is. This
must run in the release gate, not nightly-only.

## 4. Tier-2 escalations (the desktop-web gaps)

The connect affordance is gated on `isTauriRuntimeAvailable()`
(`apps/desktop/src/components/auth/LoginScreen.tsx:117`) — **plain desktop-web
never renders it**. Per the prefer-desktop-web ruling:

- T2-SH-1 drives the **LoginScreen fixture** that #1027 mirrored the connect
  UI into (used by tests/playground) — covers dialog logic, validation, trust
  screen, copy (`copy/auth/auth-copy.ts` `CONNECT_SERVER_LABELS`).
- The `set_app_config` write + relaunch + credential store cannot be faked
  (`lib/access/tauri/credentials.ts` throws outside Tauri) — that slice lives
  only in T3-SH-2 with a real build.

## 5. Why the artifact-chain gate exists (incident, 2026-07-09)

The connect feature (#1027) merged 2026-07-09 10:48 UTC. The nightly train had
already cut `desktop-v0.3.13` at 09:05; both later train runs failed on a
same-day `release-2026-07-09` tag-collision in `create-release-tags.mjs`
(after one of them had already pushed a 0.3.14 version bump to main). Result:
the server advanced to v0.3.16 while **no shipped desktop artifact contained
the launch-flagship feature**, and every desktop-v* GitHub release sits in
draft. No existing check catches this class: versions look consistent; the
artifact is simply absent. T4-SH-2 is that check, and it must run in the
release gate, not nightly-only.

## 6. Infrastructure prerequisites (one-time)

| Item | Why | Notes |
| --- | --- | --- |
| 2 staging EC2 boxes (alpha/beta) | T3-SH-1/2 two-server switch | small instances; production compose bundle |
| 2 staging DNS names + real TLS | only way to test Caddy's automatic HTTPS (CI smoke is http-only) | e.g. `selfhost-a/-b.<staging domain>` |
| Reset motion | `/setup` claims exactly once — a standing box can run the claim test once, ever | `docker compose down -v` + re-`bootstrap.sh` script; alternatively ephemeral instance per run (slower) |
| Staging gateway test key | T3-SH-3 | same key story as the rest of tier 3 (`env-manifest.ts`) |
| Real desktop build in the release lane | T3-SH-2, T4-SH-2 | must be a build ≥ the release under test |

## 7. Sharp edges (learned the hard way; don't rediscover)

- `/setup` one-shot: see reset motion above. "There is nothing to set up
  here" means the claim already succeeded.
- Invites: no secret token (UUID + email-match); no Resend locally ⇒ read the
  registration token from the invitation API response, as the smoke does.
- `update.sh` and `bootstrap.sh` **both** regenerate `.env.runtime`; the
  operator's source of truth is `.env`.
- Gateway boot is a two-step: env vars alone do nothing without
  `--profile agent-gateway` on the compose command.
- Version-equality is a lying assertion for updates — always fetch the
  artifact (§5).
- The AWS CFN template embeds a full copy of `.env.production.example`; any
  env-template assertion should check both or it will pass while CFN drifts.
