# Make Production Runtime Evidence Usable

> [!important] Frozen contract
> Founder-approved on 2026-07-14 and grounded in Proliferate `origin/main` at
> `66f45bfbe2839ae1382133393844ba61dce035cd` and a read-only production
> audit on 2026-07-14. Implementation is authorized only after the centralized
> access preflight is green and this contract is promoted.

- Current slice: **B2 — Make production runtime evidence usable — frozen**
- Implementation base: the exact accepted B1 revision
- Parallel tracker slice: **A — Put the target tracker live, dark — frozen**
- Dependent slice: **C — Activate Sentry and prove sandbox investigation — frozen**

## Outcome

Make the product's runtime and Sentry evidence identify the exact deployed
code, environment, user, and E2B sandbox without reworking the support feed.

```text
exact reviewed source revision
-> build one immutable E2B template with exact version + SHA
-> prove AnyHarness, worker, and supervisor identify that build
-> move the environment's E2B rolling reference
-> deploy the same server revision with stale identity overrides removed
-> create one fresh internal sandbox
-> prove the exact runtime/template/owner/provider identity and health
-> leave tracker ingestion disabled
```

B2 is complete only when staging and production run the same tested source and
runtime build, the live task no longer carries the known stale identity
overrides, and one fresh production E2B sandbox runs all three expected
binaries with the bounded identity inputs C will observe.

## Current production baseline

Observed on 2026-07-14:

- production uses ECS task `proliferate-prod-server:113` and image
  `proliferate-server:66f45bfbe283`;
- `/api/meta` reports server `0.1.0`, runtime `0.3.28`, and worker `0.1.0`;
- the live task carries stale `SERVER_VERSION`, `ANYHARNESS_VERSION`,
  `ANYHARNESS_GIT_SHA`, `E2B_TEMPLATE_VERSION`,
  `CLOUD_RUNTIME_SENTRY_RELEASE`, `CLOUD_TARGET_SENTRY_RELEASE`, and
  `E2B_RUNTIME_SENTRY_RELEASE` values;
- generic telemetry scrubbing changes Sentry's top-level `environment` to
  `[redacted]` in server and product-client events;
- worker and supervisor scrub their bounded `runtime_env` tag;
- E2B rebuild does not pass `PROLIFERATE_BUILD_VERSION` or
  `PROLIFERATE_BUILD_SHA`, so Rust package fallback can report `0.1.0` and no
  source SHA; and
- the current `:production` rolling template predates the merged runtime
  identity work.

The identity producer path already exists:

```text
connect.py resolves owner user + exact provider sandbox ID
-> bootstrap.py emits PROLIFERATE_USER_ID, PROLIFERATE_SANDBOX_ID,
   and PROLIFERATE_RUNTIME_ENV=e2b
-> AnyHarness, worker, and supervisor attach bounded Sentry identity
-> values are scoped to the runtime processes rather than the user shell
```

B2 deploys and proves this path. It does not redesign it.

## Dependencies and green access gate

B2 does not start until:

- the complete centralized access preflight is green;
- B1 is accepted and its receipt proves the private feed secret remains
  correctly injected through the same server deployment workflow;
- GitHub Actions OIDC can deploy the selected staging/production surfaces;
- `E2B_API_KEY` and `E2B_ACCESS_TOKEN` exist for Actions;
- `E2B_TEAM_ID`, `E2B_PUBLIC_TEMPLATE_FAMILY`, and each environment's
  `E2B_TEMPLATE_REF` identify the expected template family;
- the authenticated local E2B client can create, exec, inspect, log, and kill
  a dedicated sandbox;
- current ECS Sentry DSN configuration entries exist and are nonempty for
  server/runtime/target; these are non-secret ingest endpoints, not secret
  references; and
- one authenticated internal product user can initiate and clean up a
  founder-owned cloud-sandbox record, while the direct E2B client has the
  separately proved provider lifecycle authority. P0 may record that the
  pre-B2 staging materializer did not reach readiness; B2 already owns making
  the fresh product-created sandbox healthy in staging and production.

No slice may stop halfway for a key, sign-in, provider scope, secret location,
or permission decision. B2 consumes the P0-proven paths and the accepted B1
deployment contract.

## Scope

B2 owns:

- preserving only bounded Sentry deployment/runtime identity through the
  existing privacy scrubbers;
- removing inherited server-authored runtime release overrides;
- stamping the exact version and source SHA into AnyHarness, worker, and
  supervisor in one E2B build;
- failing immutable-template smoke on identity mismatch;
- deploying the exact E2B template before the server revision that launches
  it; and
- proving one fresh internal runtime in staging and production.

B2 must preserve B1's support-feed secret injection unchanged. It does not
re-open feed auth, privacy, schema, or deployment design.

## Repository changes

Expected bounded file tree:

```text
proliferate/
├── .github/workflows/
│   ├── _deploy-server.yml
│   └── _deploy-e2b.yml
├── scripts/
│   ├── build-template.mjs
│   └── smoke-cloud-template.mjs
├── server/
│   ├── proliferate/integrations/sentry.py
│   └── tests/unit/test_sentry_integration.py
├── apps/
│   ├── packages/product-domain/src/telemetry/
│   │   ├── scrub.ts
│   │   └── scrub.test.ts
│   ├── desktop/src/lib/integrations/telemetry/
│   │   ├── scrub.ts
│   │   └── sentry.test.ts
│   ├── web/src/lib/integrations/telemetry/sentry.ts
│   └── mobile/src/lib/integrations/telemetry/sentry.ts
├── anyharness/crates/
│   ├── proliferate-worker/src/logging.rs
│   └── proliferate-supervisor/src/logging.rs
└── specs/
    ├── developing/analytics/sentry.md
    ├── developing/deploying/ci-cd.md
    └── developing/reference/env-vars.yaml
```

Existing build stamp and identity producers under the three runtime crates,
`server/proliferate/server/cloud/runtime/bootstrap.py`, and
`server/proliferate/server/cloud/materialization/sandbox_io/connect.py` remain
authoritative review seams. No server domain, database, migration, tracker, or
support-feed implementation belongs in this PR.

## Server deployment identity

In `.github/workflows/_deploy-server.yml`:

1. preserve B1's `SUPPORT_FEED_BEARER_TOKEN` ECS secret entry exactly;
2. add `PROLIFERATE_REQUIRE_RELEASE_IDENTITY=1` for hosted tasks;
3. stop constructing `ANYHARNESS_GIT_SHA`,
   `CLOUD_RUNTIME_SENTRY_RELEASE`, or `CLOUD_TARGET_SENTRY_RELEASE` from the
   server SHA/release;
4. explicitly remove the known stale inherited variables:

   ```text
   SERVER_VERSION
   ANYHARNESS_VERSION
   ANYHARNESS_GIT_SHA
   E2B_TEMPLATE_VERSION
   CLOUD_RUNTIME_SENTRY_RELEASE
   CLOUD_TARGET_SENTRY_RELEASE
   E2B_RUNTIME_SENTRY_RELEASE
   ```

5. require `VERSION` and `anyharness/sdk/package.json` to agree and use that
   canonical release version for the hosted server/runtime/worker pins rather
   than worker/supervisor Cargo package `0.1.0`; and
6. inspect the final rendered task before registration, failing if any
   forbidden name remains, strict identity is absent, or B1's feed secret was
   lost/converted to plaintext.

Deleting assignments alone is insufficient because the workflow merges the
previous task definition's environment. The guards in
`bootstrap.py::_runtime_sentry_release`, `_target_sentry_env`, and
`server/proliferate/server/release.py::sanitize_component_release_override`
remain authoritative.

## Exact three-binary E2B build

`scripts/build-template.mjs::rebuildRuntimeBundle` must:

1. read the canonical runtime version from
   `anyharness/sdk/package.json`;
2. resolve the full SHA of the exact checked-out revision;
3. reject missing/malformed version or SHA input; and
4. pass `PROLIFERATE_BUILD_VERSION` and `PROLIFERATE_BUILD_SHA` into the
   single build of AnyHarness, worker, and supervisor.

No production build may fall back to Cargo package versions or an empty source
SHA.

`scripts/smoke-cloud-template.mjs` gains an explicit expected-version input and
runs all three binaries with `--version`. Any mismatch fails the immutable
template before `_deploy-e2b.yml` moves `:staging` or `:production`. The exact
checkout plus immutable `sha-<12>` template tag binds the source SHA; the
stamped SHA remains the source for each component's canonical Sentry release.
B2 does not add a second build-info endpoint.

## Bounded Sentry envelope preservation

The exact top-level Sentry field `environment` is deployment identity, not a
raw process-environment map.

For product clients, add one product-domain envelope scrubber:

```text
snapshot exact top-level event.environment
-> run the existing recursive telemetry scrubber
-> scrub the snapshot as text
-> restore only that top-level string
```

Web, Desktop, and Mobile Sentry adapters use it. Server `_scrub_event` applies
the same bounded rule locally.

Worker and supervisor `scrub_event` preserve only the exact tag
`runtime_env`, whose allowed live value here is `e2b`. Other env-like keys,
raw process-environment maps, URLs, paths, bodies, tokens, and secrets remain
redacted.

Immediate deployment proof is required for the server, hosted Web, and E2B
runtime. Desktop and Mobile carry the bounded code correction through their
normal release lanes; B2 does not add a Desktop or TestFlight release.

B2 deliberately manufactures no Sentry exception. Local/focused tests prove
the scrubbers and live runtime checks prove the deployed inputs. C owns the
harmless intentional exception and the first live assertion of
`environment`, user, sandbox, `runtime_env`, release, and exact event identity.

## Deployment and live runtime proof

For each environment:

```text
exact reviewed checkout
-> build immutable sha-<12> template once
-> smoke all three binary versions
-> move the environment rolling template reference
-> deploy the exact server image from the same revision
-> create a fresh internal sandbox
-> verify provider/template/owner mapping + three binaries + runtime health
```

The fresh-sandbox proof compares:

- product cloud-sandbox owner user ID to the designated internal user;
- product `e2b_sandbox_id` to the E2B provider sandbox ID;
- product `e2b_template_ref` to the moved rolling target and immutable build;
- AnyHarness, worker, and supervisor `--version` to the canonical version;
- runtime health and worker heartbeat to the expected AnyHarness/worker pins;
  and
- only the named daemon identity inputs
  `PROLIFERATE_USER_ID`, `PROLIFERATE_SANDBOX_ID`, and
  `PROLIFERATE_RUNTIME_ENV=e2b` through a bounded process inspection that
  returns comparison results rather than a full environment dump.

No customer workspace is used. No intentional error is triggered.

## Verification

### Local and CI proof

At minimum:

```bash
cd server
DEBUG=true uv run pytest -q \
  tests/unit/test_sentry_integration.py \
  tests/unit/test_runtime_sentry_release.py

cd ..
pnpm --filter @proliferate/product-domain test
cargo test -p proliferate-worker
cargo test -p proliferate-supervisor
node --check scripts/build-template.mjs
node --check scripts/smoke-cloud-template.mjs
python3 scripts/check_docs.py
```

Focused tests prove:

- top-level Sentry `environment` survives in Python and TypeScript;
- nested `env`/`environment` fields and representative secrets remain
  redacted;
- `runtime_env=e2b` survives worker/supervisor scrubbing while other env-like
  keys do not;
- missing/malformed build identity fails before publish;
- all three template binaries must report the expected release version;
- the rendered ECS task removes every forbidden variable, enables strict
  identity, and preserves B1's secret-backed feed entry; and
- server runtime release guards reject server-authored component overrides.

### Staging proof

For the exact reviewed 40-character SHA:

1. record the prior staging ECS task, image, immutable template, and rolling
   target;
2. build immutable `sha-<12>` from that checkout with the expected version/SHA;
3. prove all three binaries report the expected version;
4. smoke the immutable template, then move only the staging rolling reference;
5. deploy the exact server image;
6. inspect the live task for exact image, strict identity, forbidden-variable
   absence, and preserved B1 feed secret;
7. prove `/api/health` and `/api/meta` report coherent expected versions; and
8. create one fresh internal E2B sandbox and perform the bounded mapping,
   binary, identity-input, and health proof above.

### Production proof

Promote the same staging-tested revision and immutable template. Do not rebuild
from a mutable branch.

Repeat the staging task, health, meta, and fresh-sandbox checks in production.
Record exact task/image/template/SHA/version coordinates, owner/provider
identity comparisons, and rollback commands in a private `0600` receipt.
Do not create a Sentry event; hand the live sandbox coordinates to C.

## Failure and rollback behavior

- Missing/malformed version or SHA fails before E2B publish.
- Any binary-version mismatch fails immutable-template smoke; rolling tags do
  not move.
- A failed staging proof blocks production.
- Before mutation, record the previous ECS task definition, image, immutable
  E2B tag, and rolling target.
- If the server proof fails, restore the prior server task.
- If the fresh runtime proof fails, restore the prior E2B rolling target and
  prior server task as a pair so server/template pins remain coherent.
- After rollback, re-prove health, `/api/meta`, B1 feed auth, and one fresh
  sandbox from the restored target.
- A concrete contradiction with the frozen code contract returns for a
  bounded amendment; it does not authorize architecture re-derivation.

## Acceptance criteria

- [ ] The complete centralized access preflight is green.
- [ ] B1 is accepted and its feed-secret deployment remains unchanged.
- [ ] Exact reviewed base and deployment revision are recorded.
- [ ] No forbidden inherited release/version variable remains live.
- [ ] Strict hosted release identity is enabled.
- [ ] The exact immutable E2B template passes three-binary version smoke before
      either rolling reference moves.
- [ ] `/api/meta` and all three runtime binaries report coherent expected
      versions.
- [ ] Focused Python/TypeScript/Rust tests preserve only the approved bounded
      Sentry identity while redacting raw environment data.
- [ ] One fresh production sandbox maps to the exact internal owner, provider
      sandbox, template, runtime scope, version, and source revision.
- [ ] No intentional Sentry exception occurs; C owns live-event proof.
- [ ] Tracker ingestion remains disabled.
- [ ] Prior server/template coordinates and tested rollback commands are in
      the private receipt.

## Non-goals

- changing B1's feed auth, wire shape, secret store, or privacy contract;
- enabling Sentry, support, Grafana, or another tracker source;
- triggering C's exception-to-tracker investigation;
- writing tracker adapters, schemas, migrations, or backfills;
- reporter notification, outreach, or product UI changes;
- Grafana or CloudWatch work;
- general telemetry, IAM, deployment, or Terraform redesign;
- adding metadata beyond user ID, sandbox ID, bounded runtime environment,
  deployment environment, release version, and source revision; or
- emergency Desktop/Mobile distribution solely to prove corrected telemetry.

## Founder teach-back before freeze

Pablo should be able to explain:

1. why the exact E2B template is built and smoked before the server that
   launches it is promoted;
2. why deleting deploy assignments does not remove stale variables from an
   inherited ECS task; and
3. why B2 proves runtime inputs without manufacturing a Sentry exception,
   while C proves the first live event.

## Handoff

```text
Status:              Frozen
Repository:          proliferate-ai/proliferate
Grounded base:       66f45bfbe2839ae1382133393844ba61dce035cd
Implementation base: exact accepted B1 revision chosen at freeze
Authority:           this founder-approved contract until explicit promotion
Implementation:      prohibited until founder approval + green preflight
Tracker sources:     remain disabled throughout B2
Receipt consumed by: C
```
