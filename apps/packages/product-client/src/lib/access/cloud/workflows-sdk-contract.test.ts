import { describe, expect, it, vi } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";

import {
  cancelWorkflowInvocation,
  deliverWorkflowInvocation,
  getWorkflowInvocation,
  listWorkflowInvocationHistory,
} from "@proliferate/cloud-sdk/client/workflows";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk/client/core";
import type {
  ManagedWorkflowHistoryItem,
  ManagedWorkflowHistoryResponse,
} from "@proliferate/cloud-sdk";
import {
  workflowRunDetailKey,
  workflowRunEligibilityKey,
  workflowRunHistoryKey,
} from "@proliferate/cloud-sdk-react/lib/query-keys";
import {
  mergeWorkflowRunIntoHistory,
  workflowRunNeedsPolling,
  workflowRunRefetchInterval,
} from "@proliferate/cloud-sdk-react/hooks/workflows";

describe("managed Workflow Cloud SDK contract", () => {
  it("pins detail, deliver, cancel, and cursor-scoped history requests", async () => {
    const requests: unknown[] = [];
    const requestJson = vi.fn(async (request: unknown) => {
      requests.push(request);
      return {};
    });
    const client = { requestJson } as unknown as ProliferateCloudClient;

    await getWorkflowInvocation("invocation-a", client);
    await deliverWorkflowInvocation("invocation-a", client);
    await cancelWorkflowInvocation("invocation-a", client);
    await listWorkflowInvocationHistory("definition-a", "cursor-a", client);

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/v1/workflow-invocations/{invocation_id}",
        pathParams: { invocation_id: "invocation-a" },
      },
      {
        method: "POST",
        path: "/v1/workflow-invocations/{invocation_id}/deliver",
        pathParams: { invocation_id: "invocation-a" },
      },
      {
        method: "POST",
        path: "/v1/workflow-invocations/{invocation_id}/cancel",
        pathParams: { invocation_id: "invocation-a" },
      },
      {
        method: "GET",
        path: "/v1/workflow-invocations",
        query: { workflowDefinitionId: "definition-a", cursor: "cursor-a" },
      },
    ]);
  });

  it("omits an absent history cursor rather than serializing undefined", async () => {
    const requestJson = vi.fn(async (_request: unknown) => ({}));
    const client = { requestJson } as unknown as ProliferateCloudClient;

    await listWorkflowInvocationHistory("definition-a", undefined, client);

    expect(requestJson).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/workflow-invocations",
      query: { workflowDefinitionId: "definition-a" },
    });
  });

  it("threads abort signals through every managed-run request", async () => {
    const requestJson = vi.fn(async (_request: unknown) => ({}));
    const client = { requestJson } as unknown as ProliferateCloudClient;
    const signal = new AbortController().signal;

    await getWorkflowInvocation("invocation-a", client, { signal });
    await deliverWorkflowInvocation("invocation-a", client, { signal });
    await cancelWorkflowInvocation("invocation-a", client, { signal });
    await listWorkflowInvocationHistory("definition-a", undefined, client, { signal });

    expect(requestJson.mock.calls.every(([request]) =>
      (request as { signal?: AbortSignal }).signal === signal
    )).toBe(true);
  });

  it("isolates eligibility, history and detail by server, identity, definition and run", () => {
    expect(workflowRunEligibilityKey("https://a", "user-a", "definition-a", 1))
      .not.toEqual(workflowRunEligibilityKey("https://b", "user-a", "definition-a", 1));
    expect(workflowRunEligibilityKey("https://a", "user-a", "definition-a", 1))
      .not.toEqual(workflowRunEligibilityKey("https://a", "user-a", "definition-a", 2));
    expect(workflowRunHistoryKey("https://a", "user-a", "definition-a"))
      .not.toEqual(workflowRunHistoryKey("https://a", "user-b", "definition-a"));
    expect(workflowRunHistoryKey("https://a", "user-a", "definition-a"))
      .not.toEqual(workflowRunHistoryKey("https://a", "user-a", "definition-b"));
    expect(workflowRunDetailKey("https://a", "user-a", "definition-a", "run-a"))
      .not.toEqual(workflowRunDetailKey("https://a", "user-a", "definition-a", "run-b"));
    expect(workflowRunHistoryKey("https://a", "user-a", "definition-a"))
      .not.toContain("cursor-a");
  });

  it("polls only nonterminal Cloud truth and stops at terminal or target loss", () => {
    const base = {
      managedExecution: {
        deliveryStatus: "queued",
        freshness: { status: "pending" },
        execution: null,
      },
    };
    expect(workflowRunNeedsPolling(base as never)).toBe(true);
    expect(workflowRunRefetchInterval(base as never)).toBe(3_000);
    expect(workflowRunNeedsPolling({
      managedExecution: {
        ...base.managedExecution,
        deliveryStatus: "accepted",
        freshness: { status: "live" },
        execution: { status: "completed", cancelRequestedAt: null },
      },
    } as never)).toBe(false);
    expect(workflowRunRefetchInterval({
      managedExecution: {
        ...base.managedExecution,
        freshness: { status: "target_lost" },
      },
    } as never)).toBe(false);
    expect(workflowRunNeedsPolling({
      managedExecution: {
        ...base.managedExecution,
        freshness: { status: "target_lost" },
      },
    } as never)).toBe(false);
  });

  it("projects known mutation results without synthesizing cursor order", () => {
    const current: InfiniteData<
      ManagedWorkflowHistoryResponse,
      string | undefined
    > = {
      pages: [
        { items: [historyItem("run-new", "queued"), historyItem("run-target", "queued")], nextCursor: "cursor-2" },
        { items: [historyItem("run-old", "accepted")], nextCursor: null },
      ],
      pageParams: [undefined, "cursor-2"],
    };
    const result = mergeWorkflowRunIntoHistory(
      current,
      managedRun("run-target", "delivery_cancelled") as never,
    );

    if (!result) throw new Error("known history cache unexpectedly missing");
    expect(result.pageParams).toEqual([undefined, "cursor-2"]);
    expect(result.pages.map((page) => page.nextCursor)).toEqual(["cursor-2", null]);
    expect(result.pages.flatMap((page) => page.items).map((item) => item.id))
      .toEqual(["run-new", "run-target", "run-old"]);
    expect(result.pages[0]?.items[1]?.deliveryStatus).toBe("delivery_cancelled");

    const absentOlder = mergeWorkflowRunIntoHistory(
      current,
      {
        ...managedRun("run-older", "accepted"),
        createdAt: "2026-07-15T00:00:00Z",
      } as never,
    );
    expect(absentOlder).toBe(current);
    expect(absentOlder?.pages.flatMap((page) => page.items).map((item) => item.id))
      .toEqual(["run-new", "run-target", "run-old"]);
  });
});

function historyItem(
  id: string,
  deliveryStatus: ManagedWorkflowHistoryItem["deliveryStatus"],
): ManagedWorkflowHistoryItem {
  return {
    id,
    workflowDefinitionId: "definition-a",
    definitionRevision: 1,
    title: "Triage",
    placementKind: "scratch",
    targetKind: "managedCloud",
    deliveryStatus,
    desiredState: "active",
    executionStatus: null,
    freshness: "pending",
    latestObservedAt: null,
    cloudWorkspaceId: null,
    sessionId: null,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
  };
}

function managedRun(id: string, deliveryStatus: string) {
  return {
    id,
    workflowDefinitionId: "definition-a",
    definitionRevision: 1,
    title: "Triage",
    placement: { kind: "scratch" },
    target: { kind: "managedCloud" },
    createdAt: "2026-07-16T00:00:00Z",
    managedExecution: {
      deliveryStatus,
      desiredState: deliveryStatus === "delivery_cancelled" ? "cancelled" : "active",
      execution: null,
      freshness: { status: "pending", latestObservedAt: null },
      correlations: { cloudWorkspaceId: null, sessionId: null },
      updatedAt: "2026-07-16T00:01:00Z",
    },
  };
}
