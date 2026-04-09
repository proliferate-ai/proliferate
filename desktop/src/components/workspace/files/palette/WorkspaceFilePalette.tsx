import { Input } from "@/components/ui/Input";
import { useWorkspaceFilePalette } from "@/hooks/editor/use-workspace-file-palette";
import { WorkspaceFilePaletteSurface } from "./WorkspaceFilePaletteSurface";
import { WorkspaceFilePaletteRow } from "./WorkspaceFilePaletteRow";

interface WorkspaceFilePaletteProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceFilePalette({
  open,
  onClose,
}: WorkspaceFilePaletteProps) {
  const {
    query,
    setQuery,
    highlightedIndex,
    results,
    isLoading,
    isError,
    errorMessage,
    inputRef,
    listRef,
    handleInputKeyDown,
    handleRowMouseEnter,
    setRowRef,
    selectPath,
    closePalette,
  } = useWorkspaceFilePalette({
    open,
    onClose,
  });

  const emptyMessage = query.trim().length > 0
    ? `No files match "${query.trim()}".`
    : "No files found.";

  return (
    <WorkspaceFilePaletteSurface open={open} onClose={closePalette}>
      <div className="border-b border-border/60 px-4 py-3">
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type a file name or path"
          autoComplete="off"
          spellCheck={false}
          className="!h-auto !border-0 !bg-transparent !px-0 !py-0 text-[0.9375rem] text-foreground !shadow-none placeholder:text-muted-foreground/70 !ring-0 focus:!ring-0 focus:!outline-none"
        />
      </div>

      <div
        ref={listRef}
        className="max-h-[420px] overflow-y-auto p-2"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-scrollbar-thumb) transparent" }}
      >
        {isError ? (
          <div className="px-3 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : results.length > 0 ? (
          <div className="space-y-0.5">
            {results.map((result, index) => (
              <WorkspaceFilePaletteRow
                key={result.path}
                name={result.name}
                path={result.path}
                active={index === highlightedIndex}
                onClick={() => {
                  void selectPath(result.path);
                }}
                onMouseEnter={() => handleRowMouseEnter(index)}
                buttonRef={(element) => setRowRef(index, element)}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            {isLoading ? "Searching…" : emptyMessage}
          </div>
        )}
      </div>
    </WorkspaceFilePaletteSurface>
  );
}
