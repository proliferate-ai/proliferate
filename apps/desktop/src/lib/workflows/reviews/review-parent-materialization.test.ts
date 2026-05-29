import { describe, expect, it } from "vitest";
import type { StartCodeReviewRequest } from "@anyharness/sdk";
import {
  materializeReviewParentSession,
  waitForReviewParentSessionMaterialization,
} from "@/lib/workflows/reviews/review-parent-materialization";

describe("review parent materialization", () => {
  it("replaces optimistic parent ids in review requests", () => {
    const request: StartCodeReviewRequest = {
      parentSessionId: "client-session:codex:1:abc123",
      maxRounds: 2,
      autoIterate: true,
      reviewers: [{
        personaId: "correctness",
        label: "Correctness",
        prompt: "Find bugs.",
        agentKind: "codex",
        modelId: "gpt-5.5",
        modeId: "full-access",
      }],
    };

    expect(materializeReviewParentSession(request, "runtime-session-1")).toEqual({
      ...request,
      parentSessionId: "runtime-session-1",
    });
  });

  it("waits for parent session materialization through provided deps", async () => {
    await expect(waitForReviewParentSessionMaterialization("client-session:codex:1", {
      getMaterializedSessionId: () => "runtime-session-1",
      subscribeToMaterializedSessionId: () => () => {},
    })).resolves.toBe("runtime-session-1");
  });
});
