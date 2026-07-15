import { useMemo } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft } from "@proliferate/ui/icons";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { useCoworkArtifactDetail } from "#product/hooks/access/anyharness/cowork/use-cowork-artifact-detail";
import { useCoworkArtifactManifest } from "#product/hooks/access/anyharness/cowork/use-cowork-artifact-manifest";
import { useCoworkArtifactRefresh } from "#product/hooks/cowork/lifecycle/use-cowork-artifact-refresh";
import { useCoworkUiStore } from "#product/stores/cowork/cowork-ui-store";
import { CoworkArtifactRow } from "#product/components/workspace/cowork/CoworkArtifactRow";
import { CoworkArtifactViewer } from "#product/components/workspace/cowork/CoworkArtifactViewer";

interface CoworkArtifactsPanelProps {
  workspaceId: string;
}

export function CoworkArtifactsPanel({
  workspaceId,
}: CoworkArtifactsPanelProps) {
  const selectedArtifactId = useCoworkUiStore(
    (state) => state.selectedArtifactIdByWorkspaceId[workspaceId] ?? null,
  );
  const setSelectedArtifactId = useCoworkUiStore((state) => state.setSelectedArtifactId);
  const { artifacts, isLoading, isFetching } = useCoworkArtifactManifest(workspaceId);
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  );
  const artifactDetailQuery = useCoworkArtifactDetail(workspaceId, selectedArtifact?.id ?? null);
  const { refresh } = useCoworkArtifactRefresh(workspaceId, selectedArtifact?.id ?? null);
  const isViewingArtifact = selectedArtifact !== null;
  const isEmpty = artifacts.length === 0 && !isLoading;
  const refreshButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => { void refresh(); }}
      loading={isFetching}
    >
      Refresh
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-tl-lg border-l border-t border-border bg-sidebar-background">
      {isViewingArtifact ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedArtifactId(workspaceId, null)}
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
            {isEmpty ? (
              <EmptyState
                title="No artifacts yet"
                description="Artifacts created by this thread will appear here."
                action={refreshButton}
                className="min-h-52 bg-background/40"
              />
            ) : (
              artifacts.map((artifact) => (
                <CoworkArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  active={artifact.id === selectedArtifactId}
                  onSelect={() => setSelectedArtifactId(workspaceId, artifact.id)}
                />
              ))
            )}
          </AutoHideScrollArea>
        </div>
      )}

      {!isEmpty && (
        <div className="flex items-center justify-end border-t border-sidebar-border/70 px-3 py-2">
          {refreshButton}
        </div>
      )}
    </div>
  );
}
