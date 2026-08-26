#!/usr/bin/env node
// Open a pull request with its metadata already satisfied.
//
// Building-loop law: the metadata gate (validate-pr-metadata.mjs) re-derives
// area labels from the final diff, so a PR opened without them is red until
// someone applies them by hand — and a red seconds after opening is usually a
// label race. This wrapper derives the area:* labels from the branch's diff
// against the base with the same classifier the gate uses
// (deriveAreaExpectation), validates title + labels locally with the same
// function CI runs, and only then shells out to `gh pr create` non-draft.
//
// Usage:
//   node scripts/ci-cd/pr-open.mjs --release release:maintenance \
//     --title "docs(specs): ..." --body-file /path/body.md \
//     [--area area:sdk ...] [--base main] [--draft] [--dry-run]
//
// Ambiguous paths (e.g. cloud/sdk/** → area:cloud | area:sdk) are not guessed:
// the command fails and names them; pass --area for the human choice.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  ALLOWED_AREA_LABELS,
  ALLOWED_RELEASE_LABELS,
  deriveAreaExpectation,
  validatePullRequestMetadata,
} from "./pr-metadata.mjs";

export function parseArgs(argv) {
  const parsed = {
    release: "",
    title: "",
    bodyFile: "",
    areas: [],
    base: "main",
    draft: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--release":
        parsed.release = next();
        break;
      case "--title":
        parsed.title = next();
        break;
      case "--body-file":
        parsed.bodyFile = next();
        break;
      case "--area":
        parsed.areas.push(next());
        break;
      case "--base":
        parsed.base = next();
        break;
      case "--draft":
        parsed.draft = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

/**
 * Resolve the label set for a PR from its changed paths plus explicit choices.
 * Pure: no git, no gh. Returns `{ labels, errors }`; a non-empty `errors`
 * means the PR must not be opened as-is.
 */
export function resolveLabels({ changedFiles, release, explicitAreas = [], title }) {
  const errors = [];
  const { required, ambiguous } = deriveAreaExpectation(changedFiles);
  const areas = new Set([...required, ...explicitAreas]);

  for (const area of explicitAreas) {
    if (!ALLOWED_AREA_LABELS.includes(area)) errors.push(`Unknown area label: ${area}.`);
  }
  if (!ALLOWED_RELEASE_LABELS.includes(release)) {
    errors.push(
      `--release must be one of: ${ALLOWED_RELEASE_LABELS.join(", ")} (got ${release || "nothing"}).`,
    );
  }

  const unresolved = ambiguous.filter(({ candidates }) => !candidates.some((c) => areas.has(c)));
  if (unresolved.length > 0) {
    const detail = unresolved.map(({ path, candidates }) => `${path} -> ${candidates.join(" | ")}`);
    errors.push(`Ambiguous area for: ${detail.join("; ")}. Pass --area to choose.`);
  }

  const labels = [release, ...[...areas].sort()].filter(Boolean);
  errors.push(...validatePullRequestMetadata({ title, labels, changedFiles }));
  return { labels, errors: [...new Set(errors)] };
}

function changedFilesAgainst(base) {
  const merged = execFileSync("git", ["merge-base", `origin/${base}`, "HEAD"], {
    encoding: "utf8",
  }).trim();
  const out = execFileSync("git", ["diff", "--name-only", `${merged}...HEAD`], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title || !args.bodyFile || !args.release) {
    console.error("Required: --release, --title, --body-file.");
    process.exitCode = 2;
    return;
  }
  execFileSync("git", ["fetch", "--quiet", "origin", args.base]);
  const changedFiles = changedFilesAgainst(args.base);
  if (changedFiles.length === 0) {
    console.error(`No changes against origin/${args.base}; nothing to open.`);
    process.exitCode = 2;
    return;
  }
  const { labels, errors } = resolveLabels({
    changedFiles,
    release: args.release,
    explicitAreas: args.areas,
    title: args.title,
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  readFileSync(args.bodyFile, "utf8"); // fail early on a bad path
  const ghArgs = [
    "pr",
    "create",
    "--base",
    args.base,
    "--title",
    args.title,
    "--body-file",
    args.bodyFile,
    "--label",
    labels.join(","),
  ];
  if (args.draft) ghArgs.push("--draft");
  console.log(`labels: ${labels.join(", ")} (from ${changedFiles.length} changed path(s))`);
  if (args.dryRun) {
    console.log(`dry-run: gh ${ghArgs.join(" ")}`);
    return;
  }
  execFileSync("gh", ghArgs, { stdio: "inherit" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
