# LLM Proxy

A secure LLM API proxy for sandboxed environments using LiteLLM with virtual key authentication. Sandboxes get short-lived API keys instead of real credentials.

## Architecture

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│    Sandbox      │  API    │      LiteLLM         │  Real   │    Anthropic    │
│   (OpenCode)    │  Key    │      (4000)          │  Key    │      API        │
│                 │────────▶│                      │────────▶│                 │
│  baseURL:       │         │  1. Validate key     │         │                 │
│  proxy:4000/v1  │◀────────│  2. Track spend      │◀────────│                 │
│                 │   SSE   │  3. Forward request  │   SSE   │                 │
└─────────────────┘ Stream  │  4. Log to DB        │ Stream  └─────────────────┘
                            └──────────────────────┘
```

Uses LiteLLM's **virtual keys** (free tier) for authentication and spend tracking.

## Quick Start

1. Build and run with Docker:
   ```bash
   docker build -t llm-proxy .
   docker run -p 4000:4000 \
     -e ANTHROPIC_API_KEY=sk-ant-... \
     -e LITELLM_MASTER_KEY=sk-master-... \
     -e DATABASE_URL=postgresql://... \
     llm-proxy
   ```

2. Or use Docker Compose from the repo root:
   ```bash
   docker compose up -d llm-proxy
   ```

3. Verify it's running:
   ```bash
   curl http://localhost:4000/health/liveliness
   ```

## How It Works

### 1. Session Creation

When a session is created, the API generates a virtual key:

```typescript
import { generateSessionAPIKey } from "@proliferate/shared";

// Generate a session key for this session (duration defaults to LLM_PROXY_KEY_DURATION)
const apiKey = await generateSessionAPIKey(sessionId, orgId);
sandbox.env.LLM_PROXY_API_KEY = apiKey;
```

This calls LiteLLM's `/key/generate` endpoint with:
- `team_id`: Organization ID (for per-org billing)
- `user_id`: Session ID (for per-session tracking)
- `duration`: Defaults to `LLM_PROXY_KEY_DURATION` (auto-expires)

### 2. Sandbox Uses Key

OpenCode in the sandbox uses the key to make requests:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "https://llm-proxy.fly.dev/v1"
      }
    }
  }
}
```

OpenCode receives the proxy key via environment variables:

```bash
ANTHROPIC_API_KEY=sk-xxx...   # virtual key from LiteLLM
ANTHROPIC_BASE_URL=https://llm-proxy.fly.dev/v1
```

### 3. Spend Tracking

LiteLLM automatically logs every request to `LiteLLM_SpendLogs`:
- `team_id`: Organization (for billing)
- `user`: Session (for attribution)
- `spend`: USD cost
- `model`, `tokens`, etc.

### 4. Billing Sync

The billing worker syncs spend logs to `billing_events` every 30 seconds:

```
LiteLLM_SpendLogs → billing_events → Autumn (credit deduction)
```

## Configuration

All configuration is in `litellm/config.yaml`:

```yaml
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL

model_list:
  - model_name: anthropic/claude-sonnet-4-5
    litellm_params:
      model: anthropic/claude-sonnet-4-5-20250929
      api_key: os.environ/ANTHROPIC_API_KEY
  # ... more models
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LITELLM_MASTER_KEY` | Yes | Admin key for key generation |
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |

For the API/Gateway that generates keys:

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_PROXY_URL` | Yes | URL of this proxy |
| `LLM_PROXY_MASTER_KEY` | Yes | Same as LITELLM_MASTER_KEY |
| `LLM_PROXY_KEY_DURATION` | No | Default key duration (e.g., "24h", "168h") |
| `LLM_PROXY_REQUIRED` | No | Fail session creation if LLM_PROXY_URL is missing |

## Available Models

| Model ID (OpenCode sends) | Anthropic API Model |
|---------------------------|---------------------|
| `anthropic/claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` |
| `anthropic/claude-opus-4-5` | `claude-opus-4-5-20251101` |
| `anthropic/claude-sonnet-4` | `claude-sonnet-4-20250514` |
| `anthropic/claude-opus-4` | `claude-opus-4-20250514` |
| `anthropic/claude-3-5-sonnet` | `claude-3-5-sonnet-20241022` |
| `anthropic/claude-3-5-haiku` | `claude-3-5-haiku-20241022` |

## Security

1. **Sandboxes never see real API keys** - Only the proxy has credentials
2. **Short-lived keys** - Expiry based on `LLM_PROXY_KEY_DURATION` limits blast radius
3. **Scoped to session + org** - Enables per-org billing and tracking
4. **Key validation** - LiteLLM validates keys against the database

## Adding More Providers

Edit `litellm/config.yaml`:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
```

## License

MIT
