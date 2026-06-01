#!/usr/bin/env node

import fs from "node:fs";

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

async function githubJson(path, token) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required.");
  }
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function runHasRequiredArtifact(runId, artifactName, token) {
  if (!artifactName) {
    return true;
  }
  const data = await githubJson(
    `/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`,
    token
  );
  return (data.artifacts || []).some((artifact) => {
    return artifact.name === artifactName && artifact.expired !== true;
  });
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

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    const baseSha = fallbackSha(parsed);
    writeGithubOutput(baseSha);
    console.log(baseSha);
    return;
  }

  const currentRunId = process.env.GITHUB_RUN_ID || "";
  try {
    let run;
    for (let page = 1; page <= 5 && !run; page += 1) {
      const params = new URLSearchParams({
        branch: parsed.branch,
        status: "success",
        per_page: "50",
        page: String(page),
      });
      const data = await githubJson(
        `/actions/workflows/${encodeURIComponent(parsed.workflow)}/runs?${params.toString()}`,
        token
      );
      const candidates = data.workflow_runs || [];
      if (candidates.length === 0) {
        break;
      }
      for (const candidate of candidates) {
        if (
          String(candidate.id) === currentRunId ||
          candidate.conclusion !== "success" ||
          !candidate.head_sha ||
          candidate.head_sha === parsed.head
        ) {
          continue;
        }
        if (!(await runHasRequiredArtifact(candidate.id, parsed.requiredArtifact, token))) {
          continue;
        }
        run = candidate;
        break;
      }
    }
    const baseSha = run?.head_sha || fallbackSha(parsed);
    writeGithubOutput(baseSha);
    console.log(baseSha);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    const baseSha = fallbackSha(parsed);
    writeGithubOutput(baseSha);
    console.log(baseSha);
  }
}

main();
