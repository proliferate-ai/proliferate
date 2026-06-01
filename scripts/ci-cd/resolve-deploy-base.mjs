#!/usr/bin/env node

import fs from "node:fs";

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

function writeGithubOutput(baseSha) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(outputPath, `base_sha=${baseSha}\n`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
    const baseSha = fallbackSha(parsed);
    writeGithubOutput(baseSha);
    console.log(baseSha);
    return;
  }

  const currentRunId = process.env.GITHUB_RUN_ID || "";
  const maxPages = readPositiveIntegerEnv("DEPLOY_RUN_SCAN_MAX_PAGES", 20);
  let run;
  let exhausted = false;
  const artifactLookupFailures = [];
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
      let deployHeadSha;
      try {
        deployHeadSha = await resolveCandidateDeployHeadSha(
          candidate,
          parsed.requiredArtifact,
          token
        );
      } catch (error) {
        const details = [
          `run ${candidate.id}${candidate.html_url ? ` (${candidate.html_url})` : ""}`,
          errorMessage(error),
        ].join(": ");
        artifactLookupFailures.push(details);
        console.warn(
          `Skipping candidate because its deploy artifact could not be verified: ${details}`
        );
        continue;
      }
      if (!deployHeadSha || deployHeadSha === parsed.head) {
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

  if (!run && artifactLookupFailures.length > 0) {
    const examples = artifactLookupFailures
      .slice(0, 5)
      .map((failure) => `- ${failure}`)
      .join("\n");
    throw new Error(
      [
        `Unable to verify ${parsed.requiredArtifact} on ${artifactLookupFailures.length} candidate deploy run(s).`,
        "Failing instead of falling back to an ancestor SHA, because that could under-detect deploy surfaces.",
        "Retry the workflow or inspect GitHub Actions artifact API health.",
        examples,
      ].join("\n")
    );
  }

  const baseSha = run?.deployHeadSha || fallbackSha(parsed);
  writeGithubOutput(baseSha);
  console.log(baseSha);
}

main();
