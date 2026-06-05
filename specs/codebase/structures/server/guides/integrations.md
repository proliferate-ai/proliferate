# Integrations

Integrations are the server's raw external access boundary. Product domains
call integration public APIs; integrations own vendor clients, vendor wire
types, authentication, retries, and protocol translation.

## Ownership

`integrations/` owns all third-party SDK and API access. Every external
network call originates here. Product code calls integrations through their
public API only; integration internals stay vendor-local.

Integration code owns:

- Vendor client construction
- Authentication and credential handling for the vendor
- Payload normalization (request/response shape adjustments)
- Vendor-specific error handling and retry policies
- Webhook signature verification (when applicable)
- Vendor-specific data types

Integration code does not own:

- Product business logic.
- Database access (no `db/store/**` imports).
- Service-layer orchestration.

## Shape

Three legal shapes, picked by what the integration is.

### Shape 1: Single file (default)

```text
integrations/<vendor>.py
```

For simple integrations: one vendor, one cohesive purpose, < 300 lines.

Inside the file:

- Error class for the vendor's failures.
- Client construction or authentication setup.
- Payload dataclasses (when the integration parses structured responses).
- Public functions exported to product code.

Examples: `anthropic.py`, `customerio.py`, `github.py`, `resend.py`,
`sentry.py`, `anonymous_telemetry.py`.

### Shape 2: Folder, single provider

```text
integrations/<vendor>/
  __init__.py
  client.py
  models.py
  errors.py
  <concern>.py
```

For a vendor with multiple distinct concerns: auth + webhooks + OAuth flows,
or any set of features that don't fit cleanly in one file.

- `client.py` — base client, authentication, low-level calls.
- `models.py` — typed payload dataclasses (or Pydantic if parsing untrusted
  input from the vendor).
- `errors.py` — error types raised by the integration.
- `<concern>.py` — distinct features: `webhooks.py`, `oauth.py`,
  `notifications.py`.
- `__init__.py` — exports the public API. Internals stay vendor-local.
  This is the explicit Python-package exception to the repo-wide no-barrel
  rule; use it only for integration package public APIs.

Example: `slack/` with `webhooks.py` + `errors.py`.

Concern files should be coarse and meaningful. Do not mechanically mirror
every endpoint, REST resource, or SDK method into its own file. Start with the
operational seams that product code naturally cares about: auth, webhooks,
OAuth, sessions, provisioning, file operations, notifications, etc. Split
further only when a concern file grows large, has a distinct consumer set, or
contains multiple independent policies.

### Shape 3: Folder, polymorphic

```text
integrations/<protocol>/
  __init__.py
  base.py
  <provider>.py
  factory.py
  models.py
  errors.py
```

For multiple vendors implementing the same protocol where product code
selects an implementation at runtime.

- `base.py` — abstract interface or protocol that all providers implement.
- `<provider>.py` — each implementation (e.g., `daytona.py`, `e2b.py`).
- `factory.py` — provider selection logic (config-driven, identity-driven,
  etc.).
- `models.py` — shared types across providers.
- `errors.py` — shared error types raised by any provider.
- `__init__.py` — exports the factory and shared types.

Example: `sandbox/` with `base.py`, `daytona.py`, `e2b.py`,
`factory.py`.

## Picking a Shape

| You have | Pick |
|---|---|
| One vendor, < 300 lines, one concern | Shape 1 (single file) |
| One vendor, multiple distinct concerns | Shape 2 (single-provider folder) |
| Multiple vendors implementing the same protocol | Shape 3 (polymorphic folder) |

Shape changes when ownership changes:

- Single file → single-provider folder when concerns split (extract
  webhooks, OAuth, etc.).
- Single-provider folder → polymorphic folder when a second vendor is added
  for the same protocol.
- Coarse concern file → narrower concern files only after the narrower split
  earns its place. Avoid endpoint-per-file structures by default.

## What Goes Inside an Integration

### Error class

Every integration defines its own error type. Local to the vendor.

```python
class StripeIntegrationError(Exception):
    """Raised on failures talking to Stripe."""
```

For folder integrations, the error class lives in `errors.py`. For
single-file integrations, it's defined at the top of the file.

Integration error types do **not** inherit from the shared
`server/proliferate/errors.py` base (`ProliferateError`). The product
service catches integration errors and translates to domain errors as
needed.

### Public API

The functions exported to product code. These are what services call.

For single-file integrations, the public API is whatever the file exports
(non-underscore-prefixed names).

For folder integrations, the public API is what `__init__.py` exports.
Everything else stays vendor-local.

This `__init__.py` export surface is intentional for integration packages:
services import the vendor API from one stable package boundary while
integration internals remain private. Do not use this pattern as a general
convenience re-export elsewhere in the server tree.

```python
# integrations/stripe/__init__.py
from .client import create_stripe_customer, retrieve_stripe_subscription
from .webhooks import verify_stripe_webhook
from .errors import StripeIntegrationError

__all__ = [
    "create_stripe_customer",
    "retrieve_stripe_subscription",
    "verify_stripe_webhook",
    "StripeIntegrationError",
]
```

### Models

Vendor-specific request/response shapes. Use dataclasses by default;
Pydantic when parsing structured untrusted input (webhook payloads).

For folder integrations, models live in `models.py`. For single-file
integrations, they're inline.

### Vendor-specific configuration

Integration files read from `config.py` for credentials and endpoints. They
do not hardcode URLs or secrets.

## Allowed in Integrations

- HTTP client libraries (`httpx`, vendor SDKs).
- Webhook signature verification.
- Credential retrieval from `config.py`.
- Vendor-specific retry, backoff, and timeout policies.
- Payload normalization (snake_case ↔ camelCase, etc.).
- Throwing the integration's own error type on failure.

## Banned in Integrations

- Product business logic. The integration translates to/from the vendor;
  it does not decide what to do with the result.
- `db/store/**` imports. Integrations don't touch the database.
- Service.py imports. Integrations are leaves.
- Hardcoded credentials, URLs, or environment values. Use `config.py`.
- Single-file folders (`integrations/<vendor>/<single-file>.py` with no
  other content). Flatten until the folder has real content.
- Catching the integration's own error type to translate to HTTPException.
  HTTP translation happens in services or the global exception handler.

## Vendor Boundary Discipline

Product code calls the integration's public API and nothing else.

```python
# Allowed
from integrations.stripe import create_stripe_customer, StripeIntegrationError

# Forbidden
from integrations.stripe.client import _internal_helper
from integrations.stripe.client import _StripeRequestBuilder
```

Integration internals (private functions, internal classes) are not part of
the contract.

## Webhooks

Webhook routes belong to the relevant product domain's `api.py`, not to
integrations:

```python
# server/billing/api.py
@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> dict:
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    event = verify_stripe_webhook(payload, signature)  # from integrations.stripe
    await service.handle_stripe_event(db, event)
    return {"received": True}
```

The integration owns signature verification and event parsing. The product
service owns "what to do when the event arrives."

## Forbidden Patterns

- Single-file folders (e.g., `integrations/billing/stripe.py` as the only
  file). Flatten or add real content.
- External protocol/client code in product domains. Product domains may
  orchestrate results, but raw HTTP/SDK protocol access belongs behind the
  owning integration boundary.
- Cross-vendor imports (`integrations/stripe/` importing from
  `integrations/anthropic/`). Integrations are independent.
- Imports from `server/<domain>/**` inside an integration. Integrations don't
  know about product domains.
- Database access from inside an integration.
- The same vendor's code split across two locations.

## Adding a New Integration

1. **Pick a shape.** Single file (default), folder (multi-concern), or
   polymorphic folder (multi-vendor protocol).
2. **Define the error type.** First, before the public API.
3. **Read credentials from `config.py`.** Never hardcode.
4. **Build the client construction or authentication helper.** This is what
   the public functions use internally.
5. **Implement public functions** that product code will call.
6. **Add unit tests** for the integration that mock the HTTP layer.
7. **For folder integrations:** export the public API from `__init__.py`.
