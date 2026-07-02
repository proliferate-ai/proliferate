"""Agent LLM gateway (LiteLLM) schema constants."""

from dataclasses import dataclass

AGENT_API_KEY_PROVIDERS = ("anthropic", "openai", "xai", "google", "other")
AGENT_API_KEY_STATUS_ACTIVE = "active"
AGENT_API_KEY_STATUS_REVOKED = "revoked"

AGENT_AUTH_SURFACE_LOCAL = "local"
AGENT_AUTH_SURFACE_CLOUD = "cloud"
AGENT_AUTH_SURFACES = (AGENT_AUTH_SURFACE_LOCAL, AGENT_AUTH_SURFACE_CLOUD)

# Route selections are keyed by harness. The set mirrors the supported cloud
# agent kinds; validating against it keeps unbounded/junk path params out of the
# String(64) column (an over-length value would otherwise surface as a 500).
AGENT_AUTH_HARNESS_KINDS = ("claude", "codex", "opencode", "gemini", "grok")

AGENT_AUTH_ROUTE_NATIVE = "native"
AGENT_AUTH_ROUTE_API_KEY = "api_key"
AGENT_AUTH_ROUTE_GATEWAY = "gateway"
AGENT_AUTH_ROUTES = (
    AGENT_AUTH_ROUTE_NATIVE,
    AGENT_AUTH_ROUTE_API_KEY,
    AGENT_AUTH_ROUTE_GATEWAY,
)

# Slot semantics (spec §3.3): single-source harnesses keep radio semantics on
# the one 'primary' slot; OpenCode composes multiple sources, one row per slot.
AGENT_AUTH_SLOT_PRIMARY = "primary"
AGENT_AUTH_SLOT_GATEWAY = "gateway"
AGENT_AUTH_OPENCODE_HARNESS = "opencode"
# gateway slot must carry the gateway route; provider slots must carry an
# api_key route whose key belongs to that provider.
AGENT_AUTH_OPENCODE_SLOTS = (
    AGENT_AUTH_SLOT_GATEWAY,
    "openai",
    "anthropic",
    "xai",
    "google",
)


# Provider registry for direct api_key routes. The capabilities endpoint
# exposes this so UIs never hardcode provider metadata. `harnesses` = which
# harnesses a direct key of this provider can serve; `recommended_for` = the
# harnesses for which this provider is the recommended direct key.
@dataclass(frozen=True)
class AgentProviderRegistryEntry:
    id: str
    label: str
    env_key: str
    key_url: str
    harnesses: tuple[str, ...]
    recommended_for: tuple[str, ...]


AGENT_PROVIDER_REGISTRY: tuple[AgentProviderRegistryEntry, ...] = (
    AgentProviderRegistryEntry(
        id="anthropic",
        label="Anthropic",
        env_key="ANTHROPIC_API_KEY",
        key_url="https://console.anthropic.com/settings/keys",
        harnesses=("claude", "opencode"),
        recommended_for=("claude", "opencode"),
    ),
    AgentProviderRegistryEntry(
        id="openai",
        label="OpenAI",
        env_key="OPENAI_API_KEY",
        key_url="https://platform.openai.com/api-keys",
        harnesses=("codex", "opencode"),
        recommended_for=("codex",),
    ),
    AgentProviderRegistryEntry(
        id="xai",
        label="xAI",
        env_key="XAI_API_KEY",
        key_url="https://console.x.ai",
        harnesses=("grok", "opencode"),
        recommended_for=("grok",),
    ),
    AgentProviderRegistryEntry(
        id="google",
        label="Google",
        env_key="GEMINI_API_KEY",
        key_url="https://aistudio.google.com/apikey",
        harnesses=("gemini", "opencode"),
        recommended_for=("gemini",),
    ),
)

AGENT_GATEWAY_SUBJECT_KIND_USER = "user"
AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION = "organization"

AGENT_GATEWAY_SYNC_STATUS_PENDING = "pending"
AGENT_GATEWAY_SYNC_STATUS_SYNCED = "synced"
AGENT_GATEWAY_SYNC_STATUS_FAILED = "failed"

AGENT_CATALOG_SNAPSHOT_SOURCES = ("probe", "seed", "override")
AGENT_CATALOG_SNAPSHOT_STATUS_ACTIVE = "active"
AGENT_CATALOG_SNAPSHOT_STATUS_INACTIVE = "inactive"

# harness_kind is a free-form slug (route selections accept arbitrary kinds),
# but it is bounded to keep snapshot cardinality sane and to stay within the
# String(64) column (an over-long value would otherwise 500 on insert).
AGENT_HARNESS_KIND_MAX_LENGTH = 64

AGENT_USAGE_IMPORT_CURSOR_ID = "default"

# Fernet key derivation is versioned by this identifier (see utils/crypto.py);
# matches the cloud-secret convention used by other encrypted columns.
AGENT_GATEWAY_CIPHERTEXT_KEY_ID = "cloud-secret-v1"
