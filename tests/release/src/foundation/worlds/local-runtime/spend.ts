/**
 * Runner-side wrapper for `scripts/gateway_spend_probe.py` — the in-server-process
 * seam that reads the scoped virtual key's `token_id`, polls LiteLLM spend logs,
 * and runs the real usage importer. Same env/seam contract as
 * `fixtures/billing.ts`'s `runBillingProbe`: requires
 * `RELEASE_E2E_LOCAL_DATABASE_URL`; LiteLLM admin material stays private to the
 * server config the probe imports.
 */

import { spawn } from "node:child_process";
import path from "node:path";

export interface EnrollmentProbeResult {
  userId?: string;
  tokenId?: string | null;
  teamId?: string | null;
  billingSubjectId?: string;
  syncStatus?: string;
  budgetStatus?: string;
  gatewayEnabled?: boolean;
  grantedUsd?: number | null;
  remainingUsd?: number | null;
  error?: string;
}

export interface SpendLogRow {
  requestId: string;
  apiKey: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  spend: number;
  startTime: string | null;
  endTime: string | null;
}

export interface SpendLogsProbeResult {
  tokenId?: string;
  rows: SpendLogRow[];
  totalRowsScanned?: number;
  error?: string;
  detail?: string;
}

export interface UsageEvent {
  id: string;
  litellmRequestId: string;
  virtualKeyId: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
  sessionId: string | null;
  occurredAt: string | null;
  status: string;
}

export interface ImportReconcileResult {
  userId?: string;
  imported?: number;
  skippedDuplicate?: number;
  unresolved?: number;
  budgetStatus?: string | null;
  events?: UsageEvent[];
  grantedUsd?: number | null;
  remainingUsd?: number | null;
  error?: string;
  detail?: string;
}

const SCRIPT_RELATIVE = "../../../../scripts/gateway_spend_probe.py";

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.RELEASE_E2E_LOCAL_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "gateway_spend_probe: RELEASE_E2E_LOCAL_DATABASE_URL is required (see src/config/env-manifest.ts).",
    );
  }
  return databaseUrl;
}

async function runProbe<T>(args: readonly string[]): Promise<T> {
  const databaseUrl = requireDatabaseUrl();
  const scriptPath = path.resolve(import.meta.dirname, SCRIPT_RELATIVE);
  const serverDir = path.resolve(import.meta.dirname, "../../../../../../server");
  return new Promise<T>((resolve, reject) => {
    const child = spawn("uv", ["run", "python", scriptPath, ...args], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
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
        reject(new Error(`gateway_spend_probe.py (${args[0]}) exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const lastLine = stdout.trim().split("\n").pop() ?? "{}";
        resolve(JSON.parse(lastLine) as T);
      } catch (error) {
        reject(new Error(`gateway_spend_probe.py (${args[0]}) did not print valid JSON: ${stdout}\n${error}`));
      }
    });
  });
}

export function probeEnrollment(email: string): Promise<EnrollmentProbeResult> {
  return runProbe<EnrollmentProbeResult>(["enrollment", email]);
}

export function probeSpendLogs(
  tokenId: string,
  options: { sinceSeconds?: number } = {},
): Promise<SpendLogsProbeResult> {
  return runProbe<SpendLogsProbeResult>([
    "spend-logs",
    tokenId,
    "--since-seconds",
    String(options.sinceSeconds ?? 3600),
  ]);
}

export function probeImportAndReconcile(
  email: string,
  options: { sinceSeconds?: number } = {},
): Promise<ImportReconcileResult> {
  return runProbe<ImportReconcileResult>([
    "import-and-reconcile",
    email,
    "--since-seconds",
    String(options.sinceSeconds ?? 3600),
  ]);
}

export interface DeleteKeyProbeResult {
  tokenId?: string;
  deleted?: boolean;
  error?: string;
  detail?: string;
}

/**
 * Cleanup seam: delete a run-scoped LiteLLM virtual key by its `token_id`
 * through the server's own admin client (the runner never holds the master
 * key). Idempotent — an already-absent key is not an error.
 */
export function probeDeleteKey(tokenId: string): Promise<DeleteKeyProbeResult> {
  return runProbe<DeleteKeyProbeResult>(["delete-key", tokenId]);
}
