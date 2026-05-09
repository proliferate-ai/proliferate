import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";

export function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}
