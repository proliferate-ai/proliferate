#!/usr/bin/env node

import { Sandbox } from "e2b";

function printUsage() {
  console.log(`Smoke-test a built E2B cloud template.

Usage:
  node scripts/smoke-cloud-template.mjs --template <template-ref>

Options:
  --template <template-ref>  Exact template ref to create from, usually
                             <family>:<tag>.
  --help                     Show this help text.
`);
}

function parseArgs(argv) {
  let templateRef = "";
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--template":
        templateRef = argv[i + 1] || "";
        i += 1;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!help && !templateRef) {
    throw new Error("--template is required.");
  }

  return { templateRef, help };
}

function assertSuccessful(result, message) {
  if (result.exitCode !== 0) {
    const details = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join("\n");
    throw new Error(`${message}${details ? `:\n${details}` : ""}`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error("");
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error("E2B_API_KEY environment variable is required.");
  }

  console.log(`Creating sandbox from ${parsed.templateRef}...`);
  const sandbox = await Sandbox.create(parsed.templateRef, {
    apiKey,
    timeoutMs: 10 * 60 * 1000,
  });

  const sandboxId = sandbox.sandboxId || sandbox.sandbox_id || "unknown";
  console.log(`Sandbox ID: ${sandboxId}`);

  try {
    const binaryCheck = await sandbox.commands.run(
      "test -x /home/user/anyharness && /home/user/anyharness --version",
      {
        timeoutMs: 30_000,
      }
    );
    assertSuccessful(binaryCheck, "AnyHarness binary was not executable in the template");
    console.log(`AnyHarness: ${binaryCheck.stdout.trim()}`);

    const installCheck = await sandbox.commands.run(
      "/home/user/anyharness install-agents --agent claude --agent codex",
      {
        timeoutMs: 10 * 60 * 1000,
      }
    );
    assertSuccessful(installCheck, "Cloud agents were not preinstalled in the template");

    const combinedOutput = `${installCheck.stdout}\n${installCheck.stderr}`;
    for (const agent of ["claude", "codex"]) {
      if (!combinedOutput.includes(`agent=${agent} outcome=already_installed`)) {
        throw new Error(
          `Expected ${agent} to be already installed, but output was:\n${combinedOutput.trim()}`
        );
      }
    }

    console.log("Smoke test passed.");
  } finally {
    await (sandbox.kill?.() || sandbox.close?.() || Promise.resolve());
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
