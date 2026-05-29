# Security

Status: draft security index for teams evaluating Proliferate.

Proliferate is designed for teams that need local control, cloud execution,
self-hosting, sandbox isolation, and clear runtime boundaries for agent work.

## Current References

- [Deployment self-hosting](../reference/deployment-self-hosting.md) covers
  local, self-managed, and production deployment modes.
- [Sandbox foundation](../current/specs/00-sandbox-foundation.md) defines cloud
  target and managed sandbox ownership.
- [Agent auth](../current/specs/02-agent-auth.md) defines sandbox-scoped agent
  LLM auth and gateway behavior.
- [MCP, skills, and plugins](../current/specs/01-mcp-skills-plugins.md) defines
  sandbox-scoped runtime capability projection.
- [Cloud running alignment](../current/specs/04-cloud-running-alignment.md)
  defines command queues, worker dispatch, projection, and preflight.

## Planned Coverage

- Enterprise deployment and network boundaries
- Local secret storage and cloud credential sync
- Sandbox isolation and lifecycle policy
- Shared auth, organization controls, and auditability
- Data flow for transcripts, diffs, artifacts, and tool calls
