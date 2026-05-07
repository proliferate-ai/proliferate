import { getProliferateClient } from "./client";
import type {
  AutomationListResponse,
  AutomationResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  CreateAutomationRequest,
  LocalAutomationAttachSessionRequest,
  LocalAutomationAttachWorkspaceRequest,
  LocalAutomationClaimActionRequest,
  LocalAutomationClaimListResponse,
  LocalAutomationClaimRequest,
  LocalAutomationFailRequest,
  LocalAutomationMutationResponse,
  UpdateAutomationRequest,
} from "./client";

export async function listAutomations(): Promise<AutomationListResponse> {
  return (await getProliferateClient().GET("/v1/automations")).data!;
}

export async function createAutomation(
  body: CreateAutomationRequest,
): Promise<AutomationResponse> {
  return (await getProliferateClient().POST("/v1/automations", { body })).data!;
}

export async function getAutomation(automationId: string): Promise<AutomationResponse> {
  return (
    await getProliferateClient().GET("/v1/automations/{automation_id}", {
      params: { path: { automation_id: automationId } },
    })
  ).data!;
}

export async function updateAutomation(
  automationId: string,
  body: UpdateAutomationRequest,
): Promise<AutomationResponse> {
  return (
    await getProliferateClient().PATCH("/v1/automations/{automation_id}", {
      params: { path: { automation_id: automationId } },
      body,
    })
  ).data!;
}

export async function pauseAutomation(automationId: string): Promise<AutomationResponse> {
  return (
    await getProliferateClient().POST("/v1/automations/{automation_id}/pause", {
      params: { path: { automation_id: automationId } },
    })
  ).data!;
}

export async function resumeAutomation(automationId: string): Promise<AutomationResponse> {
  return (
    await getProliferateClient().POST("/v1/automations/{automation_id}/resume", {
      params: { path: { automation_id: automationId } },
    })
  ).data!;
}

export async function runAutomationNow(
  automationId: string,
): Promise<AutomationRunResponse> {
  return (
    await getProliferateClient().POST("/v1/automations/{automation_id}/run-now", {
      params: { path: { automation_id: automationId } },
    })
  ).data!;
}

export async function listAutomationRuns(
  automationId: string,
  limit = 50,
): Promise<AutomationRunListResponse> {
  return (
    await getProliferateClient().GET("/v1/automations/{automation_id}/runs", {
      params: { path: { automation_id: automationId }, query: { limit } },
    })
  ).data!;
}

export async function claimLocalAutomationRuns(
  body: LocalAutomationClaimRequest,
): Promise<LocalAutomationClaimListResponse> {
  return (
    await getProliferateClient().POST("/v1/automations/executor/local/claims", { body })
  ).data!;
}

export async function heartbeatLocalAutomationRun(
  runId: string,
  body: LocalAutomationClaimActionRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/heartbeat",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function markLocalAutomationRunCreatingWorkspace(
  runId: string,
  body: LocalAutomationClaimActionRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/creating-workspace",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function attachLocalAutomationRunWorkspace(
  runId: string,
  body: LocalAutomationAttachWorkspaceRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/attach-workspace",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function markLocalAutomationRunProvisioningWorkspace(
  runId: string,
  body: LocalAutomationClaimActionRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/provisioning-workspace",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function markLocalAutomationRunCreatingSession(
  runId: string,
  body: LocalAutomationAttachWorkspaceRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/creating-session",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function attachLocalAutomationRunSession(
  runId: string,
  body: LocalAutomationAttachSessionRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/attach-session",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function markLocalAutomationRunDispatching(
  runId: string,
  body: LocalAutomationClaimActionRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/dispatching",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function markLocalAutomationRunDispatched(
  runId: string,
  body: LocalAutomationAttachSessionRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/dispatched",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}

export async function markLocalAutomationRunFailed(
  runId: string,
  body: LocalAutomationFailRequest,
): Promise<LocalAutomationMutationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/automations/executor/local/runs/{run_id}/failed",
      { params: { path: { run_id: runId } }, body },
    )
  ).data!;
}
