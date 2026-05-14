# Cloud Worker Direct AnyHarness Allowlist

Status: transitional allowlist after Phase 4 command migration.

Production automation execution no longer imports or calls
`create_runtime_session`, `prompt_runtime_session`, `apply_runtime_reasoning_effort`,
or `close_runtime_session`. Runtime mutations for automation session start,
config update, and prompt delivery now go through `CloudCommand -> Worker ->
AnyHarness`.

Remaining server-side AnyHarness integration imports are allowed only for
managed runtime provisioning, readiness, diagnostics, or repo setup until the
worker event/config sync phases replace those direct reads and setup calls.

Allowed transitional callsites:

- `server/proliferate/server/cloud/runtime/anyharness_api.py`: provisioning
  setup calls for agent readiness, workspace resolution, mobility destination
  preparation, and runtime auth verification. Replacement: worker setup/event
  sync commands once workspace materialization is command-backed.
- `server/proliferate/server/cloud/runtime/repo_config_apply.py`: post-ready
  repo setup command execution/polling. Replacement: worker command-backed
  workspace setup and Cloud setup-run events.
- `server/proliferate/server/cloud/runtime/setup_monitor.py`: setup command
  diagnostics/polling. Replacement: worker event ingest for setup-run status.
- `server/proliferate/server/cloud/runtime/credential_freshness.py`: workspace
  listing for process-restart credential freshness. Replacement: worker
  inventory/config state events.
- `server/proliferate/server/cloud/runtime/ensure_running.py`: reconnect
  health handling and runtime restart error typing. Replacement: supervisor and
  worker heartbeat/readiness.
- `server/proliferate/server/cloud/repo_config/service.py`: runtime operation
  error typing for repo config flows. Replacement: worker-backed setup flow.
- `server/proliferate/server/cloud/workspaces/service.py`: transitional runtime
  reconnect error typing while managed provisioning remains in
  `cloud/runtime/**`.

Verifier:

```bash
rg "create_runtime_session|prompt_runtime_session|apply_runtime_reasoning_effort|close_runtime_session" \
  server/proliferate/server/automations server/proliferate/server/cloud -g "*.py"
```

Expected result: no production automation/cloud server hits.
