#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const parsed = {
    target: "",
    tags: "",
    movableTags: "",
    checkOnly: false,
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
      case "--movable-tags":
        parsed.movableTags = argv[index + 1] || "";
        index += 1;
        break;
      case "--check-only":
        parsed.checkOnly = ["1", "true", "yes"].includes(String(argv[index + 1] || "false").toLowerCase());
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
  node scripts/ci-cd/create-release-tags.mjs --target <sha> --tags <csv> [--movable-tags <csv>] [--check-only <true|false>] [--dry-run <true|false>]

--movable-tags names a subset of --tags that are checkpoint markers rather
than immutable version pointers (e.g. the nightly train's release-YYYY-MM-DD
tag). If one of those already exists at a different sha, it is force-moved
to the new target instead of raising a conflict. Every other tag still fails
hard on a same-name/different-sha collision.

--check-only validates tag targets without creating, moving, or pushing
anything. Use it before a version-bump commit is pushed so a real version
collision (e.g. desktop-v0.1.50 already exists) aborts the release before
any state changes, instead of after.`);
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

// Pure validation: a tag "conflicts" when it already points somewhere other
// than the intended target. Movable tags are exempt from this check — they
// are checkpoint markers a rerun is expected to advance, not version
// pointers that must stay put once cut.
export function validateTagTargets({ tags, target, existingTargets, movableTags = [] }) {
  const movable = new Set(movableTags);
  const conflicts = [];
  for (const tag of tags) {
    const existingTarget = existingTargets[tag] || "";
    if (existingTarget && existingTarget !== target && !movable.has(tag)) {
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

// Pure planning: decide, per tag, whether to skip (already correct),
// create (doesn't exist yet), or retarget (movable tag pointing elsewhere).
// Kept side-effect free so it's unit testable without a real git repo.
export function planTagActions({ tags, target, existingTargets, movableTags = [] }) {
  const movable = new Set(movableTags);
  const actions = [];
  for (const tag of tags) {
    const existingTarget = existingTargets[tag] || "";
    if (existingTarget === target) {
      actions.push({ tag, action: "skip", from: existingTarget, to: target });
      continue;
    }
    if (existingTarget && movable.has(tag)) {
      actions.push({ tag, action: "retarget", from: existingTarget, to: target });
      continue;
    }
    // Non-movable conflicts are expected to have already been rejected by
    // validateTagTargets before planTagActions is ever called.
    actions.push({ tag, action: "create", from: "", to: target });
  }
  return actions;
}

function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(
    outputPath,
    [
      `created_tags=${result.createdTags.join(",")}`,
      `retargeted_tags=${result.retargetedTags.join(",")}`,
    ].join("\n") + "\n",
  );
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
  const movableTags = parseTags(parsed.movableTags);
  const existingTargets = {};
  for (const tag of tags) {
    existingTargets[tag] = remoteTagTarget(tag) || localTagTarget(tag);
  }
  validateTagTargets({ tags, target: parsed.target, existingTargets, movableTags });

  if (parsed.checkOnly) {
    console.log(JSON.stringify({ target: parsed.target, checked: tags, conflicts: [] }, null, 2));
    return;
  }

  const actions = planTagActions({ tags, target: parsed.target, existingTargets, movableTags });
  const createdTags = [];
  const retargetedTags = [];

  for (const action of actions) {
    if (action.action === "skip") {
      console.log(`${action.tag} already points at ${parsed.target}.`);
      continue;
    }
    if (parsed.dryRun) {
      console.log(
        action.action === "retarget"
          ? `[dry-run] would retarget ${action.tag} from ${action.from} to ${action.to}`
          : `[dry-run] would create ${action.tag} at ${action.to}`,
      );
      createdTags.push(action.tag);
      if (action.action === "retarget") {
        retargetedTags.push(action.tag);
      }
      continue;
    }
    if (action.action === "retarget") {
      git(["tag", "-f", action.tag, action.to]);
      git(["push", "--force", "origin", `refs/tags/${action.tag}`]);
      createdTags.push(action.tag);
      retargetedTags.push(action.tag);
      continue;
    }
    git(["tag", action.tag, action.to]);
    git(["push", "origin", `refs/tags/${action.tag}`]);
    createdTags.push(action.tag);
  }

  const result = { target: parsed.target, createdTags, retargetedTags };
  writeGithubOutput(result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
