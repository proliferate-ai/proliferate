import type { Schema } from "./schema.js";

export type IntegrationActionApproval = Schema<"ActionApprovalResponse">;
export type IntegrationActionApprovalStatus = IntegrationActionApproval["status"];
export type IntegrationActionApprovalListResponse =
  Schema<"ActionApprovalListResponse">;
export type IntegrationActionApprovalTransitionResponse =
  Schema<"ActionApprovalTransitionResponse">;
export type IntegrationActionApprovalTransitionResult =
  IntegrationActionApprovalTransitionResponse["result"];
