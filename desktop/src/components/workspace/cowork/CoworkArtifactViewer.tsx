import type { CoworkArtifactDetailResponse } from "@anyharness/sdk";
import { useControlPlaneHealth } from "@/hooks/cloud/use-control-plane-health";
import { useCoworkArtifactViewer } from "@/hooks/cowork/use-cowork-artifact-viewer";

interface CoworkArtifactViewerProps {
  artifactDetail: CoworkArtifactDetailResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export function CoworkArtifactViewer({
  artifactDetail,
  isLoading,
  errorMessage,
}: CoworkArtifactViewerProps) {
  const controlPlaneHealth = useControlPlaneHealth();
  const previewAvailable = controlPlaneHealth.data === true;
  const { iframeRef, runtimeUrl, runtimeError } = useCoworkArtifactViewer(
    artifactDetail,
    previewAvailable,
  );

  if (!artifactDetail) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Select an artifact to preview it here.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Loading artifact preview.
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
        {errorMessage}
      </div>
    );
  }

  if (controlPlaneHealth.isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Checking preview runtime.
      </div>
    );
  }

  if (!previewAvailable) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Preview is unavailable without a reachable control plane. Artifact listing still works.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {runtimeError?.method === "ReportError" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {runtimeError.payload.type === "UnsupportedImports"
            ? `Unsupported imports: ${runtimeError.payload.modules.join(", ")}`
            : runtimeError.payload.type === "LibraryLoadFailed"
              ? `Failed to load libraries: ${runtimeError.payload.modules.join(", ")}`
              : runtimeError.payload.message}
        </div>
      )}
      <iframe
        key={artifactDetail.artifact.id}
        ref={iframeRef}
        src={runtimeUrl}
        // The hosted runtime iframe is trusted control-plane code. Untrusted
        // artifact code executes inside the runtime's own nested sandbox.
        sandbox="allow-scripts allow-same-origin"
        allow="clipboard-write"
        title={artifactDetail.artifact.title || artifactDetail.artifact.path}
        className="min-h-0 flex-1 rounded-lg border border-border bg-card"
      />
    </div>
  );
}
