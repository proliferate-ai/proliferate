import { Input } from "@/components/ui/Input";
import { useWorkspaceFilePalette } from "@/hooks/editor/use-workspace-file-palette";
import { LoaderCircle, Search } from "@/components/ui/icons";
import { WorkspaceFilePaletteSurface } from "./WorkspaceFilePaletteSurface";
import { WorkspaceFilePaletteRow } from "./WorkspaceFilePaletteRow";

const LOADING_ROW_WIDTHS = ["w-3/5", "w-4/5", "w-2/3", "w-5/6", "w-1/2"];

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
  const isInitialLoading = isLoading && results.length === 0;

  return (
    <WorkspaceFilePaletteSurface
      open={open}
      onClose={closePalette}
      headerContent={(
        <div className="relative flex h-8 items-center">
          <Search className="pointer-events-none absolute left-0 size-4 text-muted-foreground/70" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a file name or path"
            aria-label="Search files"
            autoComplete="off"
            spellCheck={false}
            className="!h-8 !border-0 !bg-transparent !py-0 !pl-6 !pr-8 text-[0.9375rem] text-foreground !shadow-none placeholder:text-muted-foreground/70 !ring-0 focus:!ring-0 focus:!outline-none"
          />
          {isLoading && (
            <LoaderCircle className="pointer-events-none absolute right-0 size-4 animate-spin text-muted-foreground/70" />
          )}
        </div>
      )}
    >
      <div className="flex h-[560px] max-h-[calc(100vh-8rem)] flex-col">
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 p-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-scrollbar-thumb) transparent" }}
        >
          {isError ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
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
          ) : isInitialLoading ? (
            <WorkspaceFilePaletteLoading />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          )}
        </div>
      </div>
    </WorkspaceFilePaletteSurface>
  );
}

function WorkspaceFilePaletteLoading() {
  return (
    <div className="flex h-full flex-col justify-center px-3">
      <div className="mb-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>Searching files</span>
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        {LOADING_ROW_WIDTHS.map((widthClassName, index) => (
          <div
            key={widthClassName}
            className="flex h-8 items-center gap-2 rounded-md px-2.5"
          >
            <div className="size-4 shrink-0 rounded bg-muted/50 animate-pulse" />
            <div
              className={`h-2.5 rounded bg-muted/50 animate-pulse ${widthClassName}`}
              style={{ animationDelay: `${index * 70}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
