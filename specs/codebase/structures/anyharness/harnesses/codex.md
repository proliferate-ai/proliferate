# Codex Harness

AnyHarness installs the published Proliferate Codex ACP fork from the exact npm
package version in the agent registry. The managed npm installer relies on
npm's registry-integrity verification, while the generated catalog records the
resolved `dist.integrity` as provenance. The wrapper executable resolves from
`node_modules/.bin/codex-acp`.

- Agent-process line: `@proliferate-ai/codex-acp@0.18.3-proliferate.1`
- Install strategy: direct registry-backed `ManagedNpmPackage`; there is no
  Git checkout or package subdirectory in the runtime install path
- Runtime expectation: the wrapper and its matching optional platform package
  are published before the registry version is promoted
- Engine relationship: the adapter embeds the Codex core it serves over ACP;
  the separately pinned native Codex CLI is used for native auth/readiness and
  must be updated and probed alongside the embedded core

The Codex ACP session config surface also exposes `fast_mode` as a live control.
That maps to Codex `service_tier = fast` for the current session, but it is not
persisted across reload/resume by the current Codex rollout replay path.

Native collaboration events are normalized by the ACP adapter before they
reach AnyHarness. Spawn events own a stable parent `Agent` tool item; child
interaction, wait, resume, close, and activity milestones become ordered tool
items carrying `_meta.anyharness.parentToolCallId`. Terminal statuses update
the original parent rather than creating a second receipt. Live and paginated
rollout replay share the same bounded deduplication state machine.

The current Codex protocol does not expose the child thread's full prose,
reasoning, or inner tool stream, and V2 supplies no natural child-completion
event. The transcript therefore shows only the collaboration activity that the
adapter receives. A parent stays running until an explicit terminal update or
the enclosing AnyHarness turn boundary closes the still-open item; turn-boundary
closure does not prove that Codex observed the child's natural completion.
Multi-target activity without one unambiguous parent remains unattributed
rather than being nested under a guess.
