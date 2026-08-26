# Runtime Systems

One living document per system, in the nine-section anatomy the Organization
Standard fixes: **Purpose · Owned state · Public surface · Consumes · Laws ·
Emits · Fences · Code map · Proof**. A system spec is the ownership unit: every
source file belongs to exactly one spec's code map, and a change is filed
against the spec that owns the code, not the surface that discovered it.

These documents describe `main` unless a section says otherwise. Where the
target monorepo tree renames a folder, the code map records the rename as
`current path → target path` and nothing moves in the spec PR. Judgment calls
the founder still owes are marked inline as `> [!decision] PABLO DECIDES:`.

The older owner docs under [`../anyharness/`](../../../anyharness/README.md),
[`../desktop-native.md`](../../../desktop-native.md), [`../worker.md`](../../../worker.md)
and [`../codebase/`](../../README.md) remain the depth references the
system specs link into; each one carries a banner naming its owning system spec.

## Runtime plane (AnyHarness)

| Spec | Owns | Grade |
| --- | --- | --- |
| [workspaces.md](workspaces/README.md) | execution-surface identity, worktrees, repo roots, workspace files/git/setup surface, archive, checkpoints, purge, mobility | system |
| [harnesses.md](harnesses/README.md) | supported agent kinds, catalog/registry, install/seed/reconcile, readiness, launch options and probes, provider adapters | system |
| [subagents.md](subagents/README.md) | in-environment delegated agents: the Workspace product MCP, relationship lifecycle, completion delivery | system |
| [terminals.md](terminals/README.md) | PTY terminals, command runs, setup/archive-script runs, terminal output streams | system |
| [artifacts.md](artifacts/README.md) | file-backed artifact manifest, lifecycle, write protection (today: Cowork's artifact machinery) | system |
| [desktop_host.md](desktop-host/README.md) | the Desktop shell ↔ sidecar ↔ desktop worker seam | seam |

Systems owned by other planes (sessions, seam, environments, agent_auth,
integration_gateway, …) are listed here as they land.
