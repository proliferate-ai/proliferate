# `@anyharness/tests`

Black-box compatibility scenarios for AnyHarness.

This package assumes a running AnyHarness runtime and tests the public HTTP +
SSE contract against that runtime. It can still self-start a local runtime for
development fallback, but the primary contract is env-driven:

- `ANYHARNESS_TEST_BASE_URL`
- `ANYHARNESS_TEST_AUTH_TOKEN`
- `ANYHARNESS_TEST_WORKSPACE_PATH`
- `ANYHARNESS_TEST_PATH_ACCESS`
- `ANYHARNESS_TEST_READY_AGENT_KINDS`

## Structure

```text
src/
  harness/     # runtime attach/start helpers and prompt collection
  fixtures/    # real workspace/repo fixtures
  runners/     # wrappers that provision an environment, then invoke the suite
  scenarios/   # compatibility assertions by product area
  tools/       # fixture/debug utilities, not scenario coverage
```

### Responsibilities

- `harness/`
  Owns the `RuntimeHarness` abstraction used by the scenario tests.
- `fixtures/`
  Owns temporary real-repo setup and cleanup.
- `runners/`
  Owns cloud/local wrappers that prepare runtime env and then run this package.
- `scenarios/`
  Owns the actual compatibility assertions.
- `tools/`
  Owns export/debug helpers such as session event fixture capture.
