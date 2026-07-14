# Pass One Exact Candidate Build into Qualification

- Status: **frozen**
- Revision: **CBH1-frozen-1** (promoted unchanged from Vault
  `draft-7-candidate-only`; founder-authorized 2026-07-14)
- Repository: `proliferate-ai/proliferate`
- Base SHA: `7850bcffd84263aca0d65a7fcd46743b8145adbe`
- Pipeline stage: **implemented and merged in PR #1159**

[`exact-test-matrix.md`](exact-test-matrix.md) preserves the candidate evidence
introduced by report V2 while advancing the runner's current aggregate to
report V3. This document remains authoritative for candidate build-map,
materialization, and AnyHarness handoff behavior.

## Outcome

Prove one real build-to-runner handoff rather than building an abstract
artifact system:

```text
release-build AnyHarness for the host platform
→ write a candidate build map with source SHA, version, path, and SHA-256
→ runner validates it before any setup side effect
→ copy/materialize those exact bytes into isolated run storage
→ launch that exact binary with an isolated runtime home + ephemeral port
→ require `/health` status + version to match the build map
→ terminate the process reliably
→ require aggregate evidence to name the same artifact ID/version/SHA-256
```

The candidate build map is the JSON handoff between candidate builders, the
qualification runner, and later world provisioners. It contains build outputs,
not provider credentials or running endpoints.

## Where this fits

Runtime order:

```text
build + store candidate outputs
→ write candidate build map
→ select tests and create run identity
→ validate build map
→ materialize required artifacts
→ load provider credentials
→ connect provider controllers
→ start selected world
→ run fixtures/scenarios
→ write evidence + clean up
```

Implementation order:

```text
this PR: one real AnyHarness producer → build map → runner consumer
→ qualification provider readiness
→ complete candidate builders + Actions distribution
→ world provisioners + one proof test per world
```

Validation therefore occurs after building at runtime. This PR implements the
smallest producer/consumer contract first so later builders and worlds share
one interface.

Keep these objects separate:

| Object | Contains |
| --- | --- |
| Candidate build map | Source SHA plus exact artifact IDs, versions, checksums, and retrieval locations |
| Materialized artifact | Verified bytes copied/downloaded into run-owned storage |
| Provider credentials | Private E2B/AWS/Stripe/LiteLLM/GitHub authentication inputs |
| Provider controller | Authenticated client created from provider credentials |
| `ReadyWorld` | Running API/runtime endpoints, Playwright controller, readiness, evidence, and cleanup handles |

This PR owns only the first two objects and the narrow AnyHarness smoke
consumer. Provider credentials/controllers and `ReadyWorld` remain later work.

## Why validate the build map

The goal is not to defend against a random unrelated file appearing on a
runner. Minimum validation prevents:

- parallel jobs or retries mixing source SHAs;
- a local artifact changing after the map is written;
- evidence naming different bytes from the binary that actually ran; and
- future worlds silently using mutable or mismatched candidate outputs.

This slice validates only schema, source SHA, unique artifact identity, local
file location, version, and SHA-256. Remote provider identities, production
deployment proof, and retained production N-1 are deferred.

## PR boundary

This PR owns:

- `CandidateBuildMapV1` for candidate artifacts;
- a portable local-file assembler;
- runner CLI input and validation before existing local-user/gateway setup;
- host-platform local-file materialization;
- one isolated AnyHarness launch/health/version/termination consumer;
- report V2 candidate-artifact evidence;
- strict fail-closed and diagnostic optional-map behavior; and
- focused schema, ordering, tamper, materialization, smoke, and report tests.

This PR does not own:

- retained-production or Tier 4 artifact maps;
- `artifactSetDigest`, production deployment attestations, or PR #1150 code;
- OCI, GitHub Actions, GitHub Release, or E2B locator implementations;
- complete Server/Desktop/Runtime/E2B/self-host candidate builders;
- GitHub Actions upload/download wiring;
- E2B/AWS/Stripe/LiteLLM/GitHub credentials or controllers;
- Server/Desktop/provider startup or a complete `ReadyWorld`;
- generic cleanup-ledger infrastructure;
- fixtures, product journeys, or scenario expansion; or
- production promotion.

The smoke may directly register process/temp-directory cleanup in `finally`.
It must not create a generic cleanup framework for one process.

## Candidate build map

```ts
interface CandidateBuildMapV1 {
  schema_version: 1;
  kind: "proliferate.candidate-build";
  source_sha: string; // lowercase 40-hex merged/candidate SHA
  artifacts: CandidateBuildArtifactV1[];
}

interface CandidateBuildArtifactV1 {
  // Stable ID. This PR uses `anyharness/<rust-host-target>`.
  artifact_id: string;
  version: string;
  sha256: string; // lowercase 64-hex digest of the file bytes
  locator: {
    kind: "local_file";
    path: string;
  };
}
```

Rules:

- `source_sha` must equal `RunIdentityV1.source_sha`.
- The artifact array must be non-empty with unique, safe `artifact_id` values.
- Version/path values must be non-empty and bounded.
- This PR accepts only `local_file` locators.
- The path must resolve to a readable regular file.
- The actual file SHA-256 must equal the declared SHA-256.
- Unknown schema versions, kinds, locator kinds, duplicate IDs, malformed
  hashes, source mismatch, unreadable paths, and byte mismatch reject.
- Map paths and raw JSON never enter aggregate evidence.

Later slices add locator variants and artifact requirements through a new
versioned contract rather than pretending this local-only proof already handles
remote distribution.

## Runner integration

Current merged flow:

```text
parse
→ resolve RunIdentityV1
→ select scenarios
→ seed local user + push gateway auth
→ execute selected tests
→ write report V1
```

Target flow:

```text
parse
→ resolve RunIdentityV1
→ select scenarios
→ load + validate supplied candidate build map
→ only now seed local user + push gateway auth
→ execute with safe candidate-artifact evidence
→ write report V2
```

The validation seam is in `tests/release/src/cli/run.ts` after scenario
selection and before the existing `seedLocalDurableUser` /
`pushLocalGatewayAuth` block. Extract the process orchestration into a testable
`cli/command.ts`; keep `cli/run.ts` as the thin process adapter.

The normal runner validates and records the map. It does not launch an extra
AnyHarness for every scenario run. The dedicated handoff-smoke target invokes
the same loader/materializer, launches the exact binary, and compares the
launched identity with report evidence.

## CLI and mode behavior

```text
--candidate-build-map <path>
```

| Invocation | Candidate build map |
| --- | --- |
| `--help` | Not loaded |
| Diagnostic dry-run | Optional; omission recorded as `null` |
| Diagnostic real run | Optional; omission recorded as `null` |
| Strict real run | Required |
| Strict dry-run | Invalid, unchanged from the merged runner |

Any supplied map is always validated.

## Failure behavior

The following are invalid invocation/artifact-integrity inputs:

- missing strict-required `--candidate-build-map`;
- unreadable or invalid JSON;
- unsupported schema/kind/locator;
- empty or duplicate artifact identity;
- source-SHA mismatch;
- malformed version/path/SHA-256;
- path that is not a readable regular file; or
- file bytes that do not match the declared SHA-256.

They must:

```text
exit 2
write no aggregate report
run zero local-user/gateway/provider/fixture/scenario side effects
```

The handoff smoke must also terminate the child process and delete its
run-owned temporary directory when launch, readiness, health, or evidence
comparison fails.

## Report V2

Adding artifact identity changes the aggregate evidence contract, so the
runner emits `TestRunReportV2` rather than silently changing V1:

```ts
interface CandidateBuildEvidenceV1 {
  artifacts: Array<{
    artifact_id: string;
    version: string;
    sha256: string;
  }>;
}

interface TestRunReportV2 {
  schema_version: 2;
  kind: "proliferate.test-run";
  // Existing V1 run, inputs, selected_tests, results, summary, and verdict.
  candidate_build: CandidateBuildEvidenceV1 | null;
}
```

`run.source_sha` remains the only candidate source SHA in evidence. The report
stores artifact ID/version/SHA-256 only—never map paths, local paths, raw map
JSON, credentials, or command/provider output.

`verdict.scope` remains `selected_tests` and `completeness` remains `partial`.
One artifact handoff does not claim complete world/artifact coverage.

## Real handoff smoke

```text
source SHA = git rev-parse HEAD
version = repository VERSION
rust host target = rustc -vV host

PROLIFERATE_BUILD_VERSION=<version>
PROLIFERATE_BUILD_SHA=<source SHA>
cargo build --release -p anyharness

assemble CandidateBuildMapV1
→ load + validate it
→ copy exact bytes to a run-owned temporary directory
→ verify copied SHA-256
→ launch: anyharness serve --host 127.0.0.1 --port <ephemeral>
           --runtime-home <isolated-temp-home>
→ poll `/health` with a bounded timeout
→ require status `ok`, expected version, and expected runtime home
→ terminate child in `finally`
→ run the diagnostic runner with the same map
→ require report candidate artifact ID/version/SHA-256 to equal the launched map
```

The test must not rely on a developer's existing runtime home, port, running
AnyHarness, native agent login, or provider credential.

## File plan

```text
specs/developing/testing/
  candidate-build-handoff.md                  add on promotion
  README.md                                   align terminology
  release-worlds-and-fixtures.md              mark remote/full maps as later
scripts/ci-cd/
  assemble-candidate-build-map.mjs            add
  assemble-candidate-build-map.test.mjs       add
tests/release/src/
  artifacts/
    build-map.ts                              add types/load/validation
    build-map.test.ts                         add
    materialize-local.ts                      add
    materialize-local.test.ts                 add
    anyharness-smoke.ts                       add
    anyharness-smoke.test.ts                  add
  cli/
    args.ts                                   add candidate-build-map flag
    args.test.ts                              modify
    command.ts                                add testable orchestration
    command.test.ts                           add zero-side-effect ordering
    run.ts                                    keep as thin process adapter
  runner/
    execute.ts                                accept safe candidate evidence
    execute.test.ts                           modify
  evidence/
    schema.ts                                 replace current report with V2
    write.test.ts                             modify
tests/release/fixtures/artifacts/
  candidate-build.valid.json                  add
Makefile                                      add assembler/handoff-smoke target
```

No duplicate V1/V2 execution path remains. Repository history records V1 as
the prior contract; current code emits V2.

## Acceptance tests

- Candidate map round-trip and strict schema validation.
- Duplicate/malformed/unsupported artifacts reject.
- Candidate source SHA must match `RunIdentityV1.source_sha`.
- Local file missing/non-regular/unreadable rejects.
- Changing file bytes after map assembly rejects.
- Diagnostic omission is explicit `candidate_build: null`.
- Strict omission rejects before setup.
- Invalid supplied map executes zero local-user, gateway, fixture, provider,
  and scenario calls; exits `2`; writes no report.
- Report V2 always contains `candidate_build`; evidence contains only bounded
  artifact ID/version/SHA-256.
- Existing result/verdict/redaction invariants remain green.
- Real release-mode AnyHarness build → map → validate → materialize → launch →
  health/version/runtime-home assertion → reliable termination succeeds.
- The launched artifact identity and report evidence are exactly equal.

Required proof:

```bash
pnpm -C tests/release test
pnpm -C tests/release typecheck
node --test scripts/ci-cd/assemble-candidate-build-map.test.mjs
make qualification-candidate-handoff-smoke
```

No live provider credential is required.

## Handoff

```text
status: Frozen
revision: CBH1-frozen-1 (from Vault draft-7-candidate-only)
repository: proliferate-ai/proliferate
base SHA: 7850bcffd84263aca0d65a7fcd46743b8145adbe
runner dependency: PR #1156 merged as 7850bcffd84263aca0d65a7fcd46743b8145adbe
artifact-proof dependency: none; PR #1150 deferred
repository promotion: authorized by founder instruction, 2026-07-14
implementation: this PR
```

An implementer may report factual constraints or deviations but may not
redefine the build-map contract, mode matrix, failure behavior, report V2
shape, file plan, or acceptance tests without returning the spec to
founder-led reconciliation.
