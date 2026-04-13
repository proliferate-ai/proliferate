import { describe, expect, it } from "vitest";
import {
  buildCloudWorkspaceStatusScreenModel,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";

describe("buildCloudWorkspaceStatusScreenModel", () => {
  it("returns a passive status footer for billing blocks", () => {
    const model = buildCloudWorkspaceStatusScreenModel({
      actionBlockKind: "billing_quota",
      actionBlockReason: "ignored",
      postReadyPhase: null,
      postReadyFilesApplied: 0,
      postReadyFilesTotal: 0,
      status: "queued",
      statusDetail: null,
      lastError: null,
      repo: {
        owner: "openai",
        name: "proliferate",
        baseBranch: "main",
        branch: "feature/support-cleanup",
      },
    } as unknown as CloudWorkspaceSummary);

    expect(model.footer).toEqual({
      kind: "status",
      message: "Cloud usage is unavailable for this workspace right now.",
    });
    expect(model.description).toBe("Cloud usage is unavailable for this workspace right now.");
  });
});
