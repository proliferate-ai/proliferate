# Proliferate Target Installer

`proliferate-target-install.sh` installs the three target-side binaries:

- `anyharness`: local runtime source of truth
- `proliferate-worker`: outbound cloud bridge for enrollment, heartbeat, and inventory
- `proliferate-supervisor`: restart wrapper for the runtime and worker

The cloud target enrollment API emits a command in this shape:

```sh
curl -fsSL "$INSTALLER_URL" | \
  PROLIFERATE_CLOUD_URL="$CLOUD_URL" \
  PROLIFERATE_ENROLLMENT_TOKEN="$TOKEN" \
  sh
```

If the binaries are already on `PATH`, the installer copies them into
`~/.proliferate/bin`. Otherwise it downloads platform-specific artifacts from
`PROLIFERATE_ARTIFACT_BASE_URL/<target>/<binary>`.

The worker talks to the local AnyHarness runtime through
`PROLIFERATE_ANYHARNESS_BASE_URL`, defaulting to `http://127.0.0.1:8457`, which
is the default `anyharness serve` bind address used by the supervisor. Set
`PROLIFERATE_ANYHARNESS_BEARER_TOKEN` only when the target runtime is configured
to require bearer auth.

By default, the user systemd unit is named `proliferate-target.service`. Local
smoke tests can set `PROLIFERATE_SERVICE_NAME` and `PROLIFERATE_HOME` to install
into an isolated service and data directory.

The installer writes:

- `~/.proliferate/worker/config.toml`
- `~/.proliferate/supervisor/config.toml`
- `~/.config/systemd/user/proliferate-target.service` when `systemctl` exists

SSH onboarding uses this command surfaced in the Desktop Compute settings page.
Managed cloud does not normally run this shell installer; managed cloud
bootstrap writes equivalent worker/supervisor config and starts the same
runtime bundle directly inside the sandbox.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PROLIFERATE_CLOUD_URL` | Cloud API base URL used by the worker. | Required |
| `PROLIFERATE_ENROLLMENT_TOKEN` | One-time target enrollment token. | Required |
| `PROLIFERATE_HOME` | Target runtime home for binaries/config/state. | `$HOME/.proliferate` |
| `PROLIFERATE_ARTIFACT_BASE_URL` | Base URL for platform binary downloads. | Release artifact base |
| `PROLIFERATE_ANYHARNESS_BASE_URL` | Local URL the worker uses to call AnyHarness. | `http://127.0.0.1:8457` |
| `PROLIFERATE_ANYHARNESS_BEARER_TOKEN` | Bearer token when local AnyHarness requires auth. | empty |
| `PROLIFERATE_SERVICE_NAME` | user systemd service name. | `proliferate-target` |

Enrollment only registers the target and worker. It does not carry GitHub,
agent, MCP, or model credentials. Those are materialized later through
worker-authenticated Cloud commands such as `configure_git_identity` and
`materialize_environment`.

## Local SSH Worker Smoke Test

Use the Makefile smoke target when validating the full local Cloud -> SSH target
path. It creates a scratch local Cloud database, starts the server locally,
exposes it through `ngrok`, enrolls the SSH target, waits for worker heartbeat
and AnyHarness health, then cleans up the remote smoke service.

```sh
make test-cloud-ssh-worker \
  SSH_TARGET=ubuntu@44.247.206.119 \
  SSH_KEY=/path/to/key.pem
```

For iterative debugging, keep the local Cloud server, ngrok tunnel, and remote
smoke service running until `Ctrl-C`:

```sh
make dev-cloud-ssh-worker \
  SSH_TARGET=ubuntu@44.247.206.119 \
  SSH_KEY=/path/to/key.pem
```

The smoke command requires `ngrok`, `cargo-zigbuild`, local Postgres, and
`server/.venv`. Set `CLOUD_SSH_WORKER_SKIP_BUILD=1` to reuse previously built
Linux binaries, or `NGROK_URL=https://...` to reuse an existing tunnel.

This smoke validates target enrollment, supervisor startup, AnyHarness health,
worker heartbeat, and version reporting. A full automation smoke has additional
requirements:

- the local Cloud profile must have GitHub OAuth configured for the run creator
- the target must receive `configure_git_identity`
- the target must clone/fetch the repo through `ensure_repo_checkout`
- the requested agent must be installed/readied before `start_session`

Until agent install/readiness is automated as part of target preparation, a
fresh SSH target may need a one-time install through AnyHarness, for example:

```sh
ssh ubuntu@target-host \
  'curl -fsS -X POST http://127.0.0.1:8457/v1/agents/claude/install \
    -H "Content-Type: application/json" \
    -d "{}"'
```
