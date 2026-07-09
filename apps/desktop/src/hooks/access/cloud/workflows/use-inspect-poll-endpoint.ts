import { useMutation } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import {
  inspectPollEndpoint,
  type PollInspectRequest,
  type PollInspectResponse,
} from "@/lib/access/cloud/workflows";

/**
 * Flow 1 (workflow-from-poll, mental-model §5): probe a poll endpoint's
 * reserved `/init` path and derive a new workflow's starting inputs from the
 * sample item. No mutation state needs invalidating — nothing is persisted by
 * this call, it is a pure probe.
 */
export function useInspectPollEndpoint() {
  return useMutation<PollInspectResponse, Error, PollInspectRequest>({
    mutationFn: (body) => inspectPollEndpoint(body),
  });
}
