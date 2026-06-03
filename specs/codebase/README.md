# Codebase Specs

Status: authoritative index for implementation-facing specs.

Use this folder for codebase ownership, product/runtime primitives, and
user-facing feature contracts. Developer process, deployment, debugging,
analytics, and QA runbooks live under [../developing/](../developing/).

## Read Order

Start with the category that owns the change:

| Category | Owns | Read |
| --- | --- | --- |
| Structures | Folder rules, dependency direction, code maps, generated boundaries, and system ownership. | [structures/README.md](structures/README.md) |
| Primitives | Reusable product/runtime concepts consumed by multiple features or structures. | [primitives/README.md](primitives/README.md) |
| Features | User-facing workflows, product surfaces, acceptance matrices, and manual smoke expectations. | [features/README.md](features/README.md) |

Then read the focused specs named by the category index. Most product changes
need at least one structure spec and either one primitive or one feature spec.

## Ownership Boundaries

- Structures tell you where code belongs and which layers may depend on which
  other layers.
- Primitives tell you the durable contract shared across workflows, such as
  provisioning state, command delivery, billing gates, MCP runtime config, or
  agent auth materialization.
- Features tell you how users experience a workflow, which primitives it
  consumes, and what acceptance or QA coverage proves it works.

When a topic spans all three, read in this order:

1. Structure spec for the code you will touch.
2. Primitive spec for the shared state or runtime contract.
3. Feature spec for the user-facing workflow.

## Coverage Rules

- If a planning topic has no dedicated feature spec yet, use
  [features/README.md](features/README.md) to find the current owner and create
  a focused feature spec before making an end-to-end behavior change.
- If a named system has no dedicated structure spec yet, use
  [structures/README.md](structures/README.md) to find the current owner and
  split a structure spec only when the codebase boundary is real.
- If a primitive name in planning docs does not exactly match a file name, use
  [primitives/README.md](primitives/README.md) to find the canonical current
  file.
- Specs under [../tbd/](../tbd/) are not operating law until they are promoted
  into this folder with a clear owner and contract.
