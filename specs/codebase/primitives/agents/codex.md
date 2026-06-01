# Codex Harness

AnyHarness installs the Codex ACP wrapper from the published npm package line,
not by building the Rust repo at runtime.

- Agent-process package: `@proliferateai/codex-acp@0.11.7`
- Install strategy: plain `ManagedNpmPackage` with `package_subdir = None` and
  `source_build_binary_name = None`
- Runtime expectation: the npm package already contains the prebuilt platform
  binaries that the wrapper needs

The Codex ACP session config surface also exposes `fast_mode` as a live control.
That maps to Codex `service_tier = fast` for the current session, but it is not
persisted across reload/resume by the current Codex rollout replay path.
