import { describe, expect, it, vi } from "vitest";
import { runOpenCoworkArtifact } from "@/lib/domain/cowork/artifacts";

describe("runOpenCoworkArtifact", () => {
  it("opens the artifact panel and selects the artifact for the workspace", () => {
    const setArtifactPanelOpen = vi.fn();
    const setSelectedArtifactId = vi.fn();

    runOpenCoworkArtifact(
      {
        setArtifactPanelOpen,
        setSelectedArtifactId,
      },
      "workspace-1",
      "artifact-1",
    );

    expect(setArtifactPanelOpen).toHaveBeenCalledWith("workspace-1", true);
    expect(setSelectedArtifactId).toHaveBeenCalledWith("workspace-1", "artifact-1");
  });
});
