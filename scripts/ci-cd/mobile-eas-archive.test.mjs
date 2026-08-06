import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const mobileBuildInputs = [
  "apps/mobile",
  "apps/packages/design",
  "apps/packages/product-client",
  "anyharness/sdk",
  "anyharness/sdk-react",
  "catalogs/agents",
  "cloud/sdk",
  "cloud/sdk-react",
];

test("mobile EAS archives retain every tracked shared build input", () => {
  const ignoredTrackedFiles = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--ignored",
      "--exclude-standard",
      "--",
      ...mobileBuildInputs,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();

  assert.equal(
    ignoredTrackedFiles,
    "",
    `EAS would omit these tracked mobile build inputs:\n${ignoredTrackedFiles}`,
  );
});
