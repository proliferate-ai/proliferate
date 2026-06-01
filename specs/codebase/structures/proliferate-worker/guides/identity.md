# Worker Identity

Status: authoritative for `anyharness/crates/proliferate-worker/src/identity/**`.

`identity/` owns the worker's Cloud identity lifecycle. It turns a one-time
enrollment token into durable Worker credentials, persists those credentials
locally through store APIs, and exposes the enrolled identity to the rest of the
worker process.

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
| `mod.rs` | Identity facade and `ensure_enrolled` workflow. | Command, event, heartbeat, or target materialization logic. |
| `enrollment.rs` | One-time bootstrap exchange and enroll request construction. | Durable row CRUD. |
| `credentials.rs` | Already-enrolled identity shape, load/save coordination, and auth helpers. | Enrollment HTTP request mechanics. |
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
  build enrollment request
  call Cloud enroll endpoint
  convert response into WorkerIdentity
  save identity
  clear enrollment_token from config
  return identity
```

Other modules should not hand-roll enrollment checks.

## Credential Shape

Target type:

```rust
pub struct WorkerIdentity {
    pub target_id: String,
    pub sandbox_profile_id: Option<String>,
    pub cloud_sandbox_id: Option<String>,
    pub slot_generation: Option<i64>,
    pub worker_id: String,
    pub worker_token: String,
}
```

Interpretation:

- `target_id`: Cloud target this worker belongs to.
- `worker_id`: Cloud worker row created during enrollment.
- `worker_token`: durable Worker -> Cloud bearer credential.
- `sandbox_profile_id`: managed sandbox profile, when applicable.
- `cloud_sandbox_id`: managed sandbox slot, when applicable.
- `slot_generation`: generation fence used to reject stale workers.

## Auth Lanes

Keep these distinct:

- `enrollment_token`: one-time bootstrap credential.
- `worker_token`: durable Worker -> Cloud bearer credential.
- `anyharness_bearer_token`: local Worker -> AnyHarness credential.

Never treat AnyHarness auth as Cloud auth. Never treat fingerprint as auth.

## Fingerprint

Current model:

```text
machine_fingerprint = sha256(os + ":" + arch + ":" + hostname)
hostname            = HOSTNAME or COMPUTERNAME, if present
```

The fingerprint is a stable display/debug hint for Cloud enrollment records. It
is not an auth credential, not a secure hardware identity, and not a
replacement for `worker_token`.

## Hard Rules

- All enrollment flows through `identity::ensure_enrolled`.
- Bootstrap token use is limited to enrollment.
- Durable Worker auth is represented by `WorkerIdentity`.
- Credential storage remains local and private.
- Identity code avoids command, event, heartbeat, and materialization logic.
