import type {
  HandoffPlanRequest,
  HandoffPlanResponse,
  ListProposedPlansResponse,
  PlanDecisionRequest,
  PlanDecisionResponse,
  ProposedPlanDetail,
  ProposedPlanDocumentResponse,
  ProposedPlanSummary,
} from "../types/plans.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class PlansClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ProposedPlanSummary[]> {
    const response = await this.transport.get<ListProposedPlansResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans`,
      options,
    );
    return response.plans;
  }

  async get(
    workspaceId: string,
    planId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ProposedPlanDetail> {
    return this.transport.get<ProposedPlanDetail>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans/${encodeURIComponent(planId)}`,
      options,
    );
  }

  async getDocument(
    workspaceId: string,
    planId: string,
    options?: AnyHarnessRequestOptions & { materialize?: boolean },
  ): Promise<ProposedPlanDocumentResponse> {
    const query = options?.materialize ? "?materialize=true" : "";
    return this.transport.get<ProposedPlanDocumentResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans/${encodeURIComponent(planId)}/document${query}`,
      options,
    );
  }

  async approve(
    workspaceId: string,
    planId: string,
    input: PlanDecisionRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<PlanDecisionResponse> {
    return this.transport.post<PlanDecisionResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans/${encodeURIComponent(planId)}/approve`,
      input,
      options,
    );
  }

  async reject(
    workspaceId: string,
    planId: string,
    input: PlanDecisionRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<PlanDecisionResponse> {
    return this.transport.post<PlanDecisionResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans/${encodeURIComponent(planId)}/reject`,
      input,
      options,
    );
  }

  async handoff(
    workspaceId: string,
    planId: string,
    input: HandoffPlanRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<HandoffPlanResponse> {
    return this.transport.post<HandoffPlanResponse>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plans/${encodeURIComponent(planId)}/handoff`,
      input,
      options,
    );
  }
}
