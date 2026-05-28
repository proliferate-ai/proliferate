# Product System Quick Reference

Status: study packet index. The files in this directory are quick-reference
review docs, not replacements for the canonical specs.

Read these as separate Anki/review surfaces:

1. `01-repo-folder-structure.md`
2. `02-cloud-workspace-target-sandbox-materialization.md`
3. `03-worker-loop-exposure-web-mobile-sync.md`
4. `04-cloud-command-contract-deliverability.md`
5. `05-agent-auth-mcp-skills.md`

Canonical sources remain:

- `docs/README.md`
- `docs/current/specs/README.md`
- `docs/server/README.md`
- `docs/anyharness/README.md`
- `docs/frontend/README.md`
- `docs/sdk/README.md`

Core system invariant:

```text
commands: Cloud -> worker -> AnyHarness
events:   AnyHarness -> worker -> Cloud -> web/mobile/desktop views
```

