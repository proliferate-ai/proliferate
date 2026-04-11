import type { Workspace } from "@anyharness/sdk";
import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "@/components/ui/icons";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { useCoworkArtifactDetail } from "@/hooks/cowork/use-cowork-artifact-detail";
import { useCoworkArtifactManifest } from "@/hooks/cowork/use-cowork-artifact-manifest";
import { useCoworkArtifactRefresh } from "@/hooks/cowork/use-cowork-artifact-refresh";
import { useCoworkUiStore } from "@/stores/cowork/cowork-ui-store";
import { CoworkArtifactRow } from "./CoworkArtifactRow";
import { CoworkArtifactViewer } from "./CoworkArtifactViewer";

interface CoworkArtifactsPanelProps {
  workspace: Workspace;
}

export function CoworkArtifactsPanel({
  workspace,
}: CoworkArtifactsPanelProps) {
  const selectedArtifactId = useCoworkUiStore(
    (state) => state.selectedArtifactIdByWorkspaceId[workspace.id] ?? null,
  );
  const setSelectedArtifactId = useCoworkUiStore((state) => state.setSelectedArtifactId);
  const { artifacts, isLoading, isFetching } = useCoworkArtifactManifest(workspace.id);
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  );
  const artifactDetailQuery = useCoworkArtifactDetail(workspace.id, selectedArtifact?.id ?? null);
  const { refresh } = useCoworkArtifactRefresh(workspace.id, selectedArtifact?.id ?? null);
  const isViewingArtifact = selectedArtifact !== null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-tl-lg border-l border-t border-border bg-sidebar-background">
      {isViewingArtifact ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedArtifactId(workspace.id, null)}
              className="-ml-2 shrink-0"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            {selectedArtifact.description && (
              <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {selectedArtifact.description}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <CoworkArtifactViewer
              artifactDetail={artifactDetailQuery.artifactDetail}
              isLoading={artifactDetailQuery.isLoading || artifactDetailQuery.isFetching}
              errorMessage={artifactDetailQuery.errorMessage}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <AutoHideScrollArea
            className="h-full"
            viewportClassName="px-3 py-3"
            contentClassName="flex flex-col gap-1"
          >
            {artifacts.length === 0 && !isLoading ? (
              <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                No artifacts yet.
              </div>
            ) : (
              artifacts.map((artifact) => (
                <CoworkArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  active={artifact.id === selectedArtifactId}
                  onSelect={() => setSelectedArtifactId(workspace.id, artifact.id)}
                />
              ))
            )}
          </AutoHideScrollArea>
        </div>
      )}

      <div className="flex items-center justify-end border-t border-sidebar-border/70 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void refresh(); }}
          loading={isFetching}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}
