# Retained Production Release Receipts

This directory is the durable, immutable store of retained-release receipts:
the exact production N-1 artifact identities Tier 4 update qualification
starts from
([`tier-4-scenario-contract.md`](../../../specs/developing/testing/tier-4-scenario-contract.md)
"Artifact Identity"). Local runs and GitHub Actions read the identical
committed receipt — same checkout, same bytes, same logical retained set.

## Contents

- `index.json` — append-only index of receipts. Each entry records the
  release id, source SHA, qualification state, receipt path, and the SHA-256
  of the exact receipt file bytes. Consumers reject a receipt whose bytes do
  not match its index entry.
- `v<X.Y.Z>.json` — one receipt per retained production release, conforming
  to `RetainedReleaseReceiptV1`
  (`tests/release/src/artifacts/retained-release-set.ts`).

## Rules

1. **Receipts are immutable.** Once indexed, a receipt file never changes.
   Re-sealing the same release must reproduce identical bytes; differing
   bytes are a hard failure, never an overwrite.
2. **The index is append-only.** Entries are added when a release is
   retained; they are removed only when a release leaves the retention set
   defined below, in a reviewed PR.
3. **Only immutable identities.** Locators embed the exact version, source
   SHA, or content digest. Mutable aliases (`latest`, `production`,
   `stable` as the terminal segment), expiring signed URLs, local paths, and
   short-lived Actions artifacts are rejected by validation.
4. **No secrets, no raw provider responses.** Receipts are public release
   metadata plus hashes.

## N-1 and the one-time bootstrap truth

`N-1` means the retained receipt of the last production release **qualified
through this platform** — never a decremented version string, a rebuild from
older source, or whatever a rolling alias currently points at.

The platform has a first-release paradox: no release could be marked
`qualified` before Tier 4 could run, and Tier 4 could not run without a
retained release. By founder ruling (2026-07-16), production **v0.3.38** is
the one-time `bootstrap_unqualified` baseline:

- The v0.3.38 receipt does **not** claim the release was historically
  qualified; its `qualification_state` says so explicitly, it carries no
  qualification evidence, and evidence derived from it displays that state.
- Its E2B `input_hash` is `null` — E2B exposes no template input hash and no
  code recorded one at release time. This is a disclosed unavailable
  historical artifact, allowed only on the bootstrap receipt. `qualified`
  receipts must carry a real input hash.
- Its self-host target records `server-v0.3.35`: v0.3.38 was a hotfix that
  did not ship the server surface, so production self-host truthfully remained
  at 0.3.35.
- Once any `qualified` receipt exists in the index, selecting a
  `bootstrap_unqualified` receipt **fails closed**. The bootstrap exception
  is one-time.

## Retention roots

A receipt in `index.json` is a garbage-collection **root**: every artifact it
references (CDN desktop packages and signatures, the versioned updater
snapshot, GitHub release assets, GHCR image digests, the E2B template build
behind the recorded immutable source tag) must not be deleted while the
receipt is indexed. At minimum the index retains:

- the current production release's receipt, and
- the immediately previous qualified production receipt until a later
  production release completes its update qualification, and
- any receipt referenced by an unresolved qualification incident.

Deleting an artifact still referenced by an indexed receipt is a
release-pipeline failure, surfaced by `make qualification-retained-release`
(hash/identity validation fails closed before any world side effect).

## Operating

```bash
# Validate + materialize (bytes verified on every use, cache never trusted):
make qualification-retained-release RETAINED_RELEASE_ID=v0.3.38

# Also live-verify E2B immutable identity (read-only metadata lookup):
make qualification-retained-release RETAINED_RELEASE_ID=v0.3.38 LIVE=1

# Select the baseline for T4-RUNTIME-1:
RELEASE_E2E_RETAINED_RELEASE_ID=v0.3.38 make release-e2e LANE=sandbox SCENARIOS=T4-RUNTIME-1 ...
```

Receipts are created/sealed with
`tests/release/src/cli/retained-release.ts seal`, which independently
verifies every downloadable artifact's bytes and (with `--live`) the E2B
immutable identity before writing anything.
