# Testing Depth

The depth behind [`specs/TESTING.md`](../TESTING.md), the per-PR testing
standard. Read that first; come here for release-validation detail.

- [`core-release-validation.md`](core-release-validation.md) — the complete
  target guarantee and qualification semantics; owns the current enforcement
  exception and closure order.
- [`release-worlds-and-fixtures.md`](release-worlds-and-fixtures.md) — the
  live Tier 3/4 worlds, their dependency matrix, and shared fixtures.
- [`tier-3-scenario-contract.md`](tier-3-scenario-contract.md) — the agreed
  Tier 3 composed world journeys.
- [`tier-4-scenario-contract.md`](tier-4-scenario-contract.md) — the single
  Tier 4 packaged install/upgrade stage: artifacts, controllers, evidence,
  current gaps.
- [`core-release-scenario-manifest.json`](core-release-scenario-manifest.json)
  — the machine-owned target-guarantee inventory, parity-tested against the
  contracts by `scripts/ci-cd/core-release-scenario-manifest.test.mjs`.
- [`manual-release-qa.md`](manual-release-qa.md) — the manual release QA
  procedure; automated tiers live in the standard. A flow covered by an
  automated tier does not also need a manual QA checklist entry.
- [`desktop-update-testing.md`](desktop-update-testing.md) — building and
  exercising the Desktop updater path locally.
- [`self-hosting.md`](self-hosting.md) — the self-host deployment fixture and
  its scenario battery.
- [`flows.md`](flows.md) — legacy current-coverage flow view being replaced
  by generated manifest/collector output.
- [`scenarios.md`](scenarios.md) — legacy implementation survey and finding
  ledger from 2026-07-07.
