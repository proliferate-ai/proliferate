import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ApiClient } from "../../fixtures/http.js";
import {
  BATTERY_FLOW_REF,
  assertStagingLane,
  authenticateBattery,
  battRunId,
  durableOrgId,
  hasErrorCode,
  isSurfaceAbsent,
  rethrowAsExpectedFail,
} from "./common.js";

interface EnrollmentTicket {
  enrollmentToken: string;
  expiresAt: string;
}

interface WorkerEnrollResponse {
  workerId: string;
  workerToken: string;
}

/**
 * T3-BATT-WORKER-1 — a worker enrolls against the staging seam, live.
 *
 * Journey (the desktop-host → seam handshake, driven through the real routes):
 * the signed-in user mints a desktop enrollment ticket
 * (`POST /v1/cloud/workers/desktop/enrollment`), a worker redeems it
 * (`POST /v1/cloud/worker/enroll` → worker id + worker token), and the worker
 * heartbeats with its token (`POST /v1/cloud/worker/heartbeat`). The ticket is
 * revoked afterwards so the durable fixture is left as found.
 *
 * EXPECTED-FAIL today (ruled 2026-08-26): staging runs no worker/background
 * plane (`WORKERS_DEPLOY_ENABLED=false`, no `ECS_WORKER_SERVICE`). The gap's
 * EXACT signatures: the product's own `cloud_worker_misconfigured` code
 * (seam/workers/service.py), or a strictly absent surface (404/405/501).
 * A generic 500/502/503 or an auth/validation failure is a REAL red.
 */
export const t3BattWorker1: ScenarioDefinition = {
  id: "T3-BATT-WORKER-1",
  title: "battery: worker enrollment handshake (ticket → enroll → heartbeat)",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user; mint a desktop enrollment ticket for the durable org" },
    { description: "redeem the ticket as a worker: POST /v1/cloud/worker/enroll → worker id + token" },
    { description: "heartbeat with the worker token; revoke the desktop enrollment afterwards" },
    { description: "expected-fail today only on the surface-unavailable signature (no worker plane on staging)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-WORKER-1", ctx);
    const { serverUrl, client } = await authenticateBattery("T3-BATT-WORKER-1", ctx);
    const installId = battRunId();

    try {
      const ticket = await client.post<EnrollmentTicket>("/v1/cloud/workers/desktop/enrollment", {
        desktopInstallId: installId,
        organizationId: durableOrgId() ?? null,
      });
      assert.ok(ticket.enrollmentToken, "T3-BATT-WORKER-1: enrollment must mint a token");

      const anonymous = new ApiClient({ baseUrl: serverUrl });
      const enrolled = await anonymous.post<WorkerEnrollResponse>("/v1/cloud/worker/enroll", {
        enrollmentToken: ticket.enrollmentToken,
        machineFingerprint: `battery-${installId}`,
        hostname: "release-e2e-battery",
        workerVersion: "e2e-battery",
        anyharnessVersion: "e2e-battery",
      });
      assert.ok(enrolled.workerId && enrolled.workerToken, "T3-BATT-WORKER-1: enroll must return a worker id + token");

      const worker = anonymous.withBearerToken(enrolled.workerToken);
      const heartbeat = await worker.post<{ workerId?: string }>("/v1/cloud/worker/heartbeat", {
        status: "idle",
        workerVersion: "e2e-battery",
        anyharnessVersion: "e2e-battery",
      });
      assert.ok(heartbeat, "T3-BATT-WORKER-1: heartbeat must answer");

      console.log(`[T3-BATT-WORKER-1/staging] green: worker ${enrolled.workerId} enrolled and heartbeat accepted.`);
    } catch (error) {
      rethrowAsExpectedFail(
        "T3-BATT-WORKER-1",
        error,
        (observed) => hasErrorCode(observed, "cloud_worker_misconfigured") || isSurfaceAbsent(observed),
        "worker enrollment not served on staging — no worker/background plane is deployed there " +
          "(WORKERS_DEPLOY_ENABLED=false); the environments/seam work owns the fix",
      );
    } finally {
      try {
        await client.post("/v1/cloud/workers/desktop/revoke", { desktopInstallId: installId });
      } catch {
        // Best-effort cleanup; a failed revoke never changes the verdict.
      }
    }
  },
};
