import { beforeEach, describe, expect, it } from "vitest";
import { runOpenCoworkArtifact } from "@/lib/domain/cowork/artifacts";
import { useCoworkUiStore } from "@/stores/cowork/cowork-ui-store";

describe("runOpenCoworkArtifact", () => {
  beforeEach(() => {
    useCoworkUiStore.setState({
      artifactPanelOpenByWorkspaceId: {},
      selectedArtifactIdByWorkspaceId: {},
    });
  });

  it("opens the artifact panel and selects the artifact for the workspace", () => {
    const store = useCoworkUiStore.getState();

    runOpenCoworkArtifact(
      {
        setArtifactPanelOpen: store.setArtifactPanelOpen,
        setSelectedArtifactId: store.setSelectedArtifactId,
      },
      "workspace-1",
      "artifact-1",
    );

    expect(useCoworkUiStore.getState().artifactPanelOpenByWorkspaceId).toEqual({
      "workspace-1": true,
    });
    expect(useCoworkUiStore.getState().selectedArtifactIdByWorkspaceId).toEqual({
      "workspace-1": "artifact-1",
    });
  });
});
