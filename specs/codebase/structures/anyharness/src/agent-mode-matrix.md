# Agent Session Mode Matrix

This document defines how a session `mode_id` is selected before launch, with a
focus on product flows that intentionally run unattended. It does not define
the live mode of an already-running session; that remains ACP-reported state.

## Sources Of Truth

The active AnyHarness agent catalog owns two related pieces of static data:

- `session.controls[key = "mode"].values` is the agent-level create-session
  mode vocabulary.
- optional `session.unattendedModeId` is the mode an unattended product flow
  may select when the caller did not explicitly choose one.

The field is curation, not a universal default. It must not change ordinary
interactive session creation, stored user preferences, or the mode chosen by an
agent process when `mode_id` is omitted.

The runtime may start from the bundled `catalogs/agents/catalog.json` document
or activate a newer validated catalog through control-plane sync. The active
document is projected into the target's resolved launch options. ProductClient
combines those target-local options with cloud display metadata, but the
selected local, cloud, or SSH runtime owns the effective unattended default.

Current launch-option responses carry `unattendedModeId` as a nullable property:

- a string means the selected target curates that unattended mode
- `null` means the selected target intentionally has no unattended default
- an absent property identifies an older response shape; only then may the
  product fall back to the cloud catalog value for compatibility

That property-presence rule prevents a newer cloud catalog from overriding an
older or differently curated target by accident.

## Selection Precedence

An unattended product flow resolves `mode_id` in this order:

1. a non-blank explicit caller or user selection
2. the selected target's `unattendedModeId`, if the selected agent and model
   support it
3. omission of `mode_id`

An explicit selection wins even when it differs from the unattended curation;
AnyHarness still applies normal create-session validation and rejects an
unsupported explicit value rather than silently replacing it.

The catalog default is safe to use when the selected model either has no
model-specific mode vocabulary or explicitly includes the curated value. The
product omits it when the target agent cannot be resolved, the selected model
cannot be resolved, or the model advertises a mode list that excludes it.
Omission is the conservative fallback: the agent process keeps its own normal
default.

Standard interactive chat does not consult `unattendedModeId`. Cowork,
workflow, plan handoff, and review execution may opt into the resolver because
those launches are explicitly unattended. Their independent product behavior
does not justify separate per-agent fallback maps.

## Catalog Validation

An active catalog may contain `session.unattendedModeId` only when all of these
invariants hold:

- the value is non-blank
- the agent-level `session.controls` contains a `mode` entry whose values
  include it
- every model that declares its own `controls.mode` vocabulary includes it

A model without a model-specific mode vocabulary inherits the validated
agent-level set. Catalog build and runtime activation both enforce these
invariants so an invalid synced document never becomes launch truth.

## Current Curation

Only agent families with a repo-supported, unambiguous unattended permission
mode receive a value:

| Agent | Agent-level mode vocabulary | `unattendedModeId` | Rationale |
| --- | --- | --- | --- |
| Claude | `auto`, `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions` | `bypassPermissions` | Catalog and product presentation identify it as bypassing permission checks. |
| Codex | `read-only`, `auto`, `full-access` | `full-access` | Catalog and product presentation identify it as unrestricted access. |
| Cursor | `agent`, `plan`, `ask` | unset | `agent` describes capability, but the repo does not establish equivalent unattended permission semantics. |
| Grok | no create-session `mode` control | unset | There is no catalog mode vocabulary to validate. |
| OpenCode | `build`, `plan` | unset | `build` is not proven to bypass permission prompts. |

Unset values are deliberate. Do not infer a permissive mode from ordering, a
presentation `isDefault` flag, a mode name such as `agent` or `build`, or a
provider-specific hardcoded table.

## Controls Through The Stack

Before launch:

1. ProductClient resolves the selected target's merged launch agent and model.
2. An unattended workflow applies the precedence above.
3. The HTTP create-session request carries the resulting opaque `mode_id`, if
   any (`anyharness-contract/src/v1/sessions.rs`).
4. AnyHarness validates it against the active catalog and selected model before
   launching the resolved agent process.

After launch, the ACP binary reports its own `SessionModeState`. The live
session actor stores that state and normalizes the reported controls into the
common session-config buckets. Live ACP config is authoritative from that point
forward; static catalog curation is not active-session truth.

`collaboration_mode` remains a separate live control. In particular, Codex may
report both `mode` and `collaboration_mode`, but create-session `mode_id` does
not set collaboration mode. Choosing `full-access` for an unattended launch
does not authorize the product to invent a collaboration-mode override.

Product labels, descriptions, icons, and safe interactive defaults live in
`apps/packages/product-domain/src/chats/session-controls/presentation.ts`.
Presentation enriches catalog values for UI; it does not own unattended launch
policy.

## Required Test Cases

Changes to this contract must cover:

- catalog validation of valid and invalid unattended values
- default selection for a supported agent and model
- explicit caller selection taking precedence
- unset/unknown/unsupported agent and model fallback to omission
- parity between local and remote launch-option projection
- current-response explicit `null` versus older-response missing-property
  compatibility behavior
