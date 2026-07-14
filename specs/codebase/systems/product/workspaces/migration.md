# Workspace Migration And Mobility

Status: authoritative for the current product boundary.

There is no current user-facing local-to-cloud, cloud-to-local, or
cloud-to-cloud workspace move workflow. The old Cloud mobility tables, Desktop
move UI, handoff state machine, cleanup tracker, and cross-runtime cutover
service were removed. AnyHarness still has a narrow target-local mobility
substrate, but raw runtime operations are not a supported user or founder
procedure by themselves.

Use [AnyHarness mobility](../../../structures/anyharness/src/mobility.md) for
the retained runtime mechanics.

## Current Product Boundary

The current product does not provide:

- a Desktop move control or mobility footer;
- a Cloud mobility ledger or handoff service;
- an active external orchestrator that chooses a destination, drives both runtimes,
  and records a durable cutover;
- cleanup/retry/repair ownership across source and destination runtimes; or
- a supported manual procedure that stitches the raw AnyHarness endpoints
  together.

AnyHarness SDK methods and narrow Server wrappers expose runtime operations.
They do not create a product flow. A future product migration workflow would
need a separate orchestrator that establishes authority over both sides,
chooses and prepares the destination, records the canonical result, handles
interruption, and owns cleanup.

There is no active external orchestrator for this today.

## Retained AnyHarness Substrate

AnyHarness owns only target-local transport and workspace safety:

```text
preflight source
  -> freeze source for one handoff id
  -> prepare exact clean destination worktree
  -> export clean session archive
  -> install at the same commit
  -> mark source remote-owned
  -> destroy old source
```

That sequence is not self-authorizing. A caller must already know that the
destination is correct and that destroying the source is safe.

## Contributor Rules

- Do not present migration as shipped product behavior.
- Do not invoke raw mobility operations as a supported user workflow.
- Do not infer that a product move exists from SDK methods, Server wrappers, or
  AnyHarness endpoints.
- Do not recreate the deleted Desktop/Cloud mobility design in this current
  truth document.
- Keep future move planning outside repository operating docs until an owner,
  product contract, and validation plan are explicit.

Git history retains the removed target design and implementation rationale.
