import { describe, expect, it } from "vitest";
import {
  openPublishDialogState,
} from "./publish-dialog-state";

describe("publish dialog state helpers", () => {
  it("opens publish without changing right panel state", () => {
    expect(openPublishDialogState("workspace-1", "publish")).toEqual({
      open: true,
      initialIntent: "publish",
      initialStep: "actions",
      workspaceId: "workspace-1",
    });
  });

  it("opens pull_request intent on the pull_request step", () => {
    expect(openPublishDialogState("workspace-1", "pull_request")).toEqual({
      open: true,
      initialIntent: "pull_request",
      initialStep: "pull_request",
      workspaceId: "workspace-1",
    });
  });
});
