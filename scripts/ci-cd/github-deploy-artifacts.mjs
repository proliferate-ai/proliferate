import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readPositiveIntegerEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function githubJson(apiPath, token) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required.");
  }
  const response = await fetch(`https://api.github.com/repos/${repository}${apiPath}`, {
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

export async function listSuccessfulWorkflowRuns({ workflow, branch, page, token }) {
  const params = new URLSearchParams({
    branch,
    status: "success",
    per_page: "50",
    page: String(page),
  });
  return githubJson(`/actions/workflows/${encodeURIComponent(workflow)}/runs?${params}`, token);
}

export async function runHasArtifact(runId, artifactName, token) {
  const maxPages = readPositiveIntegerEnv("DEPLOY_ARTIFACT_SCAN_MAX_PAGES", 10);
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await githubJson(
      `/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100&page=${page}`,
      token
    );
    const artifacts = data.artifacts || [];
    if (
      artifacts.some((artifact) => {
        return artifact.name === artifactName && artifact.expired !== true;
      })
    ) {
      return true;
    }
    if (artifacts.length === 0) {
      return false;
    }
  }
  throw new Error(
    `Artifact scan reached DEPLOY_ARTIFACT_SCAN_MAX_PAGES without finding ${artifactName}.`
  );
}

function collectJsonFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

export function downloadArtifactSummary(runId, artifactName, token) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required.");
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-artifact-"));
  try {
    execFileSync(
      "gh",
      ["run", "download", String(runId), "--repo", repository, "--name", artifactName, "--dir", directory],
      {
        env: {
          ...process.env,
          GH_TOKEN: token,
          GITHUB_TOKEN: token,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    for (const file of collectJsonFiles(directory)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && typeof parsed.headSha === "string") {
        return parsed;
      }
    }
    return null;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function readRunArtifactSummary(runId, artifactName, token) {
  if (!(await runHasArtifact(runId, artifactName, token))) {
    return null;
  }
  return downloadArtifactSummary(runId, artifactName, token);
}
