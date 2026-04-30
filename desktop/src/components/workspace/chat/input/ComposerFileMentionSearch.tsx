import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import type { RefObject } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { LoaderCircle, Search } from "@/components/ui/icons";

type FileSearchResult = SearchWorkspaceFilesResponse["results"][number];

interface ComposerFileMentionSearchProps {
  query: string;
  results: FileSearchResult[];
  highlightedIndex: number;
  isLoading: boolean;
  errorMessage: string | null;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (result: FileSearchResult) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
  className?: string;
}

export function ComposerFileMentionSearch({
  query,
  results,
  highlightedIndex,
  isLoading,
  errorMessage,
  listRef,
  onSelect,
  onRowMouseEnter,
  setRowRef,
  className,
}: ComposerFileMentionSearchProps) {
  const emptyMessage = query.trim().length > 0
    ? `No files match "${query.trim()}".`
    : "Type to search workspace files.";

  return (
    <div
      data-telemetry-mask
      className={twMerge(
        "mx-3 mb-2 overflow-hidden rounded-lg border border-border/70 bg-card shadow-floating",
        className,
      )}
    >
      <div className="flex h-8 items-center gap-2 border-b border-border/60 px-2.5 text-[0.5rem] text-muted-foreground">
        {isLoading ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <Search className="size-3.5 shrink-0" />
        )}
        <span className="truncate">
          {query.trim() ? `Search files: ${query.trim()}` : "Search files"}
        </span>
      </div>
      <div
        ref={listRef}
        className="max-h-48 overflow-y-auto p-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-scrollbar-thumb) transparent" }}
      >
        {errorMessage ? (
          <div className="px-3 py-4 text-center text-[0.5rem] text-destructive">
            {errorMessage}
          </div>
        ) : results.length > 0 ? (
          <div className="space-y-0.5">
            {results.map((result, index) => (
              <Button
                key={result.path}
                ref={(element) => setRowRef(index, element)}
                type="button"
                variant="ghost"
                size="sm"
                onMouseEnter={() => onRowMouseEnter(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => onSelect(result)}
                className={`h-8 w-full justify-start gap-1.5 rounded-md px-2 text-left font-normal ${
                  index === highlightedIndex
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <FileTreeEntryIcon
                  name={result.name}
                  path={result.path}
                  kind="file"
                  className="size-4 shrink-0"
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                  <span className="shrink-0 truncate text-[0.8125rem] leading-none text-foreground">
                    {result.name}
                  </span>
                  <span
                    className="min-w-0 truncate text-start font-mono text-[0.6875rem] leading-none text-muted-foreground [direction:rtl]"
                    title={result.path}
                  >
                    <span className="[direction:ltr] [unicode-bidi:plaintext]">
                      {result.path}
                    </span>
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="px-3 py-4 text-center text-[0.5rem] text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
