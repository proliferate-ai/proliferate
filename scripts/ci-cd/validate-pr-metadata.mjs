#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { validatePullRequestMetadata } from "./pr-metadata.mjs";

const REQUIRED_BODY_HEADINGS = [
  "Summary",
  "Testing / Verification",
  "Observability",
  "Security / Privacy",
  "Documentation impact",
  "Affected consumers",
  "Delivery receipt",
];
const EVIDENCE_STATES = new Set([
  "pending",
  "not-applicable",
  "run",
  "unavailable",
]);
const HEADING = /^##\s+(.+?)\s*#*\s*$/gm;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const REPOSITORY_PATH = /(?:^|[\s`(])(?:\.github\/|apps\/|anyharness\/|cloud\/|fixtures\/|guides\/|install\/|lints\/|scripts\/|server\/|specs\/|AGENTS\.md\b|ARCHITECTURE\.md\b|CLAUDE\.md\b|CONTRIBUTING\.md\b|README\.md\b)/m;
const NO_DOCS_REASON = /\b(?:none|not[ -]applicable)\s*(?:—|--|-|:)\s*\S.{2,}/i;

function normalizedHeading(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function bodySections(body) {
  const headings = [...body.matchAll(HEADING)];
  const sections = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const name = normalizedHeading(match[1]);
    const start = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    const existing = sections.get(name) || [];
    existing.push(body.slice(start, end));
    sections.set(name, existing);
  }
  return sections;
}

function substantiveSection(value) {
  const visible = value.replace(HTML_COMMENT, "").trim();
  if (!visible || /^[-*\s]+$/.test(visible)) {
    return false;
  }
  return !/^(?:todo|tbd|placeholder|fill this in|n\/a)[.!\s-]*$/i.test(visible);
}

export function validatePullRequestBody({ body, headSha }) {
  const errors = [];
  const sections = bodySections(typeof body === "string" ? body : "");

  for (const heading of REQUIRED_BODY_HEADINGS) {
    const matches = sections.get(normalizedHeading(heading)) || [];
    if (matches.length === 0) {
      errors.push(`PR body requires exactly one \"## ${heading}\" heading.`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`PR body contains duplicate \"## ${heading}\" headings.`);
      continue;
    }
    if (!substantiveSection(matches[0])) {
      errors.push(`PR body section \"## ${heading}\" still contains only placeholder content.`);
    }
  }

  const testing = sections.get(normalizedHeading("Testing / Verification"))?.[0] || "";
  const evidenceMatch = testing
    .replace(HTML_COMMENT, "")
    .match(/^\s*Evidence state:\s*([a-z-]+)\s*$/im);
  if (!evidenceMatch || !EVIDENCE_STATES.has(evidenceMatch[1].toLowerCase())) {
    errors.push(
      "Testing / Verification must contain Evidence state: pending | not-applicable | run | unavailable.",
    );
  }

  const docsImpact = sections.get(normalizedHeading("Documentation impact"))?.[0] || "";
  const visibleDocsImpact = docsImpact.replace(HTML_COMMENT, "").trim();
  if (
    substantiveSection(docsImpact) &&
    !REPOSITORY_PATH.test(visibleDocsImpact) &&
    !NO_DOCS_REASON.test(visibleDocsImpact)
  ) {
    errors.push(
      "Documentation impact must name a repository path or use none/not-applicable plus a reason.",
    );
  }

  const receipt = sections.get(normalizedHeading("Delivery receipt"))?.[0] || "";
  const receiptHead = receipt
    .replace(HTML_COMMENT, "")
    .match(/^\s*Current head:\s*([0-9a-f]+)\s*$/im)?.[1];
  if (!headSha) {
    errors.push("Current PR head SHA is required for ready-PR receipt validation.");
  } else if (!receiptHead) {
    errors.push("Delivery receipt must contain Current head: <exact PR head SHA>.");
  } else if (receiptHead.toLowerCase() !== headSha.toLowerCase()) {
    errors.push(
      `Delivery receipt Current head (${receiptHead}) does not match the PR head (${headSha}).`,
    );
  }

  return errors;
}

export function validateReadyPullRequest(input) {
  if (input.draft) {
    return [];
  }
  return [
    ...validatePullRequestMetadata(input),
    ...validatePullRequestBody(input),
  ];
}

function parseArgs(argv) {
  const parsed = {
    event: "",
    title: "",
    labelsJson: "",
    changedFilesJson: "",
    body: "",
    bodyFile: "",
    headSha: "",
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
      case "--body":
        parsed.body = argv[index + 1] || "";
        index += 1;
        break;
      case "--body-file":
        parsed.bodyFile = argv[index + 1] || "";
        index += 1;
        break;
      case "--head-sha":
        parsed.headSha = argv[index + 1] || "";
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
  console.log(`Validate a pull request title, labels, and ready-state receipt.

Usage:
  node scripts/ci-cd/validate-pr-metadata.mjs --event <github-event.json> [--changed-files-json <files.json>] [--body-file <body.md>] [--head-sha <sha>]
  node scripts/ci-cd/validate-pr-metadata.mjs --title <title> --labels-json <json> --body <body> --head-sha <sha> [--changed-files-json <files.json>]

--changed-files-json points at a JSON array of changed paths (strings) or
GitHub file objects ({"filename": "..."}). When provided, area labels are also
checked against the areas implied by the changed paths.
Ready PRs also require the objective body/receipt shape from the pull-request
procedure. Draft PRs bypass all enforcement.
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
  const explicitBody = parsed.bodyFile
    ? fs.readFileSync(parsed.bodyFile, "utf8")
    : parsed.body;
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
      body: explicitBody || pr.body || "",
      headSha: parsed.headSha || pr.head?.sha || "",
    };
  }
  if (!parsed.title || !parsed.labelsJson) {
    throw new Error("Provide --event, or both --title and --labels-json.");
  }
  const labels = JSON.parse(parsed.labelsJson);
  if (!Array.isArray(labels)) {
    throw new Error("--labels-json must be a JSON array.");
  }
  return {
    title: parsed.title,
    labels,
    draft: parsed.draft,
    changedFiles,
    body: explicitBody,
    headSha: parsed.headSha,
  };
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
  const errors = validateReadyPullRequest(input);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  console.log("PR metadata looks good.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
