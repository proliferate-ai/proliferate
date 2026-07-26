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

## Branch-state note (D3 python arm)

This fixture is new on `agents/d1-provider-configs` (D3 python's base): the
fixture did not exist anywhere on this branch's ancestry before this PR. It
was originally built on Track A's `agents/a4-fail-closed` (fixing an earlier
opencode source-order bug) and later gained fail-closed semantics
(`sources: []` kept for a selected-but-unsatisfiable harness,
`issuing_server_origin`) on the A-corridor tip (`agents/a8-poke-wiring`,
D3-rust's base). **D1 forked from `agents/b4-snapshot-rekey`, which never
merged A4's fixture work** — so this branch's `render_agent_auth_state` still
has the OLDER semantics: a harness whose every source is unsatisfiable is
OMITTED from `harnesses` entirely (not kept with `sources: []`), and there is
no `issuing_server_origin` field. This fixture is written to match THIS
branch's actual producer, not the A-corridor's newer one. Reconciling the two
fixture lineages (old vs. new fail-closed semantics) is exactly the "known
gap" the D3 brief §1 flagged for whoever rebases D3-python onto `main` after
D1, B4, and C2 have all merged — not solved here.

## What `v2.json` pins

**1. Per-harness gateway keys, not one shared key.** Every gateway source
carries its OWN virtual key (`sk-vk-claude-0001`, `sk-vk-codex-0002`,
`sk-vk-opencode-0003` — all distinct). The keys are scoped per
(subject, harness) by the gateway's access groups, so a renderer that resolves
one subject-wide key and fans it out to every harness is wrong and this fixture
makes that wrong-ness a test failure rather than a runtime surprise.

**2. Source order within a harness.** The producer sorts a harness's sources by
`(kind, env_var_name)`. Alphabetically `"api_key"` < `"gateway"` <
`"provider_config"`, so opencode's three sources appear in exactly that order:
`api_key` first, `gateway` second, `provider_config` third. This is not
cosmetic: a fixture in a different order is a document no reconcile could ever
emit, so the consumer would be pinning a shape that never reaches a sandbox.
Both sides assert the order
(`test_the_fixtures_source_order_is_the_order_this_renderer_emits` on the
producer, the equivalent Rust consumer test).

**3. `provider_config` sources carry an already-resolved, harness-real env
map, not generic vault field names.** opencode's third source
(`config_kind: "aws_bedrock"`) is a typed vault entry
(`AgentApiKey.kind = "aws_bedrock"`) rendered through
`_translate_provider_config_env`: its `env` map's keys
(`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`) are ALREADY opencode's real env-var
names — never the vault's generic storage field names (`region`,
`bearerToken`). Python resolves this translation before the document ever
reaches Rust (agent-auth.md's "Delivery: state.json": the runtime never learns
provider-config internals); `config_kind` rides along only so Rust's render
plane can pick which arm to run (plain env-set vs. codex's config.toml
injection for a codex/aws_bedrock or codex/azure_openai kind, once that arm
exists), never to rename a field. The DB `source_kind` backing this row is
still `api_key` — `provider_config` is a WIRE-only distinction, decided at
render time by which vault `kind` the referenced `AgentApiKey` row actually
has (see `AGENT_AUTH_SOURCE_PROVIDER_CONFIG`'s docstring in
`constants/agent_gateway.py`).

Also pinned incidentally, because they are easy to get wrong: the document is
**snake_case** on the wire (`harness_kind`, `env_var_name`, `base_url`,
`user_id`, `config_kind`) while `settings` values are the catalog's own
camelCase keys; a harness may carry several sources at once (opencode: a
direct `api_key`, a gateway, and now a `provider_config`); and this branch's
`AGENT_AUTH_HARNESS_KINDS` excludes `cursor` (native-only, no gateway/
provider-config recipe — agent-auth.md's Current-gaps: "Cursor selections are
rejected server-side", not this PR's scope to close) and does not include a
`grok`-with-empty-sources case (that fail-closed shape belongs to the newer
A4/A8 fixture lineage this branch does not yet have — see the branch-state
note above).

## Reconciliation status

Producer half (this file's `v2.json` + `README.md` + the Python test) is
owned by D3's python arm on `agents/d1-provider-configs`. The Rust consumer
half (`contract_fixture_tests.rs`) is D3-rust's responsibility, on its own
base (`agents/a8-poke-wiring`) — which per the branch-state note above already
has an EARLIER version of this fixture (A4/A8's fail-closed shape, no
`provider_config`). D3-rust must extend THAT fixture with the same third
opencode source this file adds, not overwrite it with this file verbatim —
the two fixture lineages need reconciling at whichever PR merges after both
land, per the D3 brief §1's flagged known gap. Do not let the two forks
coexist past that point.
