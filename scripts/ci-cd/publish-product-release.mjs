#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const RELEASE_SECTIONS = [
  {
    id: "features",
    title: "Features",
    labels: new Set(["release:large-feature", "release:minor-feature"]),
    empty: "_No feature changes._",
  },
  {
    id: "fixes",
    title: "Fixes",
    labels: new Set(["release:fix"]),
    empty: "_No fixes._",
  },
  {
    id: "performance",
    title: "Performance",
    labels: new Set(["release:performance"]),
    empty: "_No performance changes._",
  },
  {
    id: "docs",
    title: "Docs / Website",
    labels: new Set(["release:docs"]),
    empty: "_No docs changes._",
  },
  {
    id: "maintenance",
    title: "Internal / Release",
    labels: new Set(["release:maintenance"]),
    empty: "_No internal release changes._",
  },
  {
    id: "other",
    title: "Other Changes",
    labels: new Set(),
    empty: "_No other changes._",
  },
];

function parseArgs(argv) {
  const parsed = {
    kind: "",
    releaseTag: "",
    productTag: "",
    releaseId: "",
    base: "",
    head: "",
    surfaces: "",
    artifactTags: "",
    reason: "",
    workflowUrl: "",
    repository: process.env.GITHUB_REPOSITORY || "",
    bodyOut: "",
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--kind":
        parsed.kind = argv[index + 1] || "";
        index += 1;
        break;
      case "--release-tag":
        parsed.releaseTag = argv[index + 1] || "";
        index += 1;
        break;
      case "--product-tag":
        parsed.productTag = argv[index + 1] || "";
        index += 1;
        break;
      case "--release-id":
        parsed.releaseId = argv[index + 1] || "";
        index += 1;
        break;
      case "--base":
        parsed.base = argv[index + 1] || "";
        index += 1;
        break;
      case "--head":
        parsed.head = argv[index + 1] || "";
        index += 1;
        break;
      case "--surfaces":
        parsed.surfaces = argv[index + 1] || "";
        index += 1;
        break;
      case "--artifact-tags":
        parsed.artifactTags = argv[index + 1] || "";
        index += 1;
        break;
      case "--reason":
        parsed.reason = argv[index + 1] || "";
        index += 1;
        break;
      case "--workflow-url":
        parsed.workflowUrl = argv[index + 1] || "";
        index += 1;
        break;
      case "--repository":
        parsed.repository = argv[index + 1] || "";
        index += 1;
        break;
      case "--body-out":
        parsed.bodyOut = argv[index + 1] || "";
        index += 1;
        break;
      case "--dry-run":
        parsed.dryRun = parseBoolean(argv[index + 1] || "false");
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
  console.log(`Publish or preview a raw product GitHub Release.

Usage:
  node scripts/ci-cd/publish-product-release.mjs --kind <nightly|hotfix> --release-tag <tag> --release-id <id> --base <sha> --head <sha> --surfaces <csv> --artifact-tags <csv> --workflow-url <url> --dry-run <true|false>
`);
}

function parseBoolean(value) {
  return ["1", "true", "yes"].includes(String(value).toLowerCase());
}

function parseCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortSha(value) {
  return value ? value.slice(0, 7) : "";
}

function markdownLink(label, url) {
  return url ? `[${label}](${url})` : label;
}

function escapeTable(value) {
  return String(value || "")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|");
}

function sanitizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tagUrl(repository, tag) {
  return `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`;
}

function commitUrl(repository, sha) {
  return `https://github.com/${repository}/commit/${encodeURIComponent(sha)}`;
}

function compareUrl(repository, base, head) {
  return `https://github.com/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

function productVersion(productTag) {
  return productTag?.startsWith("proliferate-v") ? productTag.slice("proliferate-v".length) : "";
}

function releaseDate(releaseId) {
  const match = /(?:release|hotfix)-(\d{4}-\d{2}-\d{2})/.exec(releaseId || "");
  if (!match) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${match[1]}T00:00:00Z`));
}

export function releaseTitle({ releaseTag, productTag, releaseId }) {
  const version = productVersion(productTag || releaseTag);
  if (version) {
    return `Proliferate v${version}`;
  }
  return `Proliferate Hotfix ${releaseId || releaseTag}`;
}

function releaseIntro({ kind, releaseId }) {
  const date = releaseDate(releaseId);
  if (kind === "hotfix") {
    return date ? `Production hotfix for ${date}.` : "Production hotfix.";
  }
  return date ? `Daily release train for ${date}.` : "Daily release train.";
}

function normalizeLabels(labels) {
  return labels.map((label) => (typeof label === "string" ? label : label?.name || "")).filter(Boolean);
}

function normalizePullRequest(pr) {
  return {
    number: pr.number,
    title: sanitizeLine(pr.title),
    url: pr.html_url || pr.url || "",
    author: pr.user?.login || pr.author || "",
    labels: normalizeLabels(pr.labels || []),
  };
}

function normalizeCommit(commit, repository) {
  const sha = commit.sha || "";
  const message = commit.commit?.message || commit.message || "";
  return {
    sha,
    title: sanitizeLine(message.split("\n")[0] || sha),
    url: commit.html_url || (sha ? commitUrl(repository, sha) : ""),
    author: commit.author?.login || commit.commit?.author?.name || commit.author || "",
  };
}

export function releaseSectionId(labels) {
  const labelSet = new Set(labels);
  if (labelSet.has("release:skip")) {
    return "";
  }
  for (const section of RELEASE_SECTIONS) {
    if (section.id === "other") {
      continue;
    }
    if ([...section.labels].some((label) => labelSet.has(label))) {
      return section.id;
    }
  }
  return "other";
}

function areaSuffix(labels) {
  const areas = labels.filter((label) => label.startsWith("area:"));
  return areas.length > 0 ? ` (${areas.join(", ")})` : "";
}

function formatPullRequestItem(pr) {
  const author = pr.author ? ` by @${pr.author}` : "";
  return `- ${markdownLink(`#${pr.number}`, pr.url)} ${pr.title}${author}${areaSuffix(pr.labels)}`;
}

function formatCommitItem(commit, repository) {
  return `- ${markdownLink(shortSha(commit.sha), commit.url || commitUrl(repository, commit.sha))} ${commit.title}`;
}

function groupPullRequests(pullRequests) {
  const groups = Object.fromEntries(RELEASE_SECTIONS.map((section) => [section.id, []]));
  for (const pr of pullRequests) {
    const sectionId = releaseSectionId(pr.labels);
    if (!sectionId) {
      continue;
    }
    groups[sectionId].push(pr);
  }
  return groups;
}

function highlightItems(groups) {
  const featureHighlights = groups.features.slice(0, 6);
  if (featureHighlights.length > 0) {
    return featureHighlights;
  }
  return [...groups.fixes, ...groups.performance, ...groups.docs].slice(0, 3);
}

function artifactRows(repository, artifactTags) {
  const rows = [];
  for (const tag of artifactTags) {
    let lane = "";
    if (tag.startsWith("desktop-v")) lane = "Desktop";
    if (tag.startsWith("runtime-v")) lane = "Runtime";
    if (tag.startsWith("server-v")) lane = "Server";
    if (!lane) {
      continue;
    }
    rows.push(`| ${lane} | ${markdownLink(tag, tagUrl(repository, tag))} |`);
  }
  return rows;
}

export function buildReleaseContextFromApiPayload({ compare, pullsByCommit = {}, repository }) {
  const commits = (compare.commits || []).map((commit) => normalizeCommit(commit, repository));
  const prByNumber = new Map();
  for (const commit of commits) {
    for (const rawPr of pullsByCommit[commit.sha] || []) {
      const pr = normalizePullRequest(rawPr);
      if (pr.number) {
        prByNumber.set(pr.number, pr);
      }
    }
  }
  return {
    commits,
    pullRequests: [...prByNumber.values()].sort((left, right) => left.number - right.number),
  };
}

export function buildReleaseBody({
  kind,
  releaseTag,
  productTag = "",
  releaseId,
  base,
  head,
  surfaces = [],
  artifactTags = [],
  reason = "",
  workflowUrl = "",
  repository,
  pullRequests = [],
  commits = [],
}) {
  const title = releaseTitle({ releaseTag, productTag, releaseId });
  const groups = groupPullRequests(pullRequests);
  const highlights = highlightItems(groups);
  const body = [
    `## ${title}`,
    "",
    releaseIntro({ kind, releaseId }),
    "",
  ];

  if (kind === "hotfix" && reason) {
    body.push(`Reason: ${reason}`, "");
  }

  body.push("### Release Metadata", "");
  body.push("| Field | Value |");
  body.push("| --- | --- |");
  body.push(`| Version | ${escapeTable(productTag ? markdownLink(productTag, tagUrl(repository, productTag)) : "unchanged")} |`);
  body.push(`| ${kind === "hotfix" ? "Hotfix" : "Train"} | ${escapeTable(releaseId)} |`);
  body.push(`| Base | ${escapeTable(markdownLink(shortSha(base), commitUrl(repository, base)))} |`);
  body.push(`| Head | ${escapeTable(markdownLink(shortSha(head), commitUrl(repository, head)))} |`);
  body.push(`| Compare | ${escapeTable(markdownLink(`${shortSha(base)}...${shortSha(head)}`, compareUrl(repository, base, head)))} |`);
  body.push(`| Surfaces | ${escapeTable(surfaces.length > 0 ? surfaces.join(", ") : "none")} |`);
  body.push(`| Workflow | ${escapeTable(workflowUrl ? markdownLink("Actions run", workflowUrl) : "n/a")} |`);
  body.push("");

  body.push("### Highlights", "");
  if (highlights.length === 0) {
    body.push("_No highlights._", "");
  } else {
    body.push(...highlights.map(formatPullRequestItem), "");
  }

  for (const section of RELEASE_SECTIONS) {
    body.push(`### ${section.title}`, "");
    const items = groups[section.id];
    if (items.length > 0) {
      body.push(...items.map(formatPullRequestItem), "");
      continue;
    }
    if (section.id === "other" && pullRequests.length === 0 && commits.length > 0) {
      body.push(...commits.slice(0, 20).map((commit) => formatCommitItem(commit, repository)), "");
      continue;
    }
    body.push(section.empty, "");
  }

  body.push("### Artifacts", "");
  const rows = artifactRows(repository, artifactTags);
  if (rows.length === 0) {
    body.push("_No artifact tags for this release._", "");
  } else {
    body.push("| Lane | Tag |");
    body.push("| --- | --- |");
    body.push(...rows);
    body.push("");
  }

  body.push("### Raw Commits", "");
  body.push("<details>");
  body.push("<summary>View commits</summary>");
  body.push("");
  if (commits.length === 0) {
    body.push("_No raw commits found._");
  } else {
    body.push(...commits.map((commit) => formatCommitItem(commit, repository)));
  }
  body.push("");
  body.push("</details>");
  body.push("");

  return body.join("\n");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function localGitCommits({ base, head, repository }) {
  if (!base || !head || base === head) {
    return [];
  }
  try {
    return git(["log", "--reverse", "--format=%H%x00%s", `${base}..${head}`])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, title] = line.split("\0");
        return {
          sha,
          title: sanitizeLine(title || sha),
          url: commitUrl(repository, sha),
          author: "",
        };
      });
  } catch {
    return [];
  }
}

async function githubRequest({ repository, path, method = "GET", token, body }) {
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || `GitHub API request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function fetchReleaseContext({ repository, base, head, token }) {
  if (!token) {
    return {
      commits: localGitCommits({ base, head, repository }),
      pullRequests: [],
    };
  }

  const compare = await githubRequest({
    repository,
    path: `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token,
  });
  const commits = (compare.commits || []).slice(0, 250);
  const pullsByCommit = {};
  for (const commit of commits) {
    pullsByCommit[commit.sha] = await githubRequest({
      repository,
      path: `/commits/${encodeURIComponent(commit.sha)}/pulls`,
      token,
    });
  }
  return buildReleaseContextFromApiPayload({
    compare: { commits },
    pullsByCommit,
    repository,
  });
}

async function existingRelease({ repository, tag, token }) {
  try {
    return await githubRequest({
      repository,
      path: `/releases/tags/${encodeURIComponent(tag)}`,
      token,
    });
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function upsertRelease({ repository, tag, name, body, target, token, dryRun }) {
  if (dryRun) {
    return {
      action: "dry-run",
      releaseUrl: tagUrl(repository, tag),
    };
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to create or update GitHub Releases.");
  }

  const payload = {
    tag_name: tag,
    target_commitish: target,
    name,
    body,
    draft: false,
    prerelease: false,
    make_latest: "false",
  };
  const current = await existingRelease({ repository, tag, token });
  if (current) {
    const updated = await githubRequest({
      repository,
      path: `/releases/${current.id}`,
      method: "PATCH",
      token,
      body: payload,
    });
    return {
      action: "updated",
      releaseUrl: updated.html_url,
    };
  }

  const created = await githubRequest({
    repository,
    path: "/releases",
    method: "POST",
    token,
    body: payload,
  });
  return {
    action: "created",
    releaseUrl: created.html_url,
  };
}

function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(
    outputPath,
    [
      `release_action=${result.action}`,
      `release_url=${result.releaseUrl}`,
      `release_tag=${result.releaseTag}`,
    ].join("\n") + "\n",
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage();
    return;
  }
  if (!["nightly", "hotfix"].includes(parsed.kind)) {
    throw new Error("--kind must be nightly or hotfix.");
  }
  if (!parsed.releaseTag) {
    throw new Error("--release-tag is required.");
  }
  if (!parsed.releaseId) {
    throw new Error("--release-id is required.");
  }
  if (!parsed.base || !parsed.head) {
    throw new Error("--base and --head are required.");
  }
  if (!parsed.repository) {
    throw new Error("--repository or GITHUB_REPOSITORY is required.");
  }

  const context = await fetchReleaseContext({
    repository: parsed.repository,
    base: parsed.base,
    head: parsed.head,
    token: process.env.GITHUB_TOKEN || "",
  });
  const name = releaseTitle({
    releaseTag: parsed.releaseTag,
    productTag: parsed.productTag,
    releaseId: parsed.releaseId,
  });
  const body = buildReleaseBody({
    kind: parsed.kind,
    releaseTag: parsed.releaseTag,
    productTag: parsed.productTag,
    releaseId: parsed.releaseId,
    base: parsed.base,
    head: parsed.head,
    surfaces: parseCsv(parsed.surfaces),
    artifactTags: parseCsv(parsed.artifactTags),
    reason: parsed.reason,
    workflowUrl: parsed.workflowUrl,
    repository: parsed.repository,
    pullRequests: context.pullRequests,
    commits: context.commits,
  });

  if (parsed.bodyOut) {
    fs.writeFileSync(parsed.bodyOut, body);
  }

  const publish = await upsertRelease({
    repository: parsed.repository,
    tag: parsed.releaseTag,
    name,
    body,
    target: parsed.head,
    token: process.env.GITHUB_TOKEN || "",
    dryRun: parsed.dryRun,
  });
  const result = {
    ...publish,
    releaseTag: parsed.releaseTag,
    name,
    pullRequestCount: context.pullRequests.length,
    commitCount: context.commits.length,
  };
  writeGithubOutput(result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
