import { getProliferateClient } from "./client";
import type {
  AutomationListResponse,
  AutomationResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  CreateAutomationRequest,
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
