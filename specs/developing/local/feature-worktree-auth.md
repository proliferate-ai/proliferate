# Feature Worktree Auth

Status: current procedure

Run every feature worktree under its own dev profile. Choose the lowest auth
layer that proves the behavior under test; do not clone another profile's
database, tokens, or Desktop session.

## Boot The Profile

For every layer, begin with the repository-owned flow:

```bash
make setup PROFILE=<profile>
make build # first clean worktree or after generated/Rust/frontend artifacts change
make run PROFILE=<profile>
```

See [`dev-profiles.md`](dev-profiles.md) for profile state, ports, and app
identity.

## Choose One Auth Layer

Layers B and C require real auth. Remove `VITE_DEV_DISABLE_AUTH` from ignored
`apps/desktop/.env.local`, or set it to `false`, and restart the profile before
using either layer. Otherwise the Desktop installs the fake Layer A session and
returns before real auth bootstrap.

### Layer A — feature does not need a backend identity

For frontend-only work, enable the development auth bypass in the worktree's
ignored `apps/desktop/.env.local`:

```bash
VITE_DEV_DISABLE_AUTH=true
```

Restart the profile after changing the value. This creates a development-only
frontend session; there is no backing user or organization. Authenticated API
routes, personal workflow definitions, and cloud workspaces intentionally
remain unavailable. Use Layer B or C when the feature crosses that boundary.

### Layer B — feature needs a real backend session (admin/org/authed APIs)

Use a fresh profile in single-org mode and provide a local setup-token path.
To expose password sign-in even when another env file contains normal product
GitHub credentials, override them to empty in ignored `server/.env.local` and
restart:

```bash
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
```

Then run:

```bash
make setup PROFILE=<profile>
make build
SINGLE_ORG_MODE=true \
SETUP_TOKEN_FILE=/tmp/proliferate-<profile>-setup-token \
make run PROFILE=<profile>
```

Read `PROLIFERATE_API_PORT` from:

```text
~/.proliferate-local/dev/profiles/<profile>/profile.env
```

Then open:

```text
http://127.0.0.1:<PROLIFERATE_API_PORT>/setup
```

Use the token from `/tmp/proliferate-<profile>-setup-token` to claim the local
instance, create the owner account and organization, and sign in with that
account. Setup closes after the first successful claim.

Treat the setup token and local server logs as secrets. The server writes the
token file with mode `0600`, logs the plaintext token locally at info level as
a fallback, and deletes the file after a successful claim. Never copy the
token into chat, issues, shared logs, committed docs, or a PR.

### Layer C — feature needs GitHub specifically (repo connect, GitHub integration UI)

Product GitHub identity and GitHub App repository authority are separate
subflows. Configure the one the feature actually crosses; repository
connection requires both.

#### Product GitHub identity

Create a dedicated test GitHub OAuth app for the selected profile. Read
`PROLIFERATE_API_PORT` from that profile's `profile.env` and register this
callback:

```text
http://127.0.0.1:<PROLIFERATE_API_PORT>/auth/desktop/github/callback
```

Keep the test app's client id and client secret in ignored
`server/.env.local` as `GITHUB_OAUTH_CLIENT_ID` and
`GITHUB_OAUTH_CLIENT_SECRET`. Never put the secret in chat, docs, logs,
`profile.env`, `launch.env`, or a committed file. Start the profile with the
normal `setup`, first-time `build`, and `run` commands, then exercise GitHub
sign-in or connection through the product.

Do not reconfigure a production or shared OAuth app for a feature profile.
Run OAuth and Desktop deep-link profiles serially: the generated development
apps share `proliferate-local://auth/callback`, so the operating system may
deliver a callback to the wrong concurrently running profile.

For a Hosted-Web-only OAuth test, use:

```bash
make dev-web-auth
```

That helper starts its own local server and Web app and publicly exposes the
callback API through ngrok. Register only the callback it prints, use dedicated
test-provider credentials, and stop the helper immediately after the test.

#### Repository connection and GitHub App authority

Repository connection additionally requires a dedicated test GitHub App. Keep
its current configuration only in ignored `server/.env.local`:

```text
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_WEBHOOK_SECRET
GITHUB_APP_CALLBACK_BASE_URL
GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH
```

Never print or copy those secret values. Follow the
[GitHub App manual profile procedure](../../codebase/platforms/product/sandbox-github-auth.md#manual-profile-qa)
to expose this profile's API with `CLOUD_WORKER_TUNNEL=ngrok`, set the callback
base to the public API URL for the run, and register the test App's callback
and setup URLs. Stop the tunnel after the test.

Through the product UI, complete all three distinct proofs:

```text
authorize the signed-in user for the test GitHub App
install/grant the test GitHub App to the test organization or repository
verify the selected repository reports ready authority/coverage
```

Product OAuth alone does not prove installation or repository coverage.

## Decision Table

| Behavior under test | Layer |
| --- | --- |
| Rendering or interaction with no authenticated API call | A |
| Admin, organization, password-auth, or authenticated API behavior | B |
| GitHub sign-in only | C — Product GitHub identity |
| Repository connection or GitHub integration UI | C — Product identity plus GitHub App authority |
| Hosted-Web OAuth without the Desktop profile | `make dev-web-auth` |

## Profile And Schema Safety

Use one profile for one worktree. A branch with Postgres or AnyHarness SQLite
migrations keeps its profile for the branch's lifetime because migrations only
move forward. If a test needs a different identity or a clean database, create
a new profile; copying another profile's database, auth rows, refresh tokens,
provider grants, or Desktop session is unsupported.

## Verification

- Confirm the selected profile and its reachable ports with `make dev-list`.
- Prove that Layer A cannot call authenticated Cloud APIs.
- For Layer B, verify `/setup` closes after claim and the created account can
  use the required authenticated route.
- For Layer C, verify the browser callback returns to the intended profile and
  the required GitHub-backed operation succeeds.
- Stop any public auth helper or tunnel after the callback test.
