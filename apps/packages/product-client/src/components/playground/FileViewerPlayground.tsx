import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";
import { FileEditorView } from "#product/components/workspace/files/FileEditorView";
import {
  parseViewerTargetKey,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useSearchParams } from "react-router-dom";

type FileViewerPlaygroundCase =
  | "workspace-file"
  | "desktop-file"
  | "unavailable"
  | "empty"
  | "whitespace";

interface FileReferenceScenario {
  caseName: FileViewerPlaygroundCase;
  rawPath: string;
  workspacePath?: string;
}

const WORKSPACE_FILE_PATH = "src/example.ts";

/**
 * Deterministic file-reference route used by the browser qualification host.
 * It composes the shipped badge and viewer; the host owns all fixed transport
 * data and bridge counters.
 */
export function FileViewerPlayground() {
  const [params] = useSearchParams();
  const scenario = resolveScenario(params.get("case"));
  const activeTargetKey = useWorkspaceViewerTabsStore((state) => state.activeTargetKey);
  const activeTarget = activeTargetKey ? parseViewerTargetKey(activeTargetKey) : null;
  const activeFileTarget = activeTarget?.kind === "file" ? activeTarget : null;

  return (
    <main
      data-telemetry-block
      data-file-reference-routing-fixture
      data-fixture-case={scenario.caseName}
      className="flex h-screen min-h-0 min-w-0 flex-col bg-background text-foreground"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-4 py-3">
        <span className="text-ui-sm text-muted-foreground">File reference</span>
        <FileReferenceBadge
          rawPath={scenario.rawPath}
          workspacePath={scenario.workspacePath}
          variant="chip"
        />
      </div>
      <section
        aria-label="File viewer"
        data-file-reference-viewer={activeFileTarget ? "active" : "idle"}
        className="min-h-0 min-w-0 flex-1"
      >
        {activeFileTarget ? (
          <FileEditorView
            filePath={activeFileTarget.path}
            targetKey={viewerTargetKey(activeFileTarget)}
          />
        ) : null}
      </section>
    </main>
  );
}

function resolveScenario(value: string | null): FileReferenceScenario {
  switch (value) {
    case "desktop-file":
      return { caseName: value, rawPath: "/outside/reference.txt" };
    case "unavailable":
      return { caseName: value, rawPath: "/outside/reference.txt" };
    case "empty":
      return { caseName: value, rawPath: "" };
    case "whitespace":
      return { caseName: value, rawPath: "   " };
    case "workspace-file":
    default:
      return {
        caseName: "workspace-file",
        rawPath: WORKSPACE_FILE_PATH,
        workspacePath: WORKSPACE_FILE_PATH,
      };
  }
}
