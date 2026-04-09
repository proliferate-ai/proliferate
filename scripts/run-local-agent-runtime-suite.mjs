import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupAgentRuntimeSuite,
  prepareAgentRuntimeSuite,
} from "./setup-agent-runtime-suite.mjs";

const REPO_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function main() {
  const { state, env } = await prepareAgentRuntimeSuite();

  try {
    execFileSync("pnpm", ["--filter", "@anyharness/tests", "test"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...env,
      },
    });
  } finally {
    await cleanupAgentRuntimeSuite({ state });
  }
}

await main();
