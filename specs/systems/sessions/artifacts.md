# Artifacts

Status: current (grade B). System spec in the Organization Standard anatomy. The runtime system that owns **file-backed artifacts a workspace declares**: a per-workspace manifest (`.proliferate/artifacts.json`), the create / update / delete / read / list lifecycle over it, and write protection that stops generic file operations from clobbering manifest-tracked paths. There is no artifact table; git history is the version history.

Honesty about scope: on `main` this domain is **Cowork's artifact machinery** — every entry point is gated on `WorkspaceSurface::Cowork` and the only tools that call it are the Cowork MCP's. The Organization Standard's coverage audit recorded exactly that, and the roster's *artifacts/evidence* system (screenshots, files and run outputs captured as evidence for any run) is greenfield. This spec describes what exists and marks the graduation path. Depth reference: [cowork-artifacts.md](cowork-artifacts.md).

## 1. Purpose

Let an agent produce renderable, durable outputs (markdown, HTML, SVG, React) that the product treats as first-class objects rather than loose files: listed, titled, protected from accidental overwrite, and readable over HTTP by the client. The future purpose (evidence) is the same mechanism with the Cowork gate lifted and a run/session attribution added.

## 2. Owned state

| State | Where |
| --- | --- |
| `.proliferate/artifacts.json` — `ArtifactManifestDocument { version: 1, artifacts: BTreeMap<id, entry> }`; entry = id, immutable path, type, title, description, timestamps | [manifest.rs](../../../anyharness/crates/anyharness-lib/src/domains/artifacts/manifest.rs) |
| The artifact files themselves, at manifest-declared relative paths inside the workspace | written only through [runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/artifacts/runtime.rs) (temp-file + atomic commit) |
| Per-workspace in-process lock serializing manifest mutations | `ArtifactRuntime.workspace_locks` |

Supported types ([model.rs](../../../anyharness/crates/anyharness-lib/src/domains/artifacts/model.rs)): `text/markdown`, `text/html`, `image/svg+xml`, `application/vnd.proliferate.react`.

## 3. Public surface

- HTTP read model ([cowork.rs](../../../anyharness/crates/anyharness-lib/src/api/http/cowork.rs)):
  `GET /v1/workspaces/{id}/cowork/manifest`,
  `GET /v1/workspaces/{id}/cowork/artifacts/{artifact_id}`.
- MCP tools (served by the Cowork product MCP today):
  `create_artifact`, `update_artifact`, `delete_artifact`, `list_artifacts`,
  `get_artifact` — dispatch in `domains/cowork/mcp/**`, behavior here.
- In-process: `ArtifactRuntime` (get_manifest, get_artifact, create, update,
  delete), `ArtifactService` (pure plans: `plan_create` / `plan_update`,
  [service.rs](../../../anyharness/crates/anyharness-lib/src/domains/artifacts/service.rs)),
  `ArtifactProtectionService::is_protected_relative_path`
  ([protection.rs](../../../anyharness/crates/anyharness-lib/src/domains/artifacts/protection.rs))
  — the hook [workspaces.md](../workspaces/README.md) consults before generic file
  mutations.

## 4. Consumes

- `workspaces` — `WorkspaceRecord` (path, surface) and the
  `WorkspaceFileProtection` port in
  [files_runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/files_runtime.rs).
  Declared edge: `artifacts → workspaces`.
- Nothing else. The domain is the in-repo exemplar of the pure-policy /
  effects-in-runtime use-case shape ([domains.md](../../areas/anyharness.md)).

## 5. Laws

**The manifest is the truth; only listed files are artifacts.** A renderable extension without a manifest entry is an ordinary file; a manifest entry whose file is missing reports `exists: false` rather than disappearing.

**Paths are immutable.** `create_artifact` chooses the path; `update_artifact` may change content, title, description only; there is no rename/move. Renames would break the git-history-is-version-history contract.

**Writes are atomic and serialized per workspace.** Content and manifest are written to temp files and committed together under the workspace lock; a failed commit rolls back both ([runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/artifacts/runtime.rs)).

**Protected paths fail closed.** The manifest path and every manifest-declared artifact path are refused by generic file writes/renames/deletes for a protected workspace; only the artifact tools may touch them.

**Policy is pure.** `plan_create` / `plan_update` take `(manifest, input)` and return a plan; identity and clock are minted in the runtime step.

## 6. Emits

- `ArtifactManifest` / `ArtifactDetail` read models (client cowork pane).
- Turn-end autosave is *triggered* by cowork's runtime, not emitted here.

## 7. Fences

| Not owned | Owner |
| --- | --- |
| Cowork roots, threads, session startup prompts, MCP server registration, turn-end autosave trigger | cowork (`domains/cowork/**`) |
| Which sessions get the artifact tools | sessions' MCP binding assembly |
| Generic file operations | workspaces / adapters |
| Client rendering (iframe sandboxing, JSX transform) | client workspace surface ([components/workspace/cowork](../../../apps/packages/product-client/src/components/workspace/cowork)) |
| Run-level evidence capture, screenshots, artifact upload to the control plane | artifacts/evidence — greenfield, see decision |

> [!decision] PABLO DECIDES: artifacts vs evidence. Options: (a) keep this
> domain as-is under cowork's ownership (rename the spec `cowork_artifacts`,
> fold into the cowork decision in [subagents.md](../subagents/README.md)); (b) generalize:
> lift the `WorkspaceSurface::Cowork` gate to "any workspace", attach artifacts
> to a session/run id, expose the five tools through the Workspace MCP, and let
> the control-plane *evidence* primitive (run result + attachments) ship
> manifest entries as checkpoints. Recommendation: (b) — the manifest +
> protection + atomic-write core is exactly the evidence substrate, and the
> cowork coupling is one enum check.

## 8. Code map

```text
anyharness/crates/anyharness-lib/src/domains/artifacts/   → target: systems/artifacts/
├── model.rs          types, read models, inputs, ArtifactError
├── manifest.rs       schema v1, load/validate/normalize/persist, enrich
├── service.rs        pure plans (create/update), manifest read model
├── runtime.rs        ArtifactRuntime: lifecycle ops, per-workspace lock, atomic commit
└── protection.rs     ArtifactProtectionService (WorkspaceFileProtection impl)
anyharness/crates/anyharness-lib/src/domains/cowork/{manifest,artifacts}.rs   compatibility wrappers (cowork-owned)
anyharness/crates/anyharness-lib/src/domains/cowork/mcp/**                  tool dispatch (cowork-owned)
anyharness/crates/anyharness-lib/src/api/http/cowork.rs                     HTTP read model (cowork-owned transport)
anyharness/crates/anyharness-contract/src/v1/cowork.rs                      wire shapes
```

## 9. Proof

- There is **no test module inside `domains/artifacts/`** — the lifecycle is
  pinned indirectly by cowork's MCP tests and the desktop cowork pane. This is
  the spec's first gap.
- Protection is exercised by the workspace file-operation tests that write
  through `files_runtime.rs`.

## Known gaps / follow-ups

- Add `domains/artifacts/tests.rs` pinning: manifest round-trip, immutable
  path, atomic-commit rollback, protection fail-closed.
- If decision (b) lands, the Cowork gate becomes a per-workspace policy value
  and `cowork/{manifest,artifacts}.rs` wrappers are deleted.
