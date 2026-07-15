# Worker HTTP Clients

Status: authoritative for
`anyharness/crates/proliferate-worker/src/cloud_client/**` and the narrow raw
HTTP calls in `catalog_sync.rs` and `anyharness_update.rs`.

## Cloud Client

```text
cloud_client/
├── mod.rs       CloudClient, wire DTOs, endpoint methods, response parsing
├── auth.rs      bearer-header formatting
└── heartbeat.rs heartbeat request construction
```

`CloudClient` owns the current raw Cloud HTTP surface:

- `POST /v1/cloud/worker/enroll`
- `POST /v1/cloud/worker/heartbeat`
- `GET /v1/cloud/worker/download/{target}/{asset}`
- `GET /v1/cloud/runtime/download/{target}/{asset}`
- `GET /v1/catalogs/agents`
- a direct unauthenticated fetch from an already resolved CDN URL for the
  sibling checksum

It has two `reqwest` clients. Authenticated requests never follow redirects,
preventing a bearer token from crossing origins. Public artifact downloads
use a redirect-following client and a longer request timeout.

The client owns endpoint paths, headers, serialization, status checking, and
wire compatibility. It does not decide when enrollment, catalog sync, or an
update should happen, and it does not write the local store.

## AnyHarness Access

There is no general `anyharness_client` module in the current Worker.

- `catalog_sync.rs` directly owns its focused catalog version GET and catalog
  PUT, including optional runtime bearer auth.
- `anyharness_update.rs` directly owns the post-relaunch `/health` probe.

These calls do not make the Worker the general execution client for
AnyHarness. Cloud performs current workspace and session operations directly.

## Artifact Identity

The Cloud download endpoint redirects to a public artifact. After the Worker
follows that redirect, it derives the checksum URL from the resolved binary
URL so the binary and checksum come from the same published directory. It does
not resolve the two artifacts through separate Cloud redirects.

## Hard Rules

- Never use the redirect-following client for authenticated Cloud requests.
- Never attach Worker or runtime bearer credentials to public CDN downloads.
- Keep transport parsing here and convergence decisions in their owning
  modules.
- Do not invent command, event, inventory, or projection endpoints.
- Add a broader AnyHarness client only when multiple current flows require a
  shared access boundary.
