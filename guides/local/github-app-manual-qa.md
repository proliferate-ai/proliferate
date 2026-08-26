# GitHub App Manual Profile QA

Manual smoke procedure for any PR that wires the GitHub App credential
path. Required because the critical behavior spans GitHub App OAuth, local
profile env, PAPI, E2B, the credential materialization step, git, gateway
access, and AnyHarness. The platform contract this proves is
[sandbox-github-auth.md](../../specs/systems/github/sandbox-github-auth.md).

## Local secret setup

```text
server/.env.local
  GITHUB_APP_ID=<dev app id>
  GITHUB_APP_CLIENT_ID=<dev app client id>
  GITHUB_APP_CLIENT_SECRET=<dev app client secret>
  GITHUB_APP_WEBHOOK_SECRET=<dev app webhook secret>
  GITHUB_APP_CALLBACK_BASE_URL=<ngrok api url for this run>
  GITHUB_APP_PRIVATE_KEY=<inline \n-escaped private key>
  # Or, in prod-like local tests:
  # GITHUB_APP_PRIVATE_KEY_PATH=/secure/path/proliferate-github-app.pem
```

Never commit or print secret values. `GITHUB_APP_CALLBACK_BASE_URL` must
match the public URL printed by the local profile for the current session;
it is not stable across ngrok runs unless a reserved domain is used.

## Profile startup

```bash
make setup PROFILE=github-app-smoke
make run PROFILE=github-app-smoke
```

The runner prints the public API URL and provider callback URLs. Update
the callback base if it changed, then restart the profile. Register the
test App's callback and setup URLs against the public URL. Stop the tunnel
after the test.

## User handoff

```text
1. Open the local product URL for the profile.
2. Log in with the normal product GitHub identity flow.
3. Connect/authorize the dev GitHub App from the product UI.
4. Install/grant the dev GitHub App to the test repo or org.
5. Return to the product after the callback succeeds.
```

## Verification

```text
Product:
  GitHub App status shows connected.
  Add Cloud repo succeeds only for repos covered by the GitHub App.
  Add Cloud repo fails with product-actionable errors for uncovered repos.

Server:
  github_app_authorization row exists for the user.
  encrypted refresh token is present when GitHub returns one.

Sandbox (written by repository materialization):
  ~/.proliferate/git/github.com/token exists, mode 600.
  ~/.proliferate/git/github.com/meta.json shows
    tokenKind=github_app_user_to_server.
  Global git config points github.com credentials at the helper.
  SSH-style GitHub remotes rewrite to HTTPS.
```

Do not print real tokens — use size, hash prefix, redaction, or metadata.

## Sandbox inspection

```bash
e2b sandbox connect <sandbox-id>

test -x /home/user/.proliferate/bin/proliferate-git-credential-helper
test -s /home/user/.proliferate/git/github.com/token
test -s /home/user/.proliferate/git/github.com/meta.json

python3 - <<'PY'
import json
from pathlib import Path

meta = json.loads(Path("/home/user/.proliferate/git/github.com/meta.json").read_text())
print({
    "provider": meta.get("provider"),
    "tokenKind": meta.get("tokenKind"),
    "actorLogin": meta.get("actorLogin"),
    "expiresAt": meta.get("expiresAt"),
    "refreshAfter": meta.get("refreshAfter"),
})
PY

git config --global --show-origin --get-all credential.https://github.com.helper
git config --global --show-origin --get-all url.https://github.com/.insteadOf

printf 'protocol=https\nhost=github.com\n\n' \
  | /home/user/.proliferate/bin/proliferate-git-credential-helper get \
  | sed 's/^password=.*/password=<redacted>/'
```

## Plain git smoke inside the sandbox

```bash
export GIT_TERMINAL_PROMPT=0
repo=/home/user/workspace/github-app-smoke/proliferate
branch="codex/github-app-smoke-$(date +%s)"

rm -rf "$repo"
mkdir -p "$(dirname "$repo")"

git clone https://github.com/proliferate-ai/proliferate.git "$repo"
git -C "$repo" fetch --dry-run origin

git -C "$repo" checkout -B "$branch"
printf 'github app smoke %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$repo/.proliferate-github-app-smoke.txt"
git -C "$repo" add -f .proliferate-github-app-smoke.txt
git -C "$repo" commit -m "test: github app credential smoke"
git -C "$repo" push --dry-run origin "HEAD:refs/heads/$branch"
```

## Negative selected-repo smoke

```text
1. In GitHub, remove the test repo from the selected repositories granted
   to the dev GitHub App installation.
2. In product, retry Add Cloud repo or refresh the existing Cloud repo.
3. Confirm product shows the repo as unavailable/actionable.
4. Confirm materialization fails before clone/fetch with a typed
   not-covered status.
5. Restore repo access in GitHub and confirm the product recovers after
   status refresh.
```
