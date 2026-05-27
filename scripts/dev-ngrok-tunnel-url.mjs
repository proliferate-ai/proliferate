#!/usr/bin/env node

const defaultApiUrls = [
  "http://127.0.0.1:4040/api/tunnels",
  "http://127.0.0.1:4041/api/tunnels",
  "http://127.0.0.1:4042/api/tunnels",
  "http://127.0.0.1:4043/api/tunnels",
];

function usage() {
  console.error(`Usage:
  node scripts/dev-ngrok-tunnel-url.mjs --port <local-port> [--api-url <url>] [--wait-ms <ms>]`);
}

function parseArgs(argv) {
  const options = {
    apiUrls: process.env.NGROK_API_URL
      ? [process.env.NGROK_API_URL]
      : defaultApiUrls,
    waitMs: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      options.port = argv[++i];
    } else if (arg === "--api-url") {
      options.apiUrls = [argv[++i], ...options.apiUrls];
    } else if (arg === "--wait-ms") {
      options.waitMs = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.port || !/^\d+$/.test(String(options.port))) {
    throw new Error("--port must be a TCP port number.");
  }
  options.apiUrls = [...new Set(options.apiUrls.filter(Boolean))];
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTunnel(apiUrl, port) {
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
      return publicUrl.startsWith("https://") && addr.includes(String(port));
    });
    return tunnel?.public_url ? String(tunnel.public_url).replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

async function findTunnel(options) {
  const deadline = Date.now() + options.waitMs;
  do {
    for (const apiUrl of options.apiUrls) {
      const tunnel = await readTunnel(apiUrl, options.port);
      if (tunnel) {
        return tunnel;
      }
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleep(500);
  } while (true);
  return null;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const tunnel = await findTunnel(options);
  if (!tunnel) {
    process.exit(1);
  }
  console.log(tunnel);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(2);
}
