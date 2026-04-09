import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";

interface ModeToggleProps {
  filePath: string;
  activeMode: "edit" | "diff";
}

export function ModeToggle({ filePath, activeMode }: ModeToggleProps) {
  const setTabMode = useWorkspaceFilesStore((s) => s.setTabMode);

  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/50 p-0.5">
      <button
        onClick={() => setTabMode(filePath, "diff")}
        className={`h-5 px-2 rounded text-[10px] transition-colors ${
          activeMode === "diff"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Diff
      </button>
      <button
        onClick={() => setTabMode(filePath, "edit")}
        className={`h-5 px-2 rounded text-[10px] transition-colors ${
          activeMode === "edit"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Edit
      </button>
    </div>
  );
}
