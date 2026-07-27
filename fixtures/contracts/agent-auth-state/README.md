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
opencode source-order bug) and later gained fail-closed semantics on the
A-corridor tip (`agents/a8-poke-wiring`, D3-rust's base). **D1 forked from
`agents/b4-snapshot-rekey`, which never merged A4's fixture work** — so this
branch's `render_agent_auth_state` still has the OLDER semantics. This
fixture is written to match THIS branch's actual producer, not the
A-corridor's newer one.

Diffing the two fixtures directly (not just reading their READMEs) surfaces
**four concrete structural divergences**, not a one-line "third source"
delta — whoever reconciles the two lineages needs all four, or lands a
fixture that breaks a currently-passing test on one side or the other:

1. **`issuing_server_origin`.** a8's `v2.json` carries
   `"issuing_server_origin": "https://api.proliferate.example"` at the
   top level; this branch's fixture has no such field (this branch's Rust
   `AgentAuthState.issuing_server_origin` decodes as `Option`, defaulting to
   `None`, so parsing this branch's fixture on a8's Rust would silently
   produce `None` rather than fail — but a8's own
   `the_contract_fixture_parses_as_a_v2_document` test explicitly asserts
   `Some("https://api.proliferate.example")`, so swapping in this branch's
   fixture verbatim breaks that assertion).
2. **Harness count and membership.** a8's fixture has 5 harnesses (claude,
   codex, cursor, grok, opencode); this branch's has 3 (claude, codex,
   opencode) — no `cursor` (this branch's `AGENT_AUTH_HARNESS_KINDS` excludes
   it) and no `grok` entry at all. a8's
   `the_contract_fixture_parses_as_a_v2_document` asserts
   `state.harnesses.len() == 5`; that assertion breaks immediately if this
   branch's 3-harness fixture is substituted.
3. **Empty-sources ("fail-closed") semantics.** a8 keeps `grok` present with
   `"sources": []` — a harness selected but unsatisfiable renders present-but-
   empty, and a8's `the_fixtures_empty_entry_fails_closed_while_an_absent_one_is_native`
   Rust test depends on exactly that grok entry to prove the fail-closed
   refusal path. This branch's renderer instead OMITS a harness entirely when
   every source is unsatisfiable (`by_harness.setdefault` only ever creates an
   entry when a source resolves) — there is no `sources: []` case anywhere in
   this branch's fixture, and this branch's own producer test
   (`test_a_harness_with_no_resolvable_source_is_absent_not_empty`) asserts
   the opposite of a8's law by name.
4. **Per-harness gateway keys — the two producer suites assert OPPOSITE
   facts.** This branch's fixture and its producer test
   (`test_each_gateway_harness_renders_its_own_distinct_key`) assert
   claude/codex/opencode's gateway keys are all DISTINCT (B3's per-harness key
   map has already landed on this branch's ancestry). a8's OWN producer test
   suite (`server/tests/unit/test_agent_auth_state_contract_fixture.py` on
   `agents/a8-poke-wiring`,
   `test_per_harness_gateway_keys_are_not_produced_yet`) asserts the fixture's
   keys are IDENTICAL today, on purpose — a deliberate known-gap tripwire
   documented to fail loudly once B3 lands and get deleted then. Reconciling
   the two fixtures means deleting a8's tripwire test, not just merging JSON.

Reconciling the two fixture lineages (old vs. new fail-closed semantics, plus
these four concrete divergences) is exactly the "known gap" the D3 brief §1
flagged for whoever rebases D3-python onto `main` after D1, B4, and C2 have
all merged — not solved here. A `git merge-tree` of this branch's head against
`agents/a8-poke-wiring` at their merge-base additionally shows: add/add
conflicts on `v2.json`, this `README.md`, and
`server/tests/unit/test_agent_auth_state_contract_fixture.py` (both sides
created these paths independently — git cannot even three-way-merge them);
and ordinary content conflicts (both sides modified the same lines since the
merge-base) on `scripts/max_lines_allowlist.txt`,
`server/proliferate/server/catalogs/service.py`,
`specs/codebase/platforms/product/agent-auth.md`,
`server/tests/unit/test_agent_catalog_endpoint.py`, and
`specs/codebase/platforms/product/model-catalog.md`. None of these are
resolved by this PR — they are the concrete shape of the reconciliation work,
recorded here so the operator doing it isn't discovering the scope from
scratch.

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
