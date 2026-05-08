# Errors

Status: authoritative for server error classes, integration-error
translation, and HTTP error mapping.

Read after `docs/server/README.md` when a change adds, moves, catches, or
translates errors.

## Ownership

The server has three error layers:

| Layer | Home | Owns |
|---|---|---|
| Shared product errors | `server/proliferate/errors.py` | Base class and common HTTP-shaped categories. |
| Domain errors | `server/<domain>/errors.py` | Product/domain failures with stable error codes. |
| Integration errors | `integrations/<vendor>/errors.py` or the integration file | Vendor/protocol failures. |

HTTP translation is centralized. Product services raise product/domain errors;
the FastAPI exception handler maps those errors to the JSON response shape.

## Shared Product Errors

`server/proliferate/errors.py` owns the common base and generic categories:

```python
class ProliferateError(Exception):
    code: str
    message: str
    status_code: int


class NotFoundError(ProliferateError): ...
class PermissionDenied(ProliferateError): ...
class Conflict(ProliferateError): ...
class InvalidRequest(ProliferateError): ...
```

The exact class names may grow with usage, but the shape is stable:

- `code` is the stable machine-readable error code.
- `message` is the client-facing message.
- `status_code` is the HTTP status chosen by the product error type.

Do not make shared errors know about any one product domain.

## Domain Errors

Domain errors live beside the domain they describe:

```text
server/<domain>/
  errors.py
  service.py
  api.py
```

Use a domain error when the failure is product behavior:

- missing resource
- forbidden action
- invalid domain input
- conflict with current state
- product limit reached
- domain-specific unavailable state

Domain errors inherit from the shared base or one of the shared categories.

```python
class ResourceNotReady(Conflict):
    code = "resource_not_ready"

    def __init__(self, message: str) -> None:
        super().__init__(message=message)
```

Services raise domain errors. APIs do not catch and translate them in each
route; the global handler owns translation.

## Integration Errors

Integration errors stay inside the integration boundary.

```text
integrations/<vendor>/
  errors.py
  client.py
```

Integration errors should describe vendor/protocol failures, not product
meaning. They do not inherit from `ProliferateError`.

Product services catch integration errors and translate them into domain
errors:

```python
try:
    result = await vendor_call(...)
except VendorIntegrationError as exc:
    raise DomainUnavailable("Could not complete the operation.") from exc
```

That translation is where product meaning enters.

## HTTP Translation

The FastAPI app registers one handler for `ProliferateError` subclasses.

The response shape is:

```json
{
  "detail": {
    "code": "stable_error_code",
    "message": "Client-facing message."
  }
}
```

Route files should not repeat this translation:

```python
# Bad
try:
    await service.do_work(...)
except DomainError as error:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )
```

Use the global handler instead:

```python
# Good
await service.do_work(...)
```

## Direct `HTTPException`

Direct `HTTPException` is allowed only at actual HTTP boundaries:

- framework authentication/authorization dependencies that integrate directly
  with FastAPI
- routes returning non-product assets or callback pages where the response is
  not the normal JSON error contract
- temporary transitional route translation while a domain has not yet moved to
  product errors

It is banned in:

- `db/store/**`
- `server/<domain>/domain/**`
- integrations
- pure helpers
- stores or service internals that can raise a product/domain error instead

## Catching And Wrapping

Allowed:

- Service catches an integration error and raises a domain error.
- Service catches a known lower-level product error and maps it to a
  more-specific domain error.
- Worker entry points catch unexpected exceptions to log/report and then
  either re-raise or record failure state.

Banned:

- Broad `except Exception` that swallows the error.
- Catching a domain error in an API route only to reformat it.
- Integration code catching its own error type to produce an HTTP response.
- Domain errors wrapping unrelated exceptions without adding product meaning.

## Migration Notes

When migrating a domain:

1. Add or update `server/<domain>/errors.py`.
2. Convert service-layer `*ServiceError` classes to domain errors.
3. Register or reuse the global `ProliferateError` handler.
4. Delete per-route `except DomainError: raise HTTPException(...)` blocks.
5. Keep integration errors integration-local and translate them in services.

Do not mix error migration with unrelated behavior changes. Preserve codes,
messages, and status codes unless the task explicitly changes the contract.
