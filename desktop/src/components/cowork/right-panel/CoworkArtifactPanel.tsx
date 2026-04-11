import type { WorkspaceArtifactSummary } from "@anyharness/sdk";
import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { HighlightedCodePanel } from "@/components/ui/content/HighlightedCodePanel";
import {
  useWorkspaceArtifactsQuery,
  useWorkspaceArtifactContentQuery,
  useWorkspaceArtifactQuery,
} from "@anyharness/sdk-react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAppSurfaceStore } from "@/stores/ui/app-surface-store";

const EMPTY_ARTIFACTS: WorkspaceArtifactSummary[] = [];

export function CoworkArtifactPanel() {
  const workspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedArtifactId = useAppSurfaceStore((state) =>
    workspaceId ? state.selectedArtifactIdByWorkspace[workspaceId] ?? null : null
  );
  const setSelectedArtifactId = useAppSurfaceStore((state) => state.setSelectedArtifactId);

  const artifactsQuery = useWorkspaceArtifactsQuery({
    workspaceId,
    enabled: !!workspaceId,
  });
  const artifacts = artifactsQuery.data ?? EMPTY_ARTIFACTS;
  const effectiveSelectedArtifactId = useMemo(
    () => resolveEffectiveArtifactId(artifacts, selectedArtifactId),
    [artifacts, selectedArtifactId],
  );
  const { data: artifact } = useWorkspaceArtifactQuery(effectiveSelectedArtifactId, {
    workspaceId,
    enabled: !!workspaceId && !!effectiveSelectedArtifactId,
  });
  const contentQuery = useWorkspaceArtifactContentQuery({
    workspaceId,
    artifactId: artifact?.id ?? null,
    relativePath: artifact?.entry ?? null,
    enabled: !!workspaceId && !!artifact && isNativeRenderer(artifact.renderer),
  });

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Artifacts</h2>
      </div>

      {!workspaceId ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Select a Cowork thread to view its artifacts.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border">
            <AutoHideScrollArea className="max-h-48">
              <div className="flex flex-col gap-px px-2 py-2">
                {artifacts.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No artifacts yet.
                  </div>
                )}
                {artifacts.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedArtifactId(workspaceId, item.id)}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors ${
                      item.id === effectiveSelectedArtifactId
                        ? "bg-accent text-foreground"
                        : "hover:bg-accent/60 text-muted-foreground"
                    }`}
                  >
                    <span className="truncate text-sm">{item.title}</span>
                    <span className="truncate text-xs">{item.renderer}</span>
                  </Button>
                ))}
              </div>
            </AutoHideScrollArea>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {!artifact ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Select an artifact to preview it.
              </div>
            ) : (
              <AutoHideScrollArea className="h-full">
                <div className="flex flex-col gap-4 px-4 py-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{artifact.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {artifact.renderer} · {artifact.entry}
                    </p>
                  </div>

                  {renderArtifactContent(artifact.renderer, contentQuery.data ?? null)}
                </div>
              </AutoHideScrollArea>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isNativeRenderer(renderer: string): boolean {
  return renderer === "text" || renderer === "markdown" || renderer === "code";
}

function resolveEffectiveArtifactId(
  artifacts: WorkspaceArtifactSummary[],
  selectedArtifactId: string | null,
): string | null {
  const latestArtifact = artifacts[0] ?? null;
  if (!latestArtifact) {
    return null;
  }

  if (!selectedArtifactId) {
    return latestArtifact.id;
  }

  const selectedArtifact = artifacts.find((candidate) => candidate.id === selectedArtifactId) ?? null;
  if (!selectedArtifact) {
    return latestArtifact.id;
  }

  if (latestArtifact.id === selectedArtifact.id) {
    return selectedArtifact.id;
  }

  return new Date(latestArtifact.updatedAt).getTime() > new Date(selectedArtifact.updatedAt).getTime()
    ? latestArtifact.id
    : selectedArtifact.id;
}

function renderArtifactContent(renderer: string, content: string | null) {
  if (renderer === "markdown") {
    return content
      ? <MarkdownRenderer content={content} />
      : <ArtifactPlaceholder message="Loading markdown preview…" />;
  }

  if (renderer === "code") {
    return content
      ? <HighlightedCodePanel code={content} language="text" />
      : <ArtifactPlaceholder message="Loading code preview…" />;
  }

  if (renderer === "text") {
    return content
      ? (
        <pre className="overflow-x-auto rounded-lg border border-border bg-background px-3 py-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {content}
        </pre>
      )
      : <ArtifactPlaceholder message="Loading text preview…" />;
  }

  return (
    <ArtifactPlaceholder
      message={`The ${renderer} renderer still needs the sandbox host wiring.`}
    />
  );
}

function ArtifactPlaceholder({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
