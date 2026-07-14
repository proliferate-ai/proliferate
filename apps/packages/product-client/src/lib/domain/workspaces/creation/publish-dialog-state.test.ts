import { describe, expect, it } from "vitest";
import {
  openPublishDialogState,
} from "#product/lib/domain/workspaces/creation/publish-dialog-state";

describe("publish dialog state helpers", () => {
  it("opens publish without changing right panel state", () => {
    expect(openPublishDialogState("workspace-1", "publish")).toEqual({
      open: true,
      initialIntent: "publish",
      workspaceId: "workspace-1",
    });
  });
});
