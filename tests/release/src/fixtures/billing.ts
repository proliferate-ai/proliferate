import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Billing fixture for T3-BILL-1 / T3-BILL-2
 * (specs/developing/testing/scenarios.md).
 *
 * `ORG_COMPUTE_ATTRIBUTION_FIXED` is the single flag governing the compute
 * attribution assertion, mirroring `GITHUB_LINK_GATE_WORKAROUND_ACTIVE` in
 * `identity.ts`. Two merges shaped it:
 *  - #1028 (2026-07-06) added the nullable `usage_segment.organization_id`
 *    column, stamped at segment-open from the owner's current membership, and
 *    keyed org/per-user compute-budget caps off it — attribution/enforcement
 *    *scope*. At that point who-pays had NOT changed yet.
 *  - #1047 (2026-07-09) changed who-pays: `resolve_billing_subject_id_for_user`
 *    now derives the paying subject from the same membership lookup, so an org
 *    member's compute bills the ORG billing subject (org Stripe customer + org
 *    grant pool), matching LLM. `billing_subject_id` and `organization_id` on a
 *    segment can no longer disagree. Org-less users still bill personal.
 * `true` here means org compute is billed to the org subject (both merges
 * landed), so the scenario asserts org-member segments invoice the org subject
 * — not the stale "compute always bills personal" behavior.
 *
 * LLM events attribute the same way: they carry `organization_id` and bill the
 * org subject where the member is enrolled, personal otherwise.
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
    /** #1028 attribution column; #1047 makes billingSubjectId agree with it for org members. */
    organizationId: string | null;
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
