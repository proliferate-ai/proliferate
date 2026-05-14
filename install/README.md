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

Managed cloud images can use the same installer with a one-time enrollment
token at boot. SSH onboarding uses the same command surfaced in the Desktop
Compute settings page.

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
