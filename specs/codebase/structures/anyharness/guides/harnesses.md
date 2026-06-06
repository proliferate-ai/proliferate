# AnyHarness Harness Docs

Status: authoritative for provider-specific harness documentation under
`specs/codebase/structures/anyharness/harnesses/**`.

## Purpose

Harness docs explain provider-specific runtime behavior that a developer must
know before changing an agent adapter, launch behavior, transcript
normalization, or live controls.

Use a harness doc when the rule is specific to one provider:

- Claude-specific ACP extension capabilities
- Codex-specific package/version expectations
- provider-specific live config controls
- provider-specific transcript/event normalization quirks
- provider-specific restart, permission, or user-input semantics
- provider-specific adapter limitations that affect product behavior

Harness docs are not a place for general AnyHarness architecture.

## What Does Not Belong Here

Keep these elsewhere:

- Public wire schemas -> `anyharness-contract` and
  [contract.md](../contract.md).
- Provider credential file discovery -> `anyharness-credential-discovery`.
- Managed CLI install/probe/path/version mechanics ->
  `integrations/agent_cli` and [integrations.md](integrations.md).
- Cross-provider session engine rules ->
  [specs/session-engine.md](../specs/session-engine.md).
- Generic ACP/MCP protocol helpers -> `integrations/acp` or
  `integrations/mcp`.

## File Shape

Use one file per provider:

```text
harnesses/claude.md
harnesses/codex.md
harnesses/gemini.md
```

Each provider doc should answer:

- how the provider is launched or selected when that differs from the default
- what ACP extensions or provider metadata AnyHarness supports
- what live controls exist and whether they persist
- how provider-specific events map into AnyHarness transcript surfaces
- what limitations are intentional so future work does not accidentally remove
  safety guards

If a provider rule affects multiple layers, document the provider-specific
behavior here and link to the owning architecture guide for the shared rule.
