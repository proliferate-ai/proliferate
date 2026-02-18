/**
 * Shared Sandbox Configuration
 *
 * Templates and configurations used by all sandbox providers.
 * These are the "runtime" configurations that get written into sandboxes.
 */

import { env } from "@proliferate/environment/server";
import { z } from "zod";
import type { ConfigurationServiceCommand, ServiceCommand } from "../sandbox-provider";

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
    handle_path /_proliferate/mcp/* {
        reverse_proxy localhost:4000
    }

    handle_path /_proliferate/vscode/* {
        forward_auth localhost:4000 {
            uri /api/auth/check
            copy_headers Authorization
        }
        reverse_proxy localhost:3901
        header {
            -X-Frame-Options
            -Content-Security-Policy
        }
    }

    # User-exposed port snippet (written by exposePort). When populated, its
    # bare "handle" block intentionally takes priority over the default fallback
    # below, routing all non-devtools traffic to the user's chosen port.
    # Starts as an empty file so the default fallback applies until exposePort is called.
    import /home/user/.proliferate/caddy/user.caddy

    # Default fallback: try common dev server ports when no explicit port is exposed.
    handle {
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
}
`;

/**
 * Environment instructions for agents.
 * Documents available services and tools in the sandbox.
 */
export const ENV_INSTRUCTIONS = `
## Environment Information

**This is a cloud sandbox environment with full Docker support.**

### Available Tools
- **Node.js 20** with \`pnpm\` (preferred) and \`yarn\`
- **Python 3.11** with \`uv\` (preferred) and \`pip\`
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
`;

/**
 * Actions bootstrap hint written to .proliferate/actions-guide.md during sandbox setup.
 * Agents can read this file to discover the actions workflow.
 */
export const ACTIONS_BOOTSTRAP = `# Proliferate Platform Guide

You are an AI agent running inside Proliferate, authorized to use external integrations on behalf of the user via the \`proliferate\` CLI.

## Quick Start

\`\`\`bash
# Discover what the user has connected to this workspace
proliferate actions list

# Get detailed usage guide for a specific integration
proliferate actions guide --integration <name>

# Execute an action
proliferate actions run --integration <name> --action <action> --params '<json>'
\`\`\`

## How It Works

- **Read** actions (e.g. list issues, get details) are auto-approved and return immediately.
- **Write** actions (e.g. create issue, resolve issue) require user approval — your terminal blocks until the user clicks Approve in their web UI.
- **Danger** actions are denied by default.
- Authentication tokens are resolved server-side — never ask for API keys for connected integrations.

## Usage

If the user asks you to check Linear issues, look at Sentry errors, or interact with any connected tool, use these commands proactively. You are acting as the user.

Run \`proliferate actions list\` to see which integrations are connected.
Run \`proliferate actions guide --integration <name>\` for provider-specific examples.

## Local CLI

The user can also run \`npx @proliferate/cli\` on their local machine to sync files with this sandbox and use their own IDE (VS Code, Cursor, etc.).
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
	/** Directory for user-managed Caddy snippets (imported by main Caddyfile) */
	userCaddyDir: "/home/user/.proliferate/caddy",
	/** User Caddy config file (written by exposePort, imported by main Caddyfile) */
	userCaddyFile: "/home/user/.proliferate/caddy/user.caddy",
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
	/** openvscode-server (web-based editor) */
	vscode: 3901,
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

/**
 * Escape a string for safe use in single-quoted shell arguments.
 * Handles the only dangerous character in single-quoted strings: the single quote itself.
 */
export function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

const MAX_OUTPUT_BYTES = 16 * 1024;

/**
 * Cap command output to a maximum byte size.
 * Appends a truncation marker if output is trimmed.
 */
export function capOutput(output: string, maxBytes = MAX_OUTPUT_BYTES): string {
	if (output.length <= maxBytes) return output;
	return `${output.slice(0, maxBytes)}\n...[truncated]`;
}

/** Zod schema for validating a single service command from untrusted jsonb. */
const ServiceCommandSchema = z.object({
	name: z.string().min(1).max(100),
	command: z.string().min(1).max(1000),
	cwd: z.string().max(500).optional(),
});

/**
 * Parse and validate service commands from untrusted jsonb.
 * Returns [] on invalid input — never throws.
 */
export function parseServiceCommands(input: unknown): ServiceCommand[] {
	if (!Array.isArray(input)) return [];
	const result = z.array(ServiceCommandSchema).max(10).safeParse(input);
	return result.success ? result.data : [];
}

/** Zod schema for configuration-level service commands (includes optional workspacePath). */
const ConfigurationServiceCommandSchema = z.object({
	name: z.string().min(1).max(100),
	command: z.string().min(1).max(1000),
	cwd: z.string().max(500).optional(),
	workspacePath: z.string().max(500).optional(),
});

/**
 * Parse and validate configuration-level service commands from untrusted jsonb.
 * Returns [] on invalid input — never throws.
 */
export function parseConfigurationServiceCommands(input: unknown): ConfigurationServiceCommand[] {
	if (!Array.isArray(input)) return [];
	const result = z.array(ConfigurationServiceCommandSchema).max(10).safeParse(input);
	return result.success ? result.data : [];
}

/**
 * Resolve service commands for a session.
 *
 * Resolution order:
 * 1. Configuration-level commands (explicit per-configuration) — if non-empty, use those.
 * 2. Fallback: per-repo commands merged with workspace context.
 */
export function resolveServiceCommands(
	configurationCommands: unknown,
	repoSpecs: Array<{ workspacePath: string; serviceCommands?: ServiceCommand[] }>,
): ConfigurationServiceCommand[] {
	const configCmds = parseConfigurationServiceCommands(configurationCommands);
	if (configCmds.length > 0) return configCmds;

	// Fallback: merge per-repo commands with workspace context
	const merged: ConfigurationServiceCommand[] = [];
	for (const repo of repoSpecs) {
		if (!repo.serviceCommands?.length) continue;
		for (const cmd of repo.serviceCommands) {
			merged.push({
				name: cmd.name,
				command: cmd.command,
				cwd: cmd.cwd,
				workspacePath: repo.workspacePath,
			});
		}
	}
	return merged;
}
