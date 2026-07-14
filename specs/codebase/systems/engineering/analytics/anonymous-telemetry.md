# Anonymous Telemetry

Status: current system contract

Anonymous telemetry is the first-party install-level path for version,
activation, and low-cardinality usage records. It is independent of PostHog
and contains no replay data.

## Applicability And Routing

| Concern | Current behavior |
| --- | --- |
| Deployment modes | Desktop enables this path in `local_dev`, `self_managed`, and `hosted_product` unless telemetry is disabled. Server emits in all three modes unless anonymous telemetry is disabled. |
| Source components | Desktop `apps/desktop/src/lib/integrations/telemetry/anonymous.ts` and `anonymous-storage.ts`; native persistence under `apps/desktop/src-tauri/src/commands/anonymous_telemetry.rs`; Server sender under `server/proliferate/server/anonymous_telemetry/worker.py`. |
| Identity and data | Random install UUID; surface; telemetry mode; version/platform/architecture; fixed activation milestone; fixed usage counters. Desktop daily activity also sends install UUID, version, mode, and platform. |
| Destination | Desktop posts to the configured anonymous endpoint, defaulting to `/v1/telemetry/anonymous` on its configured Proliferate API. Hosted Server records its heartbeat locally; local and self-managed Server posts to `PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT`, whose default is Proliferate's hosted collector. |
| Enable, disable, or no-op | Desktop is disabled by `VITE_PROLIFERATE_TELEMETRY_DISABLED` or runtime `telemetryDisabled`. Server is disabled by `PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED`. A disabled path performs no send. |
| Privacy and replay | No user id, email, prompt, transcript, repo name, file path, URL, terminal text, raw error, secret, or replay is transmitted. |
| Known gap | The accepted schema includes `first_credential_synced` and `credentialsSynced`, but current Desktop event derivation does not emit either value. Failure/exception records and Server activation/usage records are not implemented. |

## Deployment Modes

Desktop derives the mode in
`apps/desktop/src/lib/domain/telemetry/mode.ts`:

- Vite development or a native dev profile is `local_dev`.
- A packaged client pointed at an official hosted API origin is
  `hosted_product`.
- A packaged client pointed elsewhere is `self_managed`.

Anonymous telemetry is enabled in every mode unless a build or runtime disable
gate is set. Vendor telemetry is enabled only for `hosted_product`.

Server reads `PROLIFERATE_TELEMETRY_MODE` (or `TELEMETRY_MODE`) and validates
the same three values. `hosted_product` heartbeats are written directly to the
local collector tables; the other modes send to the configured remote
anonymous endpoint.

## Records

### Version

Desktop and Server emit `VERSION` at startup and then every 24 hours. The
payload is exactly:

```text
appVersion
platform
arch
```

Desktop send failures are swallowed and retried on the next timer. Server
failures are logged and sent to Sentry when vendor telemetry is available;
the sender loop continues.

### Desktop activation

Desktop persists a milestone before attempting delivery and retries pending
milestones at bootstrap and during hourly housekeeping. Current emitting
directives are:

```text
first_launch
first_prompt_submitted
first_local_workspace_created
first_cloud_workspace_created
first_connector_installed
first_bundled_agent_seed_hydrated
```

The bundled-agent milestone is emitted only when `agent_seed_hydrated` has
`status=ready`.

### Desktop usage

Desktop persists these counters and attempts a flush after 24 hours:

```text
sessionsStarted
promptsSubmitted
workspacesCreatedLocal
workspacesCreatedCloud
credentialsSynced
connectorsInstalled
```

Counters are subtracted only after a successful send. `credentialsSynced`
is transmitted as part of the fixed payload but is not incremented by current
Desktop code, so it remains zero.

## Storage And Ingestion

Native Desktop stores the install id and pending state under its app home.
Packaged builds use `~/.proliferate/`; a named local profile resolves its
runtime config at:

```text
~/.proliferate-local/dev/profiles/<name>/app/config.json
```

The profile's app home also owns the anonymous install/state files. A browser
fallback uses local storage when native access is unavailable.

`POST /v1/telemetry/anonymous` validates the fixed surface, mode, record type,
and payload schema. The Server upserts `anonymous_telemetry_install` and
appends `anonymous_telemetry_event` in the request transaction. The local
Server install identity lives in `anonymous_telemetry_local_install`.

## Configuration

Desktop build settings:

```text
VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT
VITE_PROLIFERATE_TELEMETRY_DISABLED
```

Desktop runtime `config.json` supports `apiBaseUrl` and
`telemetryDisabled`; it is read once at startup, so changes require relaunch.

Server settings:

```text
PROLIFERATE_TELEMETRY_MODE
PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT
PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED
```
