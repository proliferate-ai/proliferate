import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAreaExpectation,
  parseReleaseNoteMetadata,
  validatePullRequestMetadata,
} from "./pr-metadata.mjs";

function releaseNote({
  section = "Fix",
  title = "Reliable support report identity",
  description = "Support reports retain the correct identity throughout processing.",
  group = "none",
} = {}) {
  return `## Release note

Section: ${section}
Title: ${title}
Description: ${description}
Group: ${group}`;
}

const omittedReleaseNote = releaseNote({
  section: "Omit",
  title: "Internal release validation",
  description: "No customer-facing behavior change; this strengthens release validation.",
});

const valid = {
  title: "fix(server): preserve support report identity",
  body: releaseNote(),
  labels: ["release:fix", "area:server"],
};

test("accepts the release metadata contract", () => {
  assert.deepEqual(validatePullRequestMetadata(valid), []);
});

test("requires a conventional title, one release label, and an area", () => {
  const errors = validatePullRequestMetadata({
    title: "Fix support identity",
    body: valid.body,
    labels: ["release:fix", "release:docs"],
  });

  assert.equal(errors.length, 3);
  assert.match(errors[0], /title must match/);
  assert.match(errors[1], /exactly one release/);
  assert.match(errors[2], /at least one area/);
});

test("rejects unknown release and area labels", () => {
  const errors = validatePullRequestMetadata({
    title: valid.title,
    body: valid.body,
    labels: ["release:experimental", "area:unknown"],
  });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /Unknown release label/);
  assert.match(errors[1], /Unknown area label/);
});

test("derives required areas from changed paths", () => {
  const { required, ambiguous } = deriveAreaExpectation([
    "apps/desktop/src/main.ts",
    "server/proliferate/api/support.py",
    ".github/workflows/pr-metadata.yml",
    "anyharness/sdk/src/index.ts",
    "anyharness/crates/anyharness/src/lib.rs",
    "specs/README.md",
  ]);

  assert.deepEqual(required, [
    "area:anyharness",
    "area:desktop",
    "area:docs",
    "area:release",
    "area:sdk",
    "area:server",
  ]);
  assert.deepEqual(ambiguous, []);
});

test("mobile-only and unrecognized paths are neutral, not guessed", () => {
  const { required, ambiguous } = deriveAreaExpectation([
    "apps/mobile/app/index.tsx",
    "Makefile",
    "install/setup.sh",
  ]);

  assert.deepEqual(required, []);
  assert.deepEqual(ambiguous, []);
});

test("blocks when a required area derived from paths is missing", () => {
  const errors = validatePullRequestMetadata({
    title: "fix(desktop): repair updater",
    body: releaseNote(),
    labels: ["release:fix", "area:server"],
    changedFiles: ["apps/desktop/src/updater.ts"],
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /require area label\(s\): area:desktop/);
});

test("passes when applied areas cover every derived area", () => {
  const errors = validatePullRequestMetadata({
    title: "feat(desktop): bundle seed",
    body: releaseNote({
      section: "New",
      title: "Portable workspace seeds",
      description: "Create reusable workspace seeds for desktop environments.",
    }),
    labels: ["release:minor-feature", "area:desktop", "area:release"],
    changedFiles: [
      "apps/desktop/src-tauri/tauri.conf.json",
      ".github/workflows/release-desktop.yml",
    ],
  });

  assert.deepEqual(errors, []);
});

test("ambiguous path-to-area result blocks for a human choice", () => {
  const errors = validatePullRequestMetadata({
    title: "chore(deps): bump shared deps",
    body: omittedReleaseNote,
    labels: ["release:maintenance", "area:release"],
    changedFiles: ["cloud/sdk/package.json"],
  });

  // cloud/sdk/... matches both area:sdk and area:cloud.
  assert.equal(errors.length, 1);
  assert.match(errors[0], /map to more than one area/);
  assert.match(errors[0], /cloud\/sdk\/package\.json -> area:cloud \| area:sdk/);
});

test("ambiguity is resolved once one candidate area is applied", () => {
  const errors = validatePullRequestMetadata({
    title: "chore(sdk): bump cloud sdk deps",
    body: omittedReleaseNote,
    labels: ["release:maintenance", "area:sdk"],
    changedFiles: ["cloud/sdk/package.json"],
  });

  assert.deepEqual(errors, []);
});

test("parses customer-facing title, description, section, and group", () => {
  const { releaseNote: parsed, errors } = parseReleaseNoteMetadata(
    releaseNote({
      section: "Improvement",
      title: "Faster workspace recovery",
      description: "Resume interrupted cloud workspace setup without creating duplicate copies.",
      group: "workspace-recovery",
    }),
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(parsed, {
    section: "Improvement",
    title: "Faster workspace recovery",
    description: "Resume interrupted cloud workspace setup without creating duplicate copies.",
    group: "workspace-recovery",
  });
});

test("rejects a missing or placeholder release-note block", () => {
  const missing = validatePullRequestMetadata({
    ...valid,
    body: "## Summary\n\nA fix.",
  });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /exactly one "## Release note"/);

  const placeholders = validatePullRequestMetadata({
    ...valid,
    body: releaseNote({ title: "TODO", description: "TBD" }),
  });
  assert.equal(placeholders.length, 2);
  assert.match(placeholders[0], /Title must be complete/);
  assert.match(placeholders[1], /Description must be complete/);
});

test("requires the release label and public section to agree", () => {
  const errors = validatePullRequestMetadata({
    ...valid,
    labels: ["release:fix", "area:server"],
    body: releaseNote({
      section: "New",
      title: "Repository workspaces",
      description: "Create a durable workspace from any connected repository.",
    }),
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /release:fix requires release-note Section Fix/);
});

test("requires truthful customer-impact wording for omitted entries", () => {
  const errors = validatePullRequestMetadata({
    title: "test(release): strengthen qualification",
    body: releaseNote({
      section: "Omit",
      title: "Internal release validation",
      description: "Strengthens release validation coverage.",
    }),
    labels: ["release:maintenance", "area:release"],
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /must begin with "No customer-facing behavior change"/);
});
