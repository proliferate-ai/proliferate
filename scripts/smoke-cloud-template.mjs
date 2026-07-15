#!/usr/bin/env node

import { Sandbox } from "e2b";

function printUsage() {
  console.log(`Smoke-test a built E2B cloud template.

Usage:
  node scripts/smoke-cloud-template.mjs --template <template-ref> [--expected-version <version>] [--expected-sha <sha>]

Options:
  --template <template-ref>    Exact template ref to create from, usually
                               <family>:<tag>.
  --expected-version <version> Canonical runtime version all three binaries must
                               report. When set, a mismatch fails the smoke test
                               before any rolling reference is moved.
  --expected-sha <sha>         Source SHA (12+ hex chars; truncated to 12) whose
                               build stamp must be embedded in all three
                               binaries. When set, an unstamped or differently
                               stamped binary fails the smoke test.
  --help                       Show this help text.
`);
}

function parseArgs(argv) {
  let templateRef = "";
  let expectedVersion = "";
  let expectedSha = "";
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--template":
        templateRef = argv[i + 1] || "";
        i += 1;
        break;
      case "--expected-version":
        expectedVersion = argv[i + 1] || "";
        i += 1;
        break;
      case "--expected-sha":
        expectedSha = argv[i + 1] || "";
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
  if (expectedSha) {
    const normalized = expectedSha.trim().toLowerCase();
    if (normalized.length < 12 || !/^[0-9a-f]+$/.test(normalized)) {
      throw new Error("--expected-sha must be at least 12 lowercase hex characters.");
    }
    expectedSha = normalized.slice(0, 12);
  }

  return { templateRef, expectedVersion, expectedSha, help };
}

// Match the worker self-update gate: split `--version` output on whitespace and
// accept an exact token (optionally `v`-prefixed). Substrings never match, so
// `0.3.0` does not satisfy an expected `0.3.0-rc1`.
function versionOutputMatches(output, expected) {
  return output
    .split(/\s+/)
    .some((token) => token === expected || token.replace(/^v/, "") === expected);
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

    // Prove all three binaries report the expected canonical version before any
    // rolling reference is moved. A stale-stamp bundle (e.g. Cargo `0.1.0`)
    // fails here, so `_deploy-e2b.yml` never promotes an unidentified build.
    if (parsed.expectedVersion) {
      const versionCheck = await sandbox.commands.run(
        [
          'echo "anyharness=$(/home/user/anyharness --version)"',
          'echo "proliferate-worker=$(/home/user/.proliferate/bin/proliferate-worker --version)"',
          'echo "proliferate-supervisor=$(/home/user/.proliferate/bin/proliferate-supervisor --version)"',
        ].join("\n"),
        { timeoutMs: 30_000 }
      );
      assertSuccessful(versionCheck, "Runtime binaries did not report --version");
      const reported = new Map(
        versionCheck.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const separator = line.indexOf("=");
            return [line.slice(0, separator), line.slice(separator + 1)];
          })
      );
      for (const binary of ["anyharness", "proliferate-worker", "proliferate-supervisor"]) {
        const output = reported.get(binary) || "";
        if (!versionOutputMatches(output, parsed.expectedVersion)) {
          throw new Error(
            `${binary} reported version ${JSON.stringify(output)}, expected ${JSON.stringify(
              parsed.expectedVersion
            )}`
          );
        }
      }
      console.log(`All three binaries report expected version ${parsed.expectedVersion}.`);
    }

    // Prove the expected source SHA was stamped into all three binaries.
    // `--version` deliberately reports only the version token (the worker
    // self-update/anyharness-update preflights exact-match it against pins),
    // and the contract adds no build-info endpoint, so the stamped
    // PROLIFERATE_STAMPED_GIT_SHA literal — compiled into each binary and the
    // source of its `<component>@<version>+<sha>` Sentry release — is asserted
    // directly in the binary image. The immutable `sha-<12>` template tag
    // remains the canonical source-revision binding.
    if (parsed.expectedSha) {
      const shaCheck = await sandbox.commands.run(
        [
          "set -eu",
          `sha="${parsed.expectedSha}"`,
          'for bin in /home/user/anyharness /home/user/.proliferate/bin/proliferate-worker /home/user/.proliferate/bin/proliferate-supervisor; do',
          '  if ! grep -a -q "$sha" "$bin"; then',
          '    echo "missing stamped sha in $bin" >&2',
          "    exit 1",
          "  fi",
          "done",
        ].join("\n"),
        { timeoutMs: 60_000 }
      );
      assertSuccessful(
        shaCheck,
        `Runtime binaries do not carry the expected stamped source SHA ${parsed.expectedSha}`
      );
      console.log(`All three binaries carry the stamped source SHA ${parsed.expectedSha}.`);
    }

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
