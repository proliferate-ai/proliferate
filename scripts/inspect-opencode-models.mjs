#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")

function usage() {
  console.log(`Usage: node scripts/inspect-opencode-models.mjs [provider] [options]

Asks OpenCode itself what models are currently available, then prints provider
counts, samples, and an optional comparison against Proliferate's curated
OpenCode catalog entries.

Options:
  --opencode-bin <path>   OpenCode executable to call (default: opencode)
  --provider <id>         Provider to pass to "opencode models"
  --refresh               Pass --refresh to OpenCode before listing
  --verbose               Pass --verbose to OpenCode and parse metadata blocks
  --raw                   Print raw OpenCode output after the summary
  --json                  Print parsed model records as JSON
  --limit <n>             Sample models per provider (default: 12)
  --catalog <path>        Catalog to compare (default: catalogs/agents/v1/catalog.json)
  --no-catalog            Skip catalog comparison
  -h, --help              Show this help

Examples:
  node scripts/inspect-opencode-models.mjs
  node scripts/inspect-opencode-models.mjs openai --refresh
  node scripts/inspect-opencode-models.mjs --provider opencode --verbose --raw
`)
}

function expandHome(value) {
  if (!value) return value
  if (value === "~") return os.homedir()
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
  return value
}

function parseArgs(argv) {
  const result = {
    opencodeBin: process.env.OPENCODE_BIN || "opencode",
    provider: undefined,
    refresh: false,
    verbose: false,
    raw: false,
    json: false,
    limit: 12,
    catalog: path.join(repoRoot, "catalogs/agents/v1/catalog.json"),
    compareCatalog: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") {
      usage()
      process.exit(0)
    }
    if (arg === "--opencode-bin") {
      result.opencodeBin = expandHome(argv[++i])
      continue
    }
    if (arg === "--provider") {
      result.provider = argv[++i]
      continue
    }
    if (arg === "--refresh") {
      result.refresh = true
      continue
    }
    if (arg === "--verbose") {
      result.verbose = true
      continue
    }
    if (arg === "--raw") {
      result.raw = true
      continue
    }
    if (arg === "--json") {
      result.json = true
      continue
    }
    if (arg === "--limit") {
      result.limit = Number.parseInt(argv[++i], 10)
      continue
    }
    if (arg === "--catalog") {
      result.catalog = path.resolve(expandHome(argv[++i]))
      continue
    }
    if (arg === "--no-catalog") {
      result.compareCatalog = false
      continue
    }
    if (!arg.startsWith("-") && !result.provider) {
      result.provider = arg
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(result.limit) || result.limit < 1) {
    throw new Error("--limit must be a positive integer")
  }

  return result
}

function runOpenCode(options) {
  const args = ["models"]
  if (options.provider) args.push(options.provider)
  if (options.refresh) args.push("--refresh")
  if (options.verbose) args.push("--verbose")

  const result = spawnSync(options.opencodeBin, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) {
    throw new Error(`Failed to run ${options.opencodeBin}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.opencodeBin} ${args.join(" ")} exited with status ${result.status}`,
        result.stderr?.trim(),
        result.stdout?.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  return result.stdout
}

function splitModelID(value) {
  const slash = value.indexOf("/")
  if (slash <= 0) return undefined
  return {
    id: value,
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  }
}

function parseVerboseJson(lines, startIndex) {
  if (lines[startIndex]?.trim() !== "{") return { metadata: undefined, nextIndex: startIndex }

  const block = []
  let depth = 0
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i]
    block.push(line)
    for (const char of line) {
      if (char === "{") depth += 1
      if (char === "}") depth -= 1
    }
    if (depth === 0) {
      try {
        return { metadata: JSON.parse(block.join("\n")), nextIndex: i }
      } catch {
        return { metadata: undefined, nextIndex: i }
      }
    }
  }

  return { metadata: undefined, nextIndex: startIndex }
}

function parseModels(output) {
  const records = []
  const lines = output.split(/\r?\n/)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line || line.startsWith("{") || line.startsWith("}") || line.startsWith('"')) continue
    if (!line.includes("/")) continue

    const parsed = splitModelID(line)
    if (!parsed) continue

    const { metadata, nextIndex } = parseVerboseJson(lines, i + 1)
    if (metadata) i = nextIndex
    records.push({ ...parsed, metadata })
  }

  return records
}

function groupByProvider(records) {
  const map = new Map()
  for (const record of records) {
    const list = map.get(record.provider) ?? []
    list.push(record)
    map.set(record.provider, list)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function readCatalogModelIDs(catalogPath) {
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
  const opencode = raw.agents?.find((agent) => agent.kind === "opencode")
  const models = opencode?.session?.models ?? []
  return new Map(models.map((model) => [model.id, model]))
}

function printSummary(records, options) {
  console.log(`OpenCode command: ${options.opencodeBin} models${options.provider ? ` ${options.provider}` : ""}`)
  console.log(`Parsed models: ${records.length}`)
  console.log("")

  for (const [provider, models] of groupByProvider(records)) {
    const samples = models
      .slice(0, options.limit)
      .map((record) => {
        const name = record.metadata?.name
        return name && name !== record.model ? `${record.model} (${name})` : record.model
      })
      .join(", ")
    const suffix = models.length > options.limit ? `, ... +${models.length - options.limit} more` : ""
    console.log(`${provider}: ${models.length}`)
    console.log(`  ${samples}${suffix}`)
  }
}

function printCatalogComparison(records, options) {
  if (!options.compareCatalog) return
  if (!fs.existsSync(options.catalog)) {
    console.log("")
    console.log(`Catalog comparison skipped; file not found: ${options.catalog}`)
    return
  }

  const catalog = readCatalogModelIDs(options.catalog)
  const live = new Map(records.map((record) => [record.id, record]))
  const liveNotCatalog = [...live.keys()].filter((id) => !catalog.has(id)).sort()
  const catalogNotLive = [...catalog.keys()].filter((id) => !live.has(id)).sort()
  const catalogLive = [...catalog.keys()].filter((id) => live.has(id)).sort()

  console.log("")
  console.log(`Catalog comparison: ${path.relative(repoRoot, options.catalog)}`)
  console.log(`  curated OpenCode catalog models: ${catalog.size}`)
  console.log(`  live models also in catalog: ${catalogLive.length}`)
  console.log(`  live models not in catalog: ${liveNotCatalog.length}`)
  console.log(`  catalog models not currently live: ${catalogNotLive.length}`)

  if (liveNotCatalog.length) {
    console.log(`  sample live-only: ${liveNotCatalog.slice(0, options.limit).join(", ")}`)
  }
  if (catalogNotLive.length) {
    console.log(`  sample catalog-only: ${catalogNotLive.slice(0, options.limit).join(", ")}`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const output = runOpenCode(options)
  const records = parseModels(output)

  printSummary(records, options)
  printCatalogComparison(records, options)

  if (options.json) {
    console.log("")
    console.log(JSON.stringify(records, null, 2))
  }

  if (options.raw) {
    console.log("")
    console.log("Raw OpenCode output:")
    process.stdout.write(output)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
