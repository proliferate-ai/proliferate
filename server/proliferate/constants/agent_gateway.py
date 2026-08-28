"""Agent LLM gateway (LiteLLM) schema constants."""

AGENT_API_KEY_STATUS_ACTIVE = "active"
AGENT_API_KEY_STATUS_REVOKED = "revoked"

# A vault entry's `kind` says how to interpret its ciphertext (agent-auth.md's
# "The vault" table). `api_key` (the default) is one opaque secret string,
# applied as the single env var named by the referencing selection; each typed
# kind decrypts to a JSON document applied as the harness's own provider env
# set. Which harness may pick which typed kind is a registry declaration
# (registry.json's `providerConfig`), not this tuple — this is the closed
# vocabulary of storable shapes only.
AGENT_API_KEY_KIND_API_KEY = "api_key"
AGENT_API_KEY_KIND_AWS_BEDROCK = "aws_bedrock"
AGENT_API_KEY_KIND_AZURE_OPENAI = "azure_openai"
# A seat: a portable Claude Max subscription credential (agent_auth spec §2,
# "The vault"). Decrypts to one opaque secret string — a long-lived
# `claude setup-token` OAuth token captured by the runtime's mint flow and
# uploaded by the courier. Referenced by `seat` selection rows, never by an
# env_var_name (the seat recipe owns its env mapping).
AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION = "anthropic_subscription"
AGENT_API_KEY_KINDS = (
    AGENT_API_KEY_KIND_API_KEY,
    AGENT_API_KEY_KIND_AWS_BEDROCK,
    AGENT_API_KEY_KIND_AZURE_OPENAI,
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
)
# Typed kinds only — excludes the bare-secret default, which a selection wires
# through `env_var_name` rather than by referencing the kind directly. A seat
# (anthropic_subscription) is NOT a typed provider-config kind: its payload is
# one opaque secret string, and only `seat` selection rows may reference it.
AGENT_API_KEY_TYPED_KINDS = (
    AGENT_API_KEY_KIND_AWS_BEDROCK,
    AGENT_API_KEY_KIND_AZURE_OPENAI,
)

AGENT_AUTH_SURFACE_LOCAL = "local"
AGENT_AUTH_SURFACE_CLOUD = "cloud"
AGENT_AUTH_SURFACES = (AGENT_AUTH_SURFACE_LOCAL, AGENT_AUTH_SURFACE_CLOUD)

# Auth selections are keyed by harness. The set mirrors the supported cloud
# agent kinds; validating against it keeps unbounded/junk path params out of the
# VARCHAR(64) column (an over-length value would otherwise surface as a 500).
# cursor takes selection rows too — it has no gateway recipe (excluded from
# AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS below), but its single api_key slot
# (CURSOR_API_KEY) is a normal selection like any other single-source harness.
AGENT_AUTH_HARNESS_KINDS = ("claude", "codex", "opencode", "grok", "cursor")

# Harnesses whose launch supports the gateway (virtual-key) recipe. Lives here
# (not in server/agent_auth/selection_rules.py) so the db/store layer
# can consult it too without violating the store→server import boundary
# (check_server_boundaries.py) — the store uses it to skip the disabled
# gateway marker row for a harness that can never carry one; the
# validator uses it to reject a gateway source outright. cursor is absent: it
# has no gateway recipe (agent-auth.md's per-harness recipe table — "typed
# refusal, no gateway route exists for cursor").
AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS = ("claude", "codex", "opencode", "grok")

# A selection row is the gateway (virtual key), a single direct api_key (a raw
# provider key bound to an env var), or a seat row ("run on this Max
# subscription"). There is no native source_kind: "use the CLI's own login" is
# the empty state (zero enabled rows). A seat row with api_key_id NULL means
# "use my seat pool" (the renderer expands it to every active seat, vault
# order); a non-null api_key_id pins one specific anthropic_subscription entry.
AGENT_AUTH_SOURCE_GATEWAY = "gateway"
AGENT_AUTH_SOURCE_API_KEY = "api_key"
AGENT_AUTH_SOURCE_SEAT = "seat"
AGENT_AUTH_SOURCE_KINDS = (
    AGENT_AUTH_SOURCE_GATEWAY,
    AGENT_AUTH_SOURCE_API_KEY,
    AGENT_AUTH_SOURCE_SEAT,
)

# Harnesses with a seat (Max subscription) launch recipe. Slice 1 of the seat
# plan (agent_auth spec §4 cell 2's recipe table): claude only — codex's seat
# route is the phase-2 refreshing-file shape. Lives here for the same
# store→server boundary reason as the gateway-capable tuple above.
AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS = ("claude",)

# The state.json WIRE kind for a rendered typed-vault source (D3 python brief
# Sec4.1/Sec2). This is NOT a DB `source_kind` -- a typed-vault selection is
# still persisted as source_kind='api_key' (D1 deliberately did not add a
# third DB value; selections.py's `_validate_source` still only recognizes
# AGENT_AUTH_SOURCE_KINDS above). Which wire `kind` a rendered api_key
# selection gets is decided at RENDER time by the referenced AgentApiKey
# row's vault `kind` (bare 'api_key' vs. a typed kind) -- never persisted
# directly.
AGENT_AUTH_SOURCE_PROVIDER_CONFIG = "provider_config"

# "native" is NOT a selection source_kind — it is the empty-selection state (zero
# enabled rows == the harness's own CLI login). It exists ONLY as an org-policy
# allow-list value: listing "native" in allowed_routes permits native CLI login;
# omitting it (when allowed_routes is otherwise set) disallows it. Never persisted
# as a selection row, so it is absent from AGENT_AUTH_SOURCE_KINDS above.
AGENT_AUTH_ROUTE_NATIVE = "native"
AGENT_AUTH_POLICY_ROUTES = (*AGENT_AUTH_SOURCE_KINDS, AGENT_AUTH_ROUTE_NATIVE)

# The only state.json wire schema version AnyHarness understands (contract §3);
# mirrors ``route_auth::state::STATE_VERSION`` on the Rust render plane.
AGENT_AUTH_STATE_VERSION = 2

AGENT_GATEWAY_SUBJECT_KIND_USER = "user"
AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION = "organization"

AGENT_GATEWAY_SYNC_STATUS_PENDING = "pending"
AGENT_GATEWAY_SYNC_STATUS_SYNCED = "synced"
AGENT_GATEWAY_SYNC_STATUS_FAILED = "failed"

AGENT_GATEWAY_BUDGET_STATUS_OK = "ok"
AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED = "exhausted"
# Distinct from ``exhausted`` (credit ran out) so credit-driven reactivation
# (top-ups) never clears an org budget-limit block, and vice versa.
AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED = "limit_reached"
AGENT_GATEWAY_BUDGET_STATUSES = (
    AGENT_GATEWAY_BUDGET_STATUS_OK,
    AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED,
    AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
)

LLM_CREDIT_SOURCE_FREE_SIGNUP = "free_signup"
LLM_CREDIT_SOURCE_TOPUP = "topup"
LLM_CREDIT_SOURCE_ADMIN = "admin"
# Per-seat managed-LLM allocation ($5/seat) granted into the shared org LLM pool
# each paid period. Expires at period end so the allocation resets on renewal
# (unused balance does not roll over); distinct from never-expiring top-ups.
LLM_CREDIT_SOURCE_SEAT_POOL = "seat_pool"
LLM_CREDIT_SOURCES = (
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
    LLM_CREDIT_SOURCE_TOPUP,
    LLM_CREDIT_SOURCE_ADMIN,
    LLM_CREDIT_SOURCE_SEAT_POOL,
)

# Bifrost-era free credits used period_key "registration" under the same
# allocation kind; reusing it keeps the one-per-github-identity dedup intact
# across the LiteLLM migration (spec section 3.2).
AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY = "registration"

AGENT_USAGE_EVENT_STATUS_IMPORTED = "imported"
AGENT_USAGE_EVENT_STATUS_NEEDS_REVIEW = "needs_review"

# Per-enrollment-key gateway-enablement verification verdict (agent-auth.md
# FR-3). `ok` means the key saw a non-empty model list (the access-group grant
# for its harness_kind is live); `misconfigured` means it saw an empty list.
# An error inside the loop records NO verdict (the prior verdict stands), so
# there is no `error` status here — a transient LiteLLM blip must not overwrite a
# last-known-good.
AGENT_GATEWAY_VERIFICATION_STATUS_OK = "ok"
AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED = "misconfigured"
AGENT_GATEWAY_VERIFICATION_STATUSES = (
    AGENT_GATEWAY_VERIFICATION_STATUS_OK,
    AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED,
)

# The snapshot table has no ``source`` column (model-catalog.md §Storage): every
# row is a machine observation the Worker uploaded, so there is nothing to
# discriminate. Only the soft-versioning status survives.
AGENT_MODEL_SNAPSHOT_STATUS_ACTIVE = "active"
AGENT_MODEL_SNAPSHOT_STATUS_INACTIVE = "inactive"

# harness_kind is a free-form slug (selections accept arbitrary kinds),
# but it is bounded to keep snapshot cardinality sane and to stay within the
# String(64) column (an over-long value would otherwise 500 on insert).
AGENT_HARNESS_KIND_MAX_LENGTH = 64

# The machine-document schema version the ingest route accepts
# (model-catalog.md §Wire schema): schemaVersion 2 is the composed observation
# — one entry per harness, no per-context map, no fingerprint.
AGENT_MODEL_SNAPSHOT_SCHEMA_VERSION = 2

AGENT_USAGE_IMPORT_CURSOR_ID = "default"

# Fernet key derivation is versioned by this identifier (see lib/infra/encryption/fernet.py);
# matches the cloud-secret convention used by other encrypted columns.
AGENT_GATEWAY_CIPHERTEXT_KEY_ID = "cloud-secret-v1"
