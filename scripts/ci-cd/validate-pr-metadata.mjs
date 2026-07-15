#!/usr/bin/env node

import fs from "node:fs";

import { validatePullRequestMetadata } from "./pr-metadata.mjs";

function parseArgs(argv) {
  const parsed = {
    event: "",
    title: "",
    labelsJson: "",
    changedFilesJson: "",
    draft: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--event":
        parsed.event = argv[index + 1] || "";
        index += 1;
        break;
      case "--title":
        parsed.title = argv[index + 1] || "";
        index += 1;
        break;
      case "--labels-json":
        parsed.labelsJson = argv[index + 1] || "";
        index += 1;
        break;
      case "--changed-files-json":
        parsed.changedFilesJson = argv[index + 1] || "";
        index += 1;
        break;
      case "--draft":
        parsed.draft = true;
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

function usage() {
  console.log(`Validate a pull request title and release/area labels.

Usage:
  node scripts/ci-cd/validate-pr-metadata.mjs --event <github-event.json> [--changed-files-json <files.json>]
  node scripts/ci-cd/validate-pr-metadata.mjs --title <title> --labels-json <json> [--changed-files-json <files.json>]

--changed-files-json points at a JSON array of changed paths (strings) or
GitHub file objects ({"filename": "..."}). When provided, area labels are also
checked against the areas implied by the changed paths.
`);
}

function loadChangedFiles(parsed) {
  if (!parsed.changedFilesJson) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(parsed.changedFilesJson, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("--changed-files-json must contain a JSON array.");
  }
  return raw;
}

function loadInput(parsed) {
  const changedFiles = loadChangedFiles(parsed);
  if (parsed.event) {
    const event = JSON.parse(fs.readFileSync(parsed.event, "utf8"));
    const pr = event.pull_request;
    if (!pr) {
      throw new Error("--event must contain a pull_request payload.");
    }
    return {
      title: pr.title,
      labels: pr.labels || [],
      draft: Boolean(pr.draft),
      changedFiles,
    };
  }
  if (!parsed.title || !parsed.labelsJson) {
    throw new Error("Provide --event, or both --title and --labels-json.");
  }
  const labels = JSON.parse(parsed.labelsJson);
  if (!Array.isArray(labels)) {
    throw new Error("--labels-json must be a JSON array.");
  }
  return { title: parsed.title, labels, draft: parsed.draft, changedFiles };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    usage();
    return;
  }
  const input = loadInput(parsed);
  if (input.draft) {
    console.log("Draft PR: metadata enforcement starts when the PR is ready for review.");
    return;
  }
  const errors = validatePullRequestMetadata(input);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  console.log("PR metadata looks good.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
