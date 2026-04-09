import { FileTreePane } from "./FileTreePane";

interface WorkspaceFilesPanelProps {
  showHeader?: boolean;
}

export function WorkspaceFilesPanel({ showHeader = true }: WorkspaceFilesPanelProps) {
  return (
    <div className="h-full flex flex-col">
      {showHeader && (
        <div className="flex items-center justify-between px-3 h-10 min-h-10 bg-sidebar border-b border-border shrink-0">
          <span className="text-xs font-medium text-foreground">Files</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <FileTreePane />
      </div>
    </div>
  );
}
