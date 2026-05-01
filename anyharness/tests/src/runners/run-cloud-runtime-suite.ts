import { spawn } from "node:child_process";
import path from "node:path";

type CloudProviderKind = "e2b" | "daytona";

interface CloudRuntimeDescription {
  provider: CloudProviderKind;
  cloudWorkspaceId: string;
  runtimeUrl: string;
  authToken: string;
  anyharnessWorkspaceId: string;
  readyAgentKinds: string[];
  repoPath: string;
}

async function main(): Promise<void> {
  const provider = parseProvider(process.argv[2]);
  let runtime: CloudRuntimeDescription | null = null;

  try {
    runtime = await runCloudDriver<CloudRuntimeDescription>(
      [
        "create-runtime",
        "--provider",
        provider,
      ],
      { expectJson: true },
    );
  } catch (error) {
    if (isProviderUnavailable(error)) {
      console.warn(
        `Skipping ${provider} cloud runtime suite because the provider is temporarily unavailable: ${errorMessage(error)}`,
      );
      return;
    }
    throw error;
  }

  try {
    await runVitest(runtime);
  } finally {
    if (runtime?.cloudWorkspaceId) {
      await runCloudDriver([
        "destroy-runtime",
        "--provider",
        provider,
        "--cloud-workspace-id",
        runtime.cloudWorkspaceId,
      ]);
    }
  }
}

function parseProvider(value: string | undefined): CloudProviderKind {
  if (value === "e2b" || value === "daytona") {
    return value;
  }
  throw new Error("expected provider argument: e2b | daytona");
}

function isProviderUnavailable(error: unknown): boolean {
  const message = errorMessage(error);
  return [
    "Organization is suspended",
    "Depleted credits",
    "Total CPU limit exceeded",
    "Total disk limit exceeded",
  ].some((marker) => message.includes(marker));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runVitest(runtime: CloudRuntimeDescription): Promise<void> {
  const env = {
    ...process.env,
    ANYHARNESS_TEST_BASE_URL: runtime.runtimeUrl,
    ANYHARNESS_TEST_AUTH_TOKEN: runtime.authToken,
    ANYHARNESS_TEST_WORKSPACE_PATH: runtime.repoPath,
    ANYHARNESS_TEST_PATH_ACCESS: "remote",
    ANYHARNESS_TEST_READY_AGENT_KINDS: runtime.readyAgentKinds.join(","),
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vitest", "run"], {
      cwd: path.resolve(import.meta.dirname, "../.."),
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`vitest failed for cloud runtime suite with exit code ${code}`));
    });
  });
}

async function runCloudDriver<T = void>(
  args: string[],
  options: { expectJson?: boolean } = {},
): Promise<T> {
  const repoRoot = path.resolve(import.meta.dirname, "../../../../");
  const serverDir = path.join(repoRoot, "server");
  const scriptPath = path.join("tests", "e2e", "infra", "cloud_runtime_driver.py");
  const expectJson = options.expectJson ?? false;

  return await new Promise<T>((resolve, reject) => {
    const child = spawn("uv", ["run", "python", scriptPath, ...args], {
      cwd: serverDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `cloud driver failed (${code})`));
        return;
      }
      if (!stdout.trim()) {
        if (expectJson) {
          reject(new Error(`cloud driver returned no JSON output for: ${args.join(" ")}`));
          return;
        }
        resolve(undefined as T);
        return;
      }
      resolve(JSON.parse(stdout) as T);
    });
  });
}

await main();
