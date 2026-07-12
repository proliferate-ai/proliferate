import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELFHOST_BOX_SCRIPT = path.resolve(HERE, "..", "..", "scripts", "selfhost-box.sh");

export const SECRET_SENTINEL = "ghp_SELFHOST_PROVIDER_SECRET_MUST_NOT_LEAK";
export const cleanupOperations = [
  "ec2:terminate-instances",
  "ec2:wait:instance-terminated",
  "ec2:delete-security-group",
  "ec2:delete-key-pair",
];

export interface MockHarness {
  directory: string;
  stateDirectory: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export interface MockHarnessOptions {
  failOps?: string;
  describeClientTokenSequence?: string;
  hangOp?: string;
  successLostOps?: string;
  statefulResources?: boolean;
  initialResources?: boolean;
  instanceRecoveryAttempts?: number;
  provisionTimeoutMs?: number;
  terminationGraceMs?: number;
}

export interface ShellResult {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

export function createMockHarness(input: string | MockHarnessOptions): MockHarness {
  const options: MockHarnessOptions = typeof input === "string" ? { failOps: input } : input;
  const directory = mkdtempSync(path.join(tmpdir(), "selfhost-box-test-"));
  const bin = path.join(directory, "bin");
  const stateDirectory = path.join(directory, "provider-state");
  const logPath = path.join(directory, "aws-calls.log");
  mkdirSync(stateDirectory, { recursive: true });
  if (options.initialResources) {
    for (const resource of ["instance", "security-group", "key-pair"]) {
      writeFileSync(path.join(stateDirectory, resource), "present\n", "utf8");
    }
  }
  writeFileSync(logPath, "", "utf8");
  writeExecutable(path.join(bin, "aws"), mockAwsScript);
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
    stateDirectory,
    logPath,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: directory,
      MOCK_AWS_LOG: logPath,
      MOCK_AWS_STATE_DIR: stateDirectory,
      MOCK_AWS_FAIL_OPS: options.failOps ?? "",
      MOCK_AWS_HANG_OPS: options.hangOp ?? "",
      MOCK_AWS_SUCCESS_LOST_OPS: options.successLostOps ?? "",
      MOCK_AWS_STATEFUL_RESOURCES: options.statefulResources ? "1" : "0",
      MOCK_DESCRIBE_CLIENT_TOKEN_SEQUENCE: options.describeClientTokenSequence ?? "",
      MOCK_SECRET_SENTINEL: SECRET_SENTINEL,
      RELEASE_E2E_GITHUB_TEST_TOKEN: SECRET_SENTINEL,
      SELFHOST_BOX_SG_DELETE_ATTEMPTS: "3",
      SELFHOST_BOX_INSTANCE_RECOVERY_ATTEMPTS: String(options.instanceRecoveryAttempts ?? 3),
      SELFHOST_BOX_RETRY_SLEEP_SECONDS: "0",
      SELFHOST_BOX_PROVISION_TIMEOUT_MS: options.provisionTimeoutMs?.toString(),
      SELFHOST_BOX_TERMINATION_GRACE_MS: options.terminationGraceMs?.toString(),
    },
  };
}

export function runShell(harness: MockHarness, args: string[]): ShellResult {
  const result = spawnSync("bash", [SELFHOST_BOX_SCRIPT, ...args], {
    encoding: "utf8",
    env: harness.env,
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: readCalls(harness),
  };
}

export function readCalls(harness: MockHarness): string[] {
  return readFileSync(harness.logPath, "utf8").split("\n").filter(Boolean);
}

export function resourceExists(harness: MockHarness, resource: string): boolean {
  return existsSync(path.join(harness.stateDirectory, resource));
}

export function terminateArgs(keyPath: string): string[] {
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

export function assertOperation(calls: string[], operation: string, message: string): void {
  assert.ok(calls.some((call) => call.startsWith(`${operation}|`)), `${message}: missing ${operation}`);
}

export function operationCount(calls: string[], operation: string): number {
  return calls.filter((call) => call.startsWith(`${operation}|`)).length;
}

export function cleanupFailurePattern(operation: string): RegExp {
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

export async function withTemporaryEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  const names = [
    "PATH",
    "TMPDIR",
    "MOCK_AWS_LOG",
    "MOCK_AWS_STATE_DIR",
    "MOCK_AWS_FAIL_OPS",
    "MOCK_AWS_HANG_OPS",
    "MOCK_AWS_SUCCESS_LOST_OPS",
    "MOCK_AWS_STATEFUL_RESOURCES",
    "MOCK_DESCRIBE_CLIENT_TOKEN_SEQUENCE",
    "MOCK_SECRET_SENTINEL",
    "RELEASE_E2E_GITHUB_TEST_TOKEN",
    "SELFHOST_BOX_SG_DELETE_ATTEMPTS",
    "SELFHOST_BOX_INSTANCE_RECOVERY_ATTEMPTS",
    "SELFHOST_BOX_RETRY_SLEEP_SECONDS",
    "SELFHOST_BOX_PROVISION_TIMEOUT_MS",
    "SELFHOST_BOX_TERMINATION_GRACE_MS",
  ];
  const prior = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    const value = environment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function writeExecutable(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o700 });
  chmodSync(file, 0o700);
}

const mockAwsScript = `#!/usr/bin/env bash
set -euo pipefail
list_has() { [[ ",\${1:-}," == *",$2,"* ]]; }
service="\${1:-}"
command="\${2:-}"
qualifier=""
if [[ "$service" == "ec2" && "$command" == "wait" ]]; then qualifier=":\${3:-}"; fi
operation="$service:$command$qualifier"
printf '%s|%s\\n' "$operation" "$*" >> "$MOCK_AWS_LOG"
counter_file="$MOCK_AWS_STATE_DIR/count-\${operation//:/_}"
operation_count=1
if [[ -f "$counter_file" ]]; then operation_count=$(( $(cat "$counter_file") + 1 )); fi
printf '%s\\n' "$operation_count" > "$counter_file"

if list_has "\${MOCK_AWS_HANG_OPS:-}" "$operation"; then
  while :; do /bin/sleep 1; done
fi

if [[ "\${MOCK_AWS_STATEFUL_RESOURCES:-0}" == "1" ]]; then
  case "$operation" in
    ec2:terminate-instances|ec2:wait:instance-terminated)
      [[ -f "$MOCK_AWS_STATE_DIR/instance" ]] || {
        printf 'An error occurred (InvalidInstanceID.NotFound)\\n' >&2; exit 255;
      }
      ;;
    ec2:delete-security-group)
      [[ -f "$MOCK_AWS_STATE_DIR/security-group" ]] || {
        printf 'An error occurred (InvalidGroup.NotFound)\\n' >&2; exit 255;
      }
      ;;
    ec2:delete-key-pair)
      [[ -f "$MOCK_AWS_STATE_DIR/key-pair" ]] || {
        printf 'An error occurred (InvalidKeyPair.NotFound)\\n' >&2; exit 255;
      }
      ;;
  esac
fi

if list_has "\${MOCK_AWS_SUCCESS_LOST_OPS:-}" "$operation"; then
  case "$operation" in
    ec2:run-instances) touch "$MOCK_AWS_STATE_DIR/instance" ;;
    ec2:terminate-instances) rm -f "$MOCK_AWS_STATE_DIR/instance" ;;
    ec2:delete-security-group) rm -f "$MOCK_AWS_STATE_DIR/security-group" ;;
    ec2:delete-key-pair) rm -f "$MOCK_AWS_STATE_DIR/key-pair" ;;
  esac
  printf '%s\\n' "$MOCK_SECRET_SENTINEL" >&2
  exit 42
fi
if list_has "\${MOCK_AWS_FAIL_OPS:-}" "$operation"; then
  printf '%s\\n' "$MOCK_SECRET_SENTINEL" >&2
  exit 42
fi

if [[ "\${MOCK_AWS_STATEFUL_RESOURCES:-0}" == "1" ]]; then
  case "$operation" in
    ec2:create-key-pair) touch "$MOCK_AWS_STATE_DIR/key-pair" ;;
    ec2:create-security-group) touch "$MOCK_AWS_STATE_DIR/security-group" ;;
    ec2:run-instances) touch "$MOCK_AWS_STATE_DIR/instance" ;;
    ec2:terminate-instances) rm -f "$MOCK_AWS_STATE_DIR/instance" ;;
    ec2:delete-security-group) rm -f "$MOCK_AWS_STATE_DIR/security-group" ;;
    ec2:delete-key-pair) rm -f "$MOCK_AWS_STATE_DIR/key-pair" ;;
  esac
fi

case "$operation" in
  ssm:get-parameters) printf 'ami-selfhost-test\\n' ;;
  ec2:create-key-pair) printf 'MOCK_PRIVATE_KEY_MATERIAL\\n' ;;
  ec2:create-security-group) printf 'sg-selfhost-test\\n' ;;
  ec2:run-instances) printf 'i-selfhost-test\\n' ;;
  ec2:describe-instances)
    if [[ "$*" == *"Name=client-token"* ]]; then
      if [[ -n "\${MOCK_DESCRIBE_CLIENT_TOKEN_SEQUENCE:-}" ]]; then
        IFS=',' read -r -a values <<< "$MOCK_DESCRIBE_CLIENT_TOKEN_SEQUENCE"
        value_index=$((operation_count - 1))
        if ((value_index >= \${#values[@]})); then value_index=$((\${#values[@]} - 1)); fi
        printf '%s\\n' "\${values[$value_index]}"
      elif [[ -f "$MOCK_AWS_STATE_DIR/instance" ]]; then
        printf 'i-selfhost-test\\n'
      else
        printf 'None\\n'
      fi
    else
      printf '203.0.113.10\\n'
    fi
    ;;
esac
`;
