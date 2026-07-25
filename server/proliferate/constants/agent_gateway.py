"""Agent LLM gateway (LiteLLM) schema constants."""

AGENT_API_KEY_STATUS_ACTIVE = "active"
AGENT_API_KEY_STATUS_REVOKED = "revoked"

AGENT_AUTH_SURFACE_LOCAL = "local"
AGENT_AUTH_SURFACE_CLOUD = "cloud"
AGENT_AUTH_SURFACES = (AGENT_AUTH_SURFACE_LOCAL, AGENT_AUTH_SURFACE_CLOUD)

# Auth selections are keyed by harness. The set mirrors the supported cloud
# agent kinds; validating against it keeps unbounded/junk path params out of the
# VARCHAR(64) column (an over-length value would otherwise surface as a 500).
# cursor is intentionally absent: it has no gateway recipe and takes no sources
# (native only), so no selection row may target it.
AGENT_AUTH_HARNESS_KINDS = ("claude", "codex", "opencode", "grok")

# A selection row is either the gateway (virtual key) or a single direct
# api_key (a raw provider key bound to an env var). There is no native
# source_kind: "use the CLI's own login" is the empty state (zero enabled rows).
AGENT_AUTH_SOURCE_GATEWAY = "gateway"
AGENT_AUTH_SOURCE_API_KEY = "api_key"
AGENT_AUTH_SOURCE_KINDS = (AGENT_AUTH_SOURCE_GATEWAY, AGENT_AUTH_SOURCE_API_KEY)

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

AGENT_CATALOG_SNAPSHOT_SOURCE_RUNTIME_MIRROR = "runtime-mirror"
AGENT_CATALOG_SNAPSHOT_SOURCES = (
    "probe",
    "seed",
    "override",
    AGENT_CATALOG_SNAPSHOT_SOURCE_RUNTIME_MIRROR,
)
AGENT_CATALOG_SNAPSHOT_STATUS_ACTIVE = "active"
AGENT_CATALOG_SNAPSHOT_STATUS_INACTIVE = "inactive"

# harness_kind is a free-form slug (selections accept arbitrary kinds),
# but it is bounded to keep snapshot cardinality sane and to stay within the
# String(64) column (an over-long value would otherwise 500 on insert).
AGENT_HARNESS_KIND_MAX_LENGTH = 64

AGENT_USAGE_IMPORT_CURSOR_ID = "default"

# Fernet key derivation is versioned by this identifier (see utils/crypto.py);
# matches the cloud-secret convention used by other encrypted columns.
AGENT_GATEWAY_CIPHERTEXT_KEY_ID = "cloud-secret-v1"
