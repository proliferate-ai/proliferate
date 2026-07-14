# E2B template rollback

Status: authoritative for rolling an E2B cloud runtime template tag back to a
known-good immutable build.

Use this runbook when a newly promoted E2B template causes managed cloud
sandbox creation, runtime boot, or template smoke failures.
The release lane is documented in
[`../deploying/releases.md`](../deploying/releases.md), and the managed sandbox model
is documented in
[`../../codebase/platforms/product/sandbox-provisioning.md`](../../codebase/platforms/product/sandbox-provisioning.md).

## Mental model

Cloud template releases publish immutable `sha-<shortsha>` tags, smoke-test the
exact immutable ref, and then move a rolling tag:

```text
TEAM_SLUG/proliferate-runtime-cloud:sha-<shortsha>
TEAM_SLUG/proliferate-runtime-cloud:staging
TEAM_SLUG/proliferate-runtime-cloud:production
```

Rollback means smoke-testing a previously good immutable `sha-*` tag and moving
the affected rolling tag back to that immutable build. Do not edit server
runtime or provisioning code for a template rollback.

Rolling tags affect newly created E2B sandboxes. Existing running or paused
sandboxes keep the image they already started with. There is no shipped atomic
sandbox-replacement flow; escalate existing-sandbox recovery instead of
improvising one.

## Required access

- GitHub Actions through the GitHub MCP, `gh`, or the GitHub web UI.
- E2B access for the template family.
- Local shell with Node dependencies installed when using the repo scripts.
- `E2B_API_KEY` for smoke and tag promotion.
- `E2B_ACCESS_TOKEN` and `E2B_TEAM_ID` only when building or publishing a new
  template, which rollback should normally avoid.
- GitHub environment access when checking `E2B_PUBLIC_TEMPLATE_FAMILY`,
  `E2B_TEMPLATE_REF`, or hosted deploy summaries.

Secrets policy:

- Do not paste `E2B_API_KEY`, `E2B_ACCESS_TOKEN`, provider dashboard tokens,
  sandbox environment values, or Worker enrollment tokens into chat, issues,
  PRs, or docs.
- Share template family refs, rolling tags, immutable tags, workflow run URLs,
  sandbox ids from smoke tests, and sanitized log snippets.

## Find the rollback target

1. Identify the affected environment and rolling tag:
   - staging uses `:staging`
   - production uses `:production`
2. Find the current bad immutable tag from the failed `Deploy Staging`,
   `Promote Production`, `Release Cloud Template`, or
   `Promote Cloud Template` run summary. The E2B job summary prints the
   immutable tag and template family.
3. Find the previous known-good immutable `sha-*` tag from the last successful
   run for the same rolling tag. Do not use a rolling tag as the rollback
   source.
4. Confirm the hosted environment points at the rolling ref. In hosted deploys,
   `E2B_TEMPLATE_REF` should be the family plus `:staging` or `:production`.
   Server runtime config uses `E2B_TEMPLATE_NAME`.

Useful commands:

```bash
gh run list --workflow "Deploy Staging" --limit 20
gh run list --workflow "Promote Production" --limit 20
gh run list --workflow "Release Cloud Template" --limit 20
gh run list --workflow "Promote Cloud Template" --limit 20
```

Inspect a candidate run and look for `Immutable tag`, `Rolling tag`, and
`Family` in the summary or logs:

```bash
gh run view <run-id> --web
gh run view <run-id> --log | rg 'sha-|E2B template|Promoted'
```

## Smoke the source tag

Run the smoke test against the exact immutable rollback source before moving
any rolling tag:

```bash
export E2B_PUBLIC_TEMPLATE_FAMILY='TEAM_SLUG/proliferate-runtime-cloud'
export GOOD_SHA_TAG='sha-<known-good-shortsha>'

(
  trap 'unset E2B_API_KEY' EXIT
  printf 'E2B API key: '
  IFS= read -r -s E2B_API_KEY
  printf '\n'
  export E2B_API_KEY
  node scripts/smoke-cloud-template.mjs \
    --template "$E2B_PUBLIC_TEMPLATE_FAMILY:$GOOD_SHA_TAG"
)
```

The subshell exports the silently entered key only to the smoke command and
unsets it on both success and failure. Do not replace the prompt with a literal
assignment.

The smoke test creates a throwaway sandbox, verifies the AnyHarness, Worker,
Supervisor, and Git credential-helper binaries, checks agent install
availability, proves Supervisor can start AnyHarness with an isolated smoke
config, and kills the sandbox before exit. It does not enroll a Worker against
Cloud or prove the hosted materialization path.

If the source tag fails smoke, do not promote it. Choose an earlier known-good
immutable tag or treat the incident as an E2B/provider or repo-wide runtime
issue.

## Roll back staging

There is no dedicated staging rollback workflow today. After the source tag
passes smoke, move the `staging` rolling tag with the repo promotion script:

```bash
(
  trap 'unset E2B_API_KEY' EXIT
  printf 'E2B API key: '
  IFS= read -r -s E2B_API_KEY
  printf '\n'
  export E2B_API_KEY
  node scripts/promote-cloud-template.mjs \
    --name "$E2B_PUBLIC_TEMPLATE_FAMILY" \
    --source-tag "$GOOD_SHA_TAG" \
    --tag staging
)
```

Then smoke the rolling staging ref:

```bash
(
  trap 'unset E2B_API_KEY' EXIT
  printf 'E2B API key: '
  IFS= read -r -s E2B_API_KEY
  printf '\n'
  export E2B_API_KEY
  node scripts/smoke-cloud-template.mjs \
    --template "$E2B_PUBLIC_TEMPLATE_FAMILY:staging"
)
```

## Roll back production

Prefer the manual GitHub workflow so the rollback is visible in Actions:

```text
Workflow: Promote Cloud Template
source_tag: sha-<known-good-shortsha>
```

The workflow re-smoke-tests the immutable source tag and promotes it to the
rolling `production` tag. Watch the run to completion before declaring
production recovered.

If GitHub Actions is unavailable and an incident owner approves local recovery,
use the same script path as staging with `--tag production`, then create a
follow-up issue with the command, operator, and verification evidence.

## Verification

The rollback is complete when all of these are true:

- The promotion command or workflow reports that the known-good immutable tag
  was assigned to the affected rolling tag.
- A post-promotion smoke test passes against the rolling ref:

  ```bash
  (
    trap 'unset E2B_API_KEY' EXIT
    printf 'E2B API key: '
    IFS= read -r -s E2B_API_KEY
    printf '\n'
    export E2B_API_KEY
    node scripts/smoke-cloud-template.mjs \
      --template "$E2B_PUBLIC_TEMPLATE_FAMILY:<staging-or-production>"
  )
  ```

- The next managed cloud sandbox creation in the affected environment uses the
  rolled-back ref and can launch authenticated AnyHarness during
  materialization.
- New materialization failures are no longer dominated by template boot or
  missing-executable errors. Worker health is checked separately because
  sidecar startup is best-effort.

For staging, run the cloud E2B suite when provider credentials and time allow:

```bash
make test-cloud-e2b
```

## Common failure modes

| Symptom | First response |
| --- | --- |
| `Source tag ... does not exist` | Confirm the template family and immutable tag from the Actions summary; build ids are not rollback tags. |
| Smoke fails on the rollback source | Pick an earlier successful `sha-*` tag; do not move the rolling tag to an unverified source. |
| Promotion succeeds but new sandboxes still use the bad image | Check whether the environment is pinned to an immutable `E2B_TEMPLATE_REF` or `E2B_TEMPLATE_NAME` instead of the rolling tag. |
| Production rollback workflow fails before smoke | Inspect GitHub secrets and E2B access; refresh credentials in the owning secret store without printing them. |
| Existing user workspace still fails after rollback | Its existing sandbox may still use the bad image. Preserve evidence and escalate; do not improvise sandbox replacement. |
| E2B API or sandbox create is degraded | Pause further promotion attempts, preserve workflow and smoke evidence, and update the incident owner. |

## Final report

Report the affected environment, bad immutable tag, rollback immutable tag,
template family, rolling tag moved, workflow run URL or exact local command,
smoke results, whether any existing sandboxes still need recovery, and any
remaining owner. State explicitly that no E2B secrets, enrollment tokens, or
sandbox environment values were shared.
