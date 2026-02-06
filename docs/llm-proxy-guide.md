# LLM Proxy Guide

Secure LLM API proxy for sandboxed environments. Sandboxes get short-lived virtual keys instead of real API keys.

## Quick Start (Local Development)

```bash
# 1. Start all services including LLM proxy
docker compose up -d

# 2. Start ngrok tunnel (so Modal sandboxes can reach your local proxy)
ngrok http 4000

# 3. Run the web app with proxy URL (use the https URL printed by ngrok)
LLM_PROXY_URL=<ngrok_https_url> pnpm dev
```

Or use the dev script:
```bash
./scripts/dev-start.sh
```

The LLM proxy is now running at `localhost:4000` and accessible to your sandbox provider via the ngrok https URL.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION CREATION                                   │
│                                                                             │
│  ┌──────────┐  1. Create session   ┌──────────────┐                         │
│  │  Client  │ ───────────────────► │   Gateway    │                         │
│  └──────────┘                      │  (or API)    │                         │
│                                    └──────┬───────┘                         │
│                                           │                                 │
│                      2. Generate virtual  │                                 │
│                         key via LiteLLM:  │                                 │
│                         team_id: org_id   │                                 │
│                         user_id: session  │                                 │
│                         duration: LLM_PROXY_KEY_DURATION                     │
│                                           │                                 │
│                      3. Create sandbox    │                                 │
│                         with env var:     │                                 │
│                         LLM_PROXY_API_KEY │                                 │
│                                           ▼                                 │
│                                    ┌──────────────┐                         │
│                                    │   Sandbox    │                         │
│                                    │   (Modal)    │                         │
│                                    └──────────────┘                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           LLM REQUEST FLOW                                   │
│                                                                             │
│  ┌──────────────┐     POST /v1/messages      ┌──────────────┐               │
│  │   Sandbox    │     Authorization:         │  LLM Proxy   │               │
│  │  (OpenCode)  │     Bearer <key>           │  (LiteLLM)   │               │
│  │              │ ──────────────────────────►│              │               │
│  │  baseURL:    │                            │ 1. Validate  │               │
│  │  proxy/v1    │                            │    key       │               │
│  │              │                            │              │               │
│  │  apiKey:     │     SSE stream             │ 2. Extract   │  Real key     │
│  │  <key>       │ ◄──────────────────────────│    team_id   │ ────────────► │
│  │              │                            │              │   Anthropic   │
│  └──────────────┘                            │ 3. Auto-log  │               │
│                                              │    to DB     │               │
│                                              └──────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           COST TRACKING FLOW                                 │
│                                                                             │
│  LiteLLM auto-logs to LiteLLM_SpendLogs (team_id = org, user = session)     │
│                          │                                                  │
│                          ▼                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Billing Worker (every 30s)                                          │   │
│  │                                                                      │   │
│  │  LiteLLM_SpendLogs ──► billing_events ──► Outbox Worker ──► Autumn   │   │
│  │                                                                      │   │
│  │  1. Read new spend logs    2. Insert with         3. Deduct credits  │   │
│  │     with team_id (org)        idempotency key        from Autumn     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part A: Key Generation

Virtual keys are generated when creating a session. This happens in the **Gateway** (or API).

### How It Works

```typescript
import { generateSessionAPIKey, isLLMProxyEnabled } from "@proliferate/shared";

// When creating a session
if (isLLMProxyEnabled()) {
  const apiKey = await generateSessionAPIKey(sessionId, orgId, {
    duration: "24h",    // Optional override (defaults to LLM_PROXY_KEY_DURATION)
    maxBudget: 50,      // Optional: $50 max spend
  });

  envVars.LLM_PROXY_API_KEY = apiKey;
}
```

The `generateSessionAPIKey` function:
1. Ensures the org's team exists in LiteLLM (for spend tracking)
2. Calls `/key/generate` to create a virtual key
3. Returns the key string (e.g., `sk-xxx...`)

### Environment Variables for Key Generation

```bash
# Required for generating keys
LLM_PROXY_URL=https://llm-proxy.fly.dev
LLM_PROXY_MASTER_KEY=sk-master-key-here

# Optional: default key duration (falls back to >=30d or SANDBOX_TIMEOUT_SECONDS)
LLM_PROXY_KEY_DURATION=24h
```

---

## Part B: OpenCode Sandbox Configuration

When a sandbox is created, OpenCode is configured to use the LLM proxy.

### Generated OpenCode Config

**With LLM Proxy (production):**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "https://llm-proxy.fly.dev/v1"
      }
    }
  },
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  }
}
```

OpenCode receives the proxy key via environment variables:

```bash
ANTHROPIC_API_KEY=sk-xxx...   # virtual key from LiteLLM
ANTHROPIC_BASE_URL=https://llm-proxy.fly.dev/v1
```

**Without Proxy (direct API, development):**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {
    "anthropic": {}
  }
}
```

When `provider.anthropic` is empty, OpenCode uses `ANTHROPIC_API_KEY` and respects `ANTHROPIC_BASE_URL` if set.

---

## Part C: LLM Proxy Service

The LLM proxy is LiteLLM running with virtual key authentication and automatic spend tracking.

### File Structure

```
apps/llm-proxy/
├── Dockerfile          # Runs LiteLLM image directly
├── litellm/
│   └── config.yaml     # LiteLLM config with models + database
└── README.md
```

No custom code needed! LiteLLM handles:
- Key validation (against database)
- Team/user spend tracking (via key metadata)
- Automatic spend logging (via `database_url`)

### LiteLLM Configuration

**`litellm/config.yaml`:**

```yaml
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL  # Same PostgreSQL as the app

model_list:
  - model_name: anthropic/claude-sonnet-4-5
    litellm_params:
      model: anthropic/claude-sonnet-4-5-20250929
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: anthropic/claude-opus-4-5
    litellm_params:
      model: anthropic/claude-opus-4-5-20251101
      api_key: os.environ/ANTHROPIC_API_KEY

  # ... other models

litellm_settings:
  drop_params: true
  set_verbose: false

router_settings:
  num_retries: 2
  retry_after: 1
  timeout: 300
```

### How Cost Tracking Works

1. **Key is created** with `team_id` (org) and `user_id` (session)
2. **Request arrives** with virtual key in Authorization header
3. **LiteLLM validates** the key against the database
4. **LiteLLM forwards** to Anthropic and gets response
5. **LiteLLM auto-logs** to `LiteLLM_SpendLogs` table:
   - `team_id` = org_id (for per-org billing)
   - `user` = session_id (for per-session tracking)
   - `spend` = actual cost in USD

6. **Billing Worker** (every 30s) syncs to `billing_events`:
   ```
   LiteLLM_SpendLogs → billing_events (with 3x markup)
   ```

7. **Outbox Worker** (every 60s) deducts from Autumn:
   ```
   billing_events → Autumn (credit deduction)
   ```

### Dockerfile

```dockerfile
FROM ghcr.io/berriai/litellm:main-latest

WORKDIR /app

# Copy config only - no custom code needed!
COPY litellm/config.yaml /app/config.yaml

EXPOSE 4000

CMD ["--config", "/app/config.yaml", "--port", "4000"]
```

### Environment Variables (LLM Proxy Service)

| Variable | Required | Description |
|----------|----------|-------------|
| `LITELLM_MASTER_KEY` | Yes | Admin key for LiteLLM |
| `ANTHROPIC_API_KEY` | Yes | Real Anthropic API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string (same as app) |

---

## Environment Variable Reference

### Session Creator (Gateway/API)

```bash
# Enable proxy mode
LLM_PROXY_URL=https://llm-proxy.fly.dev

# For generating virtual keys
LLM_PROXY_MASTER_KEY=sk-master-key

# Optional: default key duration (e.g., "24h", "168h")
LLM_PROXY_KEY_DURATION=24h

# Optional: fail session creation if LLM_PROXY_URL is missing
LLM_PROXY_REQUIRED=true

# Fallback (when proxy disabled)
ANTHROPIC_API_KEY=sk-ant-...
```

### LLM Proxy Service

```bash
# LiteLLM
LITELLM_MASTER_KEY=sk-master-key

# Real API credentials (never seen by sandboxes)
ANTHROPIC_API_KEY=sk-ant-...

# Database (same PostgreSQL as main app)
DATABASE_URL=postgresql://...
```

### Billing Worker

```bash
# Required for Autumn integration
AUTUMN_API_URL=https://api.useautumn.com
AUTUMN_API_KEY=your-autumn-key

# Database (for reading LiteLLM_SpendLogs)
POSTGRES_CONNECTION_STRING=postgresql://...
```

---

## Security Model

```
┌─────────────────┐
│    Sandbox      │  Only has: Virtual key (expires per LLM_PROXY_KEY_DURATION)
│   (untrusted)   │  Never sees: real API keys
└────────┬────────┘
         │
         │ Virtual key in Authorization header
         ▼
┌─────────────────┐
│   LLM Proxy     │  Validates: key against database
│   (trusted)     │  Extracts: team_id, user_id from key
│                 │  Has: real ANTHROPIC_API_KEY
└────────┬────────┘
         │
         │ Real API key
         ▼
┌─────────────────┐
│   Anthropic     │
└─────────────────┘
```

**Security guarantees:**
1. Sandboxes never see real API keys
2. Virtual keys expire based on `LLM_PROXY_KEY_DURATION` — limits blast radius of leaks
3. Keys are scoped to session + org — enables cost tracking
4. Proxy validates keys against database — rejects invalid/expired keys

---

## Quick Reference

| Task | File/Location |
|------|---------------|
| Generate virtual key | `packages/shared/src/llm-proxy.ts` → `generateSessionAPIKey()` |
| Check if proxy enabled | `packages/shared/src/llm-proxy.ts` → `isLLMProxyEnabled()` |
| Get proxy URL | `packages/shared/src/llm-proxy.ts` → `getLLMProxyURL()` |
| Generate OpenCode config | `packages/shared/src/sandbox/opencode.ts` → `getOpencodeConfig()` |
| LiteLLM config | `apps/llm-proxy/litellm/config.yaml` |
| LLM spend sync | `apps/worker/src/billing-worker.ts` → `syncLLMSpend()` |
| Billing DB operations | `packages/services/src/billing/db.ts` |
