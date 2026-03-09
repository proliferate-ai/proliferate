/**
 * OpenCode Tools
 *
 * Tool definitions that get injected into sandboxes.
 * Both Modal and E2B providers use these.
 *
 * vNext: Intercepted tools make synchronous HTTP callbacks to the Gateway
 * (POST /proliferate/:sessionId/tools/:toolName) instead of being stubs.
 * The Gateway executes the tool and returns the result.
 * Tool wrappers retry on ECONNRESET (Snapshot TCP Drop).
 */

export const ENV_FILE = "/tmp/.proliferate_env.json";

/**
 * Shared HTTP callback helper injected into tool execute() functions.
 * Handles the Snapshot TCP Drop: retries on network errors with the same
 * tool_call_id so the Gateway returns the cached result on thaw.
 */
export const TOOL_CALLBACK_HELPER = `
const GATEWAY_URL = process.env.PROLIFERATE_GATEWAY_URL;
const SESSION_ID = process.env.PROLIFERATE_SESSION_ID;
const AUTH_TOKEN = process.env.SANDBOX_MCP_AUTH_TOKEN;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 500;

async function callGatewayTool(toolName, toolCallId, args) {
  if (!GATEWAY_URL || !SESSION_ID || !AUTH_TOKEN) {
    return { success: false, result: "Missing gateway environment variables" };
  }

  const url = GATEWAY_URL.replace(/\\/$/, "") + "/proliferate/" + SESSION_ID + "/tools/" + toolName;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + AUTH_TOKEN,
        },
        body: JSON.stringify({ tool_call_id: toolCallId, args }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, result: "Gateway error " + res.status + ": " + text.slice(0, 200) };
      }

      return await res.json();
    } catch (err) {
      const isRetryable = err?.cause?.code === "ECONNRESET"
        || err?.message?.includes("fetch failed")
        || err?.message?.includes("ECONNRESET")
        || err?.message?.includes("ECONNREFUSED")
        || err?.name === "AbortError";

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return { success: false, result: "Network error: " + (err?.message || String(err)) };
    }
  }

  return { success: false, result: "Max retries exceeded" };
}
`;

/**
 * Verify Tool
 *
 * Uploads verification evidence to S3 for display in the UI.
 * Calls back to Gateway via HTTP.
 */
export const VERIFY_TOOL = `
// Verify Tool for OpenCode
// Calls Gateway HTTP callback to upload verification files

import { randomUUID } from "crypto"

${TOOL_CALLBACK_HELPER}

export default {
  name: "verify",
  description: \`Upload verification evidence to S3 for display in the UI.

Before calling this tool, collect evidence in .proliferate/.verification/:
- Screenshots (use Playwright MCP to capture)
- Test output logs
- Any files proving your changes work

Example:
1. mkdir -p .proliferate/.verification
2. Take screenshots, save to .proliferate/.verification/
3. npm test > .proliferate/.verification/test.log 2>&1
4. Call verify()\`,

  parameters: {
    type: "object",
    properties: {
      folder: {
        type: "string",
        description: "Folder with evidence. Defaults to .proliferate/.verification/",
      },
    },
  },

  async execute(args) {
    const toolCallId = randomUUID();
    const result = await callGatewayTool("verify", toolCallId, args || {});
    return result.result || "Verification initiated...";
  },
};
`;

/**
 * Verify Tool Description (for .txt file)
 */
export const VERIFY_TOOL_DESCRIPTION = `
Use the verify tool to upload verification evidence for display in the Proliferate UI.

## How it works

1. **Collect evidence** in the \`.proliferate/.verification/\` folder (or a custom folder)
2. **Call verify()** to upload all files to S3
3. **View in UI** - the evidence appears in the Proliferate dashboard

## What to include

- **Screenshots**: Browser screenshots showing your changes work
- **Test output**: \`npm test > .proliferate/.verification/test-output.log 2>&1\`
- **Build logs**: Save build output if relevant
- **Any files**: Anything that proves your changes work correctly

## Usage Examples

### Basic usage (default folder)
\`\`\`bash
mkdir -p .proliferate/.verification
playwright_browser_navigate({ url: "http://localhost:3000" })
playwright_browser_take_screenshot({ path: ".proliferate/.verification/homepage.png" })
npm test > .proliferate/.verification/test-output.log 2>&1
verify()
\`\`\`

### Custom folder
\`\`\`
verify({ folder: "/workspace/my-custom-evidence" })
\`\`\`
`;

/**
 * Save Snapshot Tool
 *
 * Saves a snapshot of the current sandbox environment.
 * The gateway handles snapshot creation automatically.
 */
export const SAVE_SNAPSHOT_TOOL = `
// Save Snapshot Tool for OpenCode
// Calls Gateway HTTP callback to save snapshot

import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "crypto"

${TOOL_CALLBACK_HELPER}

export default tool({
  description: \`Save a snapshot of the current sandbox environment.

Call this tool after setup is complete and verified.
The snapshot is saved automatically - no user confirmation required.

For setup sessions: Updates the configuration (future sessions start from this state)
For coding sessions: Updates the session snapshot

Call this ONLY after:
1. All dependencies are installed
2. All services are running
3. Environment variables are configured
4. You have VERIFIED everything works (health checks, screenshots)
5. You have called verify() to upload evidence

Example:
  save_snapshot({ message: "Setup complete! Dev server on :3000" })
\`,

  args: {
    message: tool.schema
      .string()
      .optional()
      .describe("Brief summary of what's configured and working"),
  },

  async execute(args) {
    const toolCallId = randomUUID();
    const result = await callGatewayTool("save_snapshot", toolCallId, args || {});
    return result.result || "Snapshot saved.";
  },
});
`;

/**
 * Save Snapshot Tool Description (for .txt file)
 */
export const SAVE_SNAPSHOT_DESCRIPTION = `
Use the save_snapshot tool to save the current environment state.

## When to Call

Only call this AFTER you have:
1. Installed all dependencies
2. Started all services (backgrounded)
3. Configured all environment variables
4. VERIFIED everything works:
   - Health checks pass
   - Screenshots taken (for web apps)
   - verify() called to upload evidence

## How It Works

1. You call \`save_snapshot({ message: "Setup complete!" })\`
2. Gateway takes a filesystem snapshot
3. For setup sessions: configuration is updated (future sessions start here)
4. For coding sessions: session snapshot is updated

## Example

\`\`\`typescript
// After verification passes
save_snapshot({
  message: "Setup complete! Next.js dev server on :3000, Postgres local on :5432"
})
\`\`\`

## Important

- Don't call this until you've VERIFIED things work
- The snapshot is saved automatically (no user confirmation needed)
- Include a brief summary of what's working in the message
`;

/**
 * Automation Complete Tool
 *
 * Marks an automation run as complete.
 * The gateway intercepts this tool and updates the automation run.
 */
export const AUTOMATION_COMPLETE_TOOL = `
// Automation Complete Tool for OpenCode
// Calls Gateway HTTP callback to complete the automation run

import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "crypto"

${TOOL_CALLBACK_HELPER}

export default tool({
  name: "automation.complete",
  description: \`Mark an automation run as complete.

Call this once the automation has finished its work.
Include a concise summary and any citations your output relied on.\`,

  args: {
    run_id: tool.schema
      .string()
      .describe("Automation run ID (required)"),
    completion_id: tool.schema
      .string()
      .describe("Idempotency key for completion (required)"),
    outcome: tool.schema
      .enum(["succeeded", "failed", "needs_human"])
      .describe("Outcome of the automation run"),
    summary_markdown: tool.schema
      .string()
      .optional()
      .describe("Summary of the outcome"),
    citations: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Source IDs used in the output"),
    diff_ref: tool.schema
      .string()
      .optional()
      .describe("Artifact reference for a diff"),
    test_report_ref: tool.schema
      .string()
      .optional()
      .describe("Artifact reference for a test report"),
    side_effect_refs: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("References to side effects (PRs, drafts, etc.)"),
  },

  async execute(args) {
    if (!args?.run_id || !args?.completion_id) {
      return "Error: run_id and completion_id are required.";
    }
    const toolCallId = args.completion_id;
    const result = await callGatewayTool("automation.complete", toolCallId, args);
    return result.result || "Automation completion submitted.";
  },
});
`;

/**
 * Automation Complete Tool Description (for .txt file)
 */
export const AUTOMATION_COMPLETE_DESCRIPTION = `
Use the automation.complete tool to finalize an automation run.

Required fields:
- run_id
- completion_id (idempotency key)
- outcome (succeeded | failed | needs_human)

Include summary_markdown and citations when possible.
`;

/**
 * Save Service Commands Tool
 *
 * Saves auto-start commands for the current repo.
 * The gateway intercepts this tool and persists the commands to the database.
 */
export const SAVE_SERVICE_COMMANDS_TOOL = `
// Save Service Commands Tool for OpenCode
// Calls Gateway HTTP callback to save commands to the configuration

import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "crypto"

${TOOL_CALLBACK_HELPER}

export default tool({
  description: \`Save auto-start service commands for this configuration.

These commands will run automatically when future sessions start with this configuration snapshot.
Use this to configure dev servers, watchers, or background services that should always be running.

Call this AFTER you have verified the commands work correctly in the current session.

Example:
  save_service_commands({
    commands: [
      { name: "dev-server", command: "pnpm dev --host 0.0.0.0" },
      { name: "tailwind", command: "pnpm tailwindcss --watch", cwd: "frontend" }
    ]
  })
\`,

  args: {
    commands: tool.schema
      .array(tool.schema.object({
        name: tool.schema.string().describe("Short name for this service (e.g. dev-server)"),
        command: tool.schema.string().describe("Shell command to run"),
        cwd: tool.schema.string().optional().describe("Working directory relative to workspace root or workspacePath"),
        workspacePath: tool.schema.string().optional().describe("Target repo directory in multi-repo setups (e.g. frontend, backend)"),
      }))
      .describe("List of service commands to auto-start on session creation"),
  },

  async execute(args) {
    if (!args?.commands || args.commands.length === 0) {
      return "Error: commands array is required and must not be empty.";
    }
    const toolCallId = randomUUID();
    const result = await callGatewayTool("save_service_commands", toolCallId, args);
    return result.result || "Service commands saved.";
  },
});
`;

/**
 * Save Service Commands Tool Description (for .txt file)
 */
export const SAVE_SERVICE_COMMANDS_DESCRIPTION = `
Use the save_service_commands tool to configure auto-start commands for this configuration.

## When to Use

Call this tool when the user asks you to save startup commands for their project.
These commands will auto-run in future sessions that use this configuration snapshot.

## How to Use

\\\`\\\`\\\`typescript
save_service_commands({
  commands: [
    { name: "dev-server", command: "pnpm dev --host 0.0.0.0" },
    { name: "db-migrate", command: "pnpm prisma migrate dev", cwd: "backend" }
  ]
})
\\\`\\\`\\\`

For multi-repo setups, specify workspacePath to target a specific repo:
\\\`\\\`\\\`typescript
save_service_commands({
  commands: [
    { name: "frontend", command: "pnpm dev", workspacePath: "frontend" },
    { name: "api", command: "pnpm start", workspacePath: "backend" }
  ]
})
\\\`\\\`\\\`

## Important

- Only save commands you have verified work in the current session
- Commands run in the background (fire-and-forget) after sandbox initialization
- Output is logged to /tmp/svc-*.log files
- Maximum 10 commands per configuration
- Call save_snapshot after this to persist the environment
`;
