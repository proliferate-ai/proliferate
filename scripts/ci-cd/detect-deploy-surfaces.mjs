#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SURFACES = [
  "server",
  "workers",
  "litellm",
  "e2b",
  "web",
  "mobile",
  "desktop",
  "runtime",
];

function printUsage() {
  console.log(`Detect deployable surfaces touched by a git diff.

Usage:
  node scripts/ci-cd/detect-deploy-surfaces.mjs --base <sha> --head <sha> [--force <surface[,surface]|all>] [--only <surface[,surface]|all>]

Outputs JSON to stdout. When GITHUB_OUTPUT is set, also writes boolean outputs
for each deploy surface plus base_sha, head_sha, and changed_files_count.
`);
}

export function parseArgs(argv) {
  const parsed = {
    base: "",
    head: "HEAD",
    force: "",
    only: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--base":
        parsed.base = argv[index + 1] || "";
        index += 1;
        break;
      case "--head":
        parsed.head = argv[index + 1] || "";
        index += 1;
        break;
      case "--force":
        parsed.force = argv[index + 1] || "";
        index += 1;
        break;
      case "--only":
        parsed.only = argv[index + 1] || "";
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveCommit(ref, fallback = "") {
  const target = ref || fallback;
  if (!target) {
    return "";
  }
  try {
    return git(["rev-parse", target]);
  } catch {
    return "";
  }
}

function firstCommit() {
  return git(["rev-list", "--max-parents=0", "HEAD"]).split("\n").at(-1) || "";
}

function changedFiles(base, head) {
  if (!base || base === head) {
    return [];
  }
  return git(["diff", "--name-only", `${base}..${head}`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function matches(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function classifyFile(path) {
  const touched = new Set();

  const workflowDeployPath =
    path.startsWith(".github/workflows/deploy-") ||
    path.startsWith(".github/workflows/promote-") ||
    path.startsWith(".github/workflows/_deploy-") ||
    path.startsWith("scripts/ci-cd/");

  if (workflowDeployPath) {
    for (const surface of SURFACES) {
      touched.add(surface);
    }
    return touched;
  }

  if (
    matches(path, ["server", "catalogs"]) ||
    path === ".dockerignore" ||
    path === ".github/workflows/server-ci.yml" ||
    path === "scripts/validate-agent-catalog.mjs"
  ) {
    touched.add("server");
  }

  if (
    matches(path, [
      "server/proliferate/background",
      "server/proliferate/server/automations/worker",
      "anyharness/crates/proliferate-worker",
    ])
  ) {
    touched.add("workers");
  }

  if (matches(path, ["server/litellm"])) {
    touched.add("litellm");
  }

  if (
    matches(path, [
      "anyharness/crates/anyharness",
      "anyharness/crates/anyharness-contract",
      "anyharness/crates/anyharness-credential-discovery",
      "anyharness/crates/anyharness-lib",
      "anyharness/crates/proliferate-supervisor",
      "anyharness/crates/proliferate-worker",
      "catalogs",
    ]) ||
    [
      "Cargo.lock",
      "Cargo.toml",
      ".github/workflows/release-cloud-template.yml",
      ".github/workflows/promote-cloud-template.yml",
      "install/proliferate-git-credential-helper",
      "scripts/build-template.mjs",
      "scripts/smoke-cloud-template.mjs",
      "scripts/promote-cloud-template.mjs",
    ].includes(path)
  ) {
    touched.add("e2b");
    touched.add("runtime");
  }

  if (
    matches(path, ["apps/web", "apps/packages", "anyharness/sdk", "anyharness/sdk-react"]) ||
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vercel.json", ".vercelignore"].includes(path)
  ) {
    touched.add("web");
  }

  if (
    matches(path, ["apps/mobile", "apps/packages"]) ||
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(path)
  ) {
    touched.add("mobile");
  }

  if (
    matches(path, [
      "apps/desktop",
      "apps/packages",
      "anyharness",
    ]) ||
    [
      "Cargo.lock",
      "Cargo.toml",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".github/workflows/release-desktop.yml",
      "scripts/build-agent-seed.mjs",
      "scripts/generate-desktop-installer-manifest.mjs",
      "scripts/generate-updater-manifest.mjs",
    ].includes(path)
  ) {
    touched.add("desktop");
  }

  if (
    matches(path, ["anyharness"]) ||
    ["Cargo.lock", "Cargo.toml", ".github/workflows/release-runtime.yml"].includes(path)
  ) {
    touched.add("runtime");
  }

  return touched;
}

export function parseSurfaceList(value, optionName) {
  const normalized = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return new Set();
  }
  if (normalized.includes("all")) {
    if (normalized.length > 1) {
      throw new Error(`${optionName}=all cannot be combined with other surfaces.`);
    }
    return new Set(SURFACES);
  }
  const unknown = normalized.filter((surface) => !SURFACES.includes(surface));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${optionName} deploy surface(s): ${unknown.join(", ")}`);
  }
  return new Set(normalized);
}

function surfacesFromFiles(files) {
  const touched = new Set();
  for (const file of files) {
    for (const surface of classifyFile(file)) {
      touched.add(surface);
    }
  }
  return touched;
}

export function selectSurfaces({ files, force = "", only = "" }) {
  const detected = surfacesFromFiles(files);
  const forced = parseSurfaceList(force, "forced");
  const onlySurfaces = parseSurfaceList(only, "only");
  const selectionMode = onlySurfaces.size > 0 ? "only" : "detected";

  const selected =
    selectionMode === "only"
      ? new Set(onlySurfaces)
      : new Set([...detected, ...forced]);

  return {
    selected,
    detected,
    forced,
    only: onlySurfaces,
    selectionMode,
  };
}

function surfaceList(set) {
  return [...set].sort((left, right) => SURFACES.indexOf(left) - SURFACES.indexOf(right));
}

function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const lines = [
    `base_sha=${result.baseSha}`,
    `head_sha=${result.headSha}`,
    `changed_files_count=${result.changedFiles.length}`,
    `selection_mode=${result.selectionMode}`,
    `detected_surfaces=${result.detectedSurfaces.join(",")}`,
    `forced_surfaces=${result.forcedSurfaces.join(",")}`,
    `only_surfaces=${result.onlySurfaces.join(",")}`,
    `selected_surfaces=${result.selectedSurfaces.join(",")}`,
  ];
  for (const surface of SURFACES) {
    lines.push(`${surface}=${result.surfaces[surface] ? "true" : "false"}`);
  }
  lines.push(`summary_json=${JSON.stringify(result)}`);
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

export function buildResult({ baseSha, headSha, files, force, only }) {
  const selection = selectSurfaces({ files, force, only });
  const selectedSurfaces = surfaceList(selection.selected);
  return {
    baseSha,
    headSha,
    changedFiles: files,
    selectionMode: selection.selectionMode,
    detectedSurfaces: surfaceList(selection.detected),
    forcedSurfaces: surfaceList(selection.forced),
    onlySurfaces: surfaceList(selection.only),
    selectedSurfaces,
    surfaces: Object.fromEntries(SURFACES.map((surface) => [surface, selection.selected.has(surface)])),
  };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const headSha = resolveCommit(parsed.head, "HEAD");
  if (!headSha) {
    throw new Error(`Could not resolve head ref: ${parsed.head || "HEAD"}`);
  }
  const baseSha = resolveCommit(parsed.base) || firstCommit();
  const files = changedFiles(baseSha, headSha);
  const result = buildResult({
    baseSha,
    headSha,
    files,
    force: parsed.force,
    only: parsed.only,
  });

  writeGithubOutput(result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
