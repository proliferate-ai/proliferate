# Gateway Models

How to add, change, or remove models served by the model gateway, rotate
its provider keys, and bump its upstream image. Architecture and account
model: [model-gateway.md](../../codebase/platforms/product/model-gateway.md).

Applies to hosted staging/production (ECS) and local dev
(`make server-litellm-up`). Permissions: repo write for tier 1; GitHub
environment-secret admin and provider-console access for tier 2 and key
rotation; deploy/promote rights for anything reaching production.

Changes come in three tiers of increasing blast radius. Every tier ends
with the same [verification](#verification).

## Tier 1: add, change, or remove a model (config-only PR)

For models whose provider is already configured.

1. Edit `server/litellm/config.yaml`:
   - Add one `model_list` entry per name harnesses may pin. Add the bare
     alias and the dated/versioned id both, pointing at the same upstream.
   - `litellm_params.model` must exist in the pinned LiteLLM version's
     model manifest
     ([`model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json);
     check the file at the pinned release tag, not `main`). Verify it;
     never invent it.
   - Aliases stay within one provider.
   - Tag `model_info: {access_groups: [...]}` with every harness group
     that should see the model.
2. Open the PR. On merge to `main`, `deploy-staging.yml` change-detects
   `server/litellm/**`, rebuilds the image, and redeploys the staging
   service.
3. Verify on staging, then promote to production via the normal release
   flow. There is no catalog step after a gateway model change: pickers
   learn gateway models from the proxy's per-key `GET /v1/models`.

Removing a model is the same PR in reverse. Harnesses pinning the removed
name start receiving 400s, so check spend logs for recent usage first.

## Tier 2: add a provider

A new provider is never just a config change. The secret plumbing is
hardcoded in the deploy workflow.

1. Add config entries as in tier 1, under a new provider section.
2. Add the secret to the chain, in all four places:
   - GitHub environment secret `AGENT_GATEWAY_MANAGED_<PROVIDER>_API_KEY`
     on both the staging and production environments.
   - `.github/workflows/_deploy-litellm.yml`: the validate step, the SSM
     `put-parameter` block, and the `secret-updates.json` and merge lists.
   - `server/docker-compose.yml`: env passthrough for local dev.
3. Providers without API keys take their own path. Bedrock uses the ECS
   task-role policy (`proliferate-gateway-bedrock-invoke`) in cloud and
   optional `GATEWAY_AWS_*` env vars locally. A new keyless provider needs
   the equivalent IAM design, not a workflow secret.
4. Deploy and verify as in tier 1.

## Tier 3: bump the upstream image pin

This is the highest-risk change: it swaps the code serving all inference
and the pricing manifest that costs spend. See also the release notes in
[../deploying/releases.md](../deploying/releases.md).

1. Pick the target official release tag and resolve its OCI index digest.
2. Update the identical `vX.Y.Z@sha256:...` string in all three places:
   `server/litellm/Dockerfile`, `server/docker-compose.yml`, and the
   expected constant in `scripts/ci-cd/litellm-image-pin.test.mjs`. The
   test failing on a lone Dockerfile edit is the review tripwire working.
3. Re-verify every `litellm_params.model` id against the new version's
   manifest; ids and prices move between releases.
4. Run the gateway smoke (`scripts/agent-gateway-smoke/`) against staging
   before promoting.

## Rotate a provider key

The GitHub environment secret is the only knob. Never write to SSM or the
ECS task definition by hand: every deploy re-pushes all secrets
(`put-parameter --overwrite`) and re-renders the task definition, so a
hand-edit silently reverts on the next unrelated deploy. That revert is
the incident, not the procedure.

1. Rotate the raw key in the provider's console.
2. Update the GitHub environment secret (staging and/or production).
3. Rerun the litellm deploy for that environment. Rotation is not a
   special path; it is what every deploy does.
4. Verify (below), then revoke the old key in the provider console.

Secrets policy: the shared rules in [README.md](README.md) apply. Provider
keys appear nowhere in CLI arguments, logs, or PR text; the config
references them only as `os.environ/<NAME>`.

## Verification

1. `GET <public_base_url>/health/liveliness` returns 200.
2. Mint a probe key scoped to one access group
   (`POST /key/generate {"models": ["<group>"]}` with the master key).
   Assert its `GET /v1/models` returns exactly that group's models, an
   in-group completion succeeds, and an out-of-group completion returns
   403 `key_model_access_denied`. Delete the probe key.
3. For tier 2, tier 3, and rotation: run one live completion per affected
   provider. The smoke matrix covers all harnesses.

## Failure modes

- 400 unknown model after a removal or rename: a harness still pins the
  old name. Re-add the dated alias or update the pinning surface.
- Provider auth errors shortly after an unrelated deploy: a classic
  hand-rotation revert. Re-run the rotation procedure through the GitHub
  secret.
- A model passes traffic but spend looks wrong: the id is missing from
  the pinned manifest (tier 3 step 3 was skipped). The proxy serves it
  while usage import misprices it.
- The staging deploy did not trigger: the change touched files outside
  `server/litellm/**`. Check the change-detect step in
  `deploy-staging.yml`.
