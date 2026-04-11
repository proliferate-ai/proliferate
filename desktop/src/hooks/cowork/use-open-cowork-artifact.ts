import { useCallback } from "react";
import { runOpenCoworkArtifact } from "@/lib/domain/cowork/artifacts";
import { useCoworkUiStore } from "@/stores/cowork/cowork-ui-store";

export function useOpenCoworkArtifact() {
  const setArtifactPanelOpen = useCoworkUiStore((state) => state.setArtifactPanelOpen);
  const setSelectedArtifactId = useCoworkUiStore((state) => state.setSelectedArtifactId);

  const openArtifact = useCallback((workspaceId: string, artifactId: string) => {
    runOpenCoworkArtifact(
      { setArtifactPanelOpen, setSelectedArtifactId },
      workspaceId,
      artifactId,
    );
  }, [setArtifactPanelOpen, setSelectedArtifactId]);

  return { openArtifact };
}
