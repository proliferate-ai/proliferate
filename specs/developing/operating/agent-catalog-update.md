# Agent Catalog Update

How to update the agent catalog: bump a harness to a new upstream version,
review the nightly probe PR, add or change a harness definition, and roll
back a bad update. Architecture and document contract:
[agent-distribution.md](../../codebase/platforms/product/agent-distribution.md).
Credential lifecycle for the scheduled run (provision, rotate, revoke,
audit): [catalog-probe.md](catalog-probe.md).

Permissions: repo write for review-and-merge paths; a machine with the
relevant harness credentials for local probe runs; nothing here needs
provider-console or environment-secret access (that is catalog-probe.md's
domain).

The catalog only changes through the probe pipeline. There is no
hand-editing path: `catalog.json` is generated output, and CI rejects a
version bump without a content change and a content change without a
version bump.

## Review the nightly probe PR

The scheduled `Catalog Probe` workflow (daily, 09:00 UTC) opens a PR when
resolved pins or probe observations changed. Reviewing it is the routine
operation:

1. Read the rendered diff on `catalog.json`. Expected shapes: version
   bumps in `harness.agentProcess`/`harness.native` with new sha256
   targets, model list changes under `session.models`, control or default
   changes, refreshed `provenance` timestamps and attestations.
2. Treat these as stop signals, not diff noise:
   - An attested version that does not match the pinned version.
   - A model or control disappearing for a harness whose upstream did not
     announce a removal (often a probe environment problem, not reality).
   - An install-source change (npm to git, new download host) with no
     matching registry change in the same PR.
3. Merge when the diff matches upstream reality. The merge moves the
   fleet: the next server deploy advertises the new version to cloud
   sandboxes over heartbeats, and the nightly app build carries it to
   desktops.

If the scheduled run fails instead of opening a PR, the workflow files a
deduplicated `ops(agent-catalog)` issue; failure response and credential
health belong to [catalog-probe.md](catalog-probe.md).

## Bump a harness deliberately

For picking up a specific upstream release without waiting for the nightly:

1. Run a focused update on a machine holding that harness's probe
   credentials:

   ```sh
   make catalog-update CATALOG_PROBE_AGENTS=codex
   ```

   Comma-separate for more than one agent. Agents outside the selection
   are retained byte-for-byte. The target resolves current upstream pins,
   installs those exact artifacts, runs the full probe matrix for the
   selection, and promotes only agents backed by fresh successful probes.
2. Cursor is opt-in on top of selection (`CATALOG_PROBE_ARGS=--include-cursor`)
   and requires a working machine-local `cursor-agent` login; the
   scheduled environment never probes it.
3. `--allow-partial` is diagnostics only. The promotion gate refuses a
   catalog built from an incomplete probe run (`run.state` must record
   `complete=true`), so a partial run cannot ship by accident.
4. Open the PR and review it as above. Note `make catalog-update` is not
   read-only on the machine that runs it: it reconciles the installed
   agents under the local dev runtime home to the new pins.

`make catalog-pin` is the narrower tool: it re-resolves pins and promotes
already-committed probe snapshots without probing. Use it when only an
artifact moved (a re-published tarball) and the observed behavior is
already covered by committed evidence.

## Change a harness definition

Install method, auth vocabulary, login policy, and launch discovery live
in `registry.json`, which is hand-edited and reviewed like code:

1. Edit `catalogs/agents/registry.json`; bump `registryVersion`.
2. Run the focused `catalog-update` for the affected agents so the
   catalog re-resolves and re-probes against the new method, and ship
   both documents in one PR (`probedAgainst.registryVersion` must match).
3. Registry changes reach machines only inside a new runtime binary;
   there is no live push for the method document. Plan for the change to
   take effect at the next release train, not the next heartbeat.

## Roll back

Revert the catalog PR. Cloud sandboxes converge backward on the next
heartbeat (the runtime applies any version that differs from its active
one, older included); desktops pick the revert up with the next app
update. The version-discipline check still applies: the revert commit
must carry a new, higher `catalogVersion`, which `git revert` does not
produce on its own; re-run `make catalog-pin` after the revert if needed
so the promoted document gets a fresh version.

Rolling back a registry change is the same revert plus the release-train
delay, since the method document only ships in binaries.

## Verification

1. CI on the PR: `scripts/validate-agent-catalog.mjs`, the Rust catalog
   tests, and `scripts/agent-catalog/check-version-discipline.mjs` all
   pass. A red pin test on a lone document edit is the review tripwire
   working.
2. After merge and deploy: a cloud sandbox heartbeat converges the
   runtime (`GET /v1/catalogs/agents/version` on the runtime reports the
   new `catalogVersion`), and its reconcile installs the new pins.
3. `cd scripts/agent-catalog && node render-catalog.mjs` renders the
   promoted document to HTML for a human-readable check of models,
   controls, and pins.

## Failure modes

- The promotion gate refuses with "incomplete diagnostic probe run": a
  prior `--allow-partial` run left `run.state` without `complete=true`.
  Run a complete `catalog-update` or intentionally remove the local
  probe state.
- A harness's probe fails locally but its upstream is healthy: check the
  credential for that auth context on the probing machine; the pipeline
  carries the previous entry forward, so a failed probe never degrades
  the shipped catalog.
- The fleet does not pick up a merged catalog: cloud requires a server
  deploy (heartbeats advertise the served version, and the server reads
  the file from its own checkout); desktop requires the next app build.
  Neither converges from the merge alone.
- Version-discipline check fails on an otherwise-correct PR: the content
  changed without a `catalogVersion`/`registryVersion` bump, or a bump
  landed without content change. Both directions are rejected.
