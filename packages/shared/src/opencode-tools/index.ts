/**
 * OpenCode Tools
 *
 * Tool definitions that get injected into sandboxes.
 * Both Modal and E2B providers use these.
 */

export const ENV_FILE = "/tmp/.proliferate_env.json";

/**
 * Request Environment Variables Tool
 *
 * Allows agents to request env vars or secrets from users via the UI.
 * Uses the OpenCode tool() API with Zod-like schema.
 */
export const REQUEST_ENV_VARIABLES_TOOL = `
// Request Environment Variables Tool for OpenCode
// Requests env vars or secrets from the user via the Proliferate UI

import { tool } from "@opencode-ai/plugin"

const ENV_FILE = "${ENV_FILE}";

const suggestionSchema = tool.schema.object({
  label: tool.schema.string().describe("Display label for this option"),
  value: tool.schema.string().optional().describe("Preset value to use"),
  instructions: tool.schema.string().optional().describe("Setup instructions for agent to handle locally"),
});

const envVariableSchema = tool.schema.object({
  key: tool.schema.string().describe("Environment variable name"),
  description: tool.schema.string().optional().describe("What this variable is for"),
  type: tool.schema.enum(["env", "secret"]).optional().describe("env = just file, secret = file + encrypted DB storage"),
  required: tool.schema.boolean().optional().describe("Whether required (defaults to true)"),
  suggestions: tool.schema.array(suggestionSchema).optional().describe("Preset options or setup instructions"),
});

export default tool({
  description: \`Request environment variables or secrets from the user.

This tool notifies the user that environment variables are needed. It returns immediately.
The user will provide values via the UI, which are written to ${ENV_FILE}.

Types:
- type: "env" - Just written to the env file (for local setup, non-sensitive config)
- type: "secret" - Written to env file AND stored encrypted in database (for API keys, credentials)

Suggestions allow you to provide preset options or local setup instructions:
- { label: "Use local DB", value: "postgresql://localhost:5432/app" }
- { label: "Run locally", instructions: "Set up a local Postgres instance" }

After calling this, use bash commands to inject values into config files:
  # Inject into .env file
  jq -r '.DATABASE_URL' ${ENV_FILE} | xargs -I{} echo "DATABASE_URL={}" >> .env

IMPORTANT: Never cat or echo the env file directly - only extract specific keys into config files.

Example:
  request_env_variables({
    keys: [
      { key: "DATABASE_URL", description: "Database connection string", type: "env", suggestions: [
        { label: "Use local PostgreSQL", value: "postgresql://postgres@localhost:5432/app" }
      ]},
      { key: "STRIPE_SECRET_KEY", description: "Stripe API key", type: "secret" }
    ]
  })\`,

  args: {
    keys: tool.schema
      .array(envVariableSchema)
      .describe("List of environment variables to request from the user"),
  },

  async execute(args) {
    if (!args?.keys || args.keys.length === 0) {
      return "Error: keys array is required and must not be empty.";
    }
    const keyList = args.keys.map(k => k.key).join(", ");
    return \`Requested env variables: \${keyList}\\n\\nUser will be prompted. Once provided, use jq to inject them into config files.\`;
  },
});
`;

/**
 * Verify Tool
 *
 * Uploads verification evidence to S3 for display in the UI.
 * The actual upload is handled by the gateway (intercepted tool).
 * This is just a stub that the gateway intercepts.
 */
export const VERIFY_TOOL = `
// Verify Tool for OpenCode
// Gateway intercepts this tool and handles the actual S3 upload

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
    // Gateway intercepts this - tool never actually runs in sandbox
    return "Verification initiated...";
  },
};
`;

/**
 * Request Environment Variables Tool Description (for .txt file)
 */
export const REQUEST_ENV_VARIABLES_DESCRIPTION = `
Use the request_env_variables tool to ask the user for environment variables or secrets.

## When to Use

Only call this tool AFTER you have:
1. Installed dependencies and discovered what env vars are needed
2. Tried to set up LOCAL alternatives for everything possible
3. Batched all remaining needs into a single request

## Local-First Principle

Always prefer local services over external ones:

| Need | Local Alternative |
|------|-------------------|
| PostgreSQL/MySQL | Use localhost:5432 (already running) |
| Redis | Use localhost:6379 (already running) |
| Cloudflare Workers | Use \`wrangler dev\` or miniflare locally |
| S3/Object Storage | Use local MinIO or filesystem |
| Email | Use Mailcatcher at localhost:1025 |

Only ask the user for things that MUST be external:
- Third-party API keys (Stripe, OpenAI, Twilio, etc.)
- OAuth credentials (GitHub App, Google OAuth, etc.)
- Credentials for services that can't run locally

## How to Use

\`\`\`typescript
request_env_variables({
  keys: [
    // Local config - provide suggestion with local value
    {
      key: "DATABASE_URL",
      description: "PostgreSQL connection string",
      type: "env",
      suggestions: [
        { label: "Use local PostgreSQL", value: "postgresql://postgres@localhost:5432/app" }
      ]
    },
    // External secret - no local alternative
    {
      key: "STRIPE_SECRET_KEY",
      description: "Stripe API key for payments",
      type: "secret"
    }
  ]
})
\`\`\`

## After Calling

1. The tool returns immediately - user sees a form in the UI
2. Keep your response BRIEF - just explain what's needed
3. Wait for user to submit (they'll send "Configuration submitted.")
4. Values are written to ${ENV_FILE}
5. Inject into config files using jq:
   \`\`\`bash
   jq -r '.DATABASE_URL' ${ENV_FILE} | xargs -I{} echo "DATABASE_URL={}" >> .env
   \`\`\`
6. Restart any services that need the new env vars

## Important

- NEVER cat or echo the env file directly
- NEVER ask for things you can set up locally
- Batch ALL env var requests into ONE call
- Keep output minimal after calling - let user focus on the form
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
// Saves a snapshot of the current sandbox environment

import { tool } from "@opencode-ai/plugin"

export default tool({
  description: \`Save a snapshot of the current sandbox environment.

Call this tool after setup is complete and verified.
The snapshot is saved automatically - no user confirmation required.

For setup sessions: Updates the prebuild (future sessions start from this state)
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
    return args?.message || "Snapshot will be saved automatically.";
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
3. For setup sessions: prebuild is updated (future sessions start here)
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
// Gateway intercepts this tool and handles the run completion

import { tool } from "@opencode-ai/plugin"

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
    return "Automation completion submitted.";
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
// Gateway intercepts this tool and saves commands to the prebuild configuration

import { tool } from "@opencode-ai/plugin"

export default tool({
  description: \`Save auto-start service commands for this configuration.

These commands will run automatically when future sessions start with this prebuild snapshot.
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
    const names = args.commands.map(c => c.name).join(", ");
    return \`Service commands saved: \${names}\`;
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
These commands will auto-run in future sessions that use this prebuild snapshot.

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

/**
 * Save Env Files Tool
 *
 * Saves env file generation spec for the current prebuild.
 * The gateway intercepts this tool and persists the spec to the database.
 */
export const SAVE_ENV_FILES_TOOL = `
// Save Env Files Tool for OpenCode
// Gateway intercepts this tool and saves env file spec to the prebuild configuration

import { tool } from "@opencode-ai/plugin"

export default tool({
  description: \`Save environment file generation spec for this configuration.

Records which env files this project needs and which keys they require.
Values will be sourced from environment variables or stored secrets at boot time.

Call this AFTER you have identified which env files the project needs and which keys they require.

Example:
  save_env_files({
    files: [
      {
        path: ".env.local",
        format: "dotenv",
        mode: "secret",
        keys: [
          { key: "DATABASE_URL", required: true },
          { key: "STRIPE_SECRET_KEY", required: false }
        ]
      }
    ]
  })
\`,

  args: {
    files: tool.schema
      .array(tool.schema.object({
        workspacePath: tool.schema.string().optional().describe("Target repo directory (default '.', i.e. workspace root)"),
        path: tool.schema.string().describe("File path relative to workspace root (e.g. '.env.local')"),
        format: tool.schema.enum(["dotenv"]).describe("File format (only 'dotenv' supported)"),
        mode: tool.schema.enum(["secret"]).describe("File mode ('secret' = scrubbed before snapshots)"),
        keys: tool.schema.array(tool.schema.object({
          key: tool.schema.string().describe("Environment variable name"),
          required: tool.schema.boolean().describe("Whether this key must be present for the app to work"),
        })).describe("List of env var keys to include in the file"),
      }))
      .describe("List of env files to generate on session boot"),
  },

  async execute(args) {
    if (!args?.files || args.files.length === 0) {
      return "Error: files array is required and must not be empty.";
    }
    const paths = args.files.map(f => f.path).join(", ");
    return \`Env file spec saved: \${paths}\`;
  },
});
`;

/**
 * Save Env Files Tool Description (for .txt file)
 */
export const SAVE_ENV_FILES_DESCRIPTION = `
Use the save_env_files tool to record which env files this project needs.

## When to Use

Call this tool when you identify that the project needs env files (e.g. .env.local, .env) containing secrets or credentials.
This saves the spec to the prebuild configuration for use during session boot.

## How to Use

\\\`\\\`\\\`typescript
save_env_files({
  files: [
    {
      path: ".env.local",
      format: "dotenv",
      mode: "secret",
      keys: [
        { key: "DATABASE_URL", required: true },
        { key: "STRIPE_SECRET_KEY", required: false }
      ]
    }
  ]
})
\\\`\\\`\\\`

## Important

- Only 'dotenv' format and 'secret' mode are supported
- Values come from sandbox environment variables (set via request_env_variables or org secrets)
- Maximum 10 files, 50 keys per file
- Call save_snapshot after this to persist the environment
`;
