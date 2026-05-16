import { useEffect, useState } from "react";
import {
  CommandPaletteGroup,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteRoot,
  useCommandPaletteClose,
} from "@/components/ui/CommandPalette";
import { CommandPaletteGlyph } from "@/components/ui/command-palette-icons";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { useWorkspaceFileSearch } from "@/hooks/workspaces/files/ui/use-workspace-file-search";
import { splitFilePath } from "@/lib/domain/command-palette/entries";

interface WorkspaceFileSearchModalProps {
  open: boolean;
  workspaceId: string | null;
  runtimeBlockedReason: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

export function WorkspaceFileSearchModal({
  open,
  workspaceId,
  runtimeBlockedReason,
  onClose,
  onOpenFile,
}: WorkspaceFileSearchModalProps) {
  const [query, setQuery] = useState("");
  const runtimeReady = Boolean(workspaceId) && runtimeBlockedReason === null;
  const search = useWorkspaceFileSearch({
    open,
    workspaceId,
    runtimeReady,
    query,
    limit: 80,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const disabledMessage = workspaceId
    ? runtimeReady
      ? null
      : runtimeBlockedReason ?? "Workspace runtime is not ready yet."
    : "Workspace is still opening.";
  const hasQuery = search.query.length > 0;
  const hasResults = search.results.length > 0;
  const showLoading = hasQuery && (search.isLoading || search.debouncedQuery.length === 0);
  const showEmpty = hasQuery
    && search.debouncedQuery.length > 0
    && !search.isLoading
    && !search.isError
    && !hasResults;

  return (
    <CommandPaletteRoot
      open={open}
      onClose={onClose}
      label="Search workspace files"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center border-b border-border/70 px-3">
        <CommandPaletteGlyph
          name="search"
          className="mr-1 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <CommandPaletteInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search workspace files..."
          className="px-0"
        />
      </div>
      <CommandPaletteList>
        {disabledMessage ? (
          <WorkspaceFileSearchMessage>{disabledMessage}</WorkspaceFileSearchMessage>
        ) : !hasQuery ? (
          <WorkspaceFileSearchMessage>Type to search workspace files.</WorkspaceFileSearchMessage>
        ) : hasResults ? (
          <CommandPaletteGroup heading="Files">
            {search.results.map((result) => (
              <WorkspaceFileSearchRow
                key={result.path}
                path={result.path}
                name={result.name}
                onOpenFile={onOpenFile}
              />
            ))}
          </CommandPaletteGroup>
        ) : showLoading ? (
          <WorkspaceFileSearchMessage>Searching files</WorkspaceFileSearchMessage>
        ) : showEmpty ? (
          <WorkspaceFileSearchMessage>No files found</WorkspaceFileSearchMessage>
        ) : null}
        {search.isError && (
          <WorkspaceFileSearchMessage>Failed to search files.</WorkspaceFileSearchMessage>
        )}
      </CommandPaletteList>
    </CommandPaletteRoot>
  );
}

function WorkspaceFileSearchRow({
  path,
  name,
  onOpenFile,
}: {
  path: string;
  name: string;
  onOpenFile: (path: string) => void;
}) {
  const close = useCommandPaletteClose();
  const display = splitFilePath(path);
  const label = name || display.name;

  return (
    <CommandPaletteItem
      value={path}
      onSelect={() => {
        close({ restoreFocus: false });
        window.requestAnimationFrame(() => onOpenFile(path));
      }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <FileTreeEntryIcon
          name={label}
          path={path}
          kind="file"
          className="size-4"
        />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{label}</span>
        {display.parent && (
          <span
            className="min-w-0 truncate text-muted-foreground"
            title={display.parent}
            data-telemetry-mask
          >
            {display.parent}
          </span>
        )}
      </span>
    </CommandPaletteItem>
  );
}

function WorkspaceFileSearchMessage({ children }: { children: string }) {
  return (
    <div
      className="px-3 py-8 text-center text-xs text-muted-foreground"
      data-telemetry-mask
    >
      {children}
    </div>
  );
}
