#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = Number(process.env.PROLIFERATE_API_PORT || "8000");
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || "http://localhost:5174";
const ngrokApiUrl = process.env.NGROK_API_URL || "http://127.0.0.1:4040/api/tunnels";
const expoArgs = (process.env.MOBILE_EXPO_ARGS || "--tunnel").split(/\s+/).filter(Boolean);
const preferredMetroPort = Number(process.env.PROLIFERATE_MOBILE_PORT || "8081");
const children = new Set();
let shuttingDown = false;

function usage() {
  console.log(`Usage:
  make dev-mobile-auth
  make dev-mobile-tunnel

Environment overrides:
  PROLIFERATE_API_PORT=8000
  FRONTEND_BASE_URL=http://localhost:5174
  PROLIFERATE_MOBILE_PORT=8081
  MOBILE_EXPO_ARGS="--tunnel"
  NGROK_API_URL=http://127.0.0.1:4040/api/tunnels

This starts local Postgres/migrations, ngrok, the server, and Expo mobile.
Add the printed Google redirect URI to Google Console for the auth flow.
Use MOBILE_EXPO_ARGS="--lan" when your phone is reliably on the same LAN.`);
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

async function waitForLocalServer() {
  const url = `http://127.0.0.1:${apiPort}/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await wait(500);
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findMetroPort() {
  for (let port = preferredMetroPort; port < preferredMetroPort + 20; port += 1) {
    if (await canBindPort(port)) {
      return port;
    }
  }
  throw new Error(`Could not find a free Metro port starting at ${preferredMetroPort}.`);
}

function argsIncludeOption(args, option) {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

async function pollNgrokTunnel() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(ngrokApiUrl);
      if (response.ok) {
        const payload = await response.json();
        const tunnels = Array.isArray(payload.tunnels) ? payload.tunnels : [];
        const tunnel = tunnels.find((candidate) => {
          const publicUrl = String(candidate.public_url || "");
          const addr = String(candidate.config?.addr || "");
          return publicUrl.startsWith("https://") && addr.includes(String(apiPort));
        });
        if (tunnel?.public_url) {
          return String(tunnel.public_url).replace(/\/$/, "");
        }
      }
    } catch {
      // ngrok's local API is not ready yet.
    }
    await wait(500);
  }
  return null;
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
          // ngrok v3 can emit non-JSON lines in some configurations. The
          // local API poll below is the reliable fallback for those cases.
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
  return {
    ...process.env,
    ...readEnvFile(path.join(repoRoot, "server", ".env")),
    ...readEnvFile(path.join(repoRoot, "server", ".env.local")),
    DEBUG: process.env.DEBUG || "1",
  };
}

async function main() {
  if (!commandExists("ngrok")) {
    throw new Error("ngrok is required. Install it with `brew install ngrok/ngrok/ngrok`.");
  }

  console.log("Preparing local database...");
  run("make", ["server-db-ready"]);

  const baseEnv = localEnv();
  const ngrokProcess = start(
    "ngrok",
    ["http", String(apiPort), "--log=stdout", "--log-format=json"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      critical: true,
    },
  );
  ngrokProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  const tunnelUrl = await waitForNgrokTunnel(ngrokProcess);
  if (typeof tunnelUrl !== "string" || !tunnelUrl.startsWith("https://")) {
    throw new Error("Could not resolve an https ngrok tunnel URL.");
  }
  const serverEnv = {
    ...baseEnv,
    API_BASE_URL: tunnelUrl,
    FRONTEND_BASE_URL: frontendBaseUrl,
  };

  console.log(`ngrok API URL: ${tunnelUrl}`);
  console.log(`Google mobile redirect URI: ${tunnelUrl}/auth/mobile/google/callback`);
  console.log("Add that redirect URI in Google Console if this ngrok URL is new.");
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
  await waitForLocalServer();

  console.log("Starting Expo mobile...");
  console.log(`EXPO_PUBLIC_PROLIFERATE_API_BASE_URL=${tunnelUrl}`);
  const metroPort = await findMetroPort();
  const resolvedExpoArgs = [...expoArgs];
  if (!argsIncludeOption(resolvedExpoArgs, "--port")) {
    resolvedExpoArgs.push("--port", String(metroPort));
  }
  console.log(`Metro port: ${metroPort}`);
  run("pnpm", ["--filter", "@proliferate/mobile", "build:shared"], {
    env: process.env,
  });
  start(
    "pnpm",
    ["--filter", "@proliferate/mobile", "exec", "expo", "start", ...resolvedExpoArgs],
    {
      env: {
        ...process.env,
        EXPO_PUBLIC_PROLIFERATE_API_BASE_URL: tunnelUrl,
      },
      critical: true,
    },
  );

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
