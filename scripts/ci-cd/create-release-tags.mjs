#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const parsed = {
    target: "",
    tags: "",
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--target":
        parsed.target = argv[index + 1] || "";
        index += 1;
        break;
      case "--tags":
        parsed.tags = argv[index + 1] || "";
        index += 1;
        break;
      case "--dry-run":
        parsed.dryRun = ["1", "true", "yes"].includes(String(argv[index + 1] || "false").toLowerCase());
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

function printUsage() {
  console.log(`Create release tags at a target commit.

Usage:
  node scripts/ci-cd/create-release-tags.mjs --target <sha> --tags <csv> --dry-run <true|false>
`);
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeRemoteTagOutput(output) {
  const rows = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/);
      return { sha, ref };
    });
  return rows.find((row) => row.ref.endsWith("^{}"))?.sha || rows[0]?.sha || "";
}

function remoteTagTarget(tag) {
  try {
    return normalizeRemoteTagOutput(
      git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]),
    );
  } catch {
    return "";
  }
}

function localTagTarget(tag) {
  try {
    return git(["rev-parse", "--verify", `${tag}^{}`]);
  } catch {
    return "";
  }
}

export function validateTagTargets({ tags, target, existingTargets }) {
  const conflicts = [];
  for (const tag of tags) {
    const existingTarget = existingTargets[tag] || "";
    if (existingTarget && existingTarget !== target) {
      conflicts.push({ tag, existingTarget, target });
    }
  }
  if (conflicts.length > 0) {
    const details = conflicts
      .map((conflict) => `${conflict.tag} exists at ${conflict.existingTarget}, not ${conflict.target}`)
      .join("; ");
    throw new Error(details);
  }
}

function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(outputPath, `created_tags=${result.createdTags.join(",")}\n`);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage();
    return;
  }
  if (!parsed.target) {
    throw new Error("--target is required.");
  }

  const tags = parseTags(parsed.tags);
  const existingTargets = {};
  for (const tag of tags) {
    existingTargets[tag] = remoteTagTarget(tag) || localTagTarget(tag);
  }
  validateTagTargets({ tags, target: parsed.target, existingTargets });

  const createdTags = [];
  for (const tag of tags) {
    if (existingTargets[tag]) {
      console.log(`${tag} already points at ${parsed.target}.`);
      continue;
    }
    if (parsed.dryRun) {
      console.log(`[dry-run] would create ${tag} at ${parsed.target}`);
      createdTags.push(tag);
      continue;
    }
    git(["tag", tag, parsed.target]);
    git(["push", "origin", `refs/tags/${tag}`]);
    createdTags.push(tag);
  }

  const result = { target: parsed.target, createdTags };
  writeGithubOutput(result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
