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
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const NO_IMPACT_REASON = /\b(?:none|not[ -]applicable)\s*(?:—|--|-|:)\s*\S.{2,}/i;
const NO_IMPACT_STATE = /^\s*(?:[-*+]\s*)?(?:none|not[ -]applicable)\b/i;
const PLACEHOLDER_SENTINEL = /^\s*(?:[-*+>]\s*)?(?:\[[ xX]\]\s*)?(?:\[?(?:todo|tbd|placeholder)\]?|fill[\s_-]*this[\s_-]*in|n\/a)\b/i;

function normalizedHeading(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function blankExceptNewlines(value) {
  return value.replace(/[^\r\n]/g, " ");
}

function visibleMarkdown(value) {
  const withoutComments = value.replace(HTML_COMMENT, blankExceptNewlines);
  let result = "";
  let offset = 0;
  let fenceCharacter = "";
  let fenceLength = 0;

  while (offset < withoutComments.length) {
    const newline = withoutComments.indexOf("\n", offset);
    const end = newline === -1 ? withoutComments.length : newline + 1;
    const line = withoutComments.slice(offset, end);
    const marker = line.match(FENCE)?.[1] || "";

    if (!fenceCharacter && marker) {
      fenceCharacter = marker[0];
      fenceLength = marker.length;
      result += blankExceptNewlines(line);
    } else if (
      fenceCharacter &&
      marker[0] === fenceCharacter &&
      marker.length >= fenceLength
    ) {
      fenceCharacter = "";
      fenceLength = 0;
      result += blankExceptNewlines(line);
    } else if (fenceCharacter) {
      result += blankExceptNewlines(line);
    } else {
      result += line;
    }
    offset = end;
  }

  return result;
}

function bodySections(body) {
  const headings = [...visibleMarkdown(body).matchAll(HEADING)];
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
  const visible = visibleMarkdown(value).trim();
  if (!visible || /^[-*\s]+$/.test(visible)) {
    return false;
  }
  return !visible.split(/\r?\n/).some((line) => PLACEHOLDER_SENTINEL.test(line));
}

function hasUnreasonedNoImpactState(value) {
  return visibleMarkdown(value)
    .split(/\r?\n/)
    .some(
      (line) => NO_IMPACT_STATE.test(line) && !NO_IMPACT_REASON.test(line),
    );
}

function isSafeRepositoryPath(rawValue) {
  let value = rawValue
    .trim()
    .replace(/^[`'"(<\[]+/, "")
    .replace(/[`'">)\],;:!?]+$/, "")
    .replace(/\.$/, "");
  value = value.split("#", 1)[0];

  if (
    !value ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes("\\") ||
    value.includes("://") ||
    value.includes("?") ||
    value.includes("%")
  ) {
    return false;
  }

  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._@+-]+$/.test(segment),
    )
  ) {
    return false;
  }

  return path.includes("/") || /\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(path);
}

function hasSafeRepositoryPath(value) {
  const visible = visibleMarkdown(value);
  const linkTargets = [...visible.matchAll(/\]\(([^)\s]+)\)/g)].map(
    (match) => match[1],
  );
  const inlineCode = [...visible.matchAll(/`([^`\r\n]+)`/g)].map(
    (match) => match[1],
  );
  return [...linkTargets, ...inlineCode, ...visible.split(/\s+/)].some(
    isSafeRepositoryPath,
  );
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
  const evidenceMatch = visibleMarkdown(testing)
    .match(/^\s*Evidence state:\s*([a-z-]+)\s*$/im);
  if (!evidenceMatch || !EVIDENCE_STATES.has(evidenceMatch[1].toLowerCase())) {
    errors.push(
      "Testing / Verification must contain Evidence state: pending | not-applicable | run | unavailable.",
    );
  }

  const docsImpact = sections.get(normalizedHeading("Documentation impact"))?.[0] || "";
  const visibleDocsImpact = visibleMarkdown(docsImpact).trim();
  if (
    substantiveSection(docsImpact) &&
    !hasSafeRepositoryPath(visibleDocsImpact) &&
    !NO_IMPACT_REASON.test(visibleDocsImpact)
  ) {
    errors.push(
      "Documentation impact must name a repository path or use none/not-applicable plus a reason.",
    );
  }

  const observability = sections.get(normalizedHeading("Observability"))?.[0] || "";
  if (
    substantiveSection(observability) &&
    hasUnreasonedNoImpactState(observability)
  ) {
    errors.push("Observability must use none/not-applicable plus a reason.");
  }

  const receipt = sections.get(normalizedHeading("Delivery receipt"))?.[0] || "";
  const receiptHead = visibleMarkdown(receipt)
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
