# Config And Constants

Server values have three homes: deployment-derived settings, shared product or
protocol constants, and private file-local implementation details. Put each
value in the narrowest home that makes its ownership obvious.

## Ownership

The server has three homes for values:

| Value kind | Home | Question |
|---|---|---|
| Env-derived runtime setting | `config.py` | Can this vary by deployment, environment, secret, or operator choice? |
| Shared hardcoded policy value | `constants/<area>.py` | Is this a product/protocol rule reused or meaningful outside one file? |
| File-local mechanical value | the owning file | Is this only an implementation detail of one function/module? |

Do not leave product policy values scattered through `api.py`, `service.py`,
`db/store/**`, worker files, or integrations.

## `config.py`

`config.py` owns runtime settings derived from environment or deployment
configuration.

Put it here when the value is:

- a secret or credential
- a hostname, URL, origin, issuer, bucket, role ARN, or external endpoint
- a feature flag
- a timeout, limit, or mode that operators may tune per deployment
- local-dev/self-hosted/production-specific

Examples:

```python
DATABASE_URL = os.environ["DATABASE_URL"]
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]
CLOUD_RUNTIME_BASE_URL = os.getenv("CLOUD_RUNTIME_BASE_URL", "http://localhost:...")
ENABLE_BILLING_RECONCILER = env_bool("ENABLE_BILLING_RECONCILER", default=False)
```

Rules:

- Do not import product services or stores from `config.py`.
- Do not put hardcoded product constants here just because many files need
  them.
- `localhost` defaults are allowed here. They are not allowed scattered in
  services, stores, or integrations.
- Integration files read credentials and vendor endpoints from `config.py`.

## `constants/<area>.py`

`constants/**` owns hardcoded shared values that are part of product behavior,
protocol behavior, or validation policy.

Put it here when the value is:

- reused by more than one file
- a product limit, validation bound, timeout, retry count, page size, or
  default policy
- a protocol label, header name, sentinel value, or status string
- meaningful enough that changing it is a product decision
- part of an API-visible contract, even if only one parser or service uses it
  today

Examples:

```python
# constants/billing.py
DEFAULT_TRIAL_DAYS = 14
USAGE_RECONCILE_BATCH_SIZE = 500

# constants/cloud.py
WORKSPACE_NAME_MAX_LENGTH = 120
CLOUD_RUNTIME_CONNECT_TIMEOUT_SECONDS = 30

# constants/http.py
REQUEST_ID_HEADER = "x-request-id"
```

Rules:

- Constants use `UPPER_SNAKE_CASE`.
- Organize by area: `billing.py`, `cloud.py`, `auth.py`, `automations.py`,
  `http.py`.
- Do not create `constants/misc.py`, `constants/common.py`, or
  `constants/helpers.py`.
- If a value becomes deployment-specific, move it from `constants/**` to
  `config.py`.

## File-Local Constants

File-local constants are allowed only when they are mechanical implementation
details with no broader product meaning. Do not keep a value local just
because it has one caller; if changing it changes product behavior, API
behavior, billing behavior, security behavior, or runtime protocol behavior,
put it in `constants/<area>.py` or `config.py`.

Allowed examples:

```python
_OWNER_ALIAS = "owner"
_CURSOR_SEPARATOR = ":"
_EMAIL_RE = re.compile(...)
_DATEUTIL_ANCHOR_YEAR = 2020
```

These values may stay in the file that owns the implementation.

Banned examples:

```python
MAX_WORKSPACES_PER_ORG = 10
DEFAULT_AUTOMATION_TIMEOUT_SECONDS = 600
RETRY_COUNT = 5
SUPPORTED_RUNTIME_VERSION = "..."
SUPPORTED_PROTOCOL_OPTIONS = {"mode", "interval", "timeout"}
```

Those carry product or protocol policy and belong in `constants/<area>.py` or
`config.py`.

## Placement Test

Ask these in order:

1. **Can an operator change it by env/deployment?** Put it in `config.py`.
2. **Does changing it alter product/protocol behavior?** Put it in
   `constants/<area>.py`.
3. **Is it only a private mechanical detail in one file?** Keep it
   file-local.

If unsure, prefer `constants/<area>.py` over scattering the value inline.
