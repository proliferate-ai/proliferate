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

AGENT_CATALOG_SNAPSHOT_SOURCES = ("probe", "seed", "override")
AGENT_CATALOG_SNAPSHOT_STATUS_ACTIVE = "active"

AGENT_USAGE_IMPORT_CURSOR_ID = "default"

# Fernet key derivation is versioned by this identifier (see utils/crypto.py);
# matches the cloud-secret convention used by other encrypted columns.
AGENT_GATEWAY_CIPHERTEXT_KEY_ID = "cloud-secret-v1"
