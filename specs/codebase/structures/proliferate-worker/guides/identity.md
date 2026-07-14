# Worker Identity

Status: authoritative for `anyharness/crates/proliferate-worker/src/identity/**`
and `integration_gateway.rs`.

The Worker has a one-time bootstrap credential and one durable Cloud identity:

```text
enrollment_token
  -> POST /v1/cloud/worker/enroll
  -> worker_id + worker_token + integration-gateway coordinates
```

The persisted identity contains only `worker_id` and `worker_token`. Sandbox,
user, runtime kind, revocation, and liveness are Cloud-owned associations; the
Worker does not persist a Target, profile, slot, generation, or fence.

## Source Ownership

| File | Owns |
| --- | --- |
| `identity/mod.rs` | Durable-identity-first `ensure_enrolled` workflow |
| `identity/enrollment.rs` | Enrollment request construction and response split |
| `identity/credentials.rs` | `WorkerIdentity` and narrow store delegation |
| `identity/fingerprint.rs` | Diagnostic machine fingerprint and hostname hint |
| `integration_gateway.rs` | Private runtime credential file written from a fresh enrollment response |
| `store/identity.rs` | Single persisted identity row |

## Enrollment Precedence

```text
if SQLite contains an identity:
  use it
  clear any enrollment token from config best-effort
  do not call enroll

otherwise:
  require enrollment_token
  send fingerprint, hostname, Worker version, and optional AnyHarness version
  persist worker_id + worker_token
  clear enrollment token from config best-effort
  write integration-gateway credentials
```

A durable identity always wins over an enrollment token still present in the
configuration. An invalid or revoked durable token does not trigger automatic
re-enrollment.

## Credentials

- `enrollment_token` is a single-use bootstrap value and is removed from the
  private TOML configuration after enrollment when possible.
- `worker_token` is the durable opaque bearer token for authenticated Worker
  heartbeats. The Worker client also attaches it to catalog fetches, but the
  current catalog route does not enforce Worker authentication.
- The integration-gateway authorization value is distinct. On fresh
  enrollment it is written atomically to `integration-gateway.json` with
  private directory/file permissions.
- `runtime_bearer_token` authenticates narrow calls to the co-located
  AnyHarness runtime. It is not Cloud auth.

The enrollment response's integration-gateway coordinates are not stored in
Worker SQLite. A restart that loads an existing identity does not recreate a
missing gateway file. Escalate that state; do not silently re-enroll or mint a
replacement locally.

## Fingerprint

The fingerprint is SHA-256 over OS, architecture, and hostname. It is a
diagnostic hint, not authentication or hardware attestation.

## Hard Rules

- Route enrollment through `identity::ensure_enrolled`.
- Never log, expose, or duplicate token values.
- Keep Worker identity limited to `worker_id` and `worker_token`.
- Keep private config and gateway writes atomic and permission-restricted.
- Do not implement routine token rotation, local identity deletion, or
  re-enrollment without an explicit product recovery design.
