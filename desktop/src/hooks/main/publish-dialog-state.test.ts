import { describe, expect, it } from "vitest";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  openPublishDialogState,
  reviewDiffsFromPublishState,
} from "./publish-dialog-state";

describe("publish dialog state helpers", () => {
  it("opens publish without changing right panel state", () => {
    expect(openPublishDialogState("workspace-1", "publish")).toEqual({
      open: true,
      initialIntent: "publish",
      workspaceId: "workspace-1",
    });
  });

  it("moves explicit review diffs into the changes panel", () => {
    expect(reviewDiffsFromPublishState()).toEqual({
      publishDialog: CLOSED_PUBLISH_DIALOG_STATE,
      rightPanelOpen: true,
      rightPanelMode: "changes",
    });
  });
});
