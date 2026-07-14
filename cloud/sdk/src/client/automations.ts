import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AutomationListResponse,
  AutomationOwnerScope,
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
} from "../types/index.js";

export interface ListAutomationsOptions {
  ownerScope?: AutomationOwnerScope;
  organizationId?: string | null;
}

export async function listAutomations(
  client?: ProliferateCloudClient,
): Promise<AutomationListResponse>;
export async function listAutomations(
  options?: ListAutomationsOptions,
  client?: ProliferateCloudClient,
): Promise<AutomationListResponse>;
export async function listAutomations(
  optionsOrClient: ListAutomationsOptions | ProliferateCloudClient = {},
  maybeClient?: ProliferateCloudClient,
): Promise<AutomationListResponse> {
  const { options, client } = resolveListArgs(optionsOrClient, maybeClient);
  return client.requestJson<AutomationListResponse>({
    method: "GET",
    path: "/v1/automations",
    query: {
      ownerScope: options.ownerScope,
      organizationId: options.organizationId,
    },
  });
}

export async function createAutomation(
  body: CreateAutomationRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationResponse> {
  return client.requestJson<AutomationResponse>({
    method: "POST",
    path: "/v1/automations",
    body,
  });
}

export async function getAutomation(
  automationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationResponse> {
  return client.requestJson<AutomationResponse>({
    method: "GET",
    path: "/v1/automations/{automation_id}",
    pathParams: { automation_id: automationId },
  });
}

export async function updateAutomation(
  automationId: string,
  body: UpdateAutomationRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationResponse> {
  return client.requestJson<AutomationResponse>({
    method: "PATCH",
    path: "/v1/automations/{automation_id}",
    pathParams: { automation_id: automationId },
    body,
  });
}

export async function pauseAutomation(
  automationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationResponse> {
  return pauseAutomationWithClient(automationId, client);
}

export async function pauseAutomationWithClient(
  automationId: string,
  client: ProliferateCloudClient,
): Promise<AutomationResponse> {
  return client.requestJson<AutomationResponse>({
    method: "POST",
    path: "/v1/automations/{automation_id}/pause",
    pathParams: { automation_id: automationId },
  });
}

export async function resumeAutomation(
  automationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationResponse> {
  return resumeAutomationWithClient(automationId, client);
}

export async function resumeAutomationWithClient(
  automationId: string,
  client: ProliferateCloudClient,
): Promise<AutomationResponse> {
  return client.requestJson<AutomationResponse>({
    method: "POST",
    path: "/v1/automations/{automation_id}/resume",
    pathParams: { automation_id: automationId },
  });
}

export async function runAutomationNow(
  automationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationRunResponse> {
  return runAutomationNowWithClient(automationId, client);
}

export async function runAutomationNowWithClient(
  automationId: string,
  client: ProliferateCloudClient,
): Promise<AutomationRunResponse> {
  return client.requestJson<AutomationRunResponse>({
    method: "POST",
    path: "/v1/automations/{automation_id}/run-now",
    pathParams: { automation_id: automationId },
  });
}

export async function listAutomationRuns(
  automationId: string,
  limit = 50,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AutomationRunListResponse> {
  return client.requestJson<AutomationRunListResponse>({
    method: "GET",
    path: "/v1/automations/{automation_id}/runs",
    pathParams: { automation_id: automationId },
    query: { limit },
  });
}

export async function claimLocalAutomationRuns(
  body: LocalAutomationClaimRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationClaimListResponse> {
  return client.requestJson<LocalAutomationClaimListResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/claims",
    body,
  });
}

export async function heartbeatLocalAutomationRun(
  runId: string,
  body: LocalAutomationClaimActionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/heartbeat",
    pathParams: { run_id: runId },
    body,
  });
}

export async function markLocalAutomationRunCreatingWorkspace(
  runId: string,
  body: LocalAutomationClaimActionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/creating-workspace",
    pathParams: { run_id: runId },
    body,
  });
}

export async function attachLocalAutomationRunWorkspace(
  runId: string,
  body: LocalAutomationAttachWorkspaceRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/attach-workspace",
    pathParams: { run_id: runId },
    body,
  });
}

export async function markLocalAutomationRunProvisioningWorkspace(
  runId: string,
  body: LocalAutomationClaimActionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/provisioning-workspace",
    pathParams: { run_id: runId },
    body,
  });
}

export async function markLocalAutomationRunCreatingSession(
  runId: string,
  body: LocalAutomationAttachWorkspaceRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/creating-session",
    pathParams: { run_id: runId },
    body,
  });
}

export async function attachLocalAutomationRunSession(
  runId: string,
  body: LocalAutomationAttachSessionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/attach-session",
    pathParams: { run_id: runId },
    body,
  });
}

export async function markLocalAutomationRunDispatching(
  runId: string,
  body: LocalAutomationClaimActionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/dispatching",
    pathParams: { run_id: runId },
    body,
  });
}

export async function markLocalAutomationRunDispatched(
  runId: string,
  body: LocalAutomationAttachSessionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/dispatched",
    pathParams: { run_id: runId },
    body,
  });
}

export async function markLocalAutomationRunFailed(
  runId: string,
  body: LocalAutomationFailRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<LocalAutomationMutationResponse> {
  return client.requestJson<LocalAutomationMutationResponse>({
    method: "POST",
    path: "/v1/automations/executor/local/runs/{run_id}/failed",
    pathParams: { run_id: runId },
    body,
  });
}

function resolveListArgs(
  optionsOrClient: ListAutomationsOptions | ProliferateCloudClient,
  maybeClient?: ProliferateCloudClient,
): {
  options: ListAutomationsOptions;
  client: ProliferateCloudClient;
} {
  if (isProliferateCloudClient(optionsOrClient)) {
    return { options: {}, client: optionsOrClient };
  }
  return {
    options: optionsOrClient,
    client: maybeClient ?? getProliferateClient(),
  };
}

function isProliferateCloudClient(value: unknown): value is ProliferateCloudClient {
  return Boolean(
    value
    && typeof value === "object"
    && "requestJson" in value
    && "buildUrl" in value,
  );
}
