import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs, resolveLabels } from "./pr-open.mjs";

const title = "docs(specs): engineering system spec — building loop";

test("derives every required area from the diff and prefixes the release label", () => {
  const { labels, errors } = resolveLabels({
    changedFiles: [
      "specs/engineering/ci-cd/README.md",
      "scripts/ci-cd/pr-open.mjs",
    ],
    release: "release:maintenance",
    title,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(labels, ["release:maintenance", "area:docs", "area:release"]);
});

test("refuses to guess an ambiguous path and names it", () => {
  const { errors } = resolveLabels({
    changedFiles: ["cloud/sdk/src/generated/openapi.ts"],
    release: "release:fix",
    title: "fix(sdk): regenerate types",
  });
  assert.ok(
    errors.some((e) => e.includes("cloud/sdk/src/generated/openapi.ts -> area:cloud | area:sdk")),
  );
});

test("an explicit --area resolves the ambiguity", () => {
  const { labels, errors } = resolveLabels({
    changedFiles: ["cloud/sdk/src/generated/openapi.ts"],
    release: "release:fix",
    explicitAreas: ["area:sdk"],
    title: "fix(sdk): regenerate types",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(labels, ["release:fix", "area:sdk"]);
});

test("runs the same title/label validation CI runs", () => {
  const { errors } = resolveLabels({
    changedFiles: ["specs/README.md"],
    release: "release:docs",
    title: "not a conventional title",
  });
  assert.ok(errors.some((e) => e.startsWith("PR title must match")));
});

test("rejects an unknown release label", () => {
  const { errors } = resolveLabels({
    changedFiles: ["specs/README.md"],
    release: "release:bogus",
    title,
  });
  assert.ok(errors.some((e) => e.startsWith("--release must be one of")));
});

test("parseArgs collects repeated --area and flags", () => {
  const parsed = parseArgs([
    "--release",
    "release:maintenance",
    "--title",
    title,
    "--body-file",
    "/tmp/body.md",
    "--area",
    "area:sdk",
    "--area",
    "area:cloud",
    "--dry-run",
  ]);
  assert.equal(parsed.release, "release:maintenance");
  assert.deepEqual(parsed.areas, ["area:sdk", "area:cloud"]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.draft, false);
  assert.equal(parsed.base, "main");
});
