# Delivery spec — engineering cull: zombie deletion (PR-E4)

Status: frozen delivery specification. Part of the engineering-systems cull
ladder; independent of the other cull PRs and of the product-cull bundles.

## Intent

Delete the two dispatch-only workflows that own nothing. Pure deletion; no
new machinery of any kind.

## Scope — deleted

| Workflow | Evidence |
| --- | --- |
| `cloud-tests.yml` | Dispatch-only; its `daytona` matrix legs invoke Makefile targets that do not exist and demand a `DAYTONA_API_KEY` — "daytona" appears nowhere else in the repository. The e2b legs' targets (`make test-cloud-e2b`, `test-agent-runtime-cloud-e2b`) remain reachable by hand via the Makefile. |
| `cloud-live-webhook.yml` | Dispatch-only. Pre-step performed: `guides/**` grep for the filename found no references; adversarial review then caught one reference by display name (`Cloud Live Webhook` in `guides/deploying/hosted.md`), removed in this PR. The delivery README's workflow-inventory rows were the only other documentation references. |

## Scope — explicitly kept

- `agent-runtime-compat.yml` — dispatch-only and dormant, but it is the only
  CI route to the standalone `anyharness/tests` suite
  (`pnpm test:agent:runtime:attached`). It stays as that suite's home until
  the step-3 CI/CD specification designs the nightly lane; deleting it now
  would orphan the suite permanently.

## Changed

- `specs/codebase/systems/engineering/delivery/README.md`: the two deleted
  workflows' inventory rows removed (same-PR docs law).
- `guides/deploying/hosted.md`: the `Cloud Live Webhook` bullet removed
  (referenced the deleted workflow by display name).

## Non-goals

`server/tests/e2e` and its `make test-cloud-e2b` target stay (step-3 testing
question) · no nightly workflow is created here · no other workflow file is
touched.

## Acceptance

- Grep-gates → 0 (excluding this spec): `cloud-tests.yml` ·
  `cloud-live-webhook` · `daytona` (repo-wide, case-insensitive).
- `agent-runtime-compat.yml` present and unchanged (`git diff --stat` shows
  no touch).
- `.github/workflows/` count drops by exactly 2.
- `check_docs.py` green.

## Revert

Plain revert; nothing depends on ordering.
