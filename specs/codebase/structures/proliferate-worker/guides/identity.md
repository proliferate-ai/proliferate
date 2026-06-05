# Worker Identity

Status: authoritative for `anyharness/crates/proliferate-worker/src/identity/**`.

`identity/` owns the worker's Cloud identity lifecycle. It turns a one-time
enrollment token into a durable worker token, persists it locally through store
APIs, and exposes the enrolled identity to the rest of the process.

Identity is **collapsed and ephemeral**: one worker = one sandbox = one Target
(1:1). There is no slot, no `slot_generation`, and no fence. A sandbox death is
a brand-new Target with a fresh enrollment — never a re-enrollment into an
existing slot.

## Target Shape

```text
identity/
  mod.rs
  enrollment.rs
  credentials.rs
  fingerprint.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Identity facade and `ensure_enrolled` workflow. | Command, reconcile, event, heartbeat, or materialization logic. |
| `enrollment.rs` | One-time bootstrap exchange and enroll request construction. | Durable row CRUD; slot validation. |
| `credentials.rs` | Enrolled-identity shape, load/save coordination, auth helpers. | Enrollment HTTP request mechanics. |
| `fingerprint.rs` | Machine fingerprint and hostname hints used during enrollment. | Authentication decisions. |

Persistence for the identity row belongs in `store/identity.rs`.

## Enrollment Workflow

`identity::ensure_enrolled` is the only high-level identity workflow:

```text
if identity exists in store:
  clear enrollment_token from config if present
  return identity

otherwise:
  require enrollment_token from config
  build enrollment request (fingerprint, hostname, versions, inventory)
  call Cloud enroll endpoint
  convert response into WorkerIdentity
  save identity
  clear enrollment_token from config
  return identity
```

There is **no slot validation** on enroll: on a dead sandbox the worker comes up
as a new Target, not a re-enroll. Other modules should not hand-roll enrollment
checks.

## Credential Shape

```rust
pub struct WorkerIdentity {
    pub target_id: String,
    pub worker_id: String,
    pub worker_token: String,
}
```

Interpretation:

- `target_id`: the Cloud Target this worker is — one Target per sandbox.
- `worker_id`: the Cloud worker row created during enrollment.
- `worker_token`: the durable Worker → Cloud bearer credential.

There are deliberately no `sandbox_profile_id`, `cloud_sandbox_id`, or
`slot_generation` fields. In the collapsed model the Target *is* the sandbox, so
there is nothing to fence and no slot identity to carry.

## Auth Lanes

Keep these distinct:

- `enrollment_token`: one-time bootstrap credential.
- `worker_token`: durable Worker → Cloud bearer credential.
- `anyharness_bearer_token`: local Worker → AnyHarness credential.

Never treat AnyHarness auth as Cloud auth. Never treat the fingerprint as auth.

## Fingerprint

```text
machine_fingerprint = sha256(os + ":" + arch + ":" + hostname)
hostname            = HOSTNAME or COMPUTERNAME, if present
```

The fingerprint is a stable display/debug hint for Cloud enrollment records. It
is not an auth credential, not a secure hardware identity, and not a replacement
for `worker_token`.

## Hard Rules

- All enrollment flows through `identity::ensure_enrolled`.
- Bootstrap token use is limited to enrollment.
- Durable Worker auth is represented by `WorkerIdentity` — `target_id` +
  `worker_id` + `worker_token`, nothing slot-shaped.
- Credential storage remains local and private.
- Identity code avoids command, reconcile, event, heartbeat, and materialization
  logic.
