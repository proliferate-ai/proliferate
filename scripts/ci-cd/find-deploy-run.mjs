#!/usr/bin/env node

import fs from "node:fs";

import {
  listSuccessfulWorkflowRuns,
  readPositiveIntegerEnv,
  readRunArtifactSummary,
} from "./github-deploy-artifacts.mjs";

function printUsage() {
  console.log(`Find a successful deploy run by summary artifact head SHA.

Usage:
  node scripts/ci-cd/find-deploy-run.mjs --workflow <workflow-file> --branch <branch> --head <sha> --artifact <name>

The script scans recent successful workflow runs, downloads the named deploy
summary artifact, and succeeds only when the artifact JSON headSha matches the
requested SHA. This avoids relying on workflow_run metadata, which can point at
the branch tip rather than the commit that the deploy job checked out.
`);
}

function parseArgs(argv) {
  const parsed = {
    workflow: "",
    branch: "main",
    head: "",
    artifact: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--workflow":
        parsed.workflow = argv[index + 1] || "";
        index += 1;
        break;
      case "--branch":
        parsed.branch = argv[index + 1] || "";
        index += 1;
        break;
      case "--head":
        parsed.head = argv[index + 1] || "";
        index += 1;
        break;
      case "--artifact":
        parsed.artifact = argv[index + 1] || "";
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

function writeGithubOutputs(run, summary) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(
    outputPath,
    [`run_id=${run.id}`, `run_url=${run.html_url}`, `artifact_head_sha=${summary.headSha}`].join("\n") +
      "\n"
  );
}

async function main() {
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
  if (!parsed.workflow) {
    throw new Error("--workflow is required.");
  }
  if (!parsed.head) {
    throw new Error("--head is required.");
  }
  if (!parsed.artifact) {
    throw new Error("--artifact is required.");
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required.");
  }

  const maxPages = readPositiveIntegerEnv("DEPLOY_RUN_SCAN_MAX_PAGES", 20);
  let exhausted = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await listSuccessfulWorkflowRuns({
      workflow: parsed.workflow,
      branch: parsed.branch,
      page,
      token,
    });
    const candidates = data.workflow_runs || [];
    if (candidates.length === 0) {
      exhausted = true;
      break;
    }
    for (const candidate of candidates) {
      const summary = await readRunArtifactSummary(candidate.id, parsed.artifact, token);
      if (summary?.headSha !== parsed.head) {
        continue;
      }
      writeGithubOutputs(candidate, summary);
      console.log(candidate.html_url);
      return;
    }
  }

  const scope = exhausted
    ? "in the complete successful-run history"
    : `within DEPLOY_RUN_SCAN_MAX_PAGES=${maxPages}`;
  console.error(`No successful deploy run with ${parsed.artifact} for ${parsed.head} was found ${scope}.`);
  process.exit(1);
}

main();
