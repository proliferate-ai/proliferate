# Codex Harness

AnyHarness installs the Proliferate Codex ACP fork from the exact Git commit in
the agent registry. The managed npm installer checks out that immutable source,
selects its `npm/` package subdirectory, and resolves the wrapper executable
from `node_modules/.bin/codex-acp`.

- Agent-process line: `@proliferate-ai/codex-acp@0.18.2-proliferate.1`
- Install strategy: Git-backed `ManagedNpmPackage` with
  `package_subdir = "npm"`
- Runtime expectation: the wrapper's matching optional platform package is
  published before the registry commit is promoted
- Engine relationship: the adapter embeds the Codex core it serves over ACP;
  the separately pinned native Codex CLI is used for native auth/readiness and
  must be updated and probed alongside the embedded core

The Codex ACP session config surface also exposes `fast_mode` as a live control.
That maps to Codex `service_tier = fast` for the current session, but it is not
persisted across reload/resume by the current Codex rollout replay path.
