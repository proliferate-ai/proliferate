# `agent-auth-state` contract fixture

The `agent-auth/state.json` document: **Python produces it, Rust consumes it.**

Per `specs/developing/testing/README.md` ("Contract fixtures"), a shared JSON
shape that crosses a language boundary gets a golden fixture here; the producing
language asserts it produces this, each consuming language asserts it parses
this, and a shape change is made by changing the fixture — which mechanically
breaks the other side until it is updated.

- Producer: `server/proliferate/server/cloud/materialization/materialize/agent_auth.py`
  (`render_agent_auth_state`), for both the cloud-materialized and the
  desktop-served surface.
- Consumer: `anyharness-lib`'s `domains/agents/route_auth/` — `load_state_file`
  → `resolve_profile` → `render_profile`.

## What `v2.json` pins

Three things the two sides could otherwise drift on silently:

**1. Per-harness gateway keys, not one shared key.** Every gateway source
carries its OWN virtual key (`sk-vk-claude-0001`, `sk-vk-codex-0002`,
`sk-vk-opencode-0003` — all distinct). The keys are scoped per
(subject, harness) by the gateway's access groups, so a renderer that resolves
one subject-wide key and fans it out to every harness is wrong and this fixture
makes that wrong-ness a test failure rather than a runtime surprise.

**2. Empty-sources semantics.** `grok` is present with `"sources": []`. That is
NOT the same as being absent, and the difference is a launch-refusal:

| Document state | Meaning | Launch |
| --- | --- | --- |
| harness absent (there is no `opencode-zen` entry here) | never configured | native — the harness's own login |
| `"sources": []` (grok, here) | selected, but nothing satisfiable | **refused**, `AGENT_ROUTE_SELECTION_MISSING` |
| `"sources": [..]` | usable | routed |

agent-auth.md, "Absent means native; present-but-empty fails closed". A harness
whose selected sources could not be satisfied (unsynced enrollment, exhausted
budget, revoked key) keeps its entry with the dead source omitted, and a launch
that resolves zero usable sources for a still-selected route is refused with a
typed error. A selection never silently degrades to the user's personal
credentials.

**3. Source order within a harness.** The producer sorts a harness's sources by
`(kind, env_var_name)`, and `"api_key"` sorts before `"gateway"` — so opencode's
`api_key` row comes FIRST and its gateway row second. This is not cosmetic: a
fixture in the other order is a document no reconcile could ever emit, so the
consumer would be pinning a shape that never reaches a sandbox. Both sides assert
the order (`test_the_fixtures_source_order_is_the_order_this_renderer_emits` on
the producer, `the_fixtures_satisfiable_entries_resolve_to_the_documented_profiles`
on the consumer).

Also pinned incidentally, because they are easy to get wrong: the document is
**snake_case** on the wire (`harness_kind`, `env_var_name`, `base_url`,
`user_id`, `issuing_server_origin`) while `settings` values are the catalog's own
camelCase keys; a harness may carry several sources at once (opencode: a direct
`api_key` + gateway); and cursor's only route is `api_key` (it has no gateway
story).

## Reconciliation status

Written by the Rust side (Track A / A4). **Track B's B3 must produce byte-identical
output for these inputs** — if B3 has already landed a fixture at this path with a
different shape, that shape wins and this consumer test is updated to it rather
than the other way round. Do not let the two forks coexist.
