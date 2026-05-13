#!/usr/bin/env node
/**
 * Bootstrap a throwaway E2B base sandbox with AnyHarness + providers installed,
 * then smoke-test providers end-to-end.
 *
 * Usage:
 *   node scripts/smoke-e2b-runtime.mjs
 *
 * Reads API keys from ~/proliferate/.env.local or environment.
 */

import { Sandbox } from "e2b";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const E2B_API_KEY = process.env.E2B_API_KEY;
if (!E2B_API_KEY) {
  console.error("ERROR: E2B_API_KEY environment variable is required");
  process.exit(1);
}
const TIMEOUT_MS = 1800000; // 30 minutes
const BINARY_PATH = path.join(
  import.meta.dirname,
  "..",
  "target",
  "x86_64-unknown-linux-musl",
  "release",
  "anyharness"
);

// Load API keys from ~/proliferate/.env.local
function loadEnvFile(filePath) {
  const vars = {};
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      vars[key] = val;
    }
  } catch {}
  return vars;
}

// Try multiple common locations for env files
const envFile = loadEnvFile(process.env.ENV_FILE || path.join(process.env.HOME, "proliferate", ".env.local"));

const API_KEYS = {
  ANTHROPIC_API_KEY:
    process.env.ANTHROPIC_API_KEY || envFile.ANTHROPIC_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || envFile.OPENAI_API_KEY || "",
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || envFile.GOOGLE_API_KEY || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || envFile.GEMINI_API_KEY || "",
  CURSOR_API_KEY: process.env.CURSOR_API_KEY || envFile.CURSOR_API_KEY || "",
};

// Agent kinds to test and their required env vars
const PROVIDERS = [
  {
    kind: "claude",
    displayName: "Claude",
    envVars: ["ANTHROPIC_API_KEY"],
    modelId: "claude-sonnet-4-5",
  },
  {
    kind: "codex",
    displayName: "Codex",
    envVars: ["OPENAI_API_KEY"],
    modelId: null,
  },
  {
    kind: "gemini",
    displayName: "Gemini",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelId: null,
  },
  {
    kind: "opencode",
    displayName: "OpenCode",
    envVars: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    modelId: null,
  },
  {
    kind: "cursor",
    displayName: "Cursor",
    envVars: ["CURSOR_API_KEY"],
    modelId: null,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function hasKey(envVarNames) {
  return envVarNames.some((v) => !!API_KEYS[v]);
}

async function run(sandbox, cmd, opts = {}) {
  try {
    const runOpts = { timeoutMs: opts.timeoutMs || 30000 };
    if (opts.user) runOpts.user = opts.user;
    return await sandbox.commands.run(cmd, runOpts);
  } catch (e) {
    return {
      stdout: e.result?.stdout || "",
      stderr: e.result?.stderr || e.message || "",
      exitCode: e.result?.exitCode || -1,
    };
  }
}

async function waitForHealth(sandbox, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await run(sandbox, "curl -s http://localhost:8457/health");
    if (h.stdout.includes("ok")) return true;
    if (i % 5 === 4) log(`  Still waiting for health... (attempt ${i + 1})`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("=== AnyHarness E2B Runtime Smoke Test ===");
  log("");

  // Print available API keys
  log("Available API keys:");
  for (const [k, v] of Object.entries(API_KEYS)) {
    log(`  ${k}: ${v ? v.slice(0, 12) + "..." : "NOT SET"}`);
  }

  // Verify binary
  if (!fs.existsSync(BINARY_PATH)) {
    console.error(`Binary not found: ${BINARY_PATH}`);
    process.exit(1);
  }
  const binarySize = fs.statSync(BINARY_PATH).size;
  log(
    `Binary: ${BINARY_PATH} (${(binarySize / 1024 / 1024).toFixed(1)} MB)`
  );

  // =========================================================================
  // Step 1: Create sandbox
  // =========================================================================
  log("");
  log("=== Step 1: Creating E2B sandbox ===");
  const sandbox = await Sandbox.create("base", {
    apiKey: E2B_API_KEY,
    timeoutMs: TIMEOUT_MS,
  });
  log(`Sandbox ID: ${sandbox.sandboxId}`);
  log(`Timeout: ${TIMEOUT_MS / 1000}s`);

  try {
    // =========================================================================
    // Step 2: Upload binary and install dependencies
    // =========================================================================
    log("");
    log("=== Step 2: Uploading binary & installing dependencies ===");

    // Upload binary
    log("Uploading AnyHarness binary...");
    const binaryData = fs.readFileSync(BINARY_PATH);
    await sandbox.files.write("/home/user/anyharness", binaryData);
    await run(sandbox, "chmod +x /home/user/anyharness");
    const versionResult = await run(
      sandbox,
      "/home/user/anyharness --version"
    );
    log(`Binary version: ${versionResult.stdout.trim()}`);

    // Install Node.js 22 (required for claude-agent-acp import attributes)
    // Must run as root because E2B base image has node 20 in /usr/local/bin
    log("Installing Node.js 22...");
    await run(
      sandbox,
      'bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -" 2>&1 | tail -5',
      { timeoutMs: 120000, user: "root" }
    );
    await run(
      sandbox,
      "apt-get install -y nodejs 2>&1 | tail -5",
      { timeoutMs: 120000, user: "root" }
    );

    // Fix PATH: the base image has node 20 at /usr/local/bin which takes
    // precedence over the newly installed node 22 at /usr/bin.
    await run(
      sandbox,
      "rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx && " +
        "ln -sf /usr/bin/node /usr/local/bin/node && " +
        "ln -sf /usr/bin/npm /usr/local/bin/npm && " +
        "ln -sf /usr/bin/npx /usr/local/bin/npx",
      { timeoutMs: 10000, user: "root" }
    );

    const nodeV = await run(sandbox, "node --version && npm --version");
    log(`Node: ${nodeV.stdout.trim().replace("\n", ", npm ")}`);

    // Check git
    const gitCheck = await run(sandbox, "git --version");
    if (gitCheck.exitCode !== 0) {
      log("Installing git...");
      await run(sandbox, "apt-get install -y git", { timeoutMs: 60000, user: "root" });
    }
    const gitV = await run(sandbox, "git --version");
    log(`Git: ${gitV.stdout.trim()}`);

    // Clone test repo
    log("Cloning proliferate repo...");
    const cloneResult = await run(
      sandbox,
      "git clone --depth 1 https://github.com/proliferate-ai/proliferate.git /home/user/proliferate 2>&1",
      { timeoutMs: 120000 }
    );
    log(`Clone exit: ${cloneResult.exitCode}`);

    // =========================================================================
    // Step 3: Start AnyHarness with all API keys
    // =========================================================================
    log("");
    log("=== Step 3: Starting AnyHarness with all API keys ===");

    // Build env string with all available keys
    const envParts = ["ANYHARNESS_DEV_CORS=1", "RUST_LOG=info"];
    for (const [k, v] of Object.entries(API_KEYS)) {
      if (v) envParts.push(`${k}='${v.replace(/'/g, "'\\''")}'`);
    }
    const envStr = envParts.join(" ");

    await run(
      sandbox,
      `${envStr} nohup /home/user/anyharness serve --host 0.0.0.0 --port 8457 > /home/user/anyharness.log 2>&1 &`,
      { timeoutMs: 10000 }
    );

    const healthy = await waitForHealth(sandbox);
    if (!healthy) {
      const logs = await run(sandbox, "cat /home/user/anyharness.log");
      console.error("AnyHarness failed to start. Logs:", logs.stdout);
      process.exit(1);
    }
    log("AnyHarness is healthy!");

    // =========================================================================
    // Step 4: Reconcile all agents (batch install)
    // =========================================================================
    log("");
    log("=== Step 4: Reconciling all agents (batch install) ===");
    const reconcileResult = await run(
      sandbox,
      `curl -s -X POST http://localhost:8457/v1/agents/reconcile -H "Content-Type: application/json" -d '{"reinstall": false}'`,
      { timeoutMs: 300000 }
    );

    let reconcileData;
    try {
      reconcileData = JSON.parse(reconcileResult.stdout);
    } catch (e) {
      log(
        `Failed to parse reconcile response: ${reconcileResult.stdout.slice(0, 500)}`
      );
      process.exit(1);
    }

    log("Reconcile results:");
    for (const r of reconcileData.results || []) {
      const icon =
        r.outcome === "installed"
          ? "OK"
          : r.outcome === "already_installed"
            ? "OK (cached)"
            : r.outcome === "skipped"
              ? "SKIP"
              : "FAIL";
      log(`  ${r.kind}: ${icon}${r.message ? " - " + r.message : ""}`);
    }

    // =========================================================================
    // Step 4b: Pre-auth setup for providers that need it
    // =========================================================================
    log("");
    log("=== Step 4b: Pre-authenticating providers ===");

    // Codex needs `codex login --with-api-key` (not just env var)
    if (API_KEYS.OPENAI_API_KEY) {
      log("Setting up Codex authentication...");
      const escapedKey = API_KEYS.OPENAI_API_KEY.replace(/'/g, "'\\''");
      const codexLogin = await run(
        sandbox,
        `echo '${escapedKey}' | PATH=/home/user/.proliferate/anyharness/agents/codex/native:$PATH codex login --with-api-key 2>&1`,
        { timeoutMs: 30000 }
      );
      log(`  Codex login: ${codexLogin.stdout.trim()}`);
    }

    // =========================================================================
    // Step 5: Check all agent statuses
    // =========================================================================
    log("");
    log("=== Step 5: Agent status after reconcile ===");
    const agentsResult = await run(
      sandbox,
      "curl -s http://localhost:8457/v1/agents"
    );
    let agents;
    try {
      agents = JSON.parse(agentsResult.stdout);
    } catch {
      log(
        `Failed to parse agents: ${agentsResult.stdout.slice(0, 500)}`
      );
      agents = [];
    }

    for (const a of agents) {
      log(
        `  ${a.kind}: readiness=${a.readiness}, credentials=${a.credentialState}, native=${a.native?.installed ?? "N/A"}, agent_process=${a.agentProcess?.installed}`
      );
      if (a.message) log(`    message: ${a.message}`);
    }

    // =========================================================================
    // Step 6: Resolve workspace
    // =========================================================================
    log("");
    log("=== Step 6: Resolving workspace ===");
    const wsResult = await run(
      sandbox,
      `curl -s -X POST http://localhost:8457/v1/workspaces/resolve -H "Content-Type: application/json" -d '{"path": "/home/user/proliferate"}'`
    );
    let workspace;
    try {
      workspace = JSON.parse(wsResult.stdout);
      log(`Workspace: ${workspace.id} (${workspace.kind})`);
    } catch (e) {
      log(`Failed to resolve workspace: ${wsResult.stdout}`);
      workspace = null;
    }

    // =========================================================================
    // Step 7: Test each provider end-to-end
    // =========================================================================
    log("");
    log("=== Step 7: Testing each provider end-to-end ===");

    const results = [];

    for (const provider of PROVIDERS) {
      log("");
      log(`--- Testing ${provider.displayName} (${provider.kind}) ---`);

      const result = {
        kind: provider.kind,
        displayName: provider.displayName,
        hasApiKey: hasKey(provider.envVars),
        binaryInstalled: false,
        acpInstalled: false,
        sessionCreated: false,
        promptWorked: false,
        error: null,
      };

      // Check agent status
      const agentData = agents.find((a) => a.kind === provider.kind);
      if (!agentData) {
        result.error = "Agent not found in registry";
        results.push(result);
        log(`  SKIP: Agent not in registry`);
        continue;
      }

      result.binaryInstalled = agentData.native?.installed ?? true;
      result.acpInstalled = agentData.agentProcess?.installed ?? false;

      log(
        `  Native installed: ${agentData.native?.installed ?? "N/A (not required)"}`
      );
      log(`  ACP installed: ${agentData.agentProcess?.installed}`);
      log(`  Readiness: ${agentData.readiness}`);
      log(`  Credentials: ${agentData.credentialState}`);

      if (!result.acpInstalled) {
        result.error = `ACP adapter not installed: ${agentData.agentProcess?.message || agentData.message || "unknown"}`;
        results.push(result);
        log(`  SKIP: ACP not installed`);
        continue;
      }

      if (!result.hasApiKey && provider.envVars.length > 0) {
        result.error = `Missing API key(s): ${provider.envVars.join(", ")}`;
        results.push(result);
        log(`  SKIP: No API key`);
        continue;
      }

      if (
        agentData.readiness !== "ready" &&
        agentData.readiness !== "credentials_required"
      ) {
        result.error = `Agent not ready: ${agentData.readiness} - ${agentData.message || ""}`;
        results.push(result);
        log(`  SKIP: Agent not ready`);
        continue;
      }

      if (!workspace) {
        result.error = "No workspace available";
        results.push(result);
        log(`  SKIP: No workspace`);
        continue;
      }

      // Create session
      log(`  Creating session...`);
      const sessionBody = {
        workspaceId: workspace.id,
        agentKind: provider.kind,
      };
      if (provider.modelId) sessionBody.modelId = provider.modelId;

      const sessionResult = await run(
        sandbox,
        `curl -s -X POST http://localhost:8457/v1/sessions -H "Content-Type: application/json" -d '${JSON.stringify(sessionBody)}'`,
        { timeoutMs: 60000 }
      );

      let session;
      try {
        session = JSON.parse(sessionResult.stdout);
        if (!session.id) {
          throw new Error(
            session.detail || session.title || "Unknown error"
          );
        }
        result.sessionCreated = true;
        log(`  Session: ${session.id} (${session.status})`);
      } catch (e) {
        result.error = `Session creation failed: ${e.message}`;
        results.push(result);
        log(`  FAIL: ${result.error}`);
        const logs = await run(
          sandbox,
          "tail -10 /home/user/anyharness.log"
        );
        log(`  Logs: ${logs.stdout.slice(0, 500)}`);
        continue;
      }

      // Send prompt
      log(`  Sending prompt...`);
      const promptBody = {
        blocks: [{ type: "text", text: "Say hello in 3 words" }],
      };
      const promptResult = await run(
        sandbox,
        `curl -s -X POST http://localhost:8457/v1/sessions/${session.id}/prompt -H "Content-Type: application/json" -d '${JSON.stringify(promptBody)}'`,
        { timeoutMs: 60000 }
      );

      try {
        JSON.parse(promptResult.stdout);
      } catch (e) {
        result.error = `Prompt failed: ${promptResult.stdout.slice(0, 300)}`;
        results.push(result);
        log(`  FAIL: ${result.error}`);
        continue;
      }

      // Poll for turn completion
      log(`  Waiting for response...`);
      let gotResponse = false;
      let responseText = "";
      let errorMsg = "";

      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));

        const eventsResult = await run(
          sandbox,
          `curl -s http://localhost:8457/v1/sessions/${session.id}/events`
        );
        let events;
        try {
          events = JSON.parse(eventsResult.stdout);
          if (!Array.isArray(events)) continue;
        } catch {
          continue;
        }

        const turnComplete = events.find(
          (e) => e.event?.type === "turn_completed"
        );
        const errorEvent = events.find((e) => e.event?.type === "error");
        const messages = events.filter(
          (e) => e.event?.type === "agent_message_chunk"
        );

        if (errorEvent) {
          errorMsg = JSON.stringify(errorEvent.event);
          log(`  Error event: ${errorMsg.slice(0, 300)}`);
          break;
        }

        if (turnComplete) {
          responseText = messages
            .map((e) => e.event?.content?.text || "")
            .join("");
          gotResponse = true;
          log(
            `  Response received (${messages.length} chunks, ${responseText.length} chars)`
          );
          log(`  Text: "${responseText.slice(0, 200)}"`);
          break;
        }

        if (i % 10 === 9) {
          log(
            `  Still waiting... (${events.length} events, ${messages.length} chunks)`
          );
        }
      }

      if (gotResponse) {
        result.promptWorked = true;
      } else {
        result.error = errorMsg || "Timed out waiting for response";
        const logs = await run(
          sandbox,
          "tail -15 /home/user/anyharness.log"
        );
        log(`  Logs: ${logs.stdout.slice(0, 500)}`);
      }

      results.push(result);
    }

    // =========================================================================
    // Step 8: Report results
    // =========================================================================
    log("");
    log("=============================================================");
    log("=== FINAL RESULTS ===");
    log("=============================================================");
    log("");

    const tableRows = [];
    for (const r of results) {
      const status = r.promptWorked
        ? "PASS"
        : r.sessionCreated
          ? "PARTIAL"
          : "FAIL";

      log(`${r.displayName} (${r.kind}):`);
      log(`  Status:           ${status}`);
      log(`  API Key:          ${r.hasApiKey ? "YES" : "NO"}`);
      log(`  Binary Installed: ${r.binaryInstalled ? "YES" : "NO"}`);
      log(`  ACP Installed:    ${r.acpInstalled ? "YES" : "NO"}`);
      log(`  Session Created:  ${r.sessionCreated ? "YES" : "NO"}`);
      log(`  Prompt Worked:    ${r.promptWorked ? "YES" : "NO"}`);
      if (r.error) log(`  Error:            ${r.error}`);
      log("");

      tableRows.push({
        provider: r.kind,
        status,
        apiKey: r.hasApiKey,
        binary: r.binaryInstalled,
        acp: r.acpInstalled,
        session: r.sessionCreated,
        prompt: r.promptWorked,
        error: r.error,
      });
    }

    // Summary line
    const passed = results.filter((r) => r.promptWorked).length;
    const total = results.length;
    log(
      `Summary: ${passed}/${total} providers fully working end-to-end`
    );

    // Write connection info
    const host = sandbox.getHost(8457);
    const connectionInfo = {
      sandboxId: sandbox.sandboxId,
      publicUrl: `https://${host}`,
      healthUrl: `https://${host}/health`,
      repoPath: "/home/user/proliferate",
      startedAt: new Date().toISOString(),
      timeoutMs: TIMEOUT_MS,
      testResults: tableRows,
    };
    const connectionFile = path.join(
      import.meta.dirname,
      "..",
      "e2b-connection.json"
    );
    fs.writeFileSync(connectionFile, JSON.stringify(connectionInfo, null, 2));
    log(`\nConnection info written to e2b-connection.json`);
    log(`Public URL: https://${host}`);
    log(`Sandbox ID: ${sandbox.sandboxId}`);
  } catch (error) {
    console.error("Deployment failed:", error);
    try {
      const logs = await run(sandbox, "cat /home/user/anyharness.log");
      console.error("AnyHarness logs:", logs.stdout);
    } catch {}
    console.error(`\nKilling sandbox ${sandbox.sandboxId}...`);
    await sandbox.kill().catch(() => {});
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
