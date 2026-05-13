#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function usage() {
  console.log(`Usage: node scripts/inspect-cursor-models.mjs [options]

Asks Cursor's CLI what models are currently available, then prints samples and
an optional comparison against Proliferate's curated Cursor catalog entries.

Options:
  --cursor-bin <path>    Cursor agent executable to call (default: cursor-agent)
  --raw                  Print raw Cursor output after the summary
  --json                 Print parsed model records as JSON
  --limit <n>            Sample models to print (default: 24)
  --catalog <path>       Catalog to compare (default: catalogs/agents/v1/catalog.json)
  --no-catalog           Skip catalog comparison
  -h, --help             Show this help
`);
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function parseArgs(argv) {
  const result = {
    cursorBin: process.env.CURSOR_AGENT_BIN || "cursor-agent",
    raw: false,
    json: false,
    limit: 24,
    catalog: path.join(repoRoot, "catalogs/agents/v1/catalog.json"),
    compareCatalog: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--cursor-bin") {
      result.cursorBin = expandHome(argv[++i]);
      continue;
    }
    if (arg === "--raw") {
      result.raw = true;
      continue;
    }
    if (arg === "--json") {
      result.json = true;
      continue;
    }
    if (arg === "--limit") {
      result.limit = Number.parseInt(argv[++i], 10);
      continue;
    }
    if (arg === "--catalog") {
      result.catalog = path.resolve(expandHome(argv[++i]));
      continue;
    }
    if (arg === "--no-catalog") {
      result.compareCatalog = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

function runCursor(options) {
  const result = spawnSync(options.cursorBin, ["models"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Failed to run ${options.cursorBin}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.cursorBin} models exited with status ${result.status}`,
        result.stderr?.trim(),
        result.stdout?.trim(),
      ].filter(Boolean).join("\n"),
    );
  }
  return result.stdout;
}

function parseModels(output) {
  return stripAnsi(output)
    .split(/\n/)
    .flatMap((raw) => {
      const line = raw.trim();
      if (!line || line === "Available models" || line.startsWith("Loading models") || line.startsWith("Tip:")) {
        return [];
      }
      const marker = line.indexOf(" - ");
      if (marker < 0) return [];
      const id = line.slice(0, marker).trim();
      const labelRaw = line.slice(marker + 3).trim();
      if (!id || /\s/.test(id)) return [];
      return [{
        id,
        displayName: labelRaw.split("  (")[0].trim(),
        isDefault: labelRaw.includes("default"),
        isCurrent: labelRaw.includes("current"),
      }];
    });
}

function readCatalogModelIDs(catalogPath) {
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const cursor = raw.agents?.find((agent) => agent.kind === "cursor");
  return new Map((cursor?.session?.models ?? []).map((model) => [model.id, model]));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = runCursor(options);
  const records = parseModels(output);

  console.log(`Cursor command: ${options.cursorBin} models`);
  console.log(`Parsed models: ${records.length}`);
  console.log(records.slice(0, options.limit).map((record) => (
    `${record.id} (${record.displayName})`
  )).join(", "));

  if (options.compareCatalog && fs.existsSync(options.catalog)) {
    const catalog = readCatalogModelIDs(options.catalog);
    const live = new Map(records.map((record) => [record.id, record]));
    const liveNotCatalog = [...live.keys()].filter((id) => !catalog.has(id)).sort();
    const catalogNotLive = [...catalog.keys()].filter((id) => !live.has(id)).sort();
    console.log("");
    console.log(`Catalog comparison: ${path.relative(repoRoot, options.catalog)}`);
    console.log(`  curated Cursor catalog models: ${catalog.size}`);
    console.log(`  live models not in catalog: ${liveNotCatalog.length}`);
    console.log(`  catalog models not currently live: ${catalogNotLive.length}`);
  }

  if (options.json) {
    console.log("");
    console.log(JSON.stringify(records, null, 2));
  }
  if (options.raw) {
    console.log("");
    console.log("Raw Cursor output:");
    process.stdout.write(output);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
