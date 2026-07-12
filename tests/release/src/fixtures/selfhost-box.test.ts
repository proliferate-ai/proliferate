import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { toFailureReport } from "../report/failure-reporter.js";
import { withRequiredCleanup } from "./required-cleanup.js";
import { terminateSelfHostBox, type SelfHostBox } from "./selfhost.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELFHOST_BOX_SCRIPT = path.resolve(HERE, "..", "..", "scripts", "selfhost-box.sh");
const SECRET_SENTINEL = "ghp_SELFHOST_PROVIDER_SECRET_MUST_NOT_LEAK";

interface MockHarness {
  directory: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

interface ShellResult {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

test("provision cleanup owns partial key, security-group, and instance resources", () => {
  const cases = [
    {
      name: "lost key-pair creation response",
      failOps: "ec2:create-key-pair",
      expectedCleanup: ["ec2:delete-key-pair"],
    },
    {
      name: "failure immediately after key-pair creation",
      failOps: "ec2:create-security-group",
      expectedCleanup: ["ec2:delete-security-group", "ec2:delete-key-pair"],
    },
    {
      name: "failure immediately after security-group creation",
      failOps: "ec2:authorize-security-group-ingress",
      expectedCleanup: ["ec2:delete-security-group", "ec2:delete-key-pair"],
    },
    {
      name: "lost instance-creation response",
      failOps: "ec2:run-instances",
      expectedCleanup: [
        "ec2:terminate-instances",
        "ec2:wait:instance-terminated",
        "ec2:delete-security-group",
        "ec2:delete-key-pair",
      ],
    },
    {
      name: "failure immediately after instance creation",
      failOps: "ec2:wait:instance-running",
      expectedCleanup: [
        "ec2:terminate-instances",
        "ec2:wait:instance-terminated",
        "ec2:delete-security-group",
        "ec2:delete-key-pair",
      ],
    },
  ];

  for (const fixtureCase of cases) {
    const harness = createMockHarness(fixtureCase.failOps);
    try {
      const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
      assert.notEqual(result.status, 0, fixtureCase.name);
      assert.match(result.stderr, /provision failed; cleaning partial resources/);
      assert.match(result.stderr, /partial resource cleanup complete after provision failure/);
      assert.equal(result.stderr.includes("teardown complete"), false);
      assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
      for (const operation of fixtureCase.expectedCleanup) {
        assertOperation(result.calls, operation, fixtureCase.name);
      }
      assert.deepEqual(
        readdirSync(harness.directory).filter((name) => name.endsWith(".pem")),
        [],
        `${fixtureCase.name}: private key file survived cleanup`,
      );
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  }
});

test("successful provision transfers ownership only after emitting its JSON handoff", () => {
  const harness = createMockHarness("");
  try {
    const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
    assert.equal(result.status, 0);
    const box = JSON.parse(result.stdout) as SelfHostBox;
    assert.equal(box.instanceId, "i-selfhost-test");
    assert.equal(box.sgId, "sg-selfhost-test");
    assert.equal(box.publicIp, "203.0.113.10");
    assert.equal(existsSync(box.keyPath), true);
    for (const operation of cleanupOperations) {
      assert.equal(operationCount(result.calls, operation), 0, `success unexpectedly ran ${operation}`);
    }
    assert.equal(result.stderr.includes("provision failed"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("partial-provision cleanup failure remains red and never claims completion", () => {
  const harness = createMockHarness(
    "ec2:create-security-group,ec2:delete-security-group,ec2:delete-key-pair",
  );
  try {
    const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
    assert.notEqual(result.status, 0);
    assertOperation(result.calls, "ec2:delete-security-group", "partial cleanup");
    assertOperation(result.calls, "ec2:delete-key-pair", "partial cleanup");
    assert.match(result.stderr, /partial resource cleanup failed after provision failure/);
    assert.match(result.stderr, /provision remains failed with partial-resource cleanup risk/);
    assert.equal(result.stderr.includes("partial resource cleanup complete"), false);
    assert.equal(result.stderr.includes("teardown complete"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("terminate attempts every resource and makes each AWS cleanup failure red", () => {
  for (const failOp of [
    "ec2:terminate-instances",
    "ec2:wait:instance-terminated",
    "ec2:delete-security-group",
    "ec2:delete-key-pair",
  ]) {
    const harness = createMockHarness(failOp);
    const keyPath = path.join(harness.directory, "owned-private-key.pem");
    writeFileSync(keyPath, `private material ${SECRET_SENTINEL}\n`, { mode: 0o600 });
    try {
      const result = runShell(harness, terminateArgs(keyPath));
      assert.notEqual(result.status, 0, failOp);
      for (const operation of cleanupOperations) {
        assertOperation(result.calls, operation, `${failOp}: all cleanup resources are attempted`);
      }
      assert.match(result.stderr, cleanupFailurePattern(failOp));
      assert.match(
        result.stderr,
        /teardown failed for instance=i-selfhost-test security-group=sg-selfhost-test key-pair=key-selfhost-test/,
      );
      assert.equal(result.stderr.includes("teardown complete"), false);
      assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
      assert.equal(existsSync(keyPath), false, `${failOp}: local private key survived cleanup`);
      if (failOp === "ec2:delete-security-group") {
        assert.equal(operationCount(result.calls, failOp), 3);
        assert.match(result.stderr, /delete-security-group\(security-group=sg-selfhost-test, exhausted=3\)/);
      }
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  }
});

test("terminate aggregates simultaneous failures without a false success", () => {
  const harness = createMockHarness(cleanupOperations.join(","));
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, "private material\n", { mode: 0o600 });
  try {
    const result = runShell(harness, terminateArgs(keyPath));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /terminate-instances\(instance=i-selfhost-test\)/);
    assert.match(result.stderr, /wait-instance-terminated\(instance=i-selfhost-test\)/);
    assert.match(result.stderr, /delete-security-group\(security-group=sg-selfhost-test, exhausted=3\)/);
    assert.match(result.stderr, /delete-key-pair\(key-pair=key-selfhost-test\)/);
    assert.equal(result.stderr.includes("teardown complete"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("terminate reports completion only after every cleanup operation succeeds", () => {
  const harness = createMockHarness("");
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, "private material\n", { mode: 0o600 });
  try {
    const result = runShell(harness, terminateArgs(keyPath));
    assert.equal(result.status, 0);
    for (const operation of cleanupOperations) {
      assertOperation(result.calls, operation, "successful teardown");
    }
    assert.match(
      result.stderr,
      /teardown complete for instance=i-selfhost-test security-group=sg-selfhost-test key-pair=key-selfhost-test/,
    );
    assert.equal(result.stderr.includes("teardown failed"), false);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("TypeScript cleanup wrappers preserve red evidence IDs without secret leakage", async () => {
  const harness = createMockHarness("ec2:terminate-instances");
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, `private material ${SECRET_SENTINEL}\n`, { mode: 0o600 });
  const box: SelfHostBox = {
    instanceId: "i-selfhost-test",
    sgId: "sg-selfhost-test",
    keyName: "key-selfhost-test",
    keyPath,
    publicIp: "203.0.113.10",
    url: "https://203.0.113.10.sslip.io",
    sshUser: "ubuntu",
  };

  try {
    const error = await withTemporaryEnvironment(harness.env, async () => {
      try {
        await withRequiredCleanup({
          label: "self-host qualification box",
          resourceIds: [
            `instance=${box.instanceId}`,
            `security-group=${box.sgId}`,
            `key-pair=${box.keyName}`,
          ],
          run: async () => "green body",
          cleanup: () => terminateSelfHostBox(box),
        });
      } catch (caught) {
        return caught;
      }
      throw new Error("cleanup unexpectedly passed");
    });

    assert.ok(error instanceof Error);
    assert.equal(String(error).includes(SECRET_SENTINEL), false);
    const evidence = toFailureReport({
      scenarioId: "T3-SH-MOCK",
      registryFlowRef: "specs/developing/testing/self-hosting.md",
      lane: "local",
      expected: "external resources are removed",
      error,
    });
    const evidenceBytes = JSON.stringify(evidence);
    assert.match(evidenceBytes, /instance=i-selfhost-test/);
    assert.match(evidenceBytes, /security-group=sg-selfhost-test/);
    assert.match(evidenceBytes, /key-pair=key-selfhost-test/);
    assert.match(evidenceBytes, /Required cleanup failed/);
    assert.match(evidenceBytes, /terminate-instances\(instance=i-selfhost-test\)/);
    assert.equal(evidenceBytes.includes(SECRET_SENTINEL), false);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

const cleanupOperations = [
  "ec2:terminate-instances",
  "ec2:wait:instance-terminated",
  "ec2:delete-security-group",
  "ec2:delete-key-pair",
];

function createMockHarness(failOps: string): MockHarness {
  const directory = mkdtempSync(path.join(tmpdir(), "selfhost-box-test-"));
  const bin = path.join(directory, "bin");
  const logPath = path.join(directory, "aws-calls.log");
  writeFileSync(logPath, "", "utf8");
  writeExecutable(
    path.join(bin, "aws"),
    `#!/usr/bin/env bash
set -euo pipefail
service="\${1:-}"
command="\${2:-}"
qualifier=""
if [[ "$service" == "ec2" && "$command" == "wait" ]]; then
  qualifier=":\${3:-}"
fi
operation="$service:$command$qualifier"
printf '%s|%s\\n' "$operation" "$*" >> "$MOCK_AWS_LOG"
if [[ ",\${MOCK_AWS_FAIL_OPS:-}," == *",$operation,"* ]]; then
  printf '%s\\n' "$MOCK_SECRET_SENTINEL" >&2
  exit 42
fi
case "$operation" in
  ssm:get-parameters) printf 'ami-selfhost-test\\n' ;;
  ec2:create-key-pair) printf 'MOCK_PRIVATE_KEY_MATERIAL\\n' ;;
  ec2:create-security-group) printf 'sg-selfhost-test\\n' ;;
  ec2:run-instances) printf 'i-selfhost-test\\n' ;;
  ec2:describe-instances)
    if [[ "$*" == *"Name=client-token"* ]]; then
      printf 'i-selfhost-test\\n'
    else
      printf '203.0.113.10\\n'
    fi
    ;;
esac
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
url="\${!#}"
if [[ "$url" == "https://checkip.amazonaws.com" ]]; then
  printf '198.51.100.20\\n'
fi
`,
  );
  writeExecutable(path.join(bin, "ssh"), "#!/usr/bin/env bash\ncat >/dev/null || true\n");
  writeExecutable(path.join(bin, "tar"), "#!/usr/bin/env bash\nprintf 'mock archive'\n");
  writeExecutable(path.join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");

  return {
    directory,
    logPath,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: directory,
      MOCK_AWS_LOG: logPath,
      MOCK_AWS_FAIL_OPS: failOps,
      MOCK_SECRET_SENTINEL: SECRET_SENTINEL,
      RELEASE_E2E_GITHUB_TEST_TOKEN: SECRET_SENTINEL,
      SELFHOST_BOX_SG_DELETE_ATTEMPTS: "3",
      SELFHOST_BOX_RETRY_SLEEP_SECONDS: "0",
    },
  };
}

function runShell(harness: MockHarness, args: string[]): ShellResult {
  const result = spawnSync("bash", [SELFHOST_BOX_SCRIPT, ...args], {
    encoding: "utf8",
    env: harness.env,
    timeout: 10_000,
  });
  if (result.error) {
    throw result.error;
  }
  const calls = readFileSync(harness.logPath, "utf8").split("\n").filter(Boolean);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls,
  };
}

function terminateArgs(keyPath: string): string[] {
  return [
    "terminate",
    "--instance-id",
    "i-selfhost-test",
    "--sg-id",
    "sg-selfhost-test",
    "--key-name",
    "key-selfhost-test",
    "--key-path",
    keyPath,
  ];
}

function assertOperation(calls: string[], operation: string, message: string): void {
  assert.ok(calls.some((call) => call.startsWith(`${operation}|`)), `${message}: missing ${operation}`);
}

function operationCount(calls: string[], operation: string): number {
  return calls.filter((call) => call.startsWith(`${operation}|`)).length;
}

function cleanupFailurePattern(operation: string): RegExp {
  switch (operation) {
    case "ec2:terminate-instances":
      return /terminate-instances\(instance=i-selfhost-test\)/;
    case "ec2:wait:instance-terminated":
      return /wait-instance-terminated\(instance=i-selfhost-test\)/;
    case "ec2:delete-security-group":
      return /delete-security-group\(security-group=sg-selfhost-test, exhausted=3\)/;
    case "ec2:delete-key-pair":
      return /delete-key-pair\(key-pair=key-selfhost-test\)/;
    default:
      throw new Error(`unknown cleanup operation ${operation}`);
  }
}

function writeExecutable(file: string, content: string): void {
  const parent = path.dirname(file);
  mkdirSync(parent, { recursive: true });
  writeFileSync(file, content, { mode: 0o700 });
  chmodSync(file, 0o700);
}

async function withTemporaryEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  const names = [
    "PATH",
    "TMPDIR",
    "MOCK_AWS_LOG",
    "MOCK_AWS_FAIL_OPS",
    "MOCK_SECRET_SENTINEL",
    "RELEASE_E2E_GITHUB_TEST_TOKEN",
    "SELFHOST_BOX_SG_DELETE_ATTEMPTS",
    "SELFHOST_BOX_RETRY_SLEEP_SECONDS",
  ];
  const prior = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    const value = environment[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
