# Workspace Mobility Decision: Git Base Preparation and Round-Trip

Status: accepted

## Decision

Mobility archives are always applied on top of an exact clean git base.

The archive is not responsible for provisioning or checking out that base. It
only carries mutable state relative to that base.

Therefore every handoff has two distinct phases:

- prepare the destination at the exact source branch + base commit SHA
- apply the exported archive on top

## Source of truth

The source AnyHarness runtime provides:

- current branch name
- exact `HEAD` SHA

The destination preparation flow must materialize that exact branch + SHA
before archive install begins.

## Local -> cloud

The server/control plane owns cloud destination preparation.

It must:

- validate the branch exists remotely
- validate the exact SHA is reachable from the remote
- provision or attach the cloud workspace
- fetch and check out the exact source branch + SHA

This is a separate provisioning mode from the existing cloud flow that creates
a new branch from a base branch.

## Cloud -> local

The local AnyHarness runtime owns local destination preparation.

It must:

- fetch the source branch
- check out the source branch
- reset the local repo to the exact source SHA

Only after that may archive install proceed.

This is required because the archive carries only:

- tracked modifications
- tracked deletions
- untracked non-ignored files

It does not carry new commits.

## Archive metadata

The archive should include branch name and base commit SHA as validation
metadata only.

Those fields exist to detect mismatch during install, not to replace the
destination-prep step.

## Why

Applying a delta on top of the wrong base is incorrect.

The runtime installer should remain simple:

- validate `destination HEAD == archive base SHA`
- apply mutable state

That keeps install deterministic and avoids inventing ad hoc merge logic in the
mobility layer.

## References

- [docs/anyharness/src/git.md](/Users/pablo/proliferate-workspace-mobility-plan/docs/anyharness/src/git.md)
- [session-portability-summary.md](./session-portability-summary.md)
