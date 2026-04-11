import type {
  CoworkArtifactDetailResponse,
  CoworkArtifactSummary,
  CoworkArtifactType,
} from "@anyharness/sdk";

export interface CoworkRuntimeSetContentMessage {
  method: "SetContent";
  payload: {
    artifactId: string;
    type: CoworkArtifactType;
    title: string;
    content: string;
  };
}

export type CoworkRuntimeMessage =
  | { method: "ReadyForContent" }
  | { method: "OpenLink"; payload: { url: string } }
  | {
    method: "ReportError";
    payload:
      | { type: "UnsupportedImports"; modules: string[] }
      | { type: "LibraryLoadFailed"; modules: string[] }
      | { type: "TransformError"; message: string }
      | { type: "RuntimeError"; message: string };
  };

export function resolveCoworkArtifactTitle(
  artifact: Pick<CoworkArtifactSummary, "title" | "path">,
): string {
  return artifact.title?.trim() || artifact.path;
}

export function buildCoworkRuntimeContentMessage(
  detail: CoworkArtifactDetailResponse,
): CoworkRuntimeSetContentMessage {
  return {
    method: "SetContent",
    payload: {
      artifactId: detail.artifact.id,
      type: detail.artifact.type as CoworkArtifactType,
      title: resolveCoworkArtifactTitle(detail.artifact),
      content: detail.content,
    },
  };
}

export function isCoworkRuntimeMessage(value: unknown): value is CoworkRuntimeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const method = (value as { method?: unknown }).method;
  return method === "ReadyForContent"
    || method === "OpenLink"
    || method === "ReportError";
}

export interface OpenCoworkArtifactDeps {
  setArtifactPanelOpen: (workspaceId: string, open: boolean) => void;
  setSelectedArtifactId: (workspaceId: string, artifactId: string | null) => void;
}

export function runOpenCoworkArtifact(
  deps: OpenCoworkArtifactDeps,
  workspaceId: string,
  artifactId: string,
) {
  deps.setArtifactPanelOpen(workspaceId, true);
  deps.setSelectedArtifactId(workspaceId, artifactId);
}
