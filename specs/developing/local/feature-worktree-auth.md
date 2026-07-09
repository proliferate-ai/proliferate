# Running a feature worktree cleanly (profiles + auth)

You are working in a feature worktree. Run the app under **your own dev profile**
(never `main`, never another feature's name). Profile name = your feature name
(e.g. `changes`, `support`, `files`, `offline`). Each profile gets its own ports,
its own Postgres DB (`proliferate_dev_<profile>`), and its own on-disk state
(`~/.proliferate-local/dev/profiles/<profile>/`), all collision-checked — so
several features run simultaneously without stepping on each other.

## Boot

```bash
pdevui <profile>    # first boot: builds frontend, creates DB, runs migrations
prunui <profile>    # every boot after that (fast, no rebuild)
```

`pdev`/`prun`/`pdevui`/`prunui`/`pseedauth` are shell helpers from the
maintainer's `~/.zshrc`. If they don't exist in your shell, use the raw
equivalents:

```bash
# pdev <profile>  ≈
USE_EXISTING_POSTGRES=1 make dev-init PROFILE=<profile>
USE_EXISTING_POSTGRES=1 node scripts/dev.mjs ensure-db --db-name proliferate_dev_<profile>
USE_EXISTING_POSTGRES=1 make rebuild dev PROFILE=<profile>

# prun <profile>  ≈
USE_EXISTING_POSTGRES=1 make dev PROFILE=<profile>

# pdevui/prunui = the same with SKIP_RUST=1 and a prebuilt runtime binary:
SKIP_RUST=1 ANYHARNESS_DEV_RUNTIME_BIN=<path-to-anyharness-bin> make dev PROFILE=<profile>

# pui <pkg>  ≈  pnpm --filter "@proliferate/<pkg>" build   (all: make shared-build)
```

These skip the Rust build and use the shared prebuilt runtime binary — which is
built from **main**. So this rule is load-bearing, not a footnote:

> **If your branch changes any Rust/anyharness code, you MUST use
> `pdev <profile>` / `prun <profile>` instead.** With `pdevui` you'd silently
> run main's runtime and your feature simply won't exist at runtime.
> Check with: `git diff main...HEAD --name-only | grep -c '\.rs$'` — nonzero
> means `pdev`. Never run two full `pdev` cargo builds at the same time
> (file-lock contention); stagger first boots.

If you edit shared packages (`packages/product-ui` etc.), run `pui <pkg>` after
edits — apps consume built dist, HMR won't pick it up.

## Auth — pick exactly one layer

Pick the *lowest* layer that covers what your feature actually exercises.

### Layer A — feature doesn't care who's logged in (default)

In this worktree's `apps/desktop/.env.local`:

```bash
VITE_DEV_DISABLE_AUTH=true
# remove/comment VITE_REQUIRE_AUTH=true
```

Boots straight into a fake local session. No OAuth, no backend user.
**Limit:** frontend-only session — cloud-workspace calls are hard-blocked, and
there is no real user row behind authed API routes.

### Layer B — feature needs a real backend session (admin/org/authed APIs)

Blank the GitHub vars in this worktree's `server/.env` (they're what force the
GitHub login screen):

```bash
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
```

**Boot with single-org mode on** — local dev pins `SINGLE_ORG_MODE=false`
(`scripts/dev.mjs`), which unmounts `/setup` and `/register`; without this the
desktop shows sign-in with no way to ever create an account:

```bash
SINGLE_ORG_MODE=true SETUP_TOKEN_FILE=/tmp/proliferate-<profile>-setup-token \
  pdevui <profile>
```

(`SETUP_TOKEN_FILE` is needed because the default `/var/lib/proliferate/...`
path isn't writable on macOS. Keep both vars on every boot of this profile.)

Then, because the profile DB is fresh, the first-run claim page is open:

1. `cat /tmp/proliferate-<profile>-setup-token`
2. Open `http://127.0.0.1:<PROLIFERATE_API_PORT>/setup` (port is in
   `~/.proliferate-local/dev/profiles/<profile>/profile.env`), paste the token,
   choose email + password + org name.
3. Sign in on the desktop password form (it's the default whenever GitHub isn't
   configured). Real JWT, real user row — everything works except
   GitHub-specific integration.

Note: after a successful claim, `/setup` permanently shows "Not found — There
is nothing to set up here". That page means the claim **worked** (setup closes
once any user exists) — don't retry; go sign in on the desktop. If you lost the
password, reset the profile DB (`dropdb proliferate_dev_<profile>` + reboot)
and claim again.

Extra teammates/users: invite from the app, or use the `/register` page with an
invitation id.

### Layer C — feature needs GitHub specifically (repo connect, GitHub integration UI)

**Do not attempt GitHub OAuth from a feature profile** — the dev GitHub app's
callback URL is registered against main's port; it will not work. Instead,
borrow main's already-authenticated state:

```bash
pseedauth <profile>       # run while the feature profile is NOT running
pdevui <profile>
```

`pseedauth` clones main's dev DB into your profile's DB (user, oauth_account,
auth_identity, provider_grant, org membership, GitHub App authorizations,
integration accounts — everything) and copies main's desktop session file
(`auth-session.json`), so the app boots already logged in as the main user with
working GitHub credentials.

Preconditions (normally true automatically):
- Your worktree's `server/.env` is a copy of main's — `JWT_SECRET` and
  `CLOUD_SECRET_KEY` must match or the copied tokens/ciphertext are useless.
  Keep `GITHUB_OAUTH_CLIENT_ID/SECRET` **set** in this layer.
- Someone has signed into the `main` profile recently (the copied access token
  expires; refresh works as long as the user's `token_generation` hasn't been
  bumped by a logout/password change on main).

**It drops and replaces your profile's DB** — any local test data in that
profile is gone. Re-run it any time you want to resync from main.

## Quick reference

| You need | Do |
|---|---|
| Just run the UI | `VITE_DEV_DISABLE_AUTH=true` in `apps/desktop/.env.local`, then `pdevui <profile>` |
| Real login / admin flows | blank GitHub vars in `server/.env`, boot with `SINGLE_ORG_MODE=true` + `SETUP_TOKEN_FILE`, claim `/setup`, password sign-in |
| GitHub integration | `pseedauth <profile>`, then boot |
| Branch changes Rust | same auth layers, but boot with `pdev`/`prun` (not `pdevui`) |
| Branch changes DB schema | dedicate the profile to this branch (see below) |

One profile per worktree. Don't share a profile name across worktrees, don't
reuse `main`.

## Schema-changing branches: dedicate the profile

Migrations only run **forward**, in two places:

- **Runtime SQLite** (`~/.proliferate-local/runtimes/<profile>/db.sqlite`):
  anyharness migrations run at boot. If your branch adds runtime migrations
  (e.g. goals/workflows), booting it upgrades the profile's SQLite — and then
  booting *older* code (main, another branch) under the **same profile** hits a
  schema it doesn't understand.
- **Server Postgres** (`proliferate_dev_<profile>`): alembic migrations run at
  boot; same one-way property.

Rules:
- A branch that changes either schema gets its **own profile name, kept for the
  branch's lifetime** — never reused for other branches or main.
- Fresh profiles are always fine: migrations bring a new DB fully up
  automatically. `pseedauth` is also fine — the clone of main's DB is upgraded
  forward on first boot.
- If a profile does get crossed over a schema boundary, reset it: delete
  `~/.proliferate-local/runtimes/<profile>/` for SQLite, and/or re-run
  `pseedauth <profile>` (or `dropdb proliferate_dev_<profile>` + reboot) for
  Postgres.
