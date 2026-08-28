#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  listSuccessfulWorkflowRuns,
  readPositiveIntegerEnv,
  readRunArtifactSummary,
} from "./github-deploy-artifacts.mjs";

function printUsage() {
  console.log(`Resolve the previous successful deploy SHA for an environment.

Usage:
  node scripts/ci-cd/resolve-deploy-base.mjs --workflow <workflow-file> --branch <branch> --head <sha> [--fallback <sha>] [--required-artifact <name>]

The script queries GitHub Actions for the latest successful run of the provided
workflow on the given branch, excluding the current run and current head SHA.
When --required-artifact is set, candidate runs must have that non-expired
artifact. Deploy workflows use this to exclude plan-only dry-runs.
It prints the resolved base SHA and writes base_sha to GITHUB_OUTPUT when set.
`);
}

function parseArgs(argv) {
  const parsed = {
    workflow: "",
    branch: "main",
    head: "",
    fallback: "",
    requiredArtifact: "",
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
      case "--fallback":
        parsed.fallback = argv[index + 1] || "";
        index += 1;
        break;
      case "--required-artifact":
        parsed.requiredArtifact = argv[index + 1] || "";
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

function fallbackSha(parsed) {
  return parsed.fallback || parsed.head;
}

// The resolution contract: a real prior deploy yields `resolved`; every other
// path (no token, no candidate run, no live artifact) is a `fallback` and the
// caller must treat the base as unreliable — deploy-staging.yml forces the full
// surface set on fallback so a long-idle environment cannot head^-diff to a
// near-no-op.
export function resolutionOutputs(deployHeadSha, parsed) {
  if (deployHeadSha) {
    return { baseSha: deployHeadSha, baseMode: "resolved" };
  }
  return { baseSha: fallbackSha(parsed), baseMode: "fallback" };
}

function writeGithubOutput(baseSha, baseMode, alreadyDeployed) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(
    outputPath,
    `base_sha=${baseSha}\nbase_mode=${baseMode}\nalready_deployed=${alreadyDeployed}\n`
  );
}

async function resolveCandidateDeployHeadSha(candidate, artifactName, token) {
  if (!artifactName) {
    return candidate.head_sha || "";
  }

  const summary = await readRunArtifactSummary(candidate.id, artifactName, token);
  return summary?.headSha || "";
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

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    const { baseSha, baseMode } = resolutionOutputs("", parsed);
    writeGithubOutput(baseSha, baseMode, false);
    console.error(`base_mode=${baseMode} (no token)`);
    console.log(baseSha);
    return;
  }

  const currentRunId = process.env.GITHUB_RUN_ID || "";
  const maxPages = readPositiveIntegerEnv("DEPLOY_RUN_SCAN_MAX_PAGES", 20);
  let run;
  let exhausted = false;
  // Candidates arrive newest-first, so a head-matching artifact seen before
  // the base is found means the NEWEST deployed head already equals --head:
  // the caller's auto path uses this to refuse re-deploying an identical
  // delta when both rollups' events resolve the same deploy head.
  let alreadyDeployed = false;
  for (let page = 1; page <= maxPages && !run; page += 1) {
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
      if (
        String(candidate.id) === currentRunId ||
        candidate.conclusion !== "success" ||
        !candidate.head_sha
      ) {
        continue;
      }
      const deployHeadSha = await resolveCandidateDeployHeadSha(
        candidate,
        parsed.requiredArtifact,
        token
      );
      if (deployHeadSha === parsed.head) {
        alreadyDeployed = true;
        continue;
      }
      if (!deployHeadSha) {
        continue;
      }
      run = { ...candidate, deployHeadSha };
      break;
    }
  }

  if (!run && !exhausted) {
    throw new Error(
      `Deploy base scan reached DEPLOY_RUN_SCAN_MAX_PAGES=${maxPages} without finding a base.`
    );
  }

  const { baseSha, baseMode } = resolutionOutputs(run?.deployHeadSha || "", parsed);
  writeGithubOutput(baseSha, baseMode, alreadyDeployed);
  console.error(`base_mode=${baseMode} already_deployed=${alreadyDeployed}`);
  console.log(baseSha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
