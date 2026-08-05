import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/deploy-staging.yml"),
  "utf8",
);

test("staging queues workflow-run events from main only", () => {
  assert.match(
    workflow,
    /^on:\n  workflow_run:\n    workflows: \["CI"\]\n    types: \[completed\]\n    branches: \[main\]$/m,
  );
  assert.match(
    workflow,
    /^concurrency:\n  group: deploy-staging\n  cancel-in-progress: false$/m,
  );
});
