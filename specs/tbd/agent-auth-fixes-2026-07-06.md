# Agent Auth — fix list (validated 2026-07-06)

*Output of the adversarial end-to-end validation pass (3 tracing agents: local
chain, cloud chain, PR #963) plus the catalog-convergence research. Each item:
what's wrong, the exact change, how to verify. Companion docs:
[`catalog-convergence-v1.md`](./catalog-convergence-v1.md) (the convergence lane,
already spec'd) and [`agent-auth-architecture-v2.md`](./agent-auth-architecture-v2.md)
(the target-state spec, written assuming everything below is landed).*

**Validation results in one line:** local auth chain fully clean (all 5 links
proven, env delta lands on the spawned process); cloud auth chain clean on all 5
claimed links (path agreement + provision-before-first-session both hold); the
bugs are at the edges — rotation, compat, deploy wiring, and the missing
convergence transport.

---

## F1 — P0 · vkey rotation never re-materializes (paying users stay broken)

**Bug.** `_remint_virtual_key`
([`topups.py:196`](../../server/proliferate/server/cloud/agent_gateway/topups.py))
persists the new virtual key (`mark_enrollment_synced`,
[`enrollments.py:156`](../../server/proliferate/db/store/agent_gateway/enrollments.py))
but schedules **no materialization**. The fingerprint mechanism that would catch
the content change only runs *inside* materialization — and nothing triggers it:
`revision` derives from selection-row `updated_at`, and rotation mutates the
enrollment row, not selections. The new-enrollment path
([`enrollment.py:292`](../../server/proliferate/server/cloud/agent_gateway/enrollment.py))
does schedule it; the top-up rotation path does not.

**Blast radius.** Exhaust budget → top up → LiteLLM key rotated + reactivated →
cloud sandboxes keep serving the **old, disabled** vkey in `state.json` until an
unrelated selection edit. The user who just paid stays broken on the cloud
surface. (Local surface self-heals: `GET /state` renders fresh on every desktop
sync.)

**Fix.** After the enrollment persist (~`topups.py:246`):

```python
if enrollment.user_id is not None:
    await materialization_service.schedule_materialize_agent_auth(
        db, user_id=enrollment.user_id
    )
```

Then audit every other caller that remints/rotates/disables vkeys
(`integrations/litellm/client.py` rotate/disable/enable call sites) for the same
missing trigger — the invariant to enforce: **any mutation of
`virtual_key_ciphertext` or vkey status schedules materialization for the
affected subject.**

**Verify.** On the `billing` profile: exhaust → top up → confirm the sandbox
`state.json` fingerprint changes and a session launches on the new key with no
selection edit. (The 2026-07-04 billing verification passed because it exercised
the local surface.)

---

## F2 — P1 · state.json forward-tolerance is unproven (gate on #963)

**Risk.** #963 adds an optional `settings` field to the v2 wire shape without a
version bump. New-server → old-runtime therefore hinges entirely on serde
tolerating unknown fields. It does today — no `#[serde(deny_unknown_fields)]`
anywhere in
[`route_auth/state.rs`](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)
— but nothing pins that property, and this loader's failure mode is
**MalformedStateFile blocks every launch** (the v1→v2 lesson, §12 of the old
doc).

**Fix (in #963 before merge).**
1. Regression test: deserialize a v2 fixture carrying unknown keys at both the
   harness level and the source level; assert success. This pins forward
   tolerance permanently.
2. Comment on `HarnessAuth`/`AuthSource`: *never add `deny_unknown_fields` —
   optional-field additions are the upgrade path.*

**Also raise on #963 (product question, not a bug):** the chrome setting is
`surfaces: ["local"]` by design — cloud sandboxes deliberately ignore it. Fine
for `--chrome` specifically; confirm that's the intent so nobody assumes
harness settings reach cloud.

---

## F3 — P1 · #942 is a prod no-op without secret wiring (gate on #942)

**Bug.** #942 adds DeepSeek/GLM upstreams + the Rust matcher arms, but
[`_deploy-litellm.yml`](../../.github/workflows/_deploy-litellm.yml) maps only
ANTHROPIC/OPENAI/XAI keys to SSM. Prod's LiteLLM container launches without
`DEEPSEEK_API_KEY`/`ZHIPU_API_KEY` → probes return 0 models from those families.

**Fix (in #942 before merge).**
1. Add both keys to the workflow env mapping (~:67–69), the task-def secrets
   (~:157–162), and the secret-updates stanza (~:177), sourced from
   `AGENT_GATEWAY_MANAGED_DEEPSEEK_API_KEY` / `AGENT_GATEWAY_MANAGED_ZHIPU_API_KEY`.
2. Optional but recommended: catalog.json enrichment entries for
   `deepseek-chat` / `deepseek-reasoner` / `glm-4-plus` / `glm-4-flash` so they
   render rich rows instead of sparse ids. Remember the triple gate: JS
   validator + Rust `cargo test` (hardcoded values) + runtime rebuild
   (`include_str!`).
3. **Naming decision:** launch copy says "GLM 5.2"; the PR ships `glm-4-*`.
   Align one or the other before the affordability post.

---

## F4 — P1/P2 · catalog convergence (spec'd separately)

The pin-bump → fleet-converge transport does not exist: heartbeat carries no
`catalogVersion`, the worker has zero catalog code, the desktop has no catalog
sync hook — while the runtime's entire receiving side (apply → poke →
reconcile → `VersionDrift` reinstall) is built and waiting. Full design,
sequencing against the in-flight `ux/agents-*` migration, and verification bar:
[`catalog-convergence-v1.md`](./catalog-convergence-v1.md) (P1 heartbeat field,
P2 worker transport, P3 desktop hook, P4 re-probe on catalog/agent update, P5
version UI). **P1+P2 are buildable now** (zero overlap with the migration); P4
after #963; P5 after #956/#957/#963/#958.

Doc hygiene rider: `sync.rs:14-27`'s comment describes the heartbeat transport
as existing — misleading until P1/P2 land; reword or land the code.

---

## F5 — decision needed · org enrollment never reaches the launch path

**Confirmed:** materialization resolves personal enrollment only
([`agent_auth.py:271`](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)
→ `get_enrollment_for_user`, `subject_kind=user`, `organization_id=None`).
Org-subject enrollment rows are minted and stored but never queried at launch.

**This is a product decision, not a silent fix:** define the resolution order
(when does a member's gateway source bill to the org team vs their personal
enrollment?) before wiring it. Until decided, the target spec documents
personal-only as the contract.

---

## F6 — S · model-visibility toggle doesn't persist on the runtime-resolved path

**Gap.** Default-visible-unless-hidden is already the architecture (absence of
an override patch = visible; new probed models pass through untouched — exactly
the desired rollout behavior). What's missing: the All-Models **Enabled** toggle
on the local+gateway route is read-only because nothing wires it to the
existing override endpoint
([`api.py:287`](../../server/proliferate/server/cloud/agent_gateway/api.py),
`PUT /catalog/{harness_kind}/override` — the old architecture doc's "no override
endpoint yet" claim is stale).

**Fix.** Toggle writes a patch (`{"update": {"<id>": {"hidden": true}}}` /
removes the key on re-enable); model pickers and the All-Models table respect
`hidden`. Launch-plan filtering deliberately unchanged (`defaultVisible` is the
menu, `availability` is the truth — hidden models stay launchable if explicitly
requested).

---

## F7 — decision needed · grok's empty gatewayPolicy

Grok sees **every** gateway model (empty `providers` = unfiltered), including
Fable-class Anthropic models, by deliberate design (dynamic discovery CLI;
flagged as a follow-up in
[`HARNESS-MATRIX.md`](../../scripts/agent-gateway-smoke/HARNESS-MATRIX.md)).
Decide: keep (cheap-harness flexibility is on-brand for the affordability
story) or constrain (`providers: ["xai"]` or a seed list for picker parity).
XS either way; the target spec assumes **keep** unless you say otherwise.

---

## F8 — XS · self-host packaging gaps (pre-existing, still real)

From the old doc's §11, unchanged: no CI publishes
`ghcr.io/proliferate-ai/proliferate-litellm` (prod compose references it; only
ECR gets built); no Caddy route exposes the compose LiteLLM service;
`.env.production.example` still documents Bifrost (#940, in flight, fixes this
last one). These belong to the B-lane, listed here so the auth story's
self-host claim stays honest.

---

## Order of operations

1. **F1 now** (small, P0, billing-critical) — own PR.
2. **F2 + F3** as review gates on #963/#942 respectively — comments today.
3. **F4 P1+P2** (server heartbeat field + worker transport) — buildable now.
4. **F6** after the `ux/agents-*` UI restructure lands (touches the same table).
5. **F5 + F7** — decisions to make, then XS/S implementation.
6. **F4 P3–P5** per the convergence spec's sequencing.
