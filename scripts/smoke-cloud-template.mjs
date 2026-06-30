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
      [
        "test -x /home/user/anyharness",
        "/home/user/anyharness --version",
        "test -x /home/user/.proliferate/bin/proliferate-worker",
        "/home/user/.proliferate/bin/proliferate-worker --version",
        "test -x /home/user/.proliferate/bin/proliferate-supervisor",
        "/home/user/.proliferate/bin/proliferate-supervisor --version",
        "test -x /home/user/.proliferate/bin/proliferate-git-credential-helper",
        'test "$(stat -c "%U:%G:%a" /home/user/.proliferate/bin/proliferate-git-credential-helper)" = "user:user:700"',
      ].join(" && "),
      {
        timeoutMs: 30_000,
      }
    );
    assertSuccessful(binaryCheck, "Runtime bundle binaries were not executable in the template");
    console.log(`Runtime bundle:\n${binaryCheck.stdout.trim()}`);

    const installCheck = await sandbox.commands.run(
      "/home/user/anyharness install-agents --agent claude --agent codex",
      {
        timeoutMs: 10 * 60 * 1000,
      }
    );
    assertSuccessful(installCheck, "Cloud agents were not preinstalled in the template");

    const combinedOutput = `${installCheck.stdout}\n${installCheck.stderr}`;
    for (const agent of ["claude", "codex"]) {
      const acceptedOutcomes = [
        `agent=${agent} outcome=already_installed`,
        `agent=${agent} outcome=installed`,
      ];
      if (!acceptedOutcomes.some((outcome) => combinedOutput.includes(outcome))) {
        throw new Error(
          `Expected ${agent} to be available, but output was:\n${combinedOutput.trim()}`
        );
      }
    }

    const helperCheck = await sandbox.commands.run(
      [
        "set -eu",
        'helper="/home/user/.proliferate/bin/proliferate-git-credential-helper"',
        'empty_output="$(printf "protocol=https\\nhost=github.com\\n\\n" | "$helper" get)"',
        'test -z "$empty_output"',
        "mkdir -p /home/user/.proliferate/git/github.com",
        'printf "template-smoke-token\\n" > /home/user/.proliferate/git/github.com/token',
        'chmod 600 /home/user/.proliferate/git/github.com/token',
        'credential_output="$(printf "protocol=https\\nhost=github.com\\n\\n" | "$helper" get)"',
        'printf "%s\\n" "$credential_output" | grep -qx "username=x-access-token"',
        'printf "%s\\n" "$credential_output" | grep -qx "password=template-smoke-token"',
        'git config --global credential.https://github.com.helper "!$helper"',
        'git_output="$(printf "protocol=https\\nhost=github.com\\n\\n" | GIT_TERMINAL_PROMPT=0 git credential fill)"',
        'printf "%s\\n" "$git_output" | grep -qx "username=x-access-token"',
        'printf "%s\\n" "$git_output" | grep -qx "password=template-smoke-token"',
        'override_file="$(mktemp)"',
        'printf "override-token\\n" > "$override_file"',
        'override_output="$(printf "protocol=https\\nhost=www.github.com\\n\\n" | PROLIFERATE_GIT_TOKEN_FILE="$override_file" "$helper" get)"',
        'printf "%s\\n" "$override_output" | grep -qx "password=override-token"',
        'wrong_host="$(printf "protocol=https\\nhost=example.com\\n\\n" | "$helper" get)"',
        'test -z "$wrong_host"',
      ].join("\n"),
      {
        timeoutMs: 30_000,
      }
    );
    assertSuccessful(helperCheck, "Git credential helper did not satisfy Git protocol checks");

    const supervisorCheck = await sandbox.commands.run(
      [
        "set -eu",
        'tmp_dir="$(mktemp -d)"',
        'cat > "$tmp_dir/worker.toml" <<EOF',
        'cloud_base_url = "http://127.0.0.1:9"',
        'enrollment_token = "template-smoke-invalid"',
        'anyharness_base_url = "http://127.0.0.1:8467"',
        'anyharness_bearer_token = "template-smoke-token"',
        'worker_db_path = "$tmp_dir/worker.sqlite3"',
        'heartbeat_interval_seconds = 10',
        "EOF",
        'cat > "$tmp_dir/supervisor.toml" <<EOF',
        'anyharness_binary = "/home/user/anyharness"',
        'worker_binary = "/home/user/.proliferate/bin/proliferate-worker"',
        'worker_config = "$tmp_dir/worker.toml"',
        'anyharness_args = ["serve", "--require-bearer-auth", "--host", "127.0.0.1", "--port", "8467"]',
        "restart_delay_seconds = 1",
        "[anyharness_env]",
        'ANYHARNESS_BEARER_TOKEN = "template-smoke-token"',
        'ANYHARNESS_DATA_DIR = "$tmp_dir/anyharness-data"',
        'HOME = "/home/user"',
        "EOF",
        "set +e",
        'timeout 8s /home/user/.proliferate/bin/proliferate-supervisor --config "$tmp_dir/supervisor.toml" run >"$tmp_dir/supervisor.log" 2>&1',
        "code=$?",
        "set -e",
        'if [ "$code" -ne 124 ] && [ "$code" -ne 143 ]; then cat "$tmp_dir/supervisor.log"; exit 1; fi',
        'grep -q "anyharness started" "$tmp_dir/supervisor.log"',
      ].join("\n"),
      {
        timeoutMs: 30_000,
      }
    );
    assertSuccessful(supervisorCheck, "Supervisor did not start AnyHarness in the template");

    console.log("Smoke test passed.");
  } finally {
    await (sandbox.kill?.() || sandbox.close?.() || Promise.resolve());
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
