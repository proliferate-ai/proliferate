import {
  useWorkspaceFilesStore,
  workspaceFileDiffPatchKey,
} from "@/stores/editor/workspace-files-store";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { ModeToggle } from "./ModeToggle";

interface FileDiffViewProps {
  filePath: string;
}

export function FileDiffView({ filePath }: FileDiffViewProps) {
  const descriptor = useWorkspaceFilesStore(
    (s) => s.tabDiffDescriptorsByPath[filePath],
  );
  const patchKey = workspaceFileDiffPatchKey(filePath, descriptor);
  const patch = useWorkspaceFilesStore((s) => s.tabPatches[patchKey]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground truncate">{filePath}</span>
        <ModeToggle filePath={filePath} activeMode="diff" />
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {patch ? (
          <DiffViewer patch={patch} />
        ) : (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">
            No diff available
          </p>
        )}
      </div>
    </div>
  );
}
