/**
 * Direct E2B verification/action backdoor for T3-PROV-2 and T3-SEC-MAT-1
 * (specs/developing/testing/scenarios.md). Thin spawn wrapper around
 * `../../scripts/e2b_sandbox_probe.py` -- mirrors the shape of
 * `github-app-seed.ts` / t3-prov-1's `runFallbackScript`.
 *
 * Why this exists: the product API never exposes a cloud sandbox's provider
 * (E2B) sandbox id (`CloudSandboxResponse` in
 * server/proliferate/server/cloud/cloud_sandboxes/models.py serializes only
 * the internal `cloud_sandbox.id`), and there is no product-level pause
 * endpoint at all -- pause only ever arrives via E2B's own idle-timeout
 * lifecycle or the billing reconciler
 * (server/proliferate/server/cloud/webhooks/service.py). Pablo has
 * authorized direct use of the E2B API key for verification of ground truth,
 * and -- since no product lever exists -- for driving the pause action
 * itself in T3-PROV-2.
 *
 * No DB access is needed: every personal cloud sandbox is tagged at create
 * time with `metadata={"proliferate_cloud_sandbox_id": str(sandbox.id)}`
 * (server/proliferate/server/cloud/materialization/sandbox_io/connect.py),
 * the exact id the product API already returns from `GET
 * /v1/cloud/cloud-sandbox`. `findProviderSandbox` resolves the provider
 * sandbox purely via E2B's own list API filtered on that metadata key.
 */

import { spawn } from "node:child_process";
import path from "node:path";

/** One live provider (E2B) sandbox tagged with a given cloud_sandbox_id. */
export interface E2BSandboxMatch {
  providerSandboxId: string;
  state: "running" | "paused";
  /** The E2B template id the sandbox was actually spawned from (observed, for MCW-003). */
  templateId: string | null;
  /** RFC3339 provider start time, or null (the observed running-interval source for step 4). */
  startedAt: string | null;
}

export interface E2BFindResult {
  /** First match's id (back-compat for existing single-match callers). */
  providerSandboxId: string | null;
  /** First match's state (back-compat). */
  state: "running" | "paused" | null;
  /**
   * EVERY live provider sandbox tagged with the queried cloud_sandbox_id.
   * CLOUD-PROVISION-1 step 3 asserts exactly one; more than one is the
   * duplicate/orphan anomaly the scenario proves the product does not produce
   * (MCW-002). Absent on older probe output → callers default to `[]`.
   */
  matches?: E2BSandboxMatch[];
  /** `matches.length` from the probe (absent on older output). */
  count?: number;
}

export interface E2BStateResult {
  state: "running" | "paused";
}

export interface E2BTemplateSweepResult {
  matches: Array<{
    providerSandboxId: string;
    state: "running" | "paused";
    templateId: string;
  }>;
  count: number;
}

export interface E2BTemplateInventoryRow {
  templateId: string;
  aliases: string[];
  names: string[];
}

export interface E2BExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface E2BReadResult {
  content: string | null;
  error: string | null;
}

/** True when RELEASE_E2E_E2B_API_KEY is present -- gates every function below. */
export function e2bVerificationAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RELEASE_E2E_E2B_API_KEY?.trim());
}

function requireApiKey(env: NodeJS.ProcessEnv): string {
  const key = env.RELEASE_E2E_E2B_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "e2b-verify: RELEASE_E2E_E2B_API_KEY is not set. This is the E2B ground-truth/pause backdoor " +
        "authorized for T3-PROV-2/T3-SEC-MAT-1 verification -- see src/config/env-manifest.ts.",
    );
  }
  return key;
}

async function runProbe<T>(args: readonly string[], env: NodeJS.ProcessEnv, stdin?: string): Promise<T> {
  const apiKey = requireApiKey(env);
  const scriptPath = path.resolve(import.meta.dirname, "../../scripts/e2b_sandbox_probe.py");
  const serverDir = path.resolve(import.meta.dirname, "../../../../server");

  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", scriptPath, ...args], {
      cwd: serverDir,
      // Only E2B_API_KEY crosses into the child's env for this script -- it
      // needs nothing else (no DATABASE_URL, no product server env at all).
      env: { ...process.env, E2B_API_KEY: apiKey },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        // Surface the raw probe stderr to the runner stream (the make log, NOT
        // persisted evidence) so an in-sandbox exec failure names itself instead
        // of being redacted to "(response body withheld)".
        process.stderr.write(
          `[e2b-verify] probe ${args[0]} exited ${code}: ${(stderr || stdout).trim().slice(0, 800)}\n`,
        );
        reject(new Error(`e2b_sandbox_probe.py ${args[0]} exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const lastLine = stdout.trim().split("\n").pop() ?? "{}";
        resolve(JSON.parse(lastLine) as T);
      } catch (error) {
        reject(new Error(`e2b_sandbox_probe.py ${args[0]} did not print valid JSON: ${stdout}\n${error}`));
      }
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/** Resolves a cloud sandbox's provider (E2B) sandbox id purely via E2B metadata -- no DB access. */
export async function findProviderSandbox(
  cloudSandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2BFindResult> {
  return runProbe<E2BFindResult>(["find", cloudSandboxId], env);
}

/** Exhaustively lists live sandboxes whose observed template id exactly matches. */
export async function listProviderSandboxesByTemplate(
  templateId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2BTemplateSweepResult> {
  return runProbe<E2BTemplateSweepResult>(["list-template", templateId], env);
}

/** Lists strict immutable template identities and aliases through the authenticated E2B CLI. */
export async function listProviderTemplates(
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2BTemplateInventoryRow[]> {
  const apiKey = env.RELEASE_E2E_E2B_API_KEY?.trim() || env.E2B_API_KEY?.trim();
  const teamId = env.RELEASE_E2E_E2B_TEAM_ID?.trim() || env.E2B_TEAM_ID?.trim();
  if (!apiKey || !teamId) {
    throw new Error("E2B template inventory requires the qualification API key and team id.");
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run(
    "e2b",
    // `--team` is explicitly a team-ID selector in the E2B CLI. This is
    // distinct from the template-name namespace, which uses the human slug.
    ["template", "list", "--team", teamId, "--format", "json"],
    {
      env: { ...env, E2B_API_KEY: apiKey },
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout.toString().trim()) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("E2B template inventory returned a non-array JSON payload.");
  }
  return parsed.map((row): E2BTemplateInventoryRow => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("E2B template inventory returned a malformed row.");
    }
    const value = row as Record<string, unknown>;
    const id = typeof value.templateID === "string" ? value.templateID : value.templateId;
    if (typeof id !== "string" || !id) {
      throw new Error("E2B template inventory row has no immutable template id.");
    }
    const aliases = Array.isArray(value.aliases) ? value.aliases : [];
    const names = Array.isArray(value.names) ? value.names : [];
    if (aliases.some((name) => typeof name !== "string") || names.some((name) => typeof name !== "string")) {
      throw new Error("E2B template inventory row has malformed aliases/names.");
    }
    return { templateId: id, aliases: aliases as string[], names: names as string[] };
  });
}

/** Lists immutable template ids directly through the authenticated E2B CLI. */
export async function listProviderTemplateIds(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  return (await listProviderTemplates(env)).map((row) => row.templateId);
}

export async function getProviderSandboxState(
  providerSandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2BStateResult> {
  return runProbe<E2BStateResult>(["state", providerSandboxId], env);
}

/** Idempotent provider-sandbox kill (`killed: false` means the exact id was already absent). */
export async function killProviderSandbox(
  providerSandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ killed: boolean }> {
  return runProbe<{ killed: boolean }>(["kill", providerSandboxId], env);
}

/** Pauses the sandbox directly via the E2B SDK -- there is no product pause endpoint. */
export async function pauseProviderSandbox(
  providerSandboxId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ paused: boolean }> {
  return runProbe<{ paused: boolean }>(["pause", providerSandboxId], env);
}

export async function execInProviderSandbox(
  providerSandboxId: string,
  command: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2BExecResult> {
  // `--` terminates argparse option parsing: exec'd argv routinely contains
  // dash-prefixed tokens (`sh -c …`, `… --version`) that argparse would
  // otherwise reject with exit 2 before any API call.
  return runProbe<E2BExecResult>(["exec", providerSandboxId, "--", ...command], env);
}

/** Writes `content` to `path` inside the sandbox via `sandbox.files.write` (content passed over stdin, never argv). */
export async function writeProviderSandboxFile(
  providerSandboxId: string,
  filePath: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ written: boolean }> {
  return runProbe<{ written: boolean }>(["write", providerSandboxId, filePath, "--content-stdin"], env, content);
}

export async function readProviderSandboxFile(
  providerSandboxId: string,
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2BReadResult> {
  return runProbe<E2BReadResult>(["read", providerSandboxId, filePath], env);
}
