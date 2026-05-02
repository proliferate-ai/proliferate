import { useEffect, useState } from "react";
import {
  useCreateWorkspaceDirectoryMutation,
  useCreateWorkspaceFileMutation,
} from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export function FileCreateDraftRow() {
  const treeStateKey = useWorkspaceViewerTabsStore((s) => s.treeStateKey);
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((s) => s.materializedWorkspaceId);
  const draft = useWorkspaceFileTreeUiStore((s) =>
    treeStateKey ? s.createDraftByTreeKey[treeStateKey] : undefined
  );
  const clearCreateDraft = useWorkspaceFileTreeUiStore((s) => s.clearCreateDraft);
  const expandDirectory = useWorkspaceFileTreeUiStore((s) => s.expandDirectory);
  const createFile = useCreateWorkspaceFileMutation({
    workspaceId: materializedWorkspaceId,
  });
  const createDirectory = useCreateWorkspaceDirectoryMutation({
    workspaceId: materializedWorkspaceId,
  });
  const { openFile } = useWorkspaceFileActions();
  const [name, setName] = useState("");
  const draftKey = draft ? `${draft.kind}:${draft.parentPath}` : null;

  useEffect(() => {
    setName("");
  }, [draftKey]);

  if (!treeStateKey || !draft) {
    return null;
  }

  const clearDraft = () => {
    setName("");
    clearCreateDraft(treeStateKey);
  };

  const fullPath = draft.parentPath
    ? `${draft.parentPath}/${name.trim()}`
    : name.trim();
  const submit = async () => {
    if (!fullPath) {
      return;
    }
    if (draft.kind === "file") {
      await createFile.mutateAsync({ path: fullPath, content: "" });
      clearDraft();
      await openFile(fullPath);
      return;
    }
    await createDirectory.mutateAsync({ path: fullPath });
    expandDirectory(treeStateKey, fullPath);
    clearDraft();
  };

  const loading = createFile.isPending || createDirectory.isPending;

  return (
    <div className="border-b border-sidebar-border bg-sidebar-background px-2 py-2">
      <div className="flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1">
        <FileTreeEntryIcon
          name={name || (draft.kind === "file" ? "new-file" : "new-folder")}
          path={fullPath}
          kind={draft.kind}
          className="size-3.5 shrink-0"
        />
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape") {
              clearDraft();
            }
          }}
          placeholder={draft.kind === "file" ? "filename.ext" : "folder name"}
          className="h-7 min-w-0 border-sidebar-border bg-sidebar-background px-2 text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={loading}
          disabled={!name.trim()}
          onClick={() => void submit()}
          className="h-7 px-2 text-xs"
        >
          Create
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearDraft}
          className="h-7 px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-background"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
