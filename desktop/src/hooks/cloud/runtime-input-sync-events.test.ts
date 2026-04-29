import { describe, expect, it } from "vitest";
import { emitRuntimeInputSyncEvent, subscribeRuntimeInputSyncEvents } from "./runtime-input-sync-events";

describe("runtime input sync events", () => {
  it("emits only normalized descriptors", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeRuntimeInputSyncEvents((event) => events.push(event));

    emitRuntimeInputSyncEvent({
      trigger: "repo_config_mutation",
      descriptors: [
        {
          kind: "repo_tracked_file",
          gitOwner: " acme ",
          gitRepoName: " rocket ",
          localWorkspaceId: " workspace ",
          relativePath: "config/.env",
        },
        {
          kind: "repo_tracked_file",
          gitOwner: "acme",
          gitRepoName: "rocket",
          localWorkspaceId: "workspace",
          relativePath: "../secret",
        },
      ],
    });
    unsubscribe();

    expect(events).toEqual([{
      trigger: "repo_config_mutation",
      descriptors: [{
        kind: "repo_tracked_file",
        gitOwner: "acme",
        gitRepoName: "rocket",
        localWorkspaceId: "workspace",
        relativePath: "config/.env",
      }],
    }]);
  });
});
