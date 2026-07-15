import { getLatencyFlowRequestHeaders } from "#product/lib/infra/measurement/measurement-port";

export function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}
