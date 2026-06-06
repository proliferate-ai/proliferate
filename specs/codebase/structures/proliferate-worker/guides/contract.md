# Worker Contract

Status: authoritative for `anyharness/crates/proliferate-worker/src/contract/**`.

`contract/` owns the **generated** Cloud↔Worker wire types — the single
language-neutral definition of what crosses the network. Cloud is the server, so
the Cloud-side contract module is the source of truth: FastAPI emits OpenAPI and
the Rust worker types are generated from it. Generated code is checked in and
never hand-edited.

"Single source" means one authoritative *definition* with all language types
*generated* — not a runtime-shared library, which is impossible across
Python / Rust / the network.

## Target Shape

```text
contract/
  mod.rs            # facade re-exporting the generated types
  generated.rs      # codegen output from the Cloud OpenAPI contract — do not edit
```

## What It Owns

The four contracts and the shared currency that ride the control and report
paths:

- `RevisionMap` — `Map<string, u64>`, keyed
  `"auth" | "plugins" | "mcp:<id>" | "exposures" | "revoked-jti" | ...`. Folding
  `revoked-jti` into the RevisionMap is what keeps everything on the one control
  poll.
- **Control exchange**: `ControlRequest` / `ControlResponse`.
- **Command envelope** (down): `CommandEnvelope` (`command_id`, `kind`,
  `payload`, `required_revisions`, lease fields).
- **Worker report** (up): `AppliedRevisionsReport` and `CommandResult`.
- **Bundle** (down, per domain): `BundleResponse` (`key`, `revision`,
  `content_hash`, domain `payload`).

There is no `SlotFence` and no slot or generation field. Identity is the bearer
`worker_token`, which resolves to one `target_id`; the target is 1:1 with its
sandbox, so there is nothing to fence.

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Thin facade re-exporting the generated wire types. | Transport, workflow logic, or hand-written DTOs. |
| `generated.rs` | The codegen output from the Cloud OpenAPI contract. | Anything hand-edited — regenerate instead. |

## Generation And Evolution Rules

- **Cloud is the source.** The Cloud contract module emits OpenAPI; the Rust
  worker client (and the TS client SDK) are generated from it.
- **Generated code is checked in and never hand-edited.** CI enforces sync:
  regenerate, and `git diff` must be clean.
- **Capability negotiation makes new kinds safe.** The worker advertises
  `supported_command_kinds`; Cloud only leases kinds the worker advertises. The
  advertised list is owned by `control/commands` (it knows what it can execute),
  not by `contract/`.
- **Additive-only, unknown-tolerant.** Add fields; never remove or repurpose one
  without deprecation. Unknown fields are ignored; an unknown command kind is a
  typed `unsupported_kind` rejection, never a crash.
- **Reuse `anyharness-contract`.** Command payloads that mirror AnyHarness ops
  reuse the AnyHarness contract types; this module owns only the envelopes,
  revisions, and reports — not AnyHarness operation shapes.

## Dependency Direction

`contract/` is pure generated types with no worker dependencies — it sits at the
bottom of the graph alongside the root support files and is consumed by every
module on the wire path (`cloud_client`, `control/commands`, `control/reconcile`,
`tail`, `lifecycle`).

## Hard Rules

- One authoritative definition (Cloud), all worker types generated — never a
  hand-maintained parallel copy.
- Never hand-edit generated code; regenerate and let CI's clean-diff check gate
  it.
- Clients and workflows import wire types from `contract/`; they do not define
  wire DTOs inline.
- Evolution is additive-only, unknown-tolerant, and new command kinds are gated
  by `supported_command_kinds`.
- No slot or fence type ever enters the contract; identity is the `worker_token`
  / `target_id`.
