/**
 * Shared Sandbox Configuration
 *
 * Templates and configurations used by all sandbox providers.
 * These are the "runtime" configurations that get written into sandboxes.
 */

import { env } from "@proliferate/environment/server";

/**
 * Proliferate plugin for OpenCode.
 * Minimal plugin - all streaming happens via SSE (DO pulls from OpenCode).
 */
export const PLUGIN_MJS = `
// Proliferate Plugin for OpenCode
// This plugin is minimal - all streaming happens via SSE (DO pulls from OpenCode)

console.log("[Proliferate] Plugin loaded (SSE mode - no event pushing)");

// OpenCode plugin - ESM named export (required by OpenCode)
export const ProliferatePlugin = async ({ project, directory }) => {
  console.log("[Proliferate] Plugin initialized");
  console.log("[Proliferate] Project:", project?.name || "unknown");
  console.log("[Proliferate] Directory:", directory);

  // Return empty hooks - all events flow via SSE from OpenCode to DO
  return {};
};
`;

/**
 * Default Caddyfile for preview proxy.
 * Proxies to common dev server ports and strips security headers for iframe embedding.
 */
export const DEFAULT_CADDYFILE = `{
    admin off
}

:20000 {
    reverse_proxy localhost:3000 localhost:5173 localhost:8000 localhost:4321 {
        lb_policy first
        lb_try_duration 1s
        lb_try_interval 100ms
        fail_duration 2s
    }

    header {
        -X-Frame-Options
        -Content-Security-Policy
    }
}
`;

/**
 * Environment instructions for agents.
 * Documents available services and tools in the sandbox.
 */
export const ENV_INSTRUCTIONS = `
## Environment Information

**This is a cloud sandbox environment with full Docker support.**

Services are pre-installed and available:

### Available Services
- **PostgreSQL 15**: \`localhost:5432\` (user: \`postgres\`, no password needed - trust auth)
- **Redis**: \`localhost:6379\`
- **Mailcatcher**: SMTP on \`localhost:1025\`, Web UI on \`localhost:1080\`
- **Docker**: Full Docker support - you can use \`docker\` and \`docker compose\`

### Available Tools
- **Node.js 20** with \`pnpm\` (preferred) and \`yarn\`
- **Python 3.11** with \`uv\` (preferred) and \`pip\`
- **Playwright** with Chromium browser
- **Docker & Docker Compose**

### How to Set Up Projects

**Option 1: Use Docker Compose (recommended for complex setups)**
\`\`\`bash
docker compose up -d
\`\`\`

**Option 2: Run services directly**

1. **For Python/FastAPI backends:**
   \`\`\`bash
   cd backend
   uv sync
   uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   \`\`\`

2. **For Node.js/React frontends:**
   \`\`\`bash
   cd frontend
   pnpm install
   pnpm dev --host 0.0.0.0
   \`\`\`

3. **Database connection string:**
   \`\`\`
   postgresql://postgres@localhost:5432/app
   \`\`\`
   Create the database first: \`sudo -u postgres createdb app\`
`;

/**
 * Sandbox paths - standardized across providers
 */
export const SANDBOX_PATHS = {
	/** Home directory (E2B runs as 'user', Modal can be configured) */
	home: "/home/user",
	/** Global OpenCode config directory */
	globalOpencodeDir: "/home/user/.config/opencode",
	/** Global plugin directory */
	globalPluginDir: "/home/user/.config/opencode/plugin",
	/** Metadata file for session state tracking */
	metadataFile: "/home/user/.proliferate/metadata.json",
	/** Environment profile file */
	envProfileFile: "/home/user/.env.proliferate",
	/** Pre-installed tool dependencies */
	preinstalledToolsDir: "/home/user/.opencode-tools",
	/** Caddyfile for preview proxy (avoid /tmp - Docker daemon can restrict it) */
	caddyfile: "/home/user/Caddyfile",
} as const;

/**
 * Standard ports used by sandboxes
 */
export const SANDBOX_PORTS = {
	/** OpenCode API server */
	opencode: 4096,
	/** Caddy preview proxy */
	preview: 20000,
	/** SSH (for terminal sessions) */
	ssh: 22,
} as const;

/**
 * Sandbox timeout in milliseconds.
 * Override via SANDBOX_TIMEOUT_SECONDS env var.
 */
const timeoutSecondsRaw = env.SANDBOX_TIMEOUT_SECONDS as unknown;
const timeoutSecondsParsed =
	typeof timeoutSecondsRaw === "number" ? timeoutSecondsRaw : Number(timeoutSecondsRaw);
const timeoutSeconds =
	Number.isFinite(timeoutSecondsParsed) && timeoutSecondsParsed > 0 ? timeoutSecondsParsed : 3600;
export const SANDBOX_TIMEOUT_MS = timeoutSeconds * 1000;
export const SANDBOX_TIMEOUT_SECONDS = timeoutSeconds;
