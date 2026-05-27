#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error(
    "Usage: node scripts/dev-bifrost-ensure-config.mjs --base-url <url> --app-dir <path>",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let baseUrl = "";
let appDir = "";

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--base-url") {
    baseUrl = args[++index] ?? "";
  } else if (arg === "--app-dir") {
    appDir = args[++index] ?? "";
  } else {
    usage();
  }
}

if (!baseUrl || !appDir) {
  usage();
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function writeConfigFile(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const configPath = path.join(directory, "config.json");
  const config = {
    $schema: "https://www.getbifrost.ai/schema",
    client: {
      enable_logging: true,
      enforce_auth_on_inference: true,
    },
  };
  fs.writeFileSync(`${configPath}.tmp`, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(`${configPath}.tmp`, configPath);
  console.log(`Ensured local Bifrost config at ${configPath}`);
}

async function tryFetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

async function ensureRunningConfig(url) {
  let current;
  try {
    current = await tryFetchJson(`${url}/api/config`);
  } catch (error) {
    console.log(`Bifrost is not running yet at ${url}; config file will apply on startup.`);
    return;
  }

  const clientConfig = {
    ...(current.client_config ?? {}),
    enable_logging: true,
    enforce_auth_on_inference: true,
  };
  const enableLogging = clientConfig.enable_logging === true;
  const enforceAuth = clientConfig.enforce_auth_on_inference === true;
  if (
    enableLogging &&
    enforceAuth &&
    current.client_config?.enable_logging === true &&
    current.client_config?.enforce_auth_on_inference === true
  ) {
    console.log("Bifrost already enforces virtual-key auth on inference.");
    return;
  }

  await tryFetchJson(`${url}/api/config`, {
    method: "PUT",
    body: JSON.stringify({
      client_config: clientConfig,
      framework_config: current.framework_config ?? {},
      auth_config: current.auth_config ?? null,
    }),
  });

  const updated = await tryFetchJson(`${url}/api/config`);
  if (updated.client_config?.enforce_auth_on_inference !== true) {
    throw new Error("Bifrost accepted config update but did not enable auth enforcement.");
  }
  console.log("Enabled Bifrost virtual-key auth enforcement for running dev gateway.");
}

const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
writeConfigFile(appDir);
await ensureRunningConfig(normalizedBaseUrl);
