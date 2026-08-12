# Product MCP Definitions

Read [servers.md](../servers.md) first. That spec
defines the source layout and implementation rules. Files in this folder define
the initial product MCPs we are standardizing.

Each definition carries the durable laws of one product MCP:

```text
agent-facing identity and exposure rules
tool inventory (names, not schemas)
lifecycle laws (auth, ordering, races)
compatibility semantics
```

Static MCP metadata (id, route slug, server name, visibility, injection) lives
in code — [servers.md](../servers.md) names the definition files as its
source-of-truth pattern. Tool argument/return schemas live in the tool
implementations, not here.

Cross-cutting standards:

- [prompt-and-skill-policy.md](prompt-and-skill-policy.md)

Definitions:

- [workspace.md](workspace.md) — target Workspace contract
- [subagents.md](subagents.md) — current compatibility truth until the legacy
  Subagents MCP is removed during Workspace implementation
- [cowork.md](cowork.md)
- [reviews.md](reviews.md)
