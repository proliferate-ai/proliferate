import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Billing fixture for T3-BILL-1 / T3-BILL-2
 * (specs/developing/testing/scenarios.md).
 *
 * `ORG_COMPUTE_ATTRIBUTION_FIXED` is the single flag governing the compute
 * attribution assertion, mirroring `GITHUB_LINK_GATE_WORKAROUND_ACTIVE` in
 * `identity.ts`. PR #1028 (org compute attribution — nullable
 * `usage_segment.organization_id`, stamped at segment-open from the owner's
 * membership) merged 2026-07-06: `usage_segment` now carries `organization_id`
 * and org/per-user compute-budget caps enforce off it. That is attribution and
 * enforcement *scope* only — who pays did not change. `billing_subject_id` on
 * the segment stays the workspace owner's *personal* billing subject in both
 * the pre- and post-#1028 worlds; #1028's PR body explicitly defers "invoice
 * org compute to the org subject" as an open question. `true` here just means
 * the org-attribution column/enforcement exists to assert against.
 *
 * LLM events are unaffected by any of this: they carry `organization_id`
 * today and are correctly org-attributed where the subject is enrolled.
 */
export const ORG_COMPUTE_ATTRIBUTION_FIXED = true;

export type BillingSubjectKind = "personal" | "organization";

export interface MeterRecords {
  userId: string;
  subjects: Partial<Record<BillingSubjectKind, string>>;
  usageSegmentHasOrgColumn: boolean;
  usageSegments: Array<{
    id: string;
    billingSubjectId: string;
    sandboxId: string;
    startedAt: string | null;
    endedAt: string | null;
    openedBy: string;
    closedBy: string | null;
    isBillable: boolean;
  }>;
  llmUsageEvents: Array<{
    id: string;
    billingSubjectId: string | null;
    organizationId: string | null;
    virtualKeyId: string | null;
    model: string | null;
    totalTokens: number;
    costUsd: number | null;
    sessionId: string | null;
  }>;
  grants: Array<{
    id: string;
    billingSubjectId: string;
    grantType: string;
    hoursGranted: number;
    remainingSeconds: number;
  }>;
  grantConsumptions: Array<{ billingSubjectId: string; usageSegmentId: string; seconds: number }>;
  error?: string;
}

export interface DrainGrantsResult {
  drained: number;
  subjects: Partial<Record<BillingSubjectKind, string>>;
  error?: string;
}

/**
 * Runs `tests/release/scripts/billing_probe.py` in-process against the local
 * profile DB (same seam and env contract as T3-PROV-1's `prov1_fallback.py`),
 * returning the parsed JSON. Requires `RELEASE_E2E_LOCAL_DATABASE_URL`.
 */
export async function runBillingProbe(
  command: "meter-records" | "drain-grants",
  email: string,
  options: { sinceSeconds?: number } = {},
): Promise<MeterRecords | DrainGrantsResult> {
  const databaseUrl = process.env.RELEASE_E2E_LOCAL_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "billing_probe: RELEASE_E2E_LOCAL_DATABASE_URL is required (see src/config/env-manifest.ts) — e.g. " +
        "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate_dev_<profile>",
    );
  }
  const scriptPath = path.resolve(import.meta.dirname, "../../scripts/billing_probe.py");
  const serverDir = path.resolve(import.meta.dirname, "../../../../server");
  const args = [scriptPath, command, email];
  if (command === "meter-records") {
    args.push("--since-seconds", String(options.sinceSeconds ?? 3600));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", ...args], {
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
        reject(new Error(`billing_probe.py (${command}) exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const lastLine = stdout.trim().split("\n").pop() ?? "{}";
        resolve(JSON.parse(lastLine));
      } catch (error) {
        reject(new Error(`billing_probe.py (${command}) did not print valid JSON: ${stdout}\n${error}`));
      }
    });
  });
}
