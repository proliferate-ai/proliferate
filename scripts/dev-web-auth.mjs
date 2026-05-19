#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = Number(process.env.PROLIFERATE_API_PORT || "8000");
const webPort = Number(process.env.PROLIFERATE_WEB_PORT || "5174");
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || `http://localhost:${webPort}`;
const localApiBaseUrl = process.env.VITE_PROLIFERATE_API_BASE_URL || `http://127.0.0.1:${apiPort}`;
const ngrokWebAddr = process.env.NGROK_WEB_ADDR || "127.0.0.1:4042";
const ngrokApiUrl = process.env.NGROK_API_URL || `http://${ngrokWebAddr}/api/tunnels`;
const children = new Set();
const tempDirs = new Set();
let shuttingDown = false;

function usage() {
  console.log(`Usage:
  make dev-web-auth

Environment overrides:
  PROLIFERATE_API_PORT=8000
  PROLIFERATE_WEB_PORT=5174
  FRONTEND_BASE_URL=http://localhost:5174
  VITE_PROLIFERATE_API_BASE_URL=http://127.0.0.1:8000
  NGROK_WEB_ADDR=127.0.0.1:4042
  NGROK_API_URL=http://127.0.0.1:4042/api/tunnels

This starts local Postgres/migrations, ngrok for the API OAuth callbacks,
the server, and Vite web.
Add the printed provider redirect URI to Google/GitHub if the ngrok URL is new.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const env = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    env[match[1]] = unquoteEnvValue(match[2]);
  }
  return env;
}

function unquoteEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("'\\''", "'");
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replaceAll("\\\"", "\"").replaceAll("\\n", "\n");
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout?.trim() || "";
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  return result.status === 0;
}

function ngrokDefaultConfigPaths() {
  const configured = process.env.NGROK_CONFIG
    ? process.env.NGROK_CONFIG.split(path.delimiter).filter(Boolean)
    : [];
  const home = os.homedir();
  const candidates = [
    ...configured,
    path.join(home, "Library", "Application Support", "ngrok", "ngrok.yml"),
    path.join(home, ".config", "ngrok", "ngrok.yml"),
    path.join(home, ".ngrok2", "ngrok.yml"),
  ];
  return [...new Set(candidates)].filter((candidate) => existsSync(candidate));
}

function createNgrokOverlayConfig() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "proliferate-ngrok-"));
  tempDirs.add(tempDir);
  const configPath = path.join(tempDir, "ngrok.yml");
  writeFileSync(
    configPath,
    `version: "3"\nagent:\n  web_addr: ${ngrokWebAddr}\n`,
    "utf8",
  );
  return configPath;
}

function ngrokConfigArgs() {
  const overlayConfig = createNgrokOverlayConfig();
  return [
    ...ngrokDefaultConfigPaths().flatMap((configPath) => ["--config", configPath]),
    "--config",
    overlayConfig,
  ];
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
  });
  children.add(child);
  child.once("exit", () => {
    children.delete(child);
  });
  if (options.critical) {
    child.once("exit", (code, signal) => {
      if (shuttingDown) {
        return;
      }
      if (code === 0) {
        shutdown(0);
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      console.error(`${command} ${args.join(" ")} stopped unexpectedly (${reason}).`);
      shutdown(code && code > 0 ? code : 1);
    });
  }
  return child;
}

function cleanup() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { force: true, recursive: true });
  }
  tempDirs.clear();
}

function shutdown(code) {
  cleanup();
  process.exit(code);
}

process.on("SIGINT", () => {
  shutdown(130);
});
process.on("SIGTERM", () => {
  shutdown(143);
});
process.on("exit", cleanup);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service is still starting.
    }
    await wait(500);
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

async function pollNgrokTunnel() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const tunnel = await readNgrokTunnel(ngrokApiUrl);
    if (tunnel) {
      return tunnel;
    }
    await wait(500);
  }
  return null;
}

async function readNgrokTunnel(apiUrl) {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const tunnels = Array.isArray(payload.tunnels) ? payload.tunnels : [];
    const tunnel = tunnels.find((candidate) => {
      const publicUrl = String(candidate.public_url || "");
      const addr = String(candidate.config?.addr || "");
      return publicUrl.startsWith("https://") && addr.includes(String(apiPort));
    });
    return tunnel?.public_url ? String(tunnel.public_url).replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

async function findExistingNgrokTunnel() {
  const candidates = [
    ngrokApiUrl,
    "http://127.0.0.1:4040/api/tunnels",
    "http://127.0.0.1:4041/api/tunnels",
    "http://127.0.0.1:4042/api/tunnels",
  ];
  for (const apiUrl of [...new Set(candidates)]) {
    const tunnel = await readNgrokTunnel(apiUrl);
    if (tunnel) {
      return tunnel;
    }
  }
  return null;
}

async function startOrReuseNgrokTunnel() {
  const existing = await findExistingNgrokTunnel();
  if (existing) {
    console.log(`Reusing existing ngrok API URL: ${existing}`);
    return { tunnelUrl: existing, ngrokProcess: null };
  }

  const ngrokProcess = start(
    "ngrok",
    [
      "http",
      String(apiPort),
      ...ngrokConfigArgs(),
      "--log=stdout",
      "--log-format=json",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      critical: true,
    },
  );
  ngrokProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  const tunnelUrl = await waitForNgrokTunnel(ngrokProcess);
  return { tunnelUrl, ngrokProcess };
}

async function waitForNgrokTunnel(ngrokProcess) {
  let logResolved = false;
  const fromLogs = new Promise((resolve) => {
    const inspectLine = (line) => {
      if (logResolved) {
        return;
      }
      const text = line.toString();
      for (const fragment of text.split(/\r?\n/)) {
        if (!fragment.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(fragment);
          const url = parsed.url || parsed.public_url;
          if (typeof url === "string" && url.startsWith("https://")) {
            logResolved = true;
            resolve(url.replace(/\/$/, ""));
          }
        } catch {
          // ngrok v3 can emit non-JSON lines. The local API poll is fallback.
        }
      }
    };
    ngrokProcess.stdout?.on("data", inspectLine);
    ngrokProcess.stderr?.on("data", inspectLine);
  });

  const fromApi = pollNgrokTunnel();
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Timed out waiting for ngrok tunnel URL.")), 45_000);
  });
  return await Promise.race([fromLogs, fromApi, timeout]);
}

function localEnv() {
  const fileEnv = {
    ...readEnvFile(path.join(repoRoot, "server", ".env")),
    ...readEnvFile(path.join(repoRoot, "server", ".env.local")),
  };
  return {
    ...fileEnv,
    ...process.env,
    DEBUG: process.env.DEBUG ?? fileEnv.DEBUG ?? "1",
  };
}

function corsOrigins() {
  const origins = new Set([
    frontendBaseUrl,
    `http://localhost:${webPort}`,
    `http://127.0.0.1:${webPort}`,
  ]);
  return [...origins].join(",");
}

async function main() {
  if (!commandExists("ngrok")) {
    throw new Error("ngrok is required. Install it with `brew install ngrok/ngrok/ngrok`.");
  }

  const baseEnv = localEnv();
  console.log("Preparing local database...");
  run("make", ["server-db-ready"], { env: baseEnv });

  const { tunnelUrl } = await startOrReuseNgrokTunnel();
  if (typeof tunnelUrl !== "string" || !tunnelUrl.startsWith("https://")) {
    throw new Error("Could not resolve an https ngrok tunnel URL.");
  }

  const serverEnv = {
    ...baseEnv,
    API_BASE_URL: tunnelUrl,
    FRONTEND_BASE_URL: frontendBaseUrl,
    CORS_ALLOW_ORIGINS: corsOrigins(),
  };

  console.log(`ngrok API URL: ${tunnelUrl}`);
  console.log(`Google web redirect URI: ${tunnelUrl}/auth/web/google/callback`);
  console.log(`GitHub redirect URI: ${tunnelUrl}/auth/github/callback`);
  console.log("Add those redirect URIs in provider consoles if this ngrok URL is new.");
  console.log("");
  console.log("Running server migrations...");
  run(".venv/bin/alembic", ["upgrade", "head"], {
    cwd: path.join(repoRoot, "server"),
    env: serverEnv,
  });

  console.log("Starting API server...");
  start(
    ".venv/bin/uvicorn",
    ["proliferate.main:app", "--reload", "--host", "127.0.0.1", "--port", String(apiPort)],
    {
      cwd: path.join(repoRoot, "server"),
      env: serverEnv,
      critical: true,
    },
  );
  await waitForUrl(`http://127.0.0.1:${apiPort}/health`, "API server");

  console.log("Starting web...");
  console.log(`FRONTEND_BASE_URL=${frontendBaseUrl}`);
  console.log(`VITE_PROLIFERATE_API_BASE_URL=${localApiBaseUrl}`);
  start(
    "pnpm",
    [
      "--filter",
      "@proliferate/web",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    {
      env: {
        ...process.env,
        VITE_PROLIFERATE_API_BASE_URL: localApiBaseUrl,
      },
      critical: true,
    },
  );
  await waitForUrl(`http://127.0.0.1:${webPort}`, "Web app");

  console.log("");
  console.log(`Web: ${frontendBaseUrl}`);
  console.log(`API: http://127.0.0.1:${apiPort}`);
  console.log(`Provider callback base: ${tunnelUrl}`);

  await new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, resolve);
    }
  });
}

main().catch((error) => {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
