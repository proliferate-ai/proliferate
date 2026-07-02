"""Agent LLM gateway (LiteLLM) schema constants."""

AGENT_API_KEY_PROVIDERS = ("anthropic", "openai", "xai", "google", "other")
AGENT_API_KEY_STATUS_ACTIVE = "active"
AGENT_API_KEY_STATUS_REVOKED = "revoked"

AGENT_AUTH_SURFACE_LOCAL = "local"
AGENT_AUTH_SURFACE_CLOUD = "cloud"
AGENT_AUTH_SURFACES = (AGENT_AUTH_SURFACE_LOCAL, AGENT_AUTH_SURFACE_CLOUD)

AGENT_AUTH_ROUTE_NATIVE = "native"
AGENT_AUTH_ROUTE_API_KEY = "api_key"
AGENT_AUTH_ROUTE_GATEWAY = "gateway"
AGENT_AUTH_ROUTES = (
    AGENT_AUTH_ROUTE_NATIVE,
    AGENT_AUTH_ROUTE_API_KEY,
    AGENT_AUTH_ROUTE_GATEWAY,
)

AGENT_GATEWAY_SUBJECT_KIND_USER = "user"
AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION = "organization"

AGENT_GATEWAY_SYNC_STATUS_PENDING = "pending"
AGENT_GATEWAY_SYNC_STATUS_SYNCED = "synced"
AGENT_GATEWAY_SYNC_STATUS_FAILED = "failed"

AGENT_GATEWAY_BUDGET_STATUS_OK = "ok"
AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED = "exhausted"

LLM_CREDIT_SOURCE_FREE_SIGNUP = "free_signup"
LLM_CREDIT_SOURCE_TOPUP = "topup"
LLM_CREDIT_SOURCE_ADMIN = "admin"
LLM_CREDIT_SOURCES = (
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
    LLM_CREDIT_SOURCE_TOPUP,
    LLM_CREDIT_SOURCE_ADMIN,
)

# Bifrost-era free credits used period_key "registration" under the same
# allocation kind; reusing it keeps the one-per-github-identity dedup intact
# across the LiteLLM migration (spec section 3.2).
AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY = "registration"

AGENT_USAGE_EVENT_STATUS_IMPORTED = "imported"
AGENT_USAGE_EVENT_STATUS_NEEDS_REVIEW = "needs_review"

AGENT_CATALOG_SNAPSHOT_SOURCES = ("probe", "seed", "override")
AGENT_CATALOG_SNAPSHOT_STATUS_ACTIVE = "active"

AGENT_USAGE_IMPORT_CURSOR_ID = "default"

# Fernet key derivation is versioned by this identifier (see utils/crypto.py);
# matches the cloud-secret convention used by other encrypted columns.
AGENT_GATEWAY_CIPHERTEXT_KEY_ID = "cloud-secret-v1"
